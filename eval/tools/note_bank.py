#!/usr/bin/env python3
"""The failure bank: what a run over the whole split holds, and whether its failures can be explained.

R207's pilot failed one episode in forty-eight and the summariser declined it, so the note lane had a material
it could not test. This tool reads a *bank* — one control-armed run over the split, four trials a task, no
sidecar — and answers the two questions the next dispatch is conditioned on:

  1. **how reliably does the arm solve the split** (`pass^1` and `pass^k` over the held-out tasks), which is the
     first number this project has that the published ladder's population can be compared with; and
  2. **do its failures come with a verdict** — the reward, the database check and the checks that failed — because
     a failure the evaluator does not explain cannot be written from, whatever the summariser is shown. R208's `P1`.

It reads and renders; it calls no model. The material ablation (`P2`, `P3`) needs the summariser, so it runs in CI
where the provider key is, and this file is what makes the bank's population quotable before that is bought.

Usage:
  python3 eval/tools/note_bank.py --bank eval/results/note-bank/control.json
  python3 eval/tools/note_bank.py --bank control.json --json /tmp/bank.json
  python3 eval/tools/note_bank.py --self-test
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# The two readers the material is made of, from the driver that owns them: one renderer for the attempt and one for
# the verdict, so a bank's census is computed by the same code that will build the prompt rather than by a copy of it.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "drivers" / "tau2"))

import notes  # noqa: E402


def rows_of(document) -> dict[str, list]:
    """`{task: [reward, …]}`, in trial order, with an unscored trial kept as `None` rather than as a zero.

    `None` is not zero: a trial the evaluator did not grade is an infrastructure fact, and counting it as a failure
    would put it in the bank as material no summariser could use. The census reports `unscored` apart for the same
    reason `notes.reward_of` returns `None` rather than 0.0.
    """
    by_task: dict[str, list] = {}
    simulations = document.get("simulations") if isinstance(document, dict) else None
    for simulation in simulations if isinstance(simulations, list) else []:
        if not isinstance(simulation, dict):
            continue
        task = simulation.get("task_id")
        if not isinstance(task, str) or task.strip() == "":
            continue
        info = simulation.get("reward_info")
        reward = info.get("reward") if isinstance(info, dict) else None
        scored = reward if isinstance(reward, (int, float)) and not isinstance(reward, bool) else None
        by_task.setdefault(task.strip(), []).append(scored)
    return by_task


def census(document, trials: int) -> dict:
    """The bank's reading: how much of the split passed, and how many failures a summariser could be shown.

    `explained` is the count of failed attempts whose `verdict_text` renders at least one line — the population
    R208's `P1` is about. `verdictChars` is the block's measured size, which is `P4`'s subject and the part of the
    material's cost that is not a sentence.
    """
    by_task = rows_of(document)
    scored = {task: [reward for reward in rewards if reward is not None] for task, rewards in by_task.items()}
    unscored = sum(len(rewards) - len(scored[task]) for task, rewards in by_task.items())
    episodes = sum(len(rewards) for rewards in scored.values())
    passes = sum(1 for rewards in scored.values() for reward in rewards if reward >= 1.0)
    held = sum(1 for rewards in scored.values() if len(rewards) >= trials and all(r >= 1.0 for r in rewards))
    failed_tasks = sorted(
        (task for task, rewards in scored.items() if any(reward < 1.0 for reward in rewards)),
        key=lambda task: (len(task), task),
    )
    verdict_chars: list[int] = []
    explained = 0
    attempts = 0
    for simulation in (document.get("simulations") or []) if isinstance(document, dict) else []:
        if not isinstance(simulation, dict):
            continue
        info = simulation.get("reward_info")
        reward = info.get("reward") if isinstance(info, dict) else None
        if not isinstance(reward, (int, float)) or isinstance(reward, bool) or reward >= 1.0:
            continue
        attempts += 1
        rendered = notes.verdict_text(simulation)
        if rendered:
            explained += 1
            verdict_chars.append(len(rendered))
    return {
        "tasks": len(scored),
        "trials": trials,
        "episodes": episodes,
        "unscored": unscored,
        "passes": passes,
        "pass1": (passes / episodes) if episodes else None,
        "held": held,
        "passK": (held / len(scored)) if scored else None,
        "failedTasks": failed_tasks,
        "failedAttempts": attempts,
        "explained": explained,
        "explainedShare": (explained / attempts) if attempts else None,
        "verdictCharsMean": round(sum(verdict_chars) / len(verdict_chars)) if verdict_chars else None,
        "verdictCharsMax": max(verdict_chars) if verdict_chars else None,
        "trajectoryCharsMean": None,
        "bill": bill_of(document),
    }


def bill_of(document) -> dict:
    """What the run cost, from τ²'s own per-simulation counters rather than from a script written afterwards.

    A bank's price is the number that decides whether the next population is affordable, so it belongs in the
    census beside the rewards: `perEpisodeUsd` is what a dispatch of a given size can be planned from, and
    `meanSeconds` is what the window guard's arithmetic assumes. R208's bank was priced with a throwaway script
    because this reader had no bill, and a fact that takes a throwaway script is a fact that will be estimated
    instead — which is how a ¥2.2 bank came to cost ¥14.5.
    """
    simulations = document.get("simulations") if isinstance(document, dict) else None
    agent = 0.0
    user = 0.0
    seconds: list[float] = []
    counted = 0
    for simulation in simulations if isinstance(simulations, list) else []:
        if not isinstance(simulation, dict):
            continue
        counted += 1
        for field, target in (("agent_cost", "agent"), ("user_cost", "user")):
            value = simulation.get(field)
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                if target == "agent":
                    agent += float(value)
                else:
                    user += float(value)
        duration = simulation.get("duration")
        if isinstance(duration, (int, float)) and not isinstance(duration, bool):
            seconds.append(float(duration))
    total = agent + user
    return {
        "episodes": counted,
        "agentUsd": round(agent, 4),
        "userUsd": round(user, 4),
        "totalUsd": round(total, 4),
        "perEpisodeUsd": round(total / counted, 6) if counted else None,
        "meanSeconds": round(sum(seconds) / len(seconds), 1) if seconds else None,
    }


def render(census_of: dict, trials: int) -> str:
    """The bank as a markdown table, with `absent` for a reading the bank cannot produce.

    A share of nothing is printed as `absent` rather than as 0.000: a bank that failed nothing has no coverage to
    report, and the difference between "no failures" and "no material" is the whole reason the bank exists.
    """

    def share(value):
        return "absent" if value is None else f"{value * 100:.1f}%"

    lines = [
        "| reading | value |",
        "|---|---|",
        f"| tasks | {census_of['tasks']} |",
        f"| episodes | {census_of['episodes']} at {trials} trial(s) |",
        f"| pass^1 | {share(census_of['pass1'])} |",
        f"| pass^{trials} | {share(census_of['passK'])} over {census_of['tasks']} task(s) |",
        f"| unscored episodes | {census_of['unscored']} |",
        f"| tasks with a failure | {len(census_of['failedTasks'])} |",
        f"| failed attempts | {census_of['failedAttempts']} |",
        f"| failures the evaluator explained | {census_of['explained']} ({share(census_of['explainedShare'])}) |",
        f"| verdict characters | mean {census_of['verdictCharsMean']}, max {census_of['verdictCharsMax']} |",
    ]
    bill = census_of.get("bill") or {}
    if bill.get("episodes"):
        per_episode = bill.get("perEpisodeUsd")
        mean_seconds = bill.get("meanSeconds")
        lines += [
            f"| cost | ${bill.get('totalUsd')} (agent ${bill.get('agentUsd')}, user ${bill.get('userUsd')}) |",
            f"| cost per episode | {'absent' if per_episode is None else f'${per_episode:.4f}'} |",
            f"| mean episode | {'absent' if mean_seconds is None else f'{mean_seconds} s'} |",
        ]
    if census_of["failedTasks"]:
        lines.append(f"| failing tasks | {', '.join(census_of['failedTasks'])} |")
    return "\n".join(lines)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="read a note bank")
    parser.add_argument("--bank", default="")
    parser.add_argument("--trials", type=int, default=4)
    parser.add_argument("--json", default="")
    parser.add_argument("--self-test", action="store_true")
    arguments = parser.parse_args(argv)

    if arguments.self_test:
        return self_test()
    if not arguments.bank:
        parser.error("--bank or --self-test")
    path = Path(arguments.bank)
    if not path.is_file():
        print(f"no bank at {path}", file=sys.stderr)
        return 2
    document = json.loads(path.read_text())
    reading = census(document, arguments.trials)
    print(render(reading, arguments.trials))
    if arguments.json:
        Path(arguments.json).write_text(json.dumps(reading, indent=1) + "\n")
    # A bank with no failure is a saturated split: `NO_MEASUREMENT` rather than a clean bill of health, because the
    # next round of this lane has nothing to distil and the honest exit code is the one a caller must look at.
    return 0 if reading["failedAttempts"] else 1


def _document(rewards: dict[str, list]) -> dict:
    """A `results.json` of the shape τ² writes, with each task's rewards in trial order."""
    simulations = []
    for task, values in rewards.items():
        for trial, reward in enumerate(values):
            info = {"reward": reward, "db_check": {"db_match": reward == 1.0, "db_reward": reward}}
            if reward < 1.0:
                info["action_checks"] = [{"action": "return_delivered_order_items", "action_match": False}]
            simulations.append({"task_id": task, "trial": trial, "reward_info": info})
    return {"simulations": simulations}


def self_test() -> int:
    checks = 0
    failed: list[str] = []

    def check(name: str, condition: bool, detail: str = "") -> None:
        nonlocal checks
        checks += 1
        if not condition:
            failed.append(f"{name}{': ' + detail if detail else ''}")
            print(f"FAIL  {name}{'' if not detail else f'  ({detail})'}")

    whole = census(_document({"5": [1.0, 1.0, 1.0, 1.0], "9": [1.0, 0.0, 1.0, 1.0]}), 4)
    check("a bank counts its tasks", whole["tasks"] == 2, str(whole["tasks"]))
    check("and its episodes", whole["episodes"] == 8, str(whole["episodes"]))
    check("pass^1 is over episodes", abs(whole["pass1"] - 7 / 8) < 1e-9, str(whole["pass1"]))
    check("pass^k is over tasks that held every trial", abs(whole["passK"] - 0.5) < 1e-9, str(whole["passK"]))
    check("the failing task is named", whole["failedTasks"] == ["9"], str(whole["failedTasks"]))
    check("one failed attempt is in the bank", whole["failedAttempts"] == 1, str(whole["failedAttempts"]))
    check("and the evaluator explains it", whole["explained"] == 1, str(whole["explained"]))
    check("the verdict's size is measured", (whole["verdictCharsMean"] or 0) > 0, str(whole["verdictCharsMean"]))
    check("the table states the pass^k label the trials imply", "pass^4" in render(whole, 4))

    clean = census(_document({"5": [1.0] * 4}), 4)
    check("a split that failed nothing has no failed attempt", clean["failedAttempts"] == 0, str(clean))
    check("and prints its coverage as absent rather than zero", "absent" in render(clean, 4), render(clean, 4))

    # `None` is unscored and not a failure: the same rule `notes.reward_of` applies, checked here because a bank
    # that counted it as zero would offer a summariser an episode nothing was wrong with.
    unscored = census({"simulations": [{"task_id": "5", "reward_info": {"reward": None}}]}, 4)
    check("an unscored episode is counted apart", unscored["unscored"] == 1, str(unscored))
    check("and is not a failed attempt", unscored["failedAttempts"] == 0, str(unscored))
    check("and does not become a pass", unscored["passes"] == 0, str(unscored["passes"]))

    # A short task — fewer trials than the label claims — is not a pass^4, and a census that said it was would
    # report a reliability for a task nobody ran four times.
    short = census(_document({"5": [1.0, 1.0]}), 4)
    check("a task with too few trials does not hold pass^k", short["passK"] == 0.0, str(short["passK"]))

    check("a bool is not a reward", census({"simulations": [{"task_id": "5", "reward_info": {"reward": True}}]}, 4)["passes"] == 0)
    ragged = census(
        {"simulations": [{}, "not a simulation", {"task_id": "  "}, {"task_id": "5", "reward_info": {"reward": 1.0}}]}, 4
    )
    check("a simulation without a task is not a row", ragged["tasks"] == 1, str(ragged["tasks"]))
    check("rows_of skips what it cannot read", rows_of({"simulations": [{}, "not a simulation", {"task_id": " "}]}) == {})
    check("a document without simulations is an empty bank", census({"simulations": []}, 4)["tasks"] == 0)
    check("a document that is not an object is an empty bank", census([], 4)["tasks"] == 0)
    check("rows_of keeps trial order", rows_of(_document({"5": [0.0, 1.0]}))["5"] == [0.0, 1.0])

    import contextlib
    import io
    import tempfile

    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "control.json"
        path.write_text(json.dumps(_document({"5": [0.0] * 4})))
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed):
            code = main(["--bank", str(path)])
        check("a bank with a failure exits 0", code == 0, str(code))
        check("and prints the table", "| pass^1 |" in printed.getvalue(), printed.getvalue()[:80])
        out = Path(directory) / "bank.json"
        with contextlib.redirect_stdout(io.StringIO()):
            main(["--bank", str(path), "--json", str(out)])
        check("the reading is written when asked for", json.loads(out.read_text())["failedAttempts"] == 4,
              out.read_text()[:120])
        empty = Path(directory) / "empty.json"
        empty.write_text(json.dumps(_document({"5": [1.0] * 4})))
        with contextlib.redirect_stdout(io.StringIO()):
            code = main(["--bank", str(empty)])
        check("a saturated split exits 1", code == 1, str(code))
        check("a missing bank exits 2", main(["--bank", str(Path(directory) / "nope.json")]) == 2)
        refused = False
        try:
            with contextlib.redirect_stderr(io.StringIO()):
                main([])
        except SystemExit:
            refused = True
        check("neither a bank nor the self-test is refused", refused)

    for name in failed:
        print(f"FAIL  {name}")
    # The bill: a bank's price is what decides whether the next population is affordable, so it is read from τ²'s
    # own counters and rendered rather than computed by a script written afterwards. The case is R208's: a ¥2.2
    # estimate became a ¥14.5 bank because nothing in the instrument said what an episode costs.
    billed = {"simulations": [
        {"task_id": "5", "trial": 0, "reward_info": {"reward": 0.0}, "agent_cost": 0.004, "user_cost": 0.001,
         "duration": 20.0},
        {"task_id": "5", "trial": 1, "reward_info": {"reward": 1.0}, "agent_cost": 0.006, "user_cost": 0.001,
         "duration": 40.0},
        {"task_id": "9", "trial": 0, "reward_info": {"reward": 1.0}, "agent_cost": True, "duration": "slow"},
    ]}
    bill = bill_of(billed)
    check("the bill adds both arms", bill["totalUsd"] == 0.012, str(bill))
    check("the bill separates the simulator", bill["userUsd"] == 0.002, str(bill))
    check("the bill is per episode", bill["perEpisodeUsd"] == 0.004, str(bill["perEpisodeUsd"]))
    check("the bill ignores what is not a cost", bill["agentUsd"] == 0.01, str(bill["agentUsd"]))
    check("the bill averages only real durations", bill["meanSeconds"] == 30.0, str(bill["meanSeconds"]))
    check("a bank with no bill has no per-episode price", bill_of({"simulations": []})["perEpisodeUsd"] is None)
    check("a document that is not a document has no bill", bill_of(None)["totalUsd"] == 0.0)
    check("the census carries the bill", census(_document({"5": [0.0]}), 4)["bill"]["episodes"] == 1)
    check("the table states the price", "cost per episode" in render(census(billed, 4), 4),
          render(census(billed, 4), 4))
    check("a bank with no episode states no price", "cost |" not in render(census({"simulations": []}, 4), 4))

    for name in failed:
        print(f"FAIL  {name}")
    print(f"{checks} case(s), {len(failed)} failure(s)")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
