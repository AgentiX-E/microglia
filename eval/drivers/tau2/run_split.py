"""Run one phase of the tau2-bench lane and write the upstream result document.

Three phases, because the lane needs three different things and a single script
with a mode flag is easier to reason about than three scripts that must agree:

  list   print the task ids of a task set, so the caller can split them
  learn  run a split with the plain agent and save what happened, so failures can
         be turned into corrections
  eval   run a split with `MicrogliaAgent` (or the plain agent) and save it

The output is upstream's own `results.json`, which `packages/eval/src/l4.ts` already
knows how to read in both of its storage forms. Nothing here re-implements scoring:
tau2's evaluator decides the reward, and this script only decides which tasks and
which agent.

Everything that can be decided without running is decided in TypeScript
(`packages/eval/src/tau2.ts`): the split, the corrections, and the argv itself. What
is left here is the part that must touch tau2.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter
# Module level rather than inside the two functions that also need it: `_record_usage` is a
# litellm callback and runs outside any of them, so a local import would be a `NameError` at the
# first billed call -- which is exactly how the self-check found it.
from datetime import datetime, timezone
from pathlib import Path

import litellm
from tau2.registry import registry

# Which τ² this is, decided by what the package exports rather than by a version string.
#
# v0.2.0 has `tau2.run.get_tasks(domain, task_ids)` and one flat `run_tasks(**kwargs)`.
# v1.0.0 moved the runner to `tau2.runner.*`, made `run_tasks(config, tasks, …)` take a
# `TextRunConfig`, and — the reason this matters — started shipping
# `data/tau2/domains/<domain>/split_tasks.json` (retail: 74 train / 40 test), which is the
# partition the published held-out figures were produced on. R92 ran on v0.2.0 and died on the
# first read: the file it was registered to read does not exist in that release.
#
# The probe is an import, not a version comparison: a release that back-ports one half and not
# the other would pass a string test and fail at the first call. `--phase selftest` prints what
# this found and checks the surface the run is about to use, so a mismatch costs two seconds
# instead of an installed environment and an aborted phase.
try:
    from tau2.runner.batch import run_tasks as _run_tasks_v1
    from tau2.runner.helpers import get_tasks as _get_tasks_v1
    from tau2.data_model.simulation import TextRunConfig

    TAU_RUNNER = "v1"
except ImportError:  # v0.2.0 — the ref every arm before R92 ran
    from tau2.run import get_tasks as _get_tasks_v0
    from tau2.run import run_tasks as _run_tasks_v0

    TAU_RUNNER = "v0"


def get_tasks(domain: str, wanted: list[str] | None = None):
    """The tasks of a domain, or the named ones, in whichever shape this τ² takes.

    v1's `get_tasks` raises `ValueError` when an id is missing, which is the behaviour this lane
    wants and had to implement itself on v0.2.0 (`tau2-task-missing`). Both are kept because the
    caller's contract — ids in, tasks out, a missing id is a refusal — is one contract.
    """
    if TAU_RUNNER == "v1":
        return _get_tasks_v1(domain, task_ids=list(wanted) if wanted else None)
    return _get_tasks_v0(domain, wanted or None)


def run_tasks(
    *,
    domain: str,
    tasks,
    agent: str,
    model: str,
    llm_args: dict,
    trials: int,
    max_steps: int,
    out: str,
    seed: int | None,
    concurrency: int,
    save_to: str,
):
    """One phase of episodes, on either runner.

    The two signatures are not reconcilable by keyword forwarding: v1 wants one `TextRunConfig`
    and reads `save_path` from a keyword, v0 wants twelve keywords and reads `save_to` from them.
    So the translation lives here, in one function a reader can check against both, rather than
    in two call sites that would drift the first time one of them changed.
    """
    if TAU_RUNNER == "v1":
        config = TextRunConfig(
            domain=domain,
            agent=agent,
            llm_agent=model,
            llm_args_agent=llm_args,
            user="user_simulator",
            llm_user=model,
            llm_args_user=llm_args,
            num_trials=trials,
            max_steps=max_steps,
            max_concurrency=concurrency,
            **({} if seed is None else {"seed": seed}),
        )
        return _run_tasks_v1(
            config,
            list(tasks),
            save_path=Path(out),
            console_display=False,
            results_format="json",
        )
    return _run_tasks_v0(
        domain=domain,
        tasks=tasks,
        agent=agent,
        user="user_simulator",
        llm_agent=model,
        llm_args_agent=llm_args,
        llm_user=model,
        llm_args_user=llm_args,
        num_trials=trials,
        max_steps=max_steps,
        save_to=save_to,
        console_display=False,
        max_concurrency=concurrency,
        seed=seed,
    )


def selftest() -> int:
    """What this τ² exposes, and whether it is what the phase below is about to call.

    Run before the episodes, not after: the expensive failure mode is a signature that moved, and
    the cheap place to find it is here. Every check is a property of the installed package.
    """
    import inspect

    problems: list[str] = []
    signature = inspect.signature(get_tasks)
    if "domain" not in signature.parameters:
        problems.append(f"get_tasks has no `domain` parameter: {signature}")
    runner = _run_tasks_v1 if TAU_RUNNER == "v1" else _run_tasks_v0
    runner_params = inspect.signature(runner).parameters
    if TAU_RUNNER == "v1":
        if "config" not in runner_params or "tasks" not in runner_params:
            problems.append(f"run_tasks is not (config, tasks): {list(runner_params)[:4]}")
        if "save_path" not in runner_params or "results_format" not in runner_params:
            problems.append(f"run_tasks lost save_path/results_format: {list(runner_params)[:8]}")
        fields = set(TextRunConfig.model_fields)
        for field in ("domain", "agent", "llm_agent", "llm_args_agent", "user", "num_trials"):
            if field not in fields:
                problems.append(f"TextRunConfig has no `{field}`")
    else:
        for field in ("domain", "tasks", "agent", "save_to", "num_trials"):
            if field not in runner_params:
                problems.append(f"run_tasks has no `{field}`")
    if not hasattr(registry, "get_agents"):
        problems.append("the registry has no get_agents")
    if not hasattr(registry, "register_agent") and not hasattr(
        registry, "register_agent_factory"
    ):
        problems.append("the registry has neither register_agent nor register_agent_factory")
    problems.extend(_selftest_assertion_guard())
    if problems:
        for problem in problems:
            print(f"[tau2] selftest: {problem}", file=sys.stderr)
        return 1
    print(
        f"[tau2] selftest: runner {TAU_RUNNER}, get_tasks{signature}, registry ok, "
        "nl-assertion guard 5/5"
    )
    return 0


def _selftest_assertion_guard() -> list[str]:
    """The guard's own answers, checked with objects rather than with a provider call.

    Two of these five cases are the ones that cost a dispatch: an empty answer (which τ² would score
    1.0) and an answer that repeats one assertion (which would let one condition stand for two).
    The rest pin the shapes a redirected judge plausibly returns — a count short by one, a reworded
    assertion, a verdict serialised as a string.
    """
    class Check:
        def __init__(self, assertion, met):
            self.nl_assertion = assertion
            self.met = met

    cases = [
        ([Check("a", True), Check("b", False)], ["a", "b"], None),
        # A reworded echo is not a failure: the scorer zips the reply in order and never matches text.
        ([Check("A.", True), Check("b", False)], ["a", "b"], None),
        ([], ["a", "b"], "answered 0 of 2"),
        ([Check("a", True)], ["a", "b"], "answered 1 of 2"),
        ([Check("a", "yes"), Check("b", True)], ["a", "b"], "answered without a verdict"),
    ]
    problems = []
    for index, (checks, asked, expected) in enumerate(cases):
        got = assertion_gap(checks, asked)
        if got != expected:
            problems.append(
                f"nl-assertion guard case {index + 1}: expected {expected!r}, got {got!r}"
            )
    return problems

# What this run spent, counted where it is spent.
#
# `l4` recorded `calls: 0` on every arm for two months because the episode count belongs to
# another process and the distillation count belongs to this one, and nothing counted tokens
# at all. A lane that cannot report its own bill cannot notice that one of its two arms is
# paying the cache-miss rate on work the other arm pays the cache-hit rate for — which is
# exactly what a per-turn memory injection does, silently, on every turn.
#
# The counter is a `Counter` rather than a dataclass because the provider's field names are
# the record: `prompt_cache_hit_tokens` is DeepSeek's own, and a renamed copy would drift
# from the API that produces it.
_usage: Counter = Counter()


# What each call's prompt was made of, summed rather than listed.
#
# The phase totals say the memory arm was billed 3.7× the control's uncached tokens on each of its
# sixteen calls, and they cannot say whether those tokens were the pack, the conversation in front of
# it, or the observation appended behind it — three mechanisms with three different repairs. The
# messages of every call pass through this callback, so the composition is free to measure: the
# provider's `prompt_cache_hit_tokens` is a count of what it held, and the prompt's own shape is a
# count of what it was asked to hold. A census of the second beside the first is the difference
# between a bill and an attribution.
#
# Sums, not a series: 2,700 calls an arm is a list nobody reads and a file that grows with the
# workload. The first call is kept apart because it is the only one whose prefix was never offered
# to the cache before.
_cache: Counter = Counter()
_first_call: "dict[str, int] | None" = None


def _content_chars(message) -> int:
    """The character count of one message, through both shapes the provider accepts."""
    content = getattr(message, "content", None)
    if content is None and isinstance(message, dict):
        content = message.get("content")
    if isinstance(content, str):
        return len(content)
    if isinstance(content, (list, tuple)):
        # Multimodal content arrives as parts; a part that is not text contributes a boundary
        # rather than a guess, so the census understates rather than invents.
        total = 0
        for part in content:
            if isinstance(part, str):
                total += len(part)
            elif isinstance(part, dict) and isinstance(part.get("text"), str):
                total += len(part["text"])
        return total
    return 0


def _role_of(message) -> str:
    role = getattr(message, "role", None)
    if role is None and isinstance(message, dict):
        role = message.get("role")
    return role if isinstance(role, str) else ""


def _census_of(messages) -> "dict[str, int] | None":
    """One call's prompt shape, or `None` when the callback was given no messages."""
    if not isinstance(messages, (list, tuple)) or not messages:
        return None
    sizes = [_content_chars(message) for message in messages]
    system = sum(size for size, message in zip(sizes, messages) if _role_of(message) == "system")
    return {
        "messages": len(sizes),
        "chars": sum(sizes),
        # Everything before the final message is what the previous request ended with, so it is the
        # part the provider should already hold. The final message is the turn's new material.
        "prefix_chars": sum(sizes[:-1]),
        # And the material before the last *two* messages is the part the provider provably saw in
        # an earlier request: a tool loop appends the assistant's call and the tool's result
        # together, and the cache is built from request prefixes, never from what the model wrote.
        # Zero on a call too short to have one, which is why its own count travels beside it.
        "seen_chars": sum(sizes[:-2]) if len(sizes) > 2 else 0,
        "seen_calls": 1 if len(sizes) > 2 else 0,
        "last_chars": sizes[-1],
        "system_chars": system,
        "conversation_chars": sum(sizes) - system,
    }


def _number(usage, name: str) -> int:
    value = getattr(usage, name, None)
    if value is None and isinstance(usage, dict):
        value = usage.get(name)
    return int(value) if isinstance(value, (int, float)) else 0


# When this phase's first billable call happened, which is the only clock the bill has.
#
# `usage_stats()` used to read the time it was called, and that is the *end* of the phase: R58's
# evaluation began at 04:48 UTC (off-peak) and finished at 06:21 (peak), and its artefact reported
# $2.1162 -- the whole ninety-three minutes priced at the double rate, when the same tokens in the
# band the phase actually ran in cost $1.0581. A bill computed at the wrong end of the run is not a
# conservative estimate; it is a number that would make an operator move a window that was fine.
_first_call_at: "datetime | None" = None


def _record_usage(kwargs, response, start_time, end_time) -> None:
    global _first_call_at, _first_call
    del start_time, end_time
    census = _census_of(kwargs.get("messages") if isinstance(kwargs, dict) else None)
    usage = getattr(response, "usage", None)
    if usage is None:
        return
    if _first_call_at is None:
        _first_call_at = datetime.now(timezone.utc)
    if census is not None:
        _cache["calls"] += 1
        for name, value in census.items():
            _cache[name] += value
        if _first_call is None:
            # The first call of the phase is the only one the provider had never seen, so its
            # prompt is the one measurement of this corpus's characters per token that is not
            # contaminated by a cache hit.
            _first_call = {
                **census,
                "prompt_tokens": _number(usage, "prompt_tokens"),
                "cached_tokens": _number(usage, "prompt_cache_hit_tokens"),
            }
    _usage["calls"] += 1
    _usage["prompt_tokens"] += _number(usage, "prompt_tokens")
    _usage["completion_tokens"] += _number(usage, "completion_tokens")
    _usage["cached_tokens"] += _number(usage, "prompt_cache_hit_tokens")


def reset_usage() -> None:
    """Clear the counters, so a self-check's second case is not billed for its first."""
    global _first_call_at, _first_call
    _usage.clear()
    _cache.clear()
    _first_call_at = None
    _first_call = None


# litellm's callbacks are process-global and this module is imported once per process, but
# `run_split` is also imported by its self-check, which imports it more than once under
# different names. Guarding on identity keeps the count from doubling.
if _record_usage not in litellm.success_callback:
    litellm.success_callback.append(_record_usage)


def cache_census() -> dict:
    """The prompt's shape against the cache the provider credited.

    `prefix_coverage` is the whole point: it is the share of the material the provider provably saw
    in an earlier request (everything before the final two messages, since a tool loop appends the
    assistant's call and the tool's result together) that the provider's own
    `prompt_cache_hit_tokens` actually credited. Near 1.0 the prefix is held and every miss is the
    turn's new material; near 0 the lane is re-billing a prefix it thinks is stable, which is a
    cadence or a boundary rather than a size.

    Absent rather than zeroed when the callback saw no messages, because `0.0` reads as "the
    provider credited nothing" and that is a claim about a measurement that did not happen.
    """
    prompt = _usage["prompt_tokens"]
    cached = _usage["cached_tokens"]
    calls = _usage["calls"]
    if _cache["calls"] == 0 or prompt <= 0 or calls == 0:
        return {"measured": False, "calls_with_messages": _cache["calls"]}
    first = _first_call or {}
    first_prompt = int(first.get("prompt_tokens") or 0)
    # Measured on the one call the provider had never seen, and only there: a ratio taken from the
    # phase total would be the average of a hit and a miss, which is not a property of the text.
    ratio = (first.get("chars", 0) / first_prompt) if first_prompt > 0 else 0.0
    if ratio <= 0:
        return {"measured": False, "calls_with_messages": _cache["calls"], "reason": "no first call"}
    seen = _cache["calls"]
    mean_seen_tokens = (
        (_cache["seen_chars"] / _cache["seen_calls"]) / ratio if _cache["seen_calls"] else 0.0
    )
    mean_last_tokens = (_cache["last_chars"] / seen) / ratio
    mean_cached = cached / calls
    return {
        "measured": True,
        "calls_with_messages": seen,
        "chars_per_token": round(ratio, 4),
        # Mean per call, so it is comparable to the provider's mean per call.
        "prefix_tokens": round(mean_seen_tokens, 1),
        "last_tokens": round(mean_last_tokens, 1),
        "cached_tokens_per_call": round(mean_cached, 1),
        "uncached_tokens_per_call": round(max(0, prompt - cached) / calls, 1),
        "prefix_coverage": round(mean_cached / mean_seen_tokens, 4)
        if mean_seen_tokens > 0
        else None,
        "first_call": {
            "messages": first.get("messages", 0),
            "chars": first.get("chars", 0),
            "prompt_tokens": first_prompt,
            "cached_tokens": int(first.get("cached_tokens") or 0),
        },
    }


def usage_stats() -> dict:
    """The run's bill, with the derived figures a reader would otherwise compute wrong."""
    prompt = _usage["prompt_tokens"]
    cached = _usage["cached_tokens"]
    completion = _usage["completion_tokens"]
    uncached = max(0, prompt - cached)
    return {
        "calls": _usage["calls"],
        "prompt_tokens": prompt,
        "completion_tokens": completion,
        "cached_tokens": cached,
        # Missed input is what the money is actually spent on, and it is not `prompt_tokens`:
        # DeepSeek bills a cache hit at a fiftieth of the miss rate, so a run can double its
        # prompt and halve its cost.
        "uncached_tokens": uncached,
        # A rate, not a count, because the comparison between arms is a rate: 0 means every
        # token of the memory arm missed, which is the symptom this counter exists to expose.
        "cache_hit_rate": (cached / prompt) if prompt else None,
        # The composition of what was sent, beside the counts of what was held. A phase total says
        # the memory arm missed 3.7× as much; only this says whether the missed material was the
        # pack (once), the prefix (a cadence) or the turn (an observation).
        "cache": cache_census(),
        "cost": _cost(prompt, cached, completion, _first_call_at),
    }


# Per million tokens, read from `eval/manifests/model-rates.json`.
#
# The card is data rather than source because it has two readers — this driver and
# `packages/eval/src/cost.ts` — and two hardcoded copies of the same table is the arrangement
# in which one of them is eventually wrong. It was two hardcoded copies until now: the S2/BIRD
# lane billed nothing at all, so nothing could catch the drift, and the first thing the card
# caught was that the lane had been asking for a retired model.
#
# The file is loaded once at import. A missing or malformed card raises rather than falling back
# to a built-in table: a bill computed from a default rate is a bill nobody can check.
_RATE_CARD_PATH = Path(__file__).resolve().parents[2] / "manifests" / "model-rates.json"


def _load_rate_card(path=None) -> dict:
    """The rate card, as the one object the bill and the guard both read."""
    source = path or _RATE_CARD_PATH
    with open(source, encoding="utf-8") as handle:
        card = json.load(handle)
    # One card per provider, one price row per model. The row this driver bills with is the card's
    # `defaultModel`, which is the model the lane is configured with; a second row is another model's
    # price and using it here would be using the wrong one.
    prices = card.get("prices")
    default = card.get("defaultModel")
    if not isinstance(prices, dict) or not isinstance(default, str) or default == "":
        raise ValueError(f"model-rates.json has no 'prices'/'defaultModel': {source}")
    for band in ("peak", "off_peak"):
        rates = (prices.get(default) or {}).get(band)
        if not isinstance(rates, dict) or not {"miss", "hit", "out"} <= set(rates):
            raise ValueError(f"model-rates.json has no usable '{band}' band for {default}: {source}")
    windows = card.get("peakWindows")
    if not isinstance(windows, list) or not windows:
        raise ValueError(f"model-rates.json has no 'peakWindows': {source}")
    return card


_RATE_CARD = _load_rate_card()
_RATES = _RATE_CARD["prices"][_RATE_CARD["defaultModel"]]
_PEAK_WINDOWS = tuple(
    (int(window["fromHourUtc"]), int(window["toHourUtc"])) for window in _RATE_CARD["peakWindows"]
)
_PEAK_WEEKDAYS_ONLY = bool(_RATE_CARD.get("peakWeekdaysOnly", True))


def _is_peak(now=None) -> bool:
    """Peak is 01:00–04:00 and 06:00–10:00 UTC, Monday to Friday.

    This is not a rounding: the same workload costs exactly twice as much inside those
    windows, and every long run this repository has dispatched has started inside one of
    them, because the person dispatching was awake in UTC+8 at the time.

    The windows come from the rate card rather than from this docstring. They matched when
    both were written, and the docstring is what a reader checks the code against.
    """
    from datetime import datetime, timezone

    moment = now or datetime.now(timezone.utc)
    if _PEAK_WEEKDAYS_ONLY and moment.weekday() >= 5:
        return False
    hour = moment.hour
    return any(start <= hour < end for start, end in _PEAK_WINDOWS)


def _next_off_peak(now=None):
    """When the current peak window ends, so a refusal can say what to wait for.

    A guard that says "not now" and not "at 10:00 UTC" is a guard an operator overrides, and
    overriding it is how a run gets dispatched at double price a second time.
    """
    from datetime import datetime, timedelta, timezone

    moment = now or datetime.now(timezone.utc)
    if not _is_peak(moment):
        return moment
    for hours in range(0, 25):
        candidate = (moment + timedelta(hours=hours)).replace(minute=0, second=0, microsecond=0)
        if candidate <= moment:
            continue
        if not _is_peak(candidate):
            return candidate
    return moment


def peak_refusal(now=None) -> str:
    """The marker a peak-window dispatch is refused with, or an empty string.

    The rate card doubles at 01:00-04:00 and 06:00-10:00 UTC on weekdays, and UTC 01:00-10:00 is
    09:00-18:00 in UTC+8 -- the hours the operator is awake. Every long run this lane has
    dispatched started inside one of those windows, so the schedule was set by a time zone rather
    than by a decision. Refusing before the first API call turns a doubled bill into a message.
    """
    from datetime import datetime, timezone

    moment = now or datetime.now(timezone.utc)
    if not _is_peak(moment):
        return ""
    opens = _next_off_peak(moment)
    return (
        f"tau2-peak-window: dispatched at {moment.strftime('%a %H:%M')} UTC, where the same tokens "
        f"cost exactly twice the off-peak rate; the window closes at {opens.strftime('%a %H:%M')} UTC"
    )


def _cost(prompt: int, cached: int, completion: int, now=None, ended=None) -> dict:
    """The bill for one run, in the band that run actually ran in.

    `now` is a parameter rather than a call to the clock inside, because a function that reads the
    clock cannot be tested: the first version of this one made its own self-check pass or fail
    depending on what hour the suite was run, which is a check that cannot say no on a Tuesday
    afternoon. Every caller that means "now" passes nothing; every test passes a fixed moment.

    `ended` exists for the same reason and for one fact: a phase can outlive its window. `now` is
    the moment the phase opened, because that is the band a dispatch chose and the band the calls
    were mostly made in; `ended` is the moment it closed, and when the two are in different bands
    the bill is bounded rather than known. R58's evaluation crossed 06:00 UTC and its artefact
    priced ninety-three minutes entirely at the closing band -- double what the same tokens cost.
    """
    peak = _is_peak(now)
    mine = _RATES["peak" if peak else "off_peak"]
    other = _RATES["off_peak" if peak else "peak"]
    uncached = max(0, prompt - cached)

    def bill(rate: dict) -> float:
        return round(
            cached / 1_000_000 * rate["hit"]
            + uncached / 1_000_000 * rate["miss"]
            + completion / 1_000_000 * rate["out"],
            4,
        )

    ended_peak = _is_peak(ended)
    crossed = ended_peak != peak
    return {
        "usd": bill(mine),
        "band": "peak" if peak else "off_peak",
        "rates": mine,
        # What the same tokens would have cost in the other band. A run that reports only its
        # own band cannot be scheduled: the reader needs to know what moving it would save.
        "usd_in_other_band": bill(other),
        # A phase that outlived its window is bounded by two numbers and the truth is between them:
        # `usd` prices every call in the band the phase opened in, and this one prices them all in
        # the band it closed in. Neither is a guess about the mix, and the pair is what lets a
        # reader see that the window moved under the run rather than assume it did not.
        **({"band_boundary_crossed": True, "usd_if_ended_in_its_closing_band": bill(
            _RATES["peak" if ended_peak else "off_peak"]
        )} if crossed else {}),
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="tau2 phase runner for the microglia L4 lane")
    parser.add_argument("--domain", default="retail")
    parser.add_argument(
        "--phase", choices=["list", "learn", "eval", "selftest"], required=True
    )
    parser.add_argument("--agent", default="llm_agent")
    parser.add_argument("--trials", type=int, default=1)
    # Not required: `selftest` decides nothing about a run and writes nothing, and requiring an
    # output path for a two-second import check is the kind of flag that teaches a reader to pass
    # `--out /dev/null` rather than to ask what the phase needs.
    parser.add_argument("--out", default="")
    parser.add_argument("--tasks", default="")
    parser.add_argument("--memory-url", default="")
    parser.add_argument("--max-steps", type=int, default=100)
    parser.add_argument("--seed", type=int, default=300)
    # A full-quality run is six hours and four arms; at double price that is a doubled bill for a
    # number that does not improve. The guard is off by default because a smoke run is cheap enough
    # to be worth running whenever the operator is awake, and on for every dispatch that is not.
    parser.add_argument("--require-off-peak", action="store_true")
    return parser.parse_args(argv)


def _llm_args(retries: int) -> dict:
    """Per-call arguments, including the one that decides the output bill.

    `deepseek-flash` answers in thinking mode **by default** and bills reasoning tokens
    at the output rate. tau-bench's agent makes one tool call per turn; a few hundred
    tokens of deliberation before `get_order_status` is paid on every turn of every
    episode and cannot change the reward. This lane asks for it off, and the request is
    recorded in the artefact rather than left in a comment — a setting that changes the
    bill by a factor has to be visible to whoever reads the number.

    The legacy name `deepseek-chat` is scheduled for discontinuation and, while it still
    resolves, it resolves to a model whose defaults this repository does not control.
    Pinning the current name and the mode is the difference between a measurement and a
    measurement of whatever the provider changed last night.
    """
    args: dict = {"num_retries": retries}
    thinking = os.environ.get("TAU_THINKING", "disabled").strip().lower()
    if thinking in ("disabled", "enabled"):
        args["extra_body"] = {"thinking": {"type": thinking}}
    return args


def install_nl_judge() -> str:
    """Point τ²'s prose-assertion judge at a model this dispatch can actually call.

    **What this fixes, measured.** τ² grades `nl_assertions` by asking a model, and the model is a
    module constant: `DEFAULT_LLM_NL_ASSERTIONS = "gpt-4.1-2025-04-14"` (`src/tau2/config.py` at
    v1.0.1). This lane holds a DeepSeek key and no OpenAI key, so every task whose `reward_basis`
    names `NL_ASSERTION` raised inside the evaluator, was retried three times by `run_with_retry`,
    and came back as an `INFRASTRUCTURE_ERROR` placeholder with no reward. R92 read:

      * forty held-out tasks, forty-four `INFRASTRUCTURE_ERROR` episodes over four trials;
      * **eleven** tasks that left the denominator;
      * those eleven, read against the corpus, carry **1–2 `nl_assertions` each**, and the
        twenty-nine tasks that scored carry **zero**.

    The correlation is the whole sample, not a coincidence of it: at v1.0.1 retail has forty tasks
    with an assertion and the evaluator is only reached for those.

    **What this is not.** A fix. An assertion graded by `deepseek-flash` is not an assertion graded by
    `gpt-4.1-2025-04-14`, and a reader comparing this lane's `pass^4` against a published row is
    entitled to know which judge produced it — so the name returns to the caller, is printed, and is
    carried into the artefact beside the release. `TAU_JUDGE_MODEL` overrides it for a dispatch that
    holds the other key, which is the path that makes this cell fully comparable rather than
    repairable.

    **What is patched.** The evaluator binds both names into its own namespace at import
    (`from tau2.config import DEFAULT_LLM_NL_ASSERTIONS`), so writing `tau2.config` would change the
    configuration and not the call. The module attributes are written instead, and `response_format`
    is requested for a provider that honours it: a reply wrapped in a markdown fence makes `json.loads`
    raise, and a judge that throws is a task that leaves the denominator — the defect this function
    exists to remove, arriving by a second route.
    """
    model = os.environ.get("TAU_JUDGE_MODEL", "").strip() or os.environ.get(
        "TAU_MODEL", "deepseek/deepseek-flash"
    )
    try:
        import tau2.evaluator.evaluator_nl_assertions as judge
    except Exception as error:  # noqa: BLE001 - a release that moved the module is not a crash here
        print(f"[tau2] judge: cannot install ({type(error).__name__}: {error})", file=sys.stderr)
        return model
    args: dict = {"temperature": 0.0}
    if model.startswith("deepseek/"):
        args["response_format"] = {"type": "json_object"}
    judge.DEFAULT_LLM_NL_ASSERTIONS = model
    judge.DEFAULT_LLM_NL_ASSERTIONS_ARGS = args
    _require_every_assertion(judge)
    return model


def assertion_gap(checks, asked) -> str | None:
    """None when the answer grades every assertion the task stated, else why it does not.

    Pulled out of the wrapper below so the rule is a function the self-test can call with plain
    objects: a guard that has never been asked a bad answer is a guard nobody knows the shape of,
    and the expensive version of that mistake is discovering it in a paid dispatch.

    **Two checks, and deliberately not three.** The count is the one that matters: τ² scores
    `all(check.met)`, `all([])` is `True`, and an empty reply therefore pays 1.0 for prose nobody
    read. The boolean is the other: a verdict serialised as the string `"true"` is not a verdict, and
    `all()` over it would read every one as true.

    The third check this function used to carry — comparing the echoed assertion text against the
    task's own — was removed before it cost a dispatch. A judge is asked to *repeat* each expectation,
    and a model that normalises punctuation, expands an abbreviation or merges a clause produces a
    string that differs from the task's own without answering a different question. τ² itself never
    matches the text; it zips the reply against the assertions in order. A guard stricter than the
    scorer it protects does not protect anything — it converts a grading difference into a dead task,
    which is the failure mode this whole round exists to remove.
    """
    asked = list(asked)
    if len(checks) != len(asked):
        return f"answered {len(checks)} of {len(asked)}"
    if not all(isinstance(getattr(check, "met", None), bool) for check in checks):
        return "answered without a verdict"
    return None


def _require_every_assertion(judge) -> None:
    """Refuse a judge answer that grades fewer assertions than the task stated.

    τ² computes an assertion reward as `all(check.met for check in checks)`, and `all([])` is `True`
    — so a judge that replies with `{"results": []}` scores **1.0** for a task whose prose conditions
    were never examined. That is a free point manufactured by an instrument failure, and it is the
    one failure mode a redirected judge makes *more* likely rather than less: the default judge is a
    model whose JSON shape this lane never chose, and the replacement is a different one.

    The wrapper therefore compares the answer against the question. A mismatch raises, which τ²
    turns into a retried-then-`INFRASTRUCTURE_ERROR` episode: the task leaves the denominator and the
    artefact says so — the honest failure this lane can read, rather than the silent 1.0 it cannot.

    This is not defensive programming for its own sake. R92's whole defect was a measurement that
    reported more than it measured; a repair that trades a missing quarter for eleven free points
    would be the same defect with a better headline.
    """
    original = judge.NLAssertionsEvaluator.__dict__["evaluate_nl_assertions"].__func__

    def evaluate_nl_assertions(cls, trajectory, nl_assertions):
        checks = original(cls, trajectory, nl_assertions)
        gap = assertion_gap(checks, nl_assertions)
        if gap is not None:
            raise RuntimeError(f"nl-assertion-judge-{gap.replace(' ', '-')}")
        return checks

    judge.NLAssertionsEvaluator.evaluate_nl_assertions = classmethod(
        evaluate_nl_assertions
    )


def task_ids(domain: str, wanted: list[str]) -> list[str]:
    tasks = get_tasks(domain, wanted or None)
    if wanted and len(tasks) != len(wanted):
        found = {task.id for task in tasks}
        missing = [task for task in wanted if task not in found]
        raise SystemExit(f"tau2-task-missing:{','.join(missing)}")
    return [task.id for task in tasks]


def inaction_of(simulations) -> dict | None:
    """Whether the agent ever acted, per episode.

    τ²'s message model gives a participant message either text or tool calls, and an assistant
    message continues an episode only by calling a tool. An episode whose assistant messages carry no
    tool call therefore ended with the agent declining to act, which is the τ² form of the abstention
    LongMemEval measures. It is reported as a *mechanism* fact beside the reward, never folded into
    it: a reward stays whatever upstream's evaluator said.

    `observable` is a field rather than something the reader infers, because a census that upstream
    could not expose must not reach a reader as "no abstention". One simulation whose messages are
    hidden, or whose trial number upstream did not set, makes the whole census unobservable: half a
    census silently reported as a whole one is the defect this field exists to prevent.

    The reduction to per-task counts happens in TypeScript (`packages/eval/src/inaction.ts`), which
    is the half with tests. This function reports the episodes exactly as it saw them.
    """
    if simulations is None:
        return None
    episodes = []
    for simulation in simulations:
        messages = None
        reader = getattr(simulation, "get_messages", None)
        if callable(reader):
            try:
                messages = reader()
            except Exception:  # noqa: BLE001 - upstream shape, not our error
                messages = None
        if messages is None:
            return {"observable": False, "episodes": []}
        task = getattr(simulation, "task_id", None)
        trial = getattr(simulation, "trial", None)
        if not isinstance(task, str) or not isinstance(trial, int) or isinstance(trial, bool) or trial < 0:
            return {"observable": False, "episodes": []}
        acted = any(
            getattr(message, "role", None) in ("assistant", "agent")
            and bool(getattr(message, "tool_calls", None))
            for message in messages
        )
        episodes.append({"task": task, "trial": trial, "acted": acted})
    return {"observable": True, "episodes": episodes}


# How much of each failure a reader gets. The line that raised is at the bottom of a traceback and a
# forty-four-row census times a full stack is a megabyte of artefact nothing reads.
ERROR_TEXT_CEILING = 400
TRACEBACK_TAIL = 1200


def failures_of(simulations) -> list | None:
    """Every episode that produced no verdict, with the reason τ² recorded for it.

    `diagnostics_of` counts the terminations, and a count was all R92 had: forty-four episodes ended
    in `INFRASTRUCTURE_ERROR`, eleven of forty tasks left the denominator, and nothing in the
    artefact could say whether the provider refused, the sandbox threw, or a deadline expired.

    τ² already knows. `run_with_retry` retries an exception three times and, when the fourth attempt
    also raises, stores the placeholder `SimulationRun` with `info = {error, error_type,
    error_traceback, failed_after_attempts}` (`src/tau2/runner/progress.py` at v1.0.1). This
    function quotes that block rather than re-deriving it, because the traceback is the only thing in
    the run that names the failing frame.

    `None` means the phase exposed no simulations at all; `[]` means it exposed them and every one
    carried a verdict. The difference is a run that could not be read and a run that was clean.
    """
    if simulations is None:
        return None
    rows = []
    for simulation in simulations:
        reason = getattr(simulation, "termination_reason", None)
        key = getattr(reason, "name", None) or (
            str(reason) if reason is not None else None
        )
        has_reward = getattr(simulation, "reward_info", None) is not None
        # An infrastructure error is a failure even where a reward happens to be attached, and a
        # missing reward is one whatever the reason says. Everything else is a verdict.
        if has_reward and key != "INFRASTRUCTURE_ERROR":
            continue
        task = getattr(simulation, "task_id", None)
        trial = getattr(simulation, "trial", None)
        if (
            not isinstance(task, str)
            or not isinstance(trial, int)
            or isinstance(trial, bool)
            or trial < 0
        ):
            # A failure the runner cannot place is not one this census can name, and inventing an
            # index for it would make the row join to a task nobody ran.
            continue
        row: dict = {"task": task, "trial": trial, "termination": key or "unknown"}
        info = getattr(simulation, "info", None)
        if isinstance(info, dict):
            error = info.get("error")
            if isinstance(error, str) and error:
                row["error"] = error[:ERROR_TEXT_CEILING]
            error_type = info.get("error_type")
            if isinstance(error_type, str) and error_type:
                row["errorType"] = error_type
            traceback_text = info.get("error_traceback")
            if isinstance(traceback_text, str) and traceback_text:
                row["tracebackTail"] = traceback_text[-TRACEBACK_TAIL:]
            attempts = info.get("failed_after_attempts")
            if isinstance(attempts, int) and not isinstance(attempts, bool):
                row["attempts"] = attempts
        rows.append(row)
    return rows


def diagnostics_of(simulations) -> dict:
    """What the caller needs for the protocol's reliability gate, or null where upstream hides it.

    The driver grades `V8-call-reliability`, which asks how many of the run's model calls failed.
    Those calls happen inside this process, in upstream's agent, and nothing about them crosses back
    in `results.json` - so the count has to be reconstructed here or the gate cannot be graded at all
    on this scenario.

    Every read is wrapped: a field upstream renames must turn this into "not observable" (a null the
    driver reports as an absent gate) rather than into a failed run. A diagnostic that can break a
    benchmark is worse than no diagnostic.
    """
    if simulations is None:
        return {
            "agent_turns": None,
            "simulations": None,
            "terminated": None,
            "inaction": None,
            "failures": None,
        }
    turns = 0
    terminated: dict[str, int] = {}
    counted_turns = True
    for simulation in simulations:
        messages = None
        reader = getattr(simulation, "get_messages", None)
        if callable(reader):
            try:
                messages = reader()
            except Exception:  # noqa: BLE001 - upstream shape, not our error
                messages = None
        if messages is None:
            counted_turns = False
        else:
            turns += sum(
                1
                for message in messages
                if getattr(message, "role", None) in ("assistant", "agent")
            )
        reason = getattr(simulation, "termination_reason", None)
        if reason is not None:
            key = getattr(reason, "name", None) or str(reason)
            terminated[key] = terminated.get(key, 0) + 1
    return {
        "agent_turns": turns if counted_turns else None,
        "simulations": len(simulations),
        "terminated": terminated or None,
        "inaction": inaction_of(simulations),
        "failures": failures_of(simulations),
    }


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    wanted = [entry for entry in args.tasks.split(",") if entry]

    # Checked before the registry import and before the provider probe, because both of those
    # cost nothing to skip and the whole point is to not start. `list` is exempt: it reads the
    # local benchmark and never calls a provider.
    if args.require_off_peak and args.phase != "list":
        refusal = peak_refusal()
        if refusal:
            raise SystemExit(refusal)

    if args.phase == "selftest":
        # Before the registry import and before any provider call: the question is whether the
        # installed τ² is the one this runner speaks, and both of those are cheaper to skip than
        # to answer.
        return selftest()

    if args.phase == "list":
        ids = task_ids(args.domain, wanted)
        with open(args.out, "w", encoding="utf-8") as stream:
            json.dump({"domain": args.domain, "tasks": ids}, stream)
        print(f"[tau2] {len(ids)} task(s) in {args.domain}")
        return 0

    if args.agent == "microglia_agent":
        # Registering under the same name `run_tasks` is asked to look up. The
        # registry refuses a duplicate, so a second registration in one process is
        # a bug rather than something to shrug at.
        from microglia_agent import MicrogliaAgent

        if "microglia_agent" not in registry.get_agents():
            if hasattr(registry, "register_agent_factory"):
                # v1.0.0 registers a *factory* and calls it with the environment's tools, the
                # policy, the model and its arguments — plus `task` and `audio_native_config`,
                # which a text agent does not take. So the adapter takes what it needs by keyword
                # and ignores the rest, which is also what stops a later upstream keyword from
                # turning into a TypeError inside a paid episode.
                registry.register_agent_factory(
                    lambda *, tools, domain_policy, llm, llm_args=None, **_: MicrogliaAgent(
                        tools=tools, domain_policy=domain_policy, llm=llm, llm_args=llm_args
                    ),
                    "microglia_agent",
                )
            else:  # v0.2.0 takes the class itself
                registry.register_agent(MicrogliaAgent, "microglia_agent")
    if args.memory_url:
        os.environ["MICROGLIA_MEMORY_URL"] = args.memory_url
    os.environ.setdefault("MICROGLIA_DOMAIN", args.domain)

    model = os.environ.get("TAU_MODEL", "deepseek/deepseek-flash")
    # Before the first episode, because the judge is reached by the evaluator of eleven of R92's
    # forty tasks and a judge that cannot be called costs a whole task rather than one call.
    judge_model = install_nl_judge()
    print(f"[tau2] judge: {judge_model} (graded nl_assertions)", file=sys.stderr)
    # litellm raises on a 429 rather than retrying, and one raised call aborts the
    # whole `run_tasks` - 68 tasks and 272 episodes lost to a rate limit one minute
    # from the end (the first reference-arm attempt). `num_retries` is litellm's own
    # knob and is forwarded verbatim through `llm_args_*`.
    retries = int(os.environ.get("TAU_RETRIES", "4"))
    llm_args = _llm_args(retries)
    tasks = get_tasks(args.domain, wanted or None)
    if not tasks:
        raise SystemExit("tau2-no-tasks")
    print(f"[tau2] {args.phase}: {len(tasks)} task(s), {args.trials} trial(s), agent={args.agent}", file=sys.stderr)

    # An existing output file makes `run_tasks` ask `ConsoleDisplay.console.input`
    # whether to resume - an interactive prompt, in a CI job, with no TTY. Deleting
    # the file first is the only way to keep that branch unreachable; a hang is the
    # most expensive failure mode a benchmark can have.
    if os.path.exists(args.out):
        os.remove(args.out)

    results = run_tasks(
        domain=args.domain,
        tasks=tasks,
        agent=args.agent,
        model=model,
        # Upstream's `run_tasks` does `if "seed" in llm_args_agent`, so passing None
        # raises `TypeError: argument of type 'NoneType' is not iterable` before the
        # first episode. The parameters are optional in the signature and required by
        # the body; two empty dicts are the difference between a run and a traceback.
        llm_args=llm_args,
        trials=args.trials,
        max_steps=args.max_steps,
        save_to=args.out,
        out=args.out,
        seed=args.seed,
        concurrency=int(os.environ.get("TAU_CONCURRENCY", "4")),
    )
    simulations = getattr(results, "simulations", None)
    print(
        json.dumps(
            {
                "phase": args.phase,
                "out": args.out,
                "tasks": len(tasks),
                "trials": args.trials,
                "simulations": len(simulations) if simulations is not None else None,
                "agent": args.agent,
                "memory_url": args.memory_url,
                "diagnostics": {**diagnostics_of(simulations), "usage": usage_stats()},
                "usage": usage_stats(),
                "thinking": os.environ.get("TAU_THINKING", "disabled"),
                "model": model,
                "judge": judge_model,
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
