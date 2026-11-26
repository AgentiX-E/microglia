"""What a long-context benchmark costs to run, before it is run.

The lane prices dispatches from a rate card and a token count, and it has twice quoted a number that
neither came from: R235's dispatch was projected at the card and came in at 1.07x, which is fine, while
the external replications were carried in the plan at a round twenty dollars for two benchmarks whose
whole cost is a function of three integers — how many questions, how long the context is, and how many
questions share it. A number carried in a plan without that arithmetic is not an estimate, it is a
guess wearing one, and the two-benchmark line was 8x high.

So this file is the arithmetic, and it is arithmetic over the **provider's billing model** rather than
over a token total, because for a long-context benchmark the billing model is most of the price:

  * a prompt token the provider had to read is billed at `miss`, and one it served from its prefix
    cache is billed at `hit` — a factor of fifty on this card;
  * a benchmark whose questions are grouped by document shares one prefix per group, so the number of
    *misses* is the number of **documents**, not the number of questions;
  * `out` is billed separately and does not cache;
  * and the peak windows double every one of those three rates, which is why the plan's dispatch
    hours are part of the budget rather than a scheduling preference.

The single number this file exists to stop being guessed is the ratio in the second bullet. A
long-context QA set with n questions over d documents moves `d * context` tokens at `miss` and
`(n - d) * context` at `hit`; at n = 1986, d = 10 and a context of 27k tokens that is 0.27M against
53.3M, so the cacheable 99.5% of the input is billed at 2% of the rate. Quoting the whole 53.6M at
`miss` — which is what an estimate written without the grouping does — overstates the bill by ~28x,
and that is where the twenty dollars came from.

Everything here reads the rate card the two dispatchers read, so this file cannot drift from the bill
it predicts: `eval/manifests/model-rates.json` is the card, `packages/eval/src/cost.ts` is one reader,
`eval/drivers/tau2/run_split.py` is the other, and this is the third.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

#: The card lives beside the manifests that record what the lane actually spent, so a budget written
#: here and a bill written by a dispatch are two readings of one file rather than two tables.
CARD = Path(__file__).resolve().parents[1] / "manifests" / "model-rates.json"

#: CNY per USD. A budget is quoted in the currency the operator approves spending in, and a rate that
#: floats is a budget that drifts while nobody is looking, so the conversion is a named constant that
#: a report restates rather than a lookup that a report performs.
CNY_PER_USD = 7.2


def card(path: Path = CARD) -> dict:
    """The rate card, as the two dispatchers read it."""
    return json.loads(Path(path).read_text(encoding="utf-8"))


def rates(model: str = "", band: str = "off_peak", path: Path = CARD) -> dict:
    """The three rates a model is billed at, in one band.

    A card that does not price the named model bills the default row and says so by returning the
    `defaultModel` name rather than raising: a benchmark whose model is unpriced is a benchmark whose
    budget is an approximation, and an approximation that names itself is a number with an assumption.
    """
    data = card(path)
    table = data["prices"]
    chosen = model if model in table else data["defaultModel"]
    if band not in table[chosen]:
        raise SystemExit(f"{chosen}: the card prices no {band!r} band")
    # The card nests the bands under the model, so the row is `table[chosen][band]` and not `table[chosen]`:
    # the first version of this line unpacked the band map itself and every caller failed on a missing key.
    return {"model": chosen, "band": band, "pricedAs": model or chosen, **table[chosen][band]}


def moving(questions: int, documents: int, context: int, answer: int = 60, samples: int = 1,
           path: Path = CARD) -> dict:
    """The tokens a grouped long-context run moves, split by how the provider bills them.

    `documents` is the number of distinct prefixes — the number of conversations in the benchmark, not
    the number of questions — because a question that shares a prefix with the one before it is served
    from the cache. `samples` repeats every question, and the repeat is a second miss per document
    rather than a hit: a provider's prefix cache has a lifetime, and a budget that assumes a second
    pass hours later hits is a budget that assumes the provider's eviction policy in its own favour.
    """
    if questions < 1 or documents < 1 or context < 1:
        raise SystemExit("a benchmark needs at least one question, one document and one token")
    if documents > questions:
        raise SystemExit(f"{documents} documents cannot share {questions} questions")
    misses = documents * samples
    prompts = questions * samples
    return {
        "questions": questions, "documents": documents, "context": context, "samples": samples,
        "miss": misses * context,
        "hit": (prompts - misses) * context,
        "out": prompts * answer,
    }


def bill(tokens: dict, rate: dict) -> dict:
    """What those tokens cost at those rates, with and without the cache.

    The no-cache column is not hypothetical: it is what a harness that queries one question at a time
    in a fresh context pays, which is how most published replications of these benchmarks are run. The
    multiplier between the two columns is the entire argument for grouping, so it is a returned field
    rather than something a reader computes off two other fields.
    """
    def spend(miss: int, hit: int, out: int) -> float:
        return (miss / 1e6) * rate["miss"] + (hit / 1e6) * rate["hit"] + (out / 1e6) * rate["out"]

    with_cache = spend(tokens["miss"], tokens["hit"], tokens["out"])
    uncached = spend(tokens["miss"] + tokens["hit"], 0, tokens["out"])
    # Six places rather than four, because these bills run to fractions of a cent: rounding a grouped
    # LoCoMo run to four places would report $0.0005 for a run that cost $0.000483, and the self-test
    # found that by asserting peak was exactly twice off-peak and getting 0.0081 against 0.0080.
    return {
        "usd": round(with_cache, 6),
        "cny": round(with_cache * CNY_PER_USD, 2),
        "uncachedUsd": round(uncached, 6),
        "uncachedCny": round(uncached * CNY_PER_USD, 2),
        "multiplier": round(uncached / with_cache, 2) if with_cache else None,
        "missShare": round(tokens["miss"] / (tokens["miss"] + tokens["hit"]), 4),
    }


def budget(questions: int, documents: int, context: int, answer: int = 60, samples: int = 1,
           model: str = "", band: str = "off_peak", path: Path = CARD) -> dict:
    """One benchmark's bill, in one call, for a manifest to record."""
    rate = rates(model, band, path)
    tokens = moving(questions, documents, context, answer, samples, path)
    return {"rate": rate, "tokens": tokens, "bill": bill(tokens, rate)}


#: The two external replications the plan carries, with the numbers a public specification gives
#: rather than an average that a plan made up. LoCoMo: 1,986 questions over 10 conversations, average
#: prompt 94,098 characters — 27k tokens at the 3.5 characters a token this card's dispatches actually
#: ran at. MemTrapBench: no published per-item context, so it is priced at a deliberately pessimistic
#: 8k and the entry says it is a bound.
BENCHMARKS = {
    "locomo": {"questions": 1986, "documents": 10, "context": 27_000, "answer": 60, "samples": 1,
               "note": "10 conversations, 1986 QA over five categories; graded by token F1 and adversarial "
                       "refusal, so the grader calls no model and costs nothing"},
    "memtrapbench": {"questions": 1000, "documents": 50, "context": 8_000, "answer": 60, "samples": 1,
                     "note": "a bound rather than a reading: the published specification does not state a "
                             "per-item context, so 8k is chosen above what its transcripts plausibly hold"},
}


def plan(band: str = "off_peak", model: str = "", path: Path = CARD) -> dict:
    """Both replications, each priced, and the pair's total."""
    rows = {name: {**spec, **budget(spec["questions"], spec["documents"], spec["context"],
                                    spec["answer"], spec["samples"], model, band, path)}
            for name, spec in BENCHMARKS.items()}
    return {
        "benchmarks": rows,
        "totalUsd": round(sum(row["bill"]["usd"] for row in rows.values()), 4),
        "totalCny": round(sum(row["bill"]["cny"] for row in rows.values()), 2),
        "band": band,
        "model": rows["locomo"]["rate"]["model"],
    }


def check_manifest(path: Path) -> list:
    """Whether a saved budget is the arithmetic this file would produce today.

    A budget in a repository is a claim about a rate card, and a rate card changes. So the saved reading
    is not trusted: it is re-derived from the card it names and compared field by field, and a budget
    whose total no longer matches is refused by the build rather than read by a plan. This is the same
    arrangement `read_anchor.py --check` uses for the anchor readings — the number a document quotes is
    the number a build can recompute — and it exists here because the plan carried a twenty-dollar line
    for two benchmarks that a card and three integers price at under three.
    """
    saved = json.loads(Path(path).read_text(encoding="utf-8"))
    problems: list = []
    fresh = plan(saved.get("band", "off_peak"), saved.get("model", ""))
    for name, row in saved.get("benchmarks", {}).items():
        if name not in fresh["benchmarks"]:
            problems.append(f"{name}: priced in the saved budget and absent from the card's plan")
            continue
        mine = fresh["benchmarks"][name]
        for field in ("questions", "documents", "context", "samples", "miss", "hit", "out"):
            if row["tokens"].get(field) != mine["tokens"][field]:
                problems.append(f"{name}: tokens.{field} is {row['tokens'].get(field)} against "
                                f"{mine['tokens'][field]} from the card")
        for field in ("usd", "cny", "uncachedUsd", "multiplier"):
            if abs((row["bill"].get(field) or 0) - mine["bill"][field]) > 1e-6:
                problems.append(f"{name}: bill.{field} is {row['bill'].get(field)} against "
                                f"{mine['bill'][field]} from the card")
    if abs((saved.get("totalCny") or 0) - fresh["totalCny"]) > 0.02:
        problems.append(f"totalCny is {saved.get('totalCny')} against {fresh['totalCny']}")
    missing = set(fresh["benchmarks"]) - set(saved.get("benchmarks", {}))
    for name in sorted(missing):
        problems.append(f"{name}: priced by the card and absent from the saved budget")
    return problems


def report(failures: list) -> int:
    """The result of a suite, as an exit code and a sentence.

    It is a function rather than four lines at the end of `self_test` because those four lines are the only part of
    a suite that runs **when the suite is failing**, and they never ran: every assertion in this file had passed on
    every run, so the branch that names a failure was dead code wearing a test's clothes. A reporter that a test can
    drive is the difference between a suite that reports and a suite that silently exits zero.
    """
    if failures:
        print("FAILED:")
        for name in failures:
            print(f"  {name}")
        return 1
    print("bench_budget: all assertions hold")
    return 0


def self_test() -> int:
    """The arithmetic, checked against cases whose answers are known outside this file."""
    failures: list = []

    def judge(into: list):
        """A recorder bound to a list, so the recording itself can be driven.

        Written as a factory rather than as a closure over `failures` because the closure's `append` line runs only
        when an assertion fails, and no assertion in this file has ever failed — the coverage run reported that line
        as unmeasured for exactly that reason. A suite whose failure path is never executed is a suite that would
        report a regression as a pass, so the probe below binds the same recorder to a scratch list and fails it once.
        """
        def check(name: str, condition: bool) -> None:
            if not condition:
                into.append(name)
        return check

    check = judge(failures)
    scratch: list = []
    judge(scratch)("a deliberate failure", False)
    check("a failing assertion is recorded rather than dropped", scratch == ["a deliberate failure"])

    rate = rates("deepseek-flash", "off_peak")
    check("the card prices the lane's model at the rates the lane dispatches at",
          (rate["miss"], rate["hit"], rate["out"]) == (0.15, 0.003, 0.6))
    check("and an unpriced model is billed as the default rather than refused",
          rates("no-such-model", "off_peak")["model"] == "deepseek-flash")

    one = moving(1, 1, 1000)
    check("one question over one document is one miss and no hit",
          (one["miss"], one["hit"], one["out"]) == (1000, 0, 60))

    grouped = moving(100, 1, 1000)
    check("a hundred questions over one document share ninety-nine prefixes",
          (grouped["miss"], grouped["hit"]) == (1000, 99 * 1000))

    ungrouped = moving(100, 100, 1000)
    check("a hundred documents are a hundred misses and no hit at all",
          (ungrouped["miss"], ungrouped["hit"]) == (100 * 1000, 0))

    few = bill(grouped, rate)
    check("grouping a hundred questions over one document is cheaper than not grouping them",
          few["usd"] < bill(ungrouped, rate)["usd"])
    check("a hundred separate contexts cost exactly what the cache would have saved",
          abs(bill(ungrouped, rate)["usd"] - few["uncachedUsd"]) < 1e-12)
    check("and the multiplier it reports is that saving, as a ratio",
          abs(few["multiplier"] - few["uncachedUsd"] / few["usd"]) < 0.01)
    check("the cacheable share is the ninety-nine per cent the grouping bought",
          abs(few["missShare"] - 0.01) < 0.0002)

    peak = bill(grouped, rates("deepseek-flash", "peak"))
    check("a peak dispatch costs exactly double an off-peak one at these rates",
          abs(peak["usd"] - 2 * few["usd"]) < 1e-9)

    twice = moving(100, 1, 1000, samples=2)
    check("re-sampling re-misses each document rather than assuming the cache survived",
          (twice["miss"], twice["hit"]) == (2 * 1000, 198 * 1000))

    # Every refusal the arithmetic can make, driven rather than reasoned about. The first version of this block
    # counted failures in a `bad` counter that only incremented when nothing was raised, so the line that would have
    # proved the refusal could never run: a test whose success path is unreachable is a test that passes by not
    # testing, and the coverage run reported it as an uncovered statement rather than as a green tick.
    def refuses(call) -> bool:
        """Whether a call refuses, as a predicate rather than as a flag a `try` sets.

        The flag version had a dead line in it — `raised = False` after the call, which only runs when nothing was
        raised and therefore never does — and a dead line in a test is worse than a dead line in a product: it is a
        statement whose whole purpose is to look like evidence.
        """
        try:
            call()
        except SystemExit:
            return True
        return False

    for arguments, why in (((0, 1, 1000), "no questions"), ((10, 20, 1000), "more documents than questions")):
        check(f"a benchmark with {why} is refused rather than priced", refuses(lambda: moving(*arguments)))
    check("a band the card does not price is refused rather than defaulted",
          refuses(lambda: rates("deepseek-flash", "twilight")))
    check("and a well-formed benchmark is not refused, so the predicate is not simply always true",
          not refuses(lambda: moving(1, 1, 1000)))

    priced = plan("off_peak")
    check("the plan prices both external replications",
          set(priced["benchmarks"]) == {"locomo", "memtrapbench"})
    check("and its total is the sum of the two, to the cent",
          abs(priced["totalCny"] - sum(r["bill"]["cny"] for r in priced["benchmarks"].values())) < 0.02)
    check("the pair costs single-digit yuan off-peak, which is the claim this file exists to make",
          priced["totalCny"] < 10)
    check("and the same work without a shared prefix would have cost an order of magnitude more",
          min(r["bill"]["multiplier"] for r in priced["benchmarks"].values()) > 10)

    # The checker, which is the only part of this file a build runs against a number somebody quoted.
    import tempfile
    with tempfile.TemporaryDirectory() as temporary:
        path = Path(temporary) / "budget.json"
        path.write_text(json.dumps(priced, indent=1), encoding="utf-8")
        check("a budget this file would produce today passes its own check", check_manifest(path) == [])
        doctored = json.loads(json.dumps(priced))
        doctored["benchmarks"]["locomo"]["bill"]["cny"] = 20.0
        path.write_text(json.dumps(doctored), encoding="utf-8")
        check("a budget whose bill was raised by hand is refused",
              check_manifest(path) != [])
        missing = json.loads(json.dumps(priced))
        del missing["benchmarks"]["memtrapbench"]
        path.write_text(json.dumps(missing), encoding="utf-8")
        check("a budget that silently drops a benchmark is refused", check_manifest(path) != [])
        extra = json.loads(json.dumps(priced))
        extra["benchmarks"]["locomo"]["tokens"]["hit"] = 0
        path.write_text(json.dumps(extra), encoding="utf-8")
        check("a budget that prices the cache away is refused", check_manifest(path) != [])
        invented = json.loads(json.dumps(priced))
        invented["benchmarks"]["swebench"] = invented["benchmarks"]["locomo"]
        path.write_text(json.dumps(invented), encoding="utf-8")
        check("a benchmark the card does not price is refused rather than read",
              any("swebench" in problem for problem in check_manifest(path)))

    # The command line, driven for real rather than reasoned about — **in this process**, because the first version
    # of this block called the script with `subprocess` and the coverage run then reported every branch of `main` as
    # unmeasured: a tool whose argument parser is exercised in a child process is a tool whose argument parser is not
    # under the floor. `sys.argv` is saved and restored rather than assigned and forgotten, so a later assertion in
    # this function cannot silently inherit a command line.
    import importlib.util
    here = Path(__file__).resolve()
    spec = importlib.util.spec_from_file_location("bench_budget_as_module", here)
    as_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(as_module)
    check("the file is importable without running its command line",
          as_module.CNY_PER_USD == CNY_PER_USD and as_module.BENCHMARKS.keys() == BENCHMARKS.keys())

    import contextlib
    import io

    quiet = io.StringIO()
    with contextlib.redirect_stdout(quiet):
        failing = report(["a named failure"])
    check("the reporter exits one and names what failed",
          failing == 1 and "FAILED:" in quiet.getvalue() and "a named failure" in quiet.getvalue())
    quiet = io.StringIO()
    with contextlib.redirect_stdout(quiet):
        passing = report([])
    check("and exits zero with a sentence when nothing failed",
          passing == 0 and "all assertions hold" in quiet.getvalue())

    with tempfile.TemporaryDirectory() as temporary:
        out = Path(temporary) / "budget.json"
        saved_argv = sys.argv

        def command(*arguments) -> tuple:
            """Run the command line in this process and hand back its code and what it printed."""
            printed = io.StringIO()
            try:
                sys.argv = [str(here), *arguments]
                with contextlib.redirect_stdout(printed):
                    return main(), printed.getvalue()
            finally:
                sys.argv = saved_argv

        code, printed = command("--out", str(out))
        check("the script writes a budget and prints its table",
              code == 0 and out.exists() and "locomo" in printed and "band off_peak" in printed)

        code, printed = command("--check", str(out))
        check("and its own output passes its own check", code == 0 and "matches the card" in printed)

        raised = json.loads(out.read_text(encoding="utf-8"))
        raised["totalCny"] = 20.0
        out.write_text(json.dumps(raised), encoding="utf-8")
        code, printed = command("--check", str(out))
        check("and a budget raised to the number the plan used to carry exits non-zero and says why",
              code == 1 and "totalCny" in printed)

        code, printed = command("--band", "peak")
        check("the peak band is priced and exits zero", code == 0 and "band peak" in printed)

    return report(failures)


def render(priced: dict) -> str:
    """The plan as a table a report can paste, one row a benchmark."""
    lines = [f"{'benchmark':14s} {'qa':>5s} {'docs':>5s} {'ctx':>7s} {'miss':>9s} {'hit':>11s} "
             f"{'usd':>7s} {'cny':>7s} {'no-cache':>9s} {'x':>5s}"]
    for name, row in priced["benchmarks"].items():
        tokens, money = row["tokens"], row["bill"]
        lines.append(f"{name:14s} {tokens['questions']:5d} {tokens['documents']:5d} "
                     f"{tokens['context']:7d} {tokens['miss']/1e6:8.2f}M {tokens['hit']/1e6:10.2f}M "
                     f"{money['usd']:7.2f} {money['cny']:7.2f} {money['uncachedCny']:9.2f} "
                     f"{money['multiplier']:4.1f}x")
    lines.append(f"{'both':14s} {'':5s} {'':5s} {'':7s} {'':9s} {'':11s} {priced['totalUsd']:7.2f} "
                 f"{priced['totalCny']:7.2f}")
    lines.append(f"band {priced['band']}, model {priced['model']}, "
                 f"{priced['benchmarks']['locomo']['rate']['pricedAs']} on the card")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="What the external replications cost, before they run.")
    parser.add_argument("--band", default="off_peak", choices=("peak", "off_peak"))
    parser.add_argument("--model", default="")
    parser.add_argument("--out", default="")
    parser.add_argument("--check", default="", metavar="PATH",
                        help="verify a saved budget against the rate card it names")
    parser.add_argument("--self-test", action="store_true")
    arguments = parser.parse_args()
    if arguments.self_test:
        return self_test()
    if arguments.check:
        problems = check_manifest(Path(arguments.check))
        if problems:
            print("the saved budget does not match the card:")
            for problem in problems:
                print(f"  {problem}")
            return 1
        print(f"bench_budget: {arguments.check} matches the card")
        return 0
    priced = plan(arguments.band, arguments.model)
    if arguments.out:
        Path(arguments.out).write_text(json.dumps(priced, indent=1) + "\n", encoding="utf-8")
    print(render(priced))
    return 0


if __name__ == "__main__":
    sys.exit(main())
