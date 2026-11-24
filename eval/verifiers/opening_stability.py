#!/usr/bin/env python3
"""Can a task's identity be read from the message that opened its episode?

R206's material is bound to a task by that task's opening request: the runner writes the note under a key made
from the first user message, and the agent computes the same key from the message τ² handed it. The registration
predicted the identity was "stable within a task and different across tasks". The pilot measured both halves and
this file is the measurement, kept because every future arm that binds anything to an episode will need it:

  exact reuse      how often two attempts at one task produce the *same* key. `1.0` means the text is a stable
                   identity; `0.0` means the binding can never match, whatever the material does.
  separability     the largest within-task Jaccard similarity against the largest cross-task one. If a
                   paraphrase of a task's opening is more like a *different* task's opening than like its own
                   sibling's, no threshold on text can bind the material to a task.
  the best theta   the threshold a fuzzy matcher would have to use, and its two error counts, so a reader can
                   see the price of the fallback rather than being told one exists.

Why this is a file rather than a paragraph. The zero it produces is the kind that gets explained away after the
fact ("the notes were empty, so of course nothing matched"), and the explanation is wrong: no note existed *and*
the identity could not have matched one. Two independent defects in one arm look exactly like one, and only a
number each keeps them apart.

Usage:
  python3 eval/verifiers/opening_stability.py --dir /tmp/r206
  python3 eval/verifiers/opening_stability.py eval/results/poc-note-x/control/results.json --json
  python3 eval/verifiers/opening_stability.py --self-test
"""

from __future__ import annotations

import argparse
import itertools
import json
import re
import sys
from pathlib import Path
from typing import Any

#: Words shorter than this are not content: `to`, `my`, `did` appear in every opening and would make every pair
#: look alike. The same floor the specificity check uses, for the same reason.
WORD_CHARS = 4


def opening_of(simulation: dict) -> str:
    """The first user message of one simulation, or `""`.

    One reader for every caller, because the identity this file measures is the one the sidecar is keyed by — a
    second reader that normalised whitespace differently would measure a key nobody writes.
    """
    messages = simulation.get("messages")
    if not isinstance(messages, list):
        return ""
    for message in messages:
        if not isinstance(message, dict):
            continue
        if message.get("role") not in ("user", "human"):
            continue
        content = message.get("content")
        if isinstance(content, str) and content.strip():
            return content
    return ""


def key_of(text: str, chars: int = 500) -> str:
    """The key `notes.note_key` writes: whitespace collapsed, case kept, bounded."""
    return " ".join(text.split())[:chars]


def tokens_of(text: str) -> set[str]:
    """Content words, lowercased. The only vocabulary a threshold can be computed over."""
    return {word for word in re.findall(r"[a-z0-9]+", text.lower()) if len(word) >= WORD_CHARS}


def similarity(left: str, right: str) -> float:
    """Jaccard over content words: 1.0 for the same phrasing, and high for two paraphrases of one scenario."""
    a, b = tokens_of(left), tokens_of(right)
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def openings_by_task(documents: list[dict]) -> dict[str, list[str]]:
    """Every task's openings, in the order the documents list them."""
    out: dict[str, list[str]] = {}
    for document in documents:
        simulations = document.get("simulations")
        if not isinstance(simulations, list):
            continue
        for simulation in simulations:
            if not isinstance(simulation, dict):
                continue
            task = simulation.get("task_id")
            if not isinstance(task, (str, int)) or str(task) == "":
                continue
            text = opening_of(simulation)
            if text == "":
                continue
            out.setdefault(str(task), []).append(text)
    return out


def census_of(by_task: dict[str, list[str]], thresholds: tuple[float, ...] = (0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5)) -> dict[str, Any]:
    """The three readings, over every pair of openings the corpus holds.

    A pair is either *within* one task (two attempts at the same thing) or *across* two tasks (two different
    things). The distribution of one against the other is the whole question: a text identity needs the first to
    be separated from the second by a margin, and the *exact* reuse is what the shipped mechanism actually does.
    """
    within: list[float] = []
    across: list[float] = []
    for task, openings in by_task.items():
        for a, b in itertools.combinations(openings, 2):
            within.append(similarity(a, b))
    tasks = list(by_task)
    for left, right in itertools.combinations(tasks, 2):
        for a in by_task[left]:
            for b in by_task[right]:
                across.append(similarity(a, b))
    if not within or not across:
        return {"state": "NO_MEASUREMENT", "within": len(within), "across": len(across)}

    exact_pairs = 0
    exact_hits = 0
    for openings in by_task.values():
        for a, b in itertools.combinations(openings, 2):
            exact_pairs += 1
            if key_of(a) == key_of(b):
                exact_hits += 1

    # The threshold a fuzzy matcher would pick, and what it would cost. Chosen by the smallest number of
    # misclassified pairs rather than by a fitted constant: every threshold here is a choice made on this corpus,
    # and the two counts are printed so the choice cannot pretend to be a property of English.
    scored = []
    for theta in thresholds:
        missed = sum(1 for value in within if value < theta)  # same task, below the line: no note served
        wrong = sum(1 for value in across if value >= theta)  # different task, above it: the wrong note served
        scored.append({"theta": theta, "missed": missed, "wrong": wrong, "errors": missed + wrong})
    best = min(scored, key=lambda row: (row["errors"], row["theta"]))
    separable = min(within) > max(across)
    return {
        "state": "SEPARABLE" if separable else "NOT_SEPARABLE",
        "tasks": len(by_task),
        "trials": sum(len(openings) for openings in by_task.values()),
        "withinPairs": len(within),
        "acrossPairs": len(across),
        # The two numbers this file exists for.
        "exactReuse": (exact_hits / exact_pairs) if exact_pairs else None,
        "exactPairs": exact_pairs,
        "withinMin": round(min(within), 4),
        "withinMean": round(sum(within) / len(within), 4),
        "acrossMax": round(max(across), 4),
        "acrossMean": round(sum(across) / len(across), 4),
        "startOfTaskMean": round(sum(within) / len(within), 4),
        "best": best,
        "thresholds": scored,
    }


def render(result: dict[str, Any]) -> str:
    """One block for a log or a step summary."""
    if result.get("state") == "NO_MEASUREMENT":
        return f"opening stability: not measured ({result.get('within')} within-task pair(s), {result.get('across')} across)"
    lines = [
        f"opening stability: {result['state']} — {result['tasks']} task(s), {result['trials']} opening(s)",
        f"  exact key reuse: {result['exactReuse']:.3f} of {result['exactPairs']} same-task pair(s)"
        if result["exactReuse"] is not None
        else "  exact key reuse: absent",
        f"  within-task similarity: min {result['withinMin']:.3f}, mean {result['withinMean']:.3f}",
        f"  cross-task similarity:  max {result['acrossMax']:.3f}, mean {result['acrossMean']:.3f}",
        f"  best threshold: θ={result['best']['theta']:.2f} — {result['best']['missed']} same-task pair(s) "
        f"below it, {result['best']['wrong']} cross-task pair(s) above it",
    ]
    return "\n".join(lines)


def load(paths: list[str]) -> list[dict]:
    documents = []
    for path in paths:
        with open(path, encoding="utf-8") as stream:
            document = json.load(stream)
        if isinstance(document, dict):
            documents.append(document)
    return documents


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="measure whether a task's opening message identifies it")
    parser.add_argument("paths", nargs="*", help="results.json file(s)")
    parser.add_argument("--dir", help="a directory to search for `*/results.json` and `results.json`")
    parser.add_argument("--json", action="store_true", help="print the census rather than the block")
    parser.add_argument("--self-test", action="store_true")
    arguments = parser.parse_args(argv)

    if arguments.self_test:
        return self_test()

    paths = list(arguments.paths)
    if arguments.dir:
        root = Path(arguments.dir)
        paths.extend(str(path) for path in sorted(root.glob("*/results.json")))
        if (root / "results.json").is_file():
            paths.append(str(root / "results.json"))
    if not paths:
        parser.error("a results.json, or --dir, is required")

    result = census_of(openings_by_task(load(paths)))
    print(json.dumps(result, indent=2, sort_keys=True) if arguments.json else render(result))
    # A corpus whose openings cannot identify a task is a *finding*, not a failure of this program: the exit code
    # is reserved for the case where nothing could be measured at all.
    return 0 if result["state"] != "NO_MEASUREMENT" else 2


# ----------------------------------------------------------------------------- self-test


def _doc(rows: list[tuple[str, str]]) -> dict:
    """A results.json whose simulations carry one user message each."""
    return {
        "simulations": [
            {"task_id": task, "trial": index, "messages": [{"role": "assistant", "content": "hi"},
                                                           {"role": "user", "content": text}]}
            for index, (task, text) in enumerate(rows)
        ]
    }


def self_test() -> int:
    failures = 0
    checks = 0

    def check(name: str, ok: bool, detail: str = "") -> None:
        nonlocal failures, checks
        checks += 1
        if ok:
            print(f"PASS  {name}")
        else:
            failures += 1
            print(f"FAIL  {name}{'' if not detail else f'  ({detail})'}")

    # The reader: one shape, and the shapes that are not one.
    check("the first user message is the opening",
          opening_of({"messages": [{"role": "assistant", "content": "x"}, {"role": "user", "content": "y"}]}) == "y")
    check("a simulation with no messages has no opening", opening_of({}) == "")
    check("an assistant-only simulation has no opening", opening_of({"messages": [{"role": "assistant", "content": "x"}]}) == "")
    check("an empty user message is not an opening", opening_of({"messages": [{"role": "user", "content": "  "}]}) == "")
    check("the key collapses whitespace", key_of("a  b\n c") == "a b c")
    check("the key keeps case", key_of("Hi There") == "Hi There")

    # A corpus where the phrasing is fixed: the identity works, and it works exactly.
    fixed = _doc([("1", "I want to exchange a water bottle"), ("1", "I want to exchange a water bottle"),
                  ("2", "I need to change my delivery address"), ("2", "I need to change my delivery address")])
    result = census_of(openings_by_task([fixed]))
    check("a fixed phrasing is separable", result["state"] == "SEPARABLE", result["state"])
    check("and reused exactly", result["exactReuse"] == 1.0, str(result["exactReuse"]))
    check("every task is counted", result["tasks"] == 2, str(result["tasks"]))
    check("every opening is counted", result["trials"] == 4, str(result["trials"]))

    # A corpus of paraphrases: the identity cannot match, and *no* threshold rescues it because two different
    # tasks about the same scenario are more alike than two attempts at one.
    paraphrased = _doc([
        ("5", "Hi, I would like to exchange a water bottle and a desk lamp"),
        ("5", "Hello! I need to swap a desk lamp and a water bottle please"),
        ("9", "Hi there, I want to exchange a water bottle and a desk lamp too"),
        ("9", "Hey, can I exchange my desk lamp and water bottle"),
    ])
    result = census_of(openings_by_task([paraphrased]))
    check("paraphrases are not reused", result["exactReuse"] == 0.0, str(result["exactReuse"]))
    check("and this corpus is not separable", result["state"] == "NOT_SEPARABLE", result["state"])
    check("the overlap is reported as a number", result["withinMin"] <= result["acrossMax"],
          f"within min {result['withinMin']} vs across max {result['acrossMax']}")
    check("the best threshold has errors on both sides", result["best"]["errors"] > 0, str(result["best"]))

    # One trial per task: nothing to compare within, and that is not a verdict about the corpus.
    single = census_of(openings_by_task([_doc([("1", "a"), ("2", "b")])]))
    check("one attempt per task is no measurement", single["state"] == "NO_MEASUREMENT", single["state"])
    empty = census_of(openings_by_task([{"simulations": []}]))
    check("an empty document is no measurement", empty["state"] == "NO_MEASUREMENT")
    check("and it renders as such", "not measured" in render(empty))

    # Two documents merge, which is what a control and a treatment of one grid look like.
    merged = openings_by_task([fixed, fixed])
    check("documents merge by task", len(merged) == 2 and len(merged["1"]) == 4, str({k: len(v) for k, v in merged.items()}))

    # The render is what a log carries, so it has to state the number the state rests on.
    block = render(census_of(openings_by_task([paraphrased])))
    check("the block names the state", "NOT_SEPARABLE" in block)
    check("the block carries the reuse share", "exact key reuse: 0.000" in block)
    check("the block carries the threshold's price", "θ=" in block)

    print(f"\n{checks} checks, {failures} failure(s)")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
