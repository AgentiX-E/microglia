#!/usr/bin/env python3
"""R218 — the submission, and the metric a row may be compared on.

Every number this lane has quoted about its position came from a hand-built table. R218 was registered as
"submission alignment: the harness the board accepts", and the first thing an audit of that table found is that
the table was wrong in a way no amount of care with individual cells would have caught:

  * the τ²-bench board's retail column holds *one domain*; the 87.9% this lane has been quoting as "the SOTA row"
    is the mean over three domains of an entry whose retail cell reads **84.43**;
  * a row labelled "Claude Opus 4.5 (alone) 85.3%" carries **Gemini 3.0 Pro's** retail number — the board's
    Opus 4.5 entry reads **79.61**;
  * our own row is `pass^1` at one attempt while most board rows are `pass^4` over four, so the two are not the
    same quantity even when their cells are in the same column.

None of those is a typo. Each is the same defect: a cell compared without its metric and its domain attached. So
this tool does not format a submission; it makes the *comparison* checkable. Three operations, one rule:

  `--emit`      an arm's `results.json` files become a board `submission.json`, with `pass_1..pass_4` computed
                from the grid rather than retyped, the cost averaged per trajectory, and `submission_type`
                derived from whether our harness replaced the scaffold (it did — the block is a system message
                the stock scaffold never writes, so the entry is `custom` and the board's own rule then requires
                notes, references and a stated prompt modification).
  `--check`     a `submission.json` is validated against the schema the board publishes
                (`web/leaderboard/public/submissions/schema.json`, read 2026-11-25 at commit `768f3d8f`) — every
                object closed to unknown keys, every range, the required contact, the reference types — plus the
                board's *prose* rules that a JSON schema cannot express (a custom entry without notes is refused,
                an entry that never says whether it changed a prompt is refused).
  `--position`  our row is placed among the board's rows **on one metric in one domain**, and the placement is
                refused when our artefact does not state that metric. A `pass^1` at one attempt has no `pass^4`;
                saying so is the whole point, because the alternative is what this lane did for eight rounds.

The board snapshot is a pinned file (`eval/manifests/tau2-board-1x-2026-11-25.json`), not a live fetch: a leader
board that moves under a quoted number makes the number unquotable, and the lane's rule everywhere else is that a
reading names the artefact it was taken from.

Usage:
  python3 eval/tools/submission.py --emit --arm eval/results/working-memory/control.json \\
    --harness replace --harness-name microglia --injects "a state block behind the conversation" \\
    --model deepseek-flash --model-organization DeepSeek --submitting-organization AgentiX-E \\
    --contact-email dev@agentix.example --tau2-version 1.0.1 --reference https://github.com/AgentiX-E/microglia \\
    --out /tmp/submission.json
  python3 eval/tools/submission.py --check /tmp/submission.json
  python3 eval/tools/submission.py --position /tmp/submission.json --metric pass_1 --domain retail
  python3 eval/tools/submission.py --census
  python3 eval/tools/submission.py --self-test
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SCHEMA = "microglia.submission/1"
BOARD_SCHEMA = "microglia.tau2-board/1"

#: Where the pinned snapshot lives, relative to this file. One copy: a second path in a script is the copy that
#: goes stale the day the snapshot is re-read.
BOARD_PATH = Path(__file__).resolve().parents[1] / "manifests" / "tau2-board-1x-2026-11-25.json"

#: The domains `Results` accepts, spelled as the schema spells them. `additionalProperties: false` on `Results`
#: means a domain outside this set is not a domain the board will read.
DOMAINS = ("retail", "airline", "telecom", "banking_knowledge")

#: `Reference.type`'s enum, from the schema. A reference of any other type fails validation at the board.
REFERENCE_TYPES = ("paper", "blog_post", "documentation", "model_card", "github", "huggingface", "other")

#: The three domains a "mean over domains" is a mean of. `banking_knowledge` is a retrieval benchmark with its own
#: tab and its own retrieval configuration, and averaging it in is how a 68.4% entry reads as a 84.4% one.
TEXT_DOMAINS = ("retail", "airline", "telecom")

#: The metric ladder. Pass^k is a *reliability* reading: a task counts only if all k of its attempts passed, so
#: pass^4 over four attempts and pass^1 over one are different quantities in the same column (COMPETITIVE §R218c).
METRICS = ("pass_1", "pass_2", "pass_3", "pass_4")

#: The implementations τ²-bench ships. A `standard` entry must be one of these: the board defines standard as a
#: general-purpose model through the benchmark's *own* agent scaffold, so an artefact whose `agent_info` names
#: anything else cannot be submitted as one, whatever the caller's flag says.
STOCK_AGENTS = ("llm_agent",)

#: A reward of one is a pass. τ²'s evaluator returns one of exactly two values, and a partial score counted as a
#: pass would inflate every rate in this file — the same rule `note_pilot.py` and `packages/eval/src/l4.ts` apply.
PASS = 1.0


class Refusal(Exception):
    """A document that cannot support the statement being built from it."""


def document_of(payload) -> dict:
    """A parsed results document, or a refusal — one gate, so a path and a fixture cannot disagree."""
    if not isinstance(payload, dict) or not isinstance(payload.get("simulations"), list):
        raise Refusal("not a results document")
    return payload


def load(path: str) -> dict:
    with open(path, encoding="utf-8") as stream:
        return document_of(json.load(stream))


def grid_of(document: dict) -> dict:
    """`{(task, trial): reward}` — the grid, with every duplicate refused.

    A duplicate `(task, trial)` is not a detail of the file layout: `tau2 submit validate` rejects it, and a rate
    computed over a grid that holds one twice is a rate over a different population. Refused at the grid so that
    every reading below inherits the refusal.
    """
    grid = {}
    for simulation in document["simulations"]:
        key = (str(simulation.get("task_id")), int(simulation.get("trial") or 0))
        if key in grid:
            raise Refusal(f"duplicate trial {key}")
        reward = (simulation.get("reward_info") or {}).get("reward")
        grid[key] = None if reward is None else float(reward)
    if not grid:
        raise Refusal("no simulations")
    return grid


def pass_k(grid: dict, k: int) -> tuple[float | None, int]:
    """`(percent, tasks)` for pass^k, or `(None, 0)` when no task has k attempts.

    A task with fewer than k attempts leaves the denominator rather than counting as a failure. Averaging it as a
    zero is the biased estimate this lane exists to avoid: at one attempt every pass^4 would read 0% and the row
    would say "reliable never" instead of "not measured".
    """
    by_task: dict[str, list[float | None]] = {}
    for (task, _trial), reward in grid.items():
        by_task.setdefault(task, []).append(reward)
    scored = [rewards for rewards in by_task.values() if len(rewards) >= k]
    if not scored:
        return (None, 0)
    passed = sum(1 for rewards in scored if all((r or 0.0) >= PASS for r in rewards[:k]))
    return (100.0 * passed / len(scored), len(scored))


def cost_of(document: dict) -> float | None:
    """The mean cost of one trajectory, or `None` when any episode is missing one.

    The board wants "average cost in USD to run one trajectory". A partial sum divided by the full count would
    understate it, and a zero is rejected outright (`cost` has a minimum of 0 but the maintainers' checklist asks
    for a positive number), so an incomplete bill is reported as absent rather than as cheap.
    """
    costs = []
    for simulation in document["simulations"]:
        agent = simulation.get("agent_cost")
        user = simulation.get("user_cost")
        if not isinstance(agent, (int, float)) or not isinstance(user, (int, float)):
            return None
        costs.append(float(agent) + float(user))
    if not costs:
        return None
    return sum(costs) / len(costs)


def info_of(document: dict, key: str, field: str = "implementation") -> str:
    block = (document.get("info") or {}).get(key) or {}
    if not isinstance(block, dict):
        raise Refusal(f"info.{key} is not an object")
    value = block.get(field)
    if not isinstance(value, str) or not value.strip():
        raise Refusal(f"info.{key}.{field} is absent")
    return value.strip()


def domain_of(document: dict) -> str:
    domain = ((document.get("info") or {}).get("environment_info") or {}).get("domain_name")
    if domain not in DOMAINS:
        raise Refusal(f"domain {domain!r} is not one the board reads")
    return domain


def emit(
    arms: list[dict],
    *,
    harness: str,
    harness_name: str,
    injects: str,
    model: str,
    model_organization: str,
    submitting_organization: str,
    contact: dict,
    tau2_version: str,
    references: list[str],
    date: str,
) -> dict:
    """One submission document from the arm documents that compose it.

    The arms are one system, so every property that the board reads as a property of *the system* has to agree
    across them: the domain, the agent implementation, the agent model, the user simulator. A disagreement is
    `mixed-agent`/`mixed-user` and stops the build, because the alternative is a row whose number is an average of
    two experiments — R93's defect, one level up.
    """
    if not arms:
        raise Refusal("no arms")
    domains = {domain_of(document) for document in arms}
    if len(domains) != 1:
        raise Refusal(f"mixed-domain: {sorted(domains)}")
    domain = domains.pop()
    implementations = {info_of(document, "agent_info") for document in arms}
    models = {info_of(document, "agent_info", "llm") for document in arms}
    users = {info_of(document, "user_info", "llm") for document in arms}
    if len(implementations) != 1:
        raise Refusal(f"mixed-agent: {sorted(implementations)}")
    if len(models) != 1:
        raise Refusal(f"mixed-model: {sorted(models)}")
    if len(users) != 1:
        raise Refusal(f"mixed-user: {sorted(users)}")

    if harness == "stock" and sorted(implementations)[0] not in STOCK_AGENTS:
        raise Refusal(
            f"stock-scaffold: the artefact ran {sorted(implementations)[0]}, which is not the benchmark's own agent"
        )

    merged: dict = {}
    bills = []
    for document in arms:
        grid = grid_of(document)
        for key, reward in grid.items():
            if key in merged:
                raise Refusal(f"duplicate trial {key} across arms")
            merged[key] = reward
        bills.append(cost_of(document))

    results: dict = {}
    for metric_index, metric in enumerate(METRICS, start=1):
        value, _tasks = pass_k(merged, metric_index)
        if value is not None:
            results[metric] = round(value, 4)
    # `pass_1` is always present here: `grid_of` refuses an empty grid, and a non-empty grid has a k=1 reading.
    # A partial bill is absent, not cheap: the same rule `cost_of` applies within one arm.
    results["cost"] = None if any(bill is None for bill in bills) else round(sum(bills) / len(bills), 6)

    custom = harness == "replace"
    notes = None
    if custom:
        notes = (
            f"{harness_name} replaces the τ² agent scaffold with our own implementation, which {injects}. "
            "The benchmark's tasks, policy, tools, user simulator and evaluator are the stock ones, unmodified. "
            "The system under test is the model plus this harness; the model itself is unchanged."
        )
    document = {
        "model_name": model,
        "model_organization": model_organization,
        "submitting_organization": submitting_organization,
        "submission_date": date,
        "submission_type": "custom" if custom else "standard",
        "modality": "text",
        "contact_info": {key: value for key, value in contact.items() if value is not None},
        "results": {domain: results},
        "trajectories_available": True,
        "references": [{"type": "github", "url": url} for url in references],
        "methodology": {
            "evaluation_date": date,
            "tau2_bench_version": tau2_version,
            "user_simulator": sorted(users)[0],
            "notes": notes,
            "verification": {
                "modified_prompts": True if custom else False,
                "omitted_questions": False,
                "details": (
                    f"Complete run: every task in {domain} through `tau2 run` with one agent model and one user "
                    f"simulator. {sorted(implementations)[0]} on {sorted(models)[0]}."
                ),
            },
        },
    }
    return document


def check(document: dict) -> tuple[list[str], list[str]]:
    """`(errors, notes)` — the schema's own constraints, then the board's prose rules.

    Mirrors `schema.json` at the pinned read: every object it closes is closed here, every range and enum is here.
    What a schema cannot say is also here, because the maintainers' checklist says it: a custom entry without
    notes and references is refused, and an entry that leaves `modified_prompts` unspecified is refused rather
    than defaulted — the field is a declaration, and a default would be us making it.
    """
    errors: list[str] = []
    notes: list[str] = []

    def require(condition: bool, message: str) -> None:
        if not condition:
            errors.append(message)

    for key in ("model_name", "model_organization", "submitting_organization", "submission_date", "contact_info", "results"):
        require(key in document, f"missing required field {key}")
    if errors:
        return errors, notes

    for key in ("model_name", "model_organization", "submitting_organization", "submission_date"):
        require(isinstance(document[key], str) and document[key].strip() != "", f"{key} is not a non-empty string")
    require(_is_date(document["submission_date"]), "submission_date is not YYYY-MM-DD")

    kind = document.get("submission_type", "standard")
    require(kind in ("standard", "custom"), f"submission_type {kind!r} is not standard|custom")
    require(document.get("modality", "text") in ("text", "voice"), "modality is not text|voice")

    contact = document["contact_info"]
    require(isinstance(contact, dict), "contact_info is not an object")
    if isinstance(contact, dict):
        require(set(contact) <= {"email", "name", "github"}, f"contact_info has unknown keys {sorted(set(contact) - {'email', 'name', 'github'})}")
        require(isinstance(contact.get("email"), str) and "@" in contact["email"], "contact_info.email is required")

    results = document["results"]
    require(isinstance(results, dict) and results, "results is not a non-empty object")
    if isinstance(results, dict):
        require(set(results) <= set(DOMAINS), f"unknown domain(s) {sorted(set(results) - set(DOMAINS))}")
        stated = 0
        for domain, values in results.items():
            if not isinstance(values, dict):
                errors.append(f"{domain}: results is not an object")
                continue
            unknown = set(values) - set(METRICS) - {"cost", "retrieval_config"}
            require(not unknown, f"{domain}: unknown keys {sorted(unknown)}")
            for metric in METRICS:
                value = values.get(metric)
                if value is None:
                    continue
                stated += 1
                require(isinstance(value, (int, float)) and 0 <= value <= 100, f"{domain}.{metric} outside [0, 100]")
            cost = values.get("cost")
            if cost is not None:
                require(isinstance(cost, (int, float)) and cost > 0, f"{domain}.cost must be positive or null")
                if isinstance(cost, (int, float)) and cost > 0:
                    notes.append(f"{domain}: ${cost:.4f} a trajectory, stated")
        require(stated > 0, "results states no pass^k in any domain")

    methodology = document.get("methodology")
    if methodology is not None:
        require(isinstance(methodology, dict), "methodology is not an object")
        if isinstance(methodology, dict):
            allowed = {"evaluation_date", "tau2_bench_version", "user_simulator", "notes", "verification"}
            require(set(methodology) <= allowed, f"methodology has unknown keys {sorted(set(methodology) - allowed)}")
            verification = methodology.get("verification")
            if verification is not None:
                require(isinstance(verification, dict), "verification is not an object")
                if isinstance(verification, dict):
                    allowed_verification = {"modified_prompts", "omitted_questions", "details"}
                    require(
                        set(verification) <= allowed_verification,
                        f"verification has unknown keys {sorted(set(verification) - allowed_verification)}",
                    )
                    require(
                        isinstance(verification.get("modified_prompts"), bool),
                        "verification.modified_prompts must be declared true or false, not left unstated",
                    )

    references = document.get("references")
    if references is not None:
        require(isinstance(references, list), "references is not a list")
        if isinstance(references, list):
            for reference in references:
                if not isinstance(reference, dict):
                    errors.append("a reference is not an object")
                    continue
                require(reference.get("type") in REFERENCE_TYPES, f"reference type {reference.get('type')!r} is not supported")
                require(isinstance(reference.get("url"), str), "a reference has no url")

    release = document.get("model_release")
    if release is not None:
        require(isinstance(release, dict), "model_release is not an object")
        if isinstance(release, dict):
            if release.get("announcement_url") is not None:
                require(_is_date(release.get("release_date")), "model_release.announcement_url without a release_date")

    if kind == "custom":
        notes_text = (methodology or {}).get("notes") if isinstance(methodology, dict) else None
        require(isinstance(notes_text, str) and notes_text.strip() != "", "a custom entry must explain itself in methodology.notes")
        require(bool(references), "a custom entry must link its implementation in references")
    if document.get("trajectories_available") is True:
        notes.append("trajectories_available: the row can be Verified once the files are uploaded and reviewed")
    else:
        notes.append("trajectories_available is not true: the row would be listed Unverified")
    return errors, notes


def _is_date(value) -> bool:
    if not isinstance(value, str) or len(value) != 10:
        return False
    parts = value.split("-")
    if [len(part) for part in parts] != [4, 2, 2]:
        return False
    return all(part.isdigit() for part in parts) and 1 <= int(parts[1]) <= 12 and 1 <= int(parts[2]) <= 31


def load_board(path: str = "") -> dict:
    with open(path or BOARD_PATH, encoding="utf-8") as stream:
        board = json.load(stream)
    if board.get("schema") != BOARD_SCHEMA:
        raise Refusal(f"board snapshot schema {board.get('schema')!r} is not {BOARD_SCHEMA}")
    return board


def stated(document: dict, domain: str, metric: str) -> float | None:
    values = (document.get("results") or {}).get(domain) or {}
    value = values.get(metric)
    return float(value) if isinstance(value, (int, float)) else None


def position(ours: dict, board: dict, metric: str, domain: str) -> dict:
    """Our row among the board's rows, on one metric in one domain — or the refusal to place it.

    Two refusals, both of them states that would otherwise produce a number about nothing:

      `unsupported-metric`  our artefact does not state the metric (one attempt has no pass^4)
      `unknown-metric`      the caller asked for something the board does not have a column for
    """
    if metric not in METRICS:
        raise Refusal(f"unknown-metric: {metric!r}")
    if domain not in DOMAINS:
        raise Refusal(f"unknown-domain: {domain!r}")
    theirs = []
    for entry in board["entries"]:
        value = (entry.get("results") or {}).get(domain) or {}
        number = value.get(metric)
        if isinstance(number, (int, float)):
            theirs.append(
                {
                    "name": entry["name"],
                    "model": entry.get("model"),
                    "submission_type": entry.get("submission_type", "standard"),
                    "value": float(number),
                    "cost": value.get("cost"),
                    # The user simulator is part of the measurement: a row run against gpt-5.2 and a row run
                    # against a two-dollar-per-million simulator are not the same experiment, and the board
                    # lets each submitter choose. Printed so the comparison carries it.
                    "user_simulator": entry.get("user_simulator"),
                    "legacy": bool(entry.get("legacy")),
                    "verified": bool(((entry.get("verification") or {}).get("modified_prompts") is False)
                                     and ((entry.get("verification") or {}).get("omitted_questions") is False)),
                }
            )
    mine = stated(ours, domain, metric)
    reading = {
        "metric": metric,
        "domain": domain,
        "board_rows": len(theirs),
        "ours": mine,
        "status": "",
        "reason": "",
        "rank": None,
        "rows": sorted(theirs, key=lambda row: -row["value"]),
        "our_user_simulator": ((ours.get("methodology") or {}).get("user_simulator")),
    }
    if mine is None:
        reading["status"] = "UNRANKED"
        reading["reason"] = (
            f"our artefact states no {metric} for {domain}: the metric needs {METRICS.index(metric) + 1} "
            "attempt(s) per task and the run was made with fewer"
        )
        return reading
    reading["status"] = "RANKED"
    reading["rank"] = 1 + sum(1 for row in theirs if row["value"] > mine)
    reading["beaten_by"] = [row["name"] for row in theirs if row["value"] > mine]
    return reading


def census(board: dict) -> dict:
    """What the board actually holds, per domain and per metric.

    The point of the census is the denominators. A "top of the board" claim needs the number of rows that state
    the metric at all, and the number that state a cost — three of twelve when this lane last counted, which is
    why a cost-versus-accuracy comparison has so few points on it.
    """
    out = {"read_on": board.get("read_on"), "source_commit": board.get("source_commit"), "domains": {}}
    for domain in DOMAINS:
        block = {}
        for metric in METRICS:
            rows = [
                {"name": entry["name"], "model": entry.get("model"), "value": float(values[metric]),
                 "submission_type": entry.get("submission_type", "standard")}
                for entry in board["entries"]
                if isinstance((values := (entry.get("results") or {}).get(domain) or {}).get(metric), (int, float))
            ]
            rows.sort(key=lambda row: -row["value"])
            block[metric] = {"rows": len(rows), "top": rows[:3]}
        costs = [
            float((entry["results"][domain])["cost"])
            for entry in board["entries"]
            if isinstance(((entry.get("results") or {}).get(domain) or {}).get("cost"), (int, float))
        ]
        block["cost"] = {"rows": len(costs), "min": min(costs) if costs else None, "max": max(costs) if costs else None}
        block["custom"] = sorted(entry["name"] for entry in board["entries"] if entry.get("submission_type") == "custom")
        out["domains"][domain] = block
    return out


def mean_over_domains(entry: dict) -> float | None:
    """The mean of an entry's per-domain pass^1 — the number that is *not* a retail number.

    Printed by `--census --means` because it is the specific arithmetic that produced this lane's error: a
    three-domain mean of 87.91 landed in a retail column and was quoted as the retail SOTA for eight rounds.
    """
    values = [float(entry["results"][domain]["pass_1"]) for domain in TEXT_DOMAINS
              if isinstance(((entry.get("results") or {}).get(domain) or {}).get("pass_1"), (int, float))]
    return sum(values) / len(values) if values else None


def write(document: dict, path: str) -> None:
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def table(reading: dict, ours_name: str) -> str:
    lines = [
        f"{reading['status']}: {reading['metric']} over {reading['domain']}, {reading['board_rows']} board row(s)",
    ]
    if reading["status"] == "RANKED":
        lines.append(f"  rank {reading['rank']} of {reading['board_rows'] + 1}")
    else:
        lines.append(f"  {ours_name}: {reading['reason']}")
    ours_simulator = reading.get("our_user_simulator") or "-"
    lines.append(f"  {'#':>3} {'value':>7}  {'type':8s} {'cost':>8s} {'user simulator':22s} entry")
    mine = reading["ours"]
    for index, row in enumerate(reading["rows"], start=1):
        marker = ""
        if mine is not None and row["value"] <= mine and (index == 1 or reading["rows"][index - 2]["value"] > mine):
            marker = f"  <- {ours_name} at {mine:.2f}"
        cost = f"${row['cost']:.4f}" if isinstance(row.get("cost"), (int, float)) else "-"
        simulator = (row.get("user_simulator") or "-")[:22]
        lines.append(f"  {index:>3} {row['value']:>7.2f}  {row['submission_type']:8s} {cost:>8s} {simulator:22s} {row['name']}{marker}")
    if mine is not None and (not reading["rows"] or reading["rows"][-1]["value"] > mine):
        lines.append(f"  {'-':>3} {mine:>7.2f}  {'ours':8s} {'-':>8s} {ours_simulator:22s} {ours_name}")
    return "\n".join(lines)


def self_test() -> int:
    checks = 0
    failures = 0

    def expect(name: str, condition: bool) -> None:
        nonlocal checks, failures
        checks += 1
        if not condition:
            failures += 1
            print(f"FAIL {name}")

    def arm(trials: int = 1, domain: str = "retail", reward=None, cost=(0.003, 0.001), offset: int = 0) -> dict:
        simulations = []
        for task in range(4):
            for trial in range(trials):
                value = 1.0 if (reward is None or reward(task, trial + offset)) else 0.0
                simulations.append(
                    {
                        "task_id": str(task),
                        "trial": trial + offset,
                        "reward_info": {"reward": value},
                        "agent_cost": cost[0] if cost else None,
                        "user_cost": cost[1] if cost else None,
                    }
                )
        return {
            "timestamp": "2026-11-25T04:20:35.000000",
            "info": {
                "agent_info": {"implementation": "microglia_agent", "llm": "deepseek/deepseek-flash"},
                "user_info": {"llm": "deepseek/deepseek-flash"},
                "environment_info": {"domain_name": domain},
            },
            "simulations": simulations,
        }

    def emit_document(document=None, **kwargs) -> dict:
        arguments = dict(
            harness="replace",
            harness_name="microglia",
            injects="appends a state block behind the conversation",
            model="deepseek-flash",
            model_organization="DeepSeek",
            submitting_organization="AgentiX-E",
            contact={"email": "dev@agentix.example"},
            tau2_version="1.0.1",
            references=["https://github.com/AgentiX-E/microglia"],
            date="2026-11-25",
        )
        arguments.update(kwargs)
        return emit([document or arm()], **arguments)

    # --- the grid -------------------------------------------------------------------------------------------
    expect("a duplicate (task, trial) is refused", _raises(lambda: grid_of({"simulations": [
        {"task_id": "1", "trial": 0, "reward_info": {"reward": 1.0}},
        {"task_id": "1", "trial": 0, "reward_info": {"reward": 1.0}}]}), "duplicate"))
    expect("an empty grid is refused", _raises(lambda: grid_of({"simulations": []}), "no simulations"))
    expect("a document without simulations is refused", _raises(lambda: document_of({"nope": 1}), "not a results document"))
    expect("a missing reward is not a pass", pass_k({("1", 0): None}, 1)[0] == 0.0)

    # --- pass^k ---------------------------------------------------------------------------------------------
    four = {(str(task), trial): 1.0 for task in range(4) for trial in range(4)}
    expect("four attempts each is pass^1 = 100", pass_k(four, 1)[0] == 100.0)
    expect("four attempts each is pass^4 = 100", pass_k(four, 4)[0] == 100.0)
    mixed = dict(four)
    mixed[("0", 3)] = 0.0
    expect("one failed attempt costs pass^4 a task and pass^1 nothing", pass_k(mixed, 4)[0] == 75.0 and pass_k(mixed, 1)[0] == 100.0)
    one = {(str(task), 0): 1.0 for task in range(4)}
    expect("one attempt states no pass^2", pass_k(one, 2) == (None, 0))
    expect("one attempt states pass^1", pass_k(one, 1) == (100.0, 4))
    partial = dict(one)
    partial[("0", 1)] = 1.0
    expect("a task with two attempts leaves the pass^1 denominator alone", pass_k(partial, 1) == (100.0, 4))
    expect("a task with two attempts enters pass^2 and only it", pass_k(partial, 2)[1] == 1)
    expect("the pass^4 of a task that only ran twice is not a zero", pass_k({("1", 0): 1.0, ("2", 0): 1.0}, 4) == (None, 0))

    # --- the bill -------------------------------------------------------------------------------------------
    expect("the mean bill is per trajectory", abs((cost_of(arm(trials=2)) or 0) - 0.004) < 1e-9)
    expect("a missing agent cost makes the bill absent", cost_of(arm(cost=None)) is None)
    expect("a bill of nothing at all is absent", cost_of({"simulations": []}) is None)

    # --- emission -------------------------------------------------------------------------------------------
    document = emit_document()
    expect("the emitted entry is custom when the scaffold is replaced", document["submission_type"] == "custom")
    expect("a custom entry states that a prompt was added", document["methodology"]["verification"]["modified_prompts"] is True)
    expect("a custom entry explains itself", "appends a state block" in (document["methodology"]["notes"] or ""))
    expect("the entry carries one domain", list(document["results"]) == ["retail"])
    expect("one attempt states pass_1 and no pass_2", "pass_1" in document["results"]["retail"] and "pass_2" not in document["results"]["retail"])
    expect("the cost is stated per trajectory", abs(document["results"]["retail"]["cost"] - 0.004) < 1e-9)
    expect("the user simulator is the one the artefact ran", document["methodology"]["user_simulator"] == "deepseek/deepseek-flash")
    expect("four attempts state pass_4", "pass_4" in emit_document(arm(trials=4))["results"]["retail"])
    stock_arm = arm()
    stock_arm["info"]["agent_info"]["implementation"] = "llm_agent"
    stock = emit([stock_arm], **_emit_arguments(harness="stock"))
    expect("a stock harness is a standard entry", stock["submission_type"] == "standard")
    expect("claiming the stock scaffold with our own agent is refused",
           _raises(lambda: emit([arm()], **_emit_arguments(harness="stock")), "stock-scaffold"))
    expect("a standard entry has no notes", stock["methodology"]["notes"] is None)
    expect("a stock harness declares no prompt modification", stock["methodology"]["verification"]["modified_prompts"] is False)

    expect("two arms of one attempt each compose two attempts",
          "pass_2" in emit([arm(), arm(offset=1)], **_emit_arguments())["results"]["retail"])
    expect("an arm repeated is a duplicate trial", _raises(lambda: emit([arm(), arm()], **_emit_arguments()), "duplicate"))
    expect("a mixed domain is refused", _raises(lambda: emit([arm(), arm(domain="airline")], **_emit_arguments()), "mixed-domain"))
    other = arm()
    other["info"]["agent_info"]["implementation"] = "llm_agent"
    expect("a mixed agent is refused", _raises(lambda: emit([arm(), other], **_emit_arguments()), "mixed-agent"))
    other = arm()
    other["info"]["agent_info"]["llm"] = "openai/gpt"
    expect("a mixed model is refused", _raises(lambda: emit([arm(), other], **_emit_arguments()), "mixed-model"))
    other = arm()
    other["info"]["user_info"]["llm"] = "openai/gpt"
    expect("a mixed user is refused", _raises(lambda: emit([arm(), other], **_emit_arguments()), "mixed-user"))
    expect("no arms is refused", _raises(lambda: emit([], **_emit_arguments()), "no arms"))
    expect("a domain the board does not read is refused", _raises(lambda: domain_of(arm(domain="mock")), "not one the board reads"))
    expect("an agent with no implementation is refused", _raises(lambda: info_of({"info": {}}, "agent_info"), "absent"))
    expect("an info block that is not an object is refused", _raises(lambda: info_of({"info": {"agent_info": 3}}, "agent_info"), "not an object"))
    expect("a partial bill among arms makes the merged bill absent",
          emit([arm(), _with_missing_cost(arm(offset=1))], **_emit_arguments())["results"]["retail"]["cost"] is None)

    # --- the check ------------------------------------------------------------------------------------------
    errors, notes = check(document)
    expect("a clean custom entry passes", errors == [])
    expect("a clean entry's bill is noted", any("a trajectory" in note for note in notes))
    expect("a clean entry is noted as verifiable", any("Verified" in note for note in notes))
    expect("a missing required field is caught", "missing required field model_name" in check(_without(document, "model_name"))[0])
    expect("a bad date is caught", any("YYYY-MM-DD" in error for error in check(_with(document, submission_date="25-11-2026"))[0]))
    expect("a bad submission type is caught", any("standard|custom" in error for error in check(_with(document, submission_type="peer"))[0]))
    expect("an unknown domain is caught", any("unknown domain" in error for error in check(_with(document, results={"shopping": {"pass_1": 1.0}}))[0]))
    expect("an unknown result key is caught", any("unknown keys" in error for error in check(_with(document, results={"retail": {"pass_1": 1.0, "pass_9": 2}}))[0]))
    expect("a rate outside 0..100 is caught", any("outside" in error for error in check(_with(document, results={"retail": {"pass_1": 140.0}}))[0]))
    expect("a zero cost is caught", any("positive" in error for error in check(_with(document, results={"retail": {"pass_1": 1.0, "cost": 0}}))[0]))
    expect("a null cost is allowed", check(_with(document, results={"retail": {"pass_1": 1.0, "cost": None}}))[0] == [])
    expect("an entry that states no metric is caught", any("no pass^k" in error for error in check(_with(document, results={"retail": {"cost": 1.0}}))[0]))
    expect("a contact without an email is caught", any("email" in error for error in check(_with(document, contact_info={"name": "x"}))[0]))
    expect("an unknown contact key is caught", any("unknown keys" in error for error in check(_with(document, contact_info={"email": "a@b.c", "phone": "1"}))[0]))
    expect("an unknown methodology key is caught", any("unknown keys" in error for error in check(_with(document, methodology={"notes": "x", "seed": 1}))[0]))
    expect("an unstated prompt declaration is caught",
          any("modified_prompts" in error for error in check(_with(document, methodology={"notes": "x", "verification": {"omitted_questions": False}}))[0]))
    expect("a custom entry without notes is caught",
          any("explain itself" in error for error in check(_with(document, methodology={"verification": {"modified_prompts": True}}, references=[{"type": "github", "url": "u"}]))[0]))
    expect("a custom entry without references is caught",
          any("link its implementation" in error for error in check(_with(document, references=[]))[0]))
    expect("an unsupported reference type is caught",
          any("not supported" in error for error in check(_with(document, references=[{"type": "tweet", "url": "u"}]))[0]))
    expect("a reference without a url is caught", any("no url" in error for error in check(_with(document, references=[{"type": "github"}]))[0]))
    expect("a release with an announcement and no date is caught",
          any("release_date" in error for error in check(_with(document, model_release={"announcement_url": "u"}))[0]))
    expect("a release with a date is allowed",
          check(_with(document, model_release={"announcement_url": "u", "release_date": "2026-01-01"}))[0] == [])
    unverified = _with(document, trajectories_available=False)
    expect("an entry without trajectories is noted unverified", any("Unverified" in note for note in check(unverified)[1]))
    expect("a contact that is not an object is caught",
           any("not an object" in error for error in check(_with(document, contact_info="x"))[0]))
    expect("results that is not an object is caught",
           any("non-empty object" in error for error in check(_with(document, results=[]))[0]))
    expect("a domain whose results are not an object is caught",
           any("not an object" in error for error in check(_with(document, results={"retail": "x"}))[0]))
    expect("a methodology that is not an object is caught",
           any("methodology is not an object" in error for error in check(_with(document, methodology="x"))[0]))
    expect("a verification that is not an object is caught",
           any("verification is not an object" in error
               for error in check(_with(document, methodology={"notes": "x", "verification": "y"}))[0]))
    expect("references that are not a list is caught",
           any("not a list" in error for error in check(_with(document, references="x"))[0]))
    expect("a reference that is not an object is caught",
           any("not an object" in error for error in check(_with(document, references=["x"]))[0]))
    expect("a model_release that is not an object is caught",
           any("model_release is not an object" in error for error in check(_with(document, model_release=[]))[0]))
    expect("a date with letters is caught", any("YYYY-MM-DD" in error for error in check(_with(document, submission_date="2026-1a-01"))[0]))
    expect("a month of thirteen is caught", any("YYYY-MM-DD" in error for error in check(_with(document, submission_date="2026-13-01"))[0]))
    expect("a day of thirty-two is caught", any("YYYY-MM-DD" in error for error in check(_with(document, submission_date="2026-11-32"))[0]))
    expect("a call that does not refuse is not a refusal", _raises(lambda: 1, "x") is False)
    expect("a call that does not exit is not an exit", _exits(lambda: 1, "x") is False)
    expect("a retrieval_config is allowed in a domain", check(_with(document, results={"retail": {"pass_1": 1.0, "retrieval_config": "alltools"}}))[0] == [])

    # --- the position ---------------------------------------------------------------------------------------
    board = load_board()
    ours = emit_document(arm(trials=4, reward=lambda task, trial: task > 0))
    reading = position(ours, board, "pass_1", "retail")
    expect("a pass^1 entry is placed", reading["status"] == "RANKED")
    expect("the rank counts the rows above it", reading["rank"] == 1 + sum(1 for row in reading["rows"] if row["value"] > 75.0))
    expect("a one-attempt artefact is not placed on pass^4",
          position(emit_document(), board, "pass_4", "retail")["status"] == "UNRANKED")
    expect("the refusal says which metric needs how many attempts",
          "needs 4 attempt" in position(emit_document(), board, "pass_4", "retail")["reason"])
    expect("an unknown metric is refused", _raises(lambda: position(ours, board, "pass_5", "retail"), "unknown-metric"))
    expect("an unknown domain is refused", _raises(lambda: position(ours, board, "pass_1", "shopping"), "unknown-domain"))
    expect("a snapshot of another schema is refused",
          _raises(lambda: load_board(str(_snapshot({"schema": "other", "entries": []}))), "is not microglia.tau2-board/1"))

    # --- the census -----------------------------------------------------------------------------------------
    reading = census(board)
    expect("the census reads the snapshot's date", reading["read_on"] == "2026-11-25")
    expect("the census finds retail rows", reading["domains"]["retail"]["pass_1"]["rows"] > 20)
    expect("the census's retail top is the board's top",
          reading["domains"]["retail"]["pass_1"]["top"][0]["value"] == max(
              entry["results"]["retail"]["pass_1"] for entry in board["entries"]
              if isinstance(((entry.get("results") or {}).get("retail") or {}).get("pass_1"), (int, float))))
    expect("the census counts the rows that state a cost", reading["domains"]["retail"]["cost"]["rows"] >= 1)
    expect("the census names the custom entries", "raft-30b-a3b_neu_2026-04-29" in reading["domains"]["retail"]["custom"])
    expect("a three-domain mean is not a retail number",
          any(abs((mean_over_domains(entry) or 0) - 87.91) < 0.05 for entry in board["entries"]))
    expect("the mean of a one-domain entry is that domain",
          mean_over_domains({"results": {"retail": {"pass_1": 84.43}}}) == 84.43)
    expect("an entry with no domain has no mean", mean_over_domains({"results": {}}) is None)

    # --- the writer, the table, and the command line ---------------------------------------------------------
    import contextlib
    import io
    import tempfile

    def cli(arguments: list[str]) -> int:
        """`main` with its own output captured: a suite's transcript is its assertions, not the tool's tables."""
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return main(arguments)

    with tempfile.TemporaryDirectory() as temporary:
        path = str(Path(temporary) / "nested" / "submission.json")
        write(document, path)
        expect("the writer makes the directory", Path(path).is_file())
        expect("what is written is what was checked", check(json.loads(Path(path).read_text()))[0] == [])
        placed = table(position(ours, board, "pass_1", "retail"), "microglia")
        expect("the table names the metric and the domain", "pass_1 over retail" in placed)
        expect("the table marks our row", "microglia at 75.00" in placed)
        expect("an unplaced row is drawn instead of ranked",
              "microglia" in table(position(emit_document(), board, "pass_4", "retail"), "microglia"))
        last = emit_document(arm(trials=4, reward=lambda task, trial: False))
        expect("a row below every board row is still drawn",
              "ours    " in table(position(last, board, "pass_1", "retail"), "microglia"))

        # --- the command line, which is what a workflow calls ---------------------------------------------
        arm_path = str(Path(temporary) / "arm.json")
        Path(arm_path).write_text(json.dumps(arm()), encoding="utf-8")
        emitted = str(Path(temporary) / "cli" / "submission.json")
        code = cli([
            "--emit", "--arm", arm_path, "--model", "deepseek-flash", "--model-organization", "DeepSeek",
            "--contact-email", "dev@agentix.example", "--tau2-version", "1.0.1", "--date", "2026-11-25",
            "--injects", "appends a state block", "--reference", "https://github.com/AgentiX-E/microglia",
            "--out", emitted,
        ])
        expect("the command line emits a submission", code == 0 and Path(emitted).is_file())
        expect("the command line's entry passes its own check", cli(["--check", emitted]) == 0)
        expect("the command line places our row", cli(["--position", emitted, "--metric", "pass_1"]) == 0)
        expect("the command line refuses to place a pass^4 it does not have",
               cli(["--position", emitted, "--metric", "pass_4"]) == 1)
        expect("the command line takes a census", cli(["--census"]) == 0)
        expect("the command line prints the means it was warned about", cli(["--census", "--means"]) == 0)
        expect("the command line needs an operation", cli([]) == 2)
        expect("an emit without its required flags is refused",
               _exits(lambda: cli(["--emit", "--arm", arm_path]), "tau2-submission-missing"))
        expect("an emit with an invalid date is refused by its own check",
               cli([
                   "--emit", "--arm", arm_path, "--model", "m", "--model-organization", "o",
                   "--contact-email", "a@b.c", "--tau2-version", "1.0.1", "--date", "25-11-2026",
                   "--injects", "x", "--reference", "u", "--out", str(Path(temporary) / "bad.json"),
               ]) == 2)
        broken = str(Path(temporary) / "broken.json")
        Path(broken).write_text(json.dumps(_with(document, model_name="")), encoding="utf-8")
        expect("the command line reports an invalid document", cli(["--check", broken]) == 2)

    print(f"\n{checks} checks, {failures} failure(s)")
    return 0 if failures == 0 else 1


def _emit_arguments(**overrides) -> dict:
    arguments = dict(
        harness="replace",
        harness_name="microglia",
        injects="appends a state block behind the conversation",
        model="deepseek-flash",
        model_organization="DeepSeek",
        submitting_organization="AgentiX-E",
        contact={"email": "dev@agentix.example"},
        tau2_version="1.0.1",
        references=["https://github.com/AgentiX-E/microglia"],
        date="2026-11-25",
    )
    arguments.update(overrides)
    return arguments


def _raises(call, fragment: str) -> bool:
    try:
        call()
    except Refusal as refusal:
        return fragment in str(refusal)
    return False


def _exits(call, fragment: str) -> bool:
    try:
        call()
    except SystemExit as exit_code:
        return fragment in str(exit_code)
    return False


def _with(document: dict, **changes) -> dict:
    copy = json.loads(json.dumps(document))
    copy.update(changes)
    return copy


def _without(document: dict, key: str) -> dict:
    copy = json.loads(json.dumps(document))
    copy.pop(key, None)
    return copy


def _with_missing_cost(document: dict) -> dict:
    copy = json.loads(json.dumps(document))
    copy["simulations"][0]["agent_cost"] = None
    return copy


def _snapshot(payload: dict) -> str:
    import tempfile

    handle = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
    json.dump(payload, handle)
    handle.close()
    return handle.name


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="the board's submission, and the metric a row may be compared on")
    parser.add_argument("--emit", action="store_true")
    parser.add_argument("--arm", action="append", default=[])
    parser.add_argument("--harness", choices=("stock", "replace"), default="replace")
    parser.add_argument("--harness-name", default="microglia")
    parser.add_argument("--injects", default="")
    parser.add_argument("--model", default="")
    parser.add_argument("--model-organization", default="")
    parser.add_argument("--submitting-organization", default="AgentiX-E")
    parser.add_argument("--contact-email", default="")
    parser.add_argument("--contact-name", default=None)
    parser.add_argument("--contact-github", default=None)
    parser.add_argument("--tau2-version", default="")
    parser.add_argument("--reference", action="append", default=[])
    parser.add_argument("--date", default="")
    parser.add_argument("--out", default="")
    parser.add_argument("--check", default="")
    parser.add_argument("--position", default="")
    parser.add_argument("--census", action="store_true")
    parser.add_argument("--means", action="store_true", help="print every entry's mean over domains beside its retail cell")
    parser.add_argument("--metric", default="pass_1")
    parser.add_argument("--domain", default="retail")
    parser.add_argument("--board", default="")
    parser.add_argument("--ours-name", default="microglia")
    parser.add_argument("--self-test", action="store_true")
    arguments = parser.parse_args(argv)

    if arguments.self_test:
        return self_test()

    if arguments.emit:
        missing = [name for name, value in
                   (("--model", arguments.model), ("--model-organization", arguments.model_organization),
                    ("--contact-email", arguments.contact_email), ("--tau2-version", arguments.tau2_version),
                    ("--date", arguments.date), ("--out", arguments.out)) if not value]
        if arguments.harness == "replace" and not arguments.injects:
            missing.append("--injects")
        if missing:
            raise SystemExit(f"tau2-submission-missing: {', '.join(missing)}")
        document = emit(
            [load(path) for path in arguments.arm],
            harness=arguments.harness,
            harness_name=arguments.harness_name,
            injects=arguments.injects,
            model=arguments.model,
            model_organization=arguments.model_organization,
            submitting_organization=arguments.submitting_organization,
            contact={"email": arguments.contact_email, "name": arguments.contact_name,
                     "github": arguments.contact_github},
            tau2_version=arguments.tau2_version,
            references=arguments.reference,
            date=arguments.date,
        )
        errors, notes = check(document)
        if errors:
            for error in errors:
                print(f"tau2-submission-invalid: {error}", file=sys.stderr)
            return 2
        write(document, arguments.out)
        print(json.dumps({"out": arguments.out, "results": document["results"], "notes": notes}, indent=1))
        return 0

    if arguments.check:
        document = json.loads(Path(arguments.check).read_text(encoding="utf-8"))
        errors, notes = check(document)
        for note in notes:
            print(f"note  {note}")
        for error in errors:
            print(f"error {error}", file=sys.stderr)
        print(f"{len(errors)} error(s)")
        return 0 if not errors else 2

    if arguments.position:
        document = json.loads(Path(arguments.position).read_text(encoding="utf-8"))
        reading = position(document, load_board(arguments.board), arguments.metric, arguments.domain)
        print(table(reading, arguments.ours_name))
        return 0 if reading["status"] == "RANKED" else 1

    if arguments.census:
        board = load_board(arguments.board)
        reading = census(board)
        if arguments.means:
            reading["means_over_domains"] = sorted(
                (
                    {"name": entry["name"], "retail": ((entry.get("results") or {}).get("retail") or {}).get("pass_1"),
                     "mean": mean_over_domains(entry)}
                    for entry in board["entries"]
                ),
                key=lambda row: -(row["mean"] or 0),
            )
        print(json.dumps(reading, indent=1))
        return 0

    parser.print_help()
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
