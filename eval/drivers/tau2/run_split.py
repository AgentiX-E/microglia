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
from pathlib import Path

import litellm
from tau2.registry import registry
from tau2.run import get_tasks, run_tasks

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


def _number(usage, name: str) -> int:
    value = getattr(usage, name, None)
    if value is None and isinstance(usage, dict):
        value = usage.get(name)
    return int(value) if isinstance(value, (int, float)) else 0


def _record_usage(kwargs, response, start_time, end_time) -> None:
    del kwargs, start_time, end_time
    usage = getattr(response, "usage", None)
    if usage is None:
        return
    _usage["calls"] += 1
    _usage["prompt_tokens"] += _number(usage, "prompt_tokens")
    _usage["completion_tokens"] += _number(usage, "completion_tokens")
    _usage["cached_tokens"] += _number(usage, "prompt_cache_hit_tokens")


# litellm's callbacks are process-global and this module is imported once per process, but
# `run_split` is also imported by its self-check, which imports it more than once under
# different names. Guarding on identity keeps the count from doubling.
if _record_usage not in litellm.success_callback:
    litellm.success_callback.append(_record_usage)


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
        "cost": _cost(prompt, cached, completion),
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
    for band in ("peak", "off_peak"):
        rates = card.get("bands", {}).get(band)
        if not isinstance(rates, dict) or not {"miss", "hit", "out"} <= set(rates):
            raise ValueError(f"model-rates.json has no usable '{band}' band: {source}")
    windows = card.get("peakWindows")
    if not isinstance(windows, list) or not windows:
        raise ValueError(f"model-rates.json has no 'peakWindows': {source}")
    return card


_RATE_CARD = _load_rate_card()
_RATES = _RATE_CARD["bands"]
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


def _cost(prompt: int, cached: int, completion: int, now=None) -> dict:
    """The bill for one run, in the band that run actually ran in.

    `now` is a parameter rather than a call to the clock inside, because a function that reads the
    clock cannot be tested: the first version of this one made its own self-check pass or fail
    depending on what hour the suite was run, which is a check that cannot say no on a Tuesday
    afternoon. Every caller that means "now" passes nothing; every test passes a fixed moment.
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

    return {
        "usd": bill(mine),
        "band": "peak" if peak else "off_peak",
        "rates": mine,
        # What the same tokens would have cost in the other band. A run that reports only its
        # own band cannot be scheduled: the reader needs to know what moving it would save.
        "usd_in_other_band": bill(other),
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="tau2 phase runner for the microglia L4 lane")
    parser.add_argument("--domain", default="retail")
    parser.add_argument("--phase", choices=["list", "learn", "eval"], required=True)
    parser.add_argument("--agent", default="llm_agent")
    parser.add_argument("--trials", type=int, default=1)
    parser.add_argument("--out", required=True)
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
        return {"agent_turns": None, "simulations": None, "terminated": None, "inaction": None}
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
            registry.register_agent(MicrogliaAgent, "microglia_agent")
    if args.memory_url:
        os.environ["MICROGLIA_MEMORY_URL"] = args.memory_url
    os.environ.setdefault("MICROGLIA_DOMAIN", args.domain)

    model = os.environ.get("TAU_MODEL", "deepseek/deepseek-flash")
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
        user="user_simulator",
        llm_agent=model,
        # Upstream's `run_tasks` does `if "seed" in llm_args_agent`, so passing None
        # raises `TypeError: argument of type 'NoneType' is not iterable` before the
        # first episode. The parameters are optional in the signature and required by
        # the body; two empty dicts are the difference between a run and a traceback.
        llm_args_agent=llm_args,
        llm_user=model,
        llm_args_user=llm_args,
        num_trials=args.trials,
        max_steps=args.max_steps,
        save_to=args.out,
        console_display=False,
        max_concurrency=int(os.environ.get("TAU_CONCURRENCY", "4")),
        seed=args.seed,
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
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
