"""Self-check for the lane's bill, runnable without tau2 or litellm installed.

`run_split.py` cannot be imported on a machine that has not cloned tau2, so the two
modules it needs and the one third-party package it needs are stubbed. What is under test
is arithmetic about tokens and a calendar, and neither of those needs a benchmark.

The arithmetic is worth a test because every number in it is a number that decides how a
run is scheduled: the peak/off-peak split is exactly a factor of two on an identical
workload, and the cache-hit term is a factor of fifty on the input that hits. A run that
reports its token count without reporting its band has reported nothing a reader can act
on.

Run: `python3 eval/drivers/tau2/selfcheck_usage.py --self-test`
"""

from __future__ import annotations

import os
import sys
import types
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))


# --------------------------------------------------------------------------- stubs

litellm = types.ModuleType("litellm")
litellm.success_callback = []


class _Registry:
    def get_agents(self):
        return []


def _unreachable(*args, **kwargs):  # pragma: no cover - a phase is not run here
    raise AssertionError("no phase runs in the self-check")


registry_module = types.ModuleType("tau2.registry")
registry_module.registry = _Registry()
run_module = types.ModuleType("tau2.run")
run_module.get_tasks = _unreachable
run_module.run_tasks = _unreachable

for name, attributes in {
    "tau2": {},
    "tau2.registry": {},
    "tau2.run": {},
}.items():
    module = types.ModuleType(name)
    module.__path__ = []
    for key, value in attributes.items():
        setattr(module, key, value)
    sys.modules[name] = module

sys.modules["tau2.registry"] = registry_module
sys.modules["tau2.run"] = run_module
sys.modules["litellm"] = litellm

sys.path.insert(0, HERE)

import run_split as subject  # noqa: E402 - after the stubs, by construction


# -------------------------------------------------------------------------- tests


CASES = []


def case(fn):
    CASES.append(fn)
    return fn


def at(day: int, hour: int, minute: int = 0) -> datetime:
    """A UTC instant on a known weekday. 2026-11-09 is a Monday."""
    return datetime(2026, 11, 9 + day, hour, minute, tzinfo=timezone.utc)


@case
def peak_windows_are_the_two_the_rate_card_names(checks):
    # Monday: 01:00–04:00 and 06:00–10:00 are peak; every other hour is not.
    checks.equal(subject._is_peak(at(0, 0, 59)), False, "00:59 UTC on a Monday")
    checks.equal(subject._is_peak(at(0, 1)), True, "01:00 opens the first window")
    checks.equal(subject._is_peak(at(0, 3, 59)), True, "03:59 is still inside it")
    checks.equal(subject._is_peak(at(0, 4)), False, "04:00 closes it")
    checks.equal(subject._is_peak(at(0, 5, 59)), False, "05:59 is the gap")
    checks.equal(subject._is_peak(at(0, 6)), True, "06:00 opens the second")
    checks.equal(subject._is_peak(at(0, 9, 59)), True, "09:59 is still inside it")
    checks.equal(subject._is_peak(at(0, 10)), False, "10:00 closes it")
    checks.equal(subject._is_peak(at(0, 23)), False, "23:00 is off-peak")


@case
def the_weekend_is_off_peak_all_day(checks):
    # 2026-11-14 is a Saturday, 11-15 a Sunday.
    checks.equal(subject._is_peak(at(5, 2)), False, "Saturday 02:00")
    checks.equal(subject._is_peak(at(5, 8)), False, "Saturday 08:00")
    checks.equal(subject._is_peak(at(6, 2)), False, "Sunday 02:00")


@case
def the_same_tokens_cost_exactly_twice_as_much_in_peak(checks):
    # The moment is passed in. The first version of this case called `_cost` without one, so it
    # read the wall clock and passed only between 01:00 and 10:00 UTC on a weekday -- a self-check
    # that fails on a Tuesday afternoon is not a self-check, and the two-band assertion below is
    # the only thing that can catch a rate card read backwards.
    peak = subject._cost(1_000_000, 0, 1_000_000, at(0, 2))
    off = subject._cost(1_000_000, 0, 1_000_000, at(0, 12))
    checks.equal(peak["usd"], 1.5, "1M missed input plus 1M output at peak")
    checks.equal(peak["band"], "peak", "the band is named, not inferred")
    checks.equal(peak["usd_in_other_band"], 0.75, "and the other band is quoted beside it")
    checks.equal(off["usd"], 0.75, "the same tokens off-peak")
    checks.equal(off["band"], "off_peak", "named as the other band")
    checks.equal(off["usd_in_other_band"], 1.5, "and the peak bill quoted beside it")
    checks.equal(round(peak["usd"] / off["usd"]), 2, "the factor of two is the whole point")


@case
def a_cached_token_costs_a_fiftieth_of_a_missed_one(checks):
    # 1M input, all cached, no output: 1M x 0.006 rather than 1M x 0.30.
    checks.equal(subject._cost(1_000_000, 1_000_000, 0, at(0, 2))["usd"], 0.006, "all hit at peak")


@case
def a_cache_hit_is_worth_fifty_times_its_own_price(checks):
    missed = subject._cost(1_000_000, 0, 0, at(0, 2))["usd"]
    hit = subject._cost(1_000_000, 1_000_000, 0, at(0, 2))["usd"]
    checks.equal(round(missed / hit), 50, "the ratio the write-path bug is measured in")


@case
def a_peak_dispatch_is_refused_before_it_spends_anything(checks):
    refusal = subject.peak_refusal(at(0, 9, 47))
    checks.substring(refusal, "tau2-peak-window", "the marker a caller branches on")
    checks.substring(refusal, "10:00 UTC", "and the hour the window closes, not just the fact")
    checks.substring(refusal, "twice", "and why it matters")


@case
def an_off_peak_dispatch_is_not_refused(checks):
    checks.equal(subject.peak_refusal(at(0, 12)), "", "midday on a Monday is off-peak")
    checks.equal(subject.peak_refusal(at(0, 4, 30)), "", "and so is the gap between windows")
    checks.equal(subject.peak_refusal(at(5, 2)), "", "and all weekend")


@case
def the_refusal_names_the_end_of_the_window_it_is_in(checks):
    checks.equal(subject._next_off_peak(at(0, 1)).hour, 4, "the first window closes at 04:00")
    checks.equal(subject._next_off_peak(at(0, 9, 59)).hour, 10, "the second at 10:00")
    checks.equal(subject._next_off_peak(at(0, 12)), at(0, 12), "off-peak is already open")
    checks.equal(subject._next_off_peak(at(5, 2)), at(5, 2), "a weekend has nothing to wait for")


@case
def the_usage_record_divides_by_the_prompt_not_by_the_calls(checks):
    subject._usage.clear()
    subject._usage.update(
        {"calls": 10, "prompt_tokens": 1000, "completion_tokens": 200, "cached_tokens": 800}
    )
    stats = subject.usage_stats()
    checks.equal(stats["calls"], 10, "calls are counted")
    checks.equal(stats["uncached_tokens"], 200, "missed input is the difference")
    checks.equal(stats["cache_hit_rate"], 0.8, "the rate is over the prompt, not the calls")


@case
def an_empty_run_reports_no_rate_rather_than_zero(checks):
    subject._usage.clear()
    stats = subject.usage_stats()
    checks.equal(stats["cache_hit_rate"], None, "no tokens is no measurement, not 0%")
    checks.equal(stats["cost"]["usd"], 0.0, "and it costs nothing")


@case
def a_response_is_read_off_the_object_it_arrives_on(checks):
    subject._usage.clear()

    usage = types.SimpleNamespace(
        prompt_tokens=100, completion_tokens=20, prompt_cache_hit_tokens=60
    )
    subject._record_usage({}, types.SimpleNamespace(usage=usage), 0, 0)
    checks.equal(dict(subject._usage)["prompt_tokens"], 100, "object attributes are read")
    checks.equal(dict(subject._usage)["cached_tokens"], 60, "including the provider's own name")

    # The same fields as a mapping, which is how some litellm paths deliver them.
    subject._record_usage({}, types.SimpleNamespace(usage={"prompt_tokens": 5}), 0, 0)
    checks.equal(dict(subject._usage)["prompt_tokens"], 105, "and as a mapping")


@case
def a_response_with_no_usage_is_not_a_call(checks):
    subject._usage.clear()
    subject._record_usage({}, types.SimpleNamespace(usage=None), 0, 0)
    checks.equal(dict(subject._usage), {}, "nothing to count is not a counted call")


@case
def a_missing_field_counts_as_zero_rather_than_as_an_error(checks):
    subject._usage.clear()
    subject._record_usage(
        {}, types.SimpleNamespace(usage=types.SimpleNamespace(prompt_tokens=7)), 0, 0
    )
    checks.equal(dict(subject._usage)["completion_tokens"], 0, "absent is zero here")
    checks.equal(dict(subject._usage)["calls"], 1, "but the call still happened")


@case
def thinking_is_off_by_default_and_can_be_asked_for(checks):
    saved = os.environ.pop("TAU_THINKING", None)
    try:
        default = subject._llm_args(2)
        checks.equal(
            default["extra_body"], {"thinking": {"type": "disabled"}}, "off unless asked"
        )
        checks.equal(default["num_retries"], 2, "the retry count still travels")

        os.environ["TAU_THINKING"] = "enabled"
        checks.equal(
            subject._llm_args(2)["extra_body"],
            {"thinking": {"type": "enabled"}},
            "asked for explicitly",
        )

        # A value that is neither is passed through as no opinion rather than as a guess.
        os.environ["TAU_THINKING"] = "provider-default"
        checks.equal("extra_body" in subject._llm_args(2), False, "an unknown value adds nothing")
    finally:
        os.environ.pop("TAU_THINKING", None)
        if saved is not None:
            os.environ["TAU_THINKING"] = saved


@case
def the_default_model_is_not_the_retired_name(checks):
    # `deepseek-chat` is scheduled for discontinuation; a run that resolves it is measuring
    # whatever the provider routes it to. The default in the source is what a dispatch with
    # no variable set will use, so it is asserted rather than trusted.
    source = open(os.path.join(HERE, "run_split.py"), encoding="utf-8").read()
    checks.substring(source, '"deepseek/deepseek-flash"', "the default is the current name")
    checks.absent(source, '"deepseek/deepseek-chat"', "and the retired name is not a default")


@case
def the_rates_are_read_from_the_shared_card_rather_than_copied_here(checks):
    # The card has two readers: this driver and the TypeScript lanes. They were two hardcoded
    # copies of the same table, which is the arrangement in which one of them is eventually
    # wrong -- and nothing caught it, because the other lane billed nothing at all.
    import json

    card_path = os.path.join(HERE, "..", "..", "manifests", "model-rates.json")
    with open(card_path, encoding="utf-8") as handle:
        card = json.load(handle)
    checks.equal(subject._RATES, card["bands"], "the driver bills at the card's rates")
    checks.equal(
        subject._PEAK_WINDOWS,
        tuple((w["fromHourUtc"], w["toHourUtc"]) for w in card["peakWindows"]),
        "and guards the card's windows",
    )
    source = open(os.path.join(HERE, "run_split.py"), encoding="utf-8").read()
    # A literal rate in the source is how the second copy comes back.
    checks.absent(source, "0.30", "no rate is written into the driver")
    checks.absent(source, "1.20", "neither is the output rate")


@case
def a_card_without_a_band_is_refused_rather_than_defaulted(checks):
    # A bill computed from a fallback rate is a bill nobody can check. Raising is the only
    # behaviour that keeps the card authoritative when someone edits it badly.
    import json
    import tempfile

    broken = {"bands": {"peak": {"miss": 0.3, "hit": 0.006, "out": 1.2}}, "peakWindows": []}
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
        json.dump(broken, handle)
        path = handle.name
    try:
        raised = ""
        try:
            subject._load_rate_card(path)
        except ValueError as error:
            raised = str(error)
        checks.substring(raised, "no usable 'off_peak' band", "a missing band is a refusal")

        with open(path, "w", encoding="utf-8") as handle:
            json.dump(
                {
                    "bands": {
                        "peak": {"miss": 0.3, "hit": 0.006, "out": 1.2},
                        "off_peak": {"miss": 0.15, "hit": 0.003, "out": 0.6},
                    },
                    "peakWindows": [],
                },
                handle,
            )
        raised = ""
        try:
            subject._load_rate_card(path)
        except ValueError as error:
            raised = str(error)
        checks.substring(raised, "no 'peakWindows'", "and so are no windows")
    finally:
        os.unlink(path)


# ------------------------------------------------------------------------- runner


class Checks:
    def __init__(self) -> None:
        self.total = 0
        self.failed: list[str] = []

    def equal(self, actual, expected, why: str) -> None:
        self.total += 1
        if actual != expected:
            self.failed.append(f"{why}: expected {expected!r}, got {actual!r}")

    def substring(self, actual: str, expected: str, why: str) -> None:
        self.total += 1
        if expected not in actual:
            self.failed.append(f"{why}: {expected!r} is not in the source")

    def absent(self, actual: str, forbidden: str, why: str) -> None:
        self.total += 1
        if forbidden in actual:
            self.failed.append(f"{why}: {forbidden!r} should not appear")


def main(argv: list[str]) -> int:
    if "--self-test" not in argv:
        print(__doc__)
        return 2
    checks = Checks()
    for fn in CASES:
        try:
            fn(checks)
            print(f"PASS  {fn.__name__}")
        except Exception as error:  # noqa: BLE001 - a raising case is a failing case
            checks.failed.append(f"{fn.__name__} raised {type(error).__name__}: {error}")
            print(f"FAIL  {fn.__name__} raised {type(error).__name__}: {error}")
    if checks.failed:
        print()
        for line in checks.failed:
            print(f"FAIL  {line}")
        return 1
    print(f"\n{len(CASES)} cases, {checks.total} assertions, all passed")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
