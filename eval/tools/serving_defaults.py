#!/usr/bin/env python3
"""The driver's half of one manifest, two readers.

`eval/manifests/serving-defaults.json` is what the evaluation measured; `packages/core/src/memory/serving.ts` is what
the product ships, and `serving.test.ts` binds the two on the TypeScript side. This file binds the **third** reader,
which is the one that actually spends the money: the dispatch's own arm definition, where a placement is written as
a `--note-source` argument rather than as a constant.

Why the argument and not a constant: R216's grid runs two arms of the same code with two placements, so the placement
travels with the arm. That is the right design for an ablation and the wrong design for a default — a value that
lives in a command line is a value no compiler reads. So the workflow is parsed here, the argument is mapped to the
placement it means, and the manifest is asserted against it.

    python3 eval/tools/serving_defaults.py            # exit 1 if the dispatch and the manifest disagree
    python3 eval/tools/serving_defaults.py --self-test
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "eval" / "manifests" / "serving-defaults.json"
WORKFLOW = ROOT / ".github" / "workflows" / "working-memory.yml"

#: The `--note-source` values and the placement each one puts the block in. `board` appends behind the conversation;
#: `board-front` writes into the system message; `board-policy` is the tail placement under R219's admission rule,
#: which changes what the block says and not where it sits. Anything else is a note source that says nothing about
#: placement, and a policy arm that was mapped to a placement of its own would be read as a third address.
PLACEMENT_OF = {"board": "tail", "board-front": "front", "board-policy": "tail", "board-clause": "tail"}

#: The fields a reader may compare. Kept as data so the report can name a mismatch rather than assert into the void.
COMPARED = ("placement", "askSource", "settlementGrades", "blockCeilingChars", "openAskCeiling", "trials",
            "blockLines")


def summary(checks: int, failures: list[str]) -> str:
    """The last thing a suite prints, in both of its shapes — a reporter that only runs when something is wrong is a
    reporter nobody has read."""
    text = f"{checks - len(failures)}/{checks} assertions"
    if failures:
        text += "\n" + "\n".join(f"FAIL {name}" for name in failures)
    return text


class Refusal(Exception):
    """A manifest or workflow this tool will not read, as distinct from a disagreement between them."""


def load_manifest(path: Path | str = MANIFEST) -> dict:
    """The defaults block, with the fields the comparison reads checked for presence."""
    try:
        document = json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise Refusal(f"{path}: no such manifest")
    except json.JSONDecodeError as error:
        raise Refusal(f"{path}: {error}")
    defaults = document.get("defaults") if isinstance(document, dict) else None
    if not isinstance(defaults, dict):
        raise Refusal(f"{path}: no `defaults` object")
    for field in COMPARED:
        # `null` is a field that was written down and said nothing, which is the same defect as an absent one and
        # harder to see: `"askSource": null` passes a presence check and fails every comparison made against it.
        if defaults.get(field) is None:
            raise Refusal(f"{path}: `defaults` has no {field}")
    if defaults["placement"] not in ("tail", "front"):
        raise Refusal(f"{path}: placement {defaults['placement']!r} is not one this driver implements")
    return defaults


def carrier_arm(path: Path | str = MANIFEST) -> str:
    """The arm named as carrying the manifest's placement.

    It is a name rather than a predicate on purpose. "Some arm serves this placement" is satisfied by any arm that
    happens to agree, so changing `placement` in the manifest would leave the Python reader green while the dispatch
    kept the old one — the divergence this whole file exists to catch. Naming the arm makes the comparison a
    comparison of two specific values.
    """
    try:
        document = json.loads(Path(path).read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError) as error:
        raise Refusal(f"{path}: {error}")
    arm = ((document.get("carrier") or {}) if isinstance(document, dict) else {}).get("arm")
    if not isinstance(arm, str) or not arm:
        raise Refusal(f"{path}: no `carrier.arm`")
    return arm


def placement_of(note_source: str) -> str:
    """The placement a `--note-source` value means, or `""` when it means nothing about placement."""
    return PLACEMENT_OF.get(note_source.strip(), "")


def arm_note_sources(path: Path | str = WORKFLOW) -> dict[str, str]:
    """`arm -> note source` from the workflow's `run_arm` lines.

    A `run_arm` without `--note-source` is the control arm: it serves no block, so it has no placement and is absent
    from the map rather than present with a default.
    """
    try:
        text = Path(path).read_text(encoding="utf-8")
    except FileNotFoundError:
        raise Refusal(f"{path}: no such workflow")
    found: dict[str, str] = {}
    for line in text.splitlines():
        match = re.match(r"\s*run_arm\s+(\w+)(.*)$", line)
        if not match:
            continue
        arm, rest = match.group(1), match.group(2)
        source = re.search(r"--note-source\s+(\S+)", rest)
        if source:
            found[arm] = source.group(1)
    if not found:
        raise Refusal(f"{path}: no `run_arm ... --note-source` line")
    return found


def disagreements(defaults: dict, sources: dict[str, str], carrier: str = "board") -> list[str]:
    """Every way the dispatch and the manifest can disagree, as sentences.

    Two questions, and they are different. **Has the declared placement an arm?** — if the manifest says `tail` and
    no arm in the workflow puts the block behind the conversation, the dispatch cannot measure the configuration the
    product ships. **Does every arm's placement mean what it says?** — a `--note-source` outside the map is an arm
    whose block position is unknown, which in a two-arm grid means the contrast is between two unknowns.
    """
    problems = []
    places = {arm: placement_of(source) for arm, source in sources.items()}
    for arm, place in places.items():
        if not place:
            problems.append(f"{arm}: `--note-source {sources[arm]}` names no placement")
    if carrier not in sources:
        problems.append(f"the carrier arm {carrier!r} is not in the dispatch")
    elif places.get(carrier) != defaults["placement"]:
        problems.append(
            f"the carrier arm {carrier!r} serves {places.get(carrier) or 'nothing'!r}, but the manifest names "
            f"{defaults['placement']!r}: the dispatch cannot measure the configuration the product ships")
    return problems


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Does the dispatch measure the configuration the product ships?")
    parser.add_argument("--manifest", default=str(MANIFEST))
    parser.add_argument("--workflow", default=str(WORKFLOW))
    parser.add_argument("--self-test", action="store_true")
    arguments = parser.parse_args(argv)

    if arguments.self_test:
        return self_test()

    try:
        defaults = load_manifest(arguments.manifest)
        sources = arm_note_sources(arguments.workflow)
        carrier = carrier_arm(arguments.manifest)
    except Refusal as error:
        print(f"serving-defaults-refused: {error}", file=sys.stderr)
        return 2

    problems = disagreements(defaults, sources, carrier)
    print(f"serving defaults: placement {defaults['placement']!r}, "
          f"ask source {defaults['askSource']!r}, {defaults['trials']} attempt(s)")
    for arm, source in sorted(sources.items()):
        print(f"  arm {arm:10s} --note-source {source:12s} -> {placement_of(source) or 'unknown'}")
    if problems:
        for problem in problems:
            print(f"serving-defaults-disagreement: {problem}", file=sys.stderr)
        return 1
    return 0


def self_test() -> int:
    """The suite, on manifests and workflows it builds."""
    import tempfile

    results: list[tuple[str, bool]] = []

    def expect(name: str, condition: bool) -> None:
        results.append((name, condition))

    def verdict(body, fragment: str) -> bool:
        """Whether `body()` refuses with `fragment` — a value, so the no-refusal branch can be asserted on too."""
        try:
            body()
        except Refusal as error:
            return fragment in str(error)
        return False

    def refuses(name: str, body, fragment: str) -> None:
        expect(name, verdict(body, fragment))

    def manifest(carrier: str | None = "board", **defaults) -> Path:
        body = {"placement": "tail", "askSource": "request", "settlementGrades": ["name", "overlap"],
                "blockCeilingChars": 500, "openAskCeiling": 3, "trials": 1, "blockLines": 8}
        body.update(defaults)
        document: dict = {"schema": "microglia.serving-defaults/1", "defaults": body}
        if carrier is not None:
            document["carrier"] = {"arm": carrier}
        handle = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        json.dump(document, handle)
        handle.close()
        return Path(handle.name)

    def workflow(*lines: str) -> Path:
        handle = tempfile.NamedTemporaryFile("w", suffix=".yml", delete=False)
        handle.write("steps:\n  - run: |\n" + "".join(f"          {line}\n" for line in lines))
        handle.close()
        return Path(handle.name)

    # --- the reporter, which otherwise only runs when something is wrong --------------------------------
    expect("a clean sheet is one line", summary(2, []) == "2/2 assertions")
    expect("a dirty one names each failure", summary(2, ["b"]) == "1/2 assertions\nFAIL b")
    expect("a call that does not refuse is not a refusal", verdict(lambda: 1, "x") is False)

    # --- the note source vocabulary --------------------------------------------------------------------------
    expect("board is the tail placement", placement_of("board") == "tail")
    expect("board-front is the front placement", placement_of("board-front") == "front")
    expect("board-clause is the tail placement under another reach", placement_of("board-clause") == "tail")
    expect("model names no placement", placement_of("model") == "")
    expect("so does anything else", placement_of("anything") == "")

    # --- the manifest ----------------------------------------------------------------------------------------
    expect("the live manifest names a carrier arm", carrier_arm(MANIFEST) == "board")
    refuses("a manifest with no carrier is refused", lambda: carrier_arm(manifest(carrier=None)), "no `carrier.arm`")
    live = load_manifest(MANIFEST)
    expect("the live manifest reads", live["placement"] in ("tail", "front"))
    refuses("a missing manifest is refused", lambda: load_manifest("/nonexistent/x.json"), "no such manifest")
    bad = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
    bad.write("{")
    bad.close()
    refuses("unreadable json is refused", lambda: load_manifest(bad.name), "line")
    no_defaults = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
    json.dump({"schema": "x"}, no_defaults)
    no_defaults.close()
    refuses("a manifest with no defaults is refused", lambda: load_manifest(no_defaults.name), "no `defaults`")
    refuses("a default field missing is refused",
            lambda: load_manifest(manifest(placement="tail", askSource=None)), "has no askSource")
    refuses("a placement this driver does not implement is refused",
            lambda: load_manifest(manifest(placement="system-merged")), "not one this driver implements")

    # --- the workflow ----------------------------------------------------------------------------------------
    expect("run_arm lines are read", arm_note_sources(WORKFLOW) == {
        "front": "board-front", "board": "board", "policy": "board-policy", "clause": "board-clause"})
    refuses("a workflow with no run_arm is refused",
            lambda: arm_note_sources(workflow("echo nothing")), "no `run_arm")
    refuses("a missing workflow is refused",
            lambda: arm_note_sources("/nonexistent/w.yml"), "no such workflow")
    expect("a control arm with no note source is absent", arm_note_sources(
        workflow("run_arm control", "run_arm board --note-source board")) == {"board": "board"})
    expect("the dispatch may carry more than two arms", arm_note_sources(workflow(
        "run_arm control", "run_arm front --note-source board-front", "run_arm board --note-source board")
    ) == {"front": "board-front", "board": "board"})

    # --- the comparison --------------------------------------------------------------------------------------
    defaults = load_manifest(manifest())
    expect("a dispatch with the manifest's placement agrees",
           disagreements(defaults, {"front": "board-front", "board": "board"}) == [])
    expect("a dispatch with no carrier arm disagrees",
           disagreements(defaults, {"front": "board-front"}, "board")[0] == "the carrier arm 'board' is not in the "
           "dispatch")
    expect("a carrier serving the wrong placement disagrees",
           "but the manifest names" in disagreements(defaults, {"front": "board-front", "board": "board-front"},
                                                     "board")[0])
    expect("an unknown note source is named",
           any("names no placement" in problem for problem in disagreements(
               defaults, {"front": "model", "board": "board"})))
    expect("two problems are both reported", len(disagreements(
        defaults, {"front": "model"}, "board")) == 2)
    expect("an empty dispatch disagrees about its carrier", disagreements(defaults, {}, "board") == [
        "the carrier arm 'board' is not in the dispatch"])

    # --- the command line ------------------------------------------------------------------------------------
    expect("the live pairing passes", main([]) == 0)
    expect("a manifest the driver cannot serve exits two",
           _capture(["--manifest", str(manifest(placement="system-merged"))], 2))
    expect("a workflow with no arms exits two",
           _capture(["--workflow", str(workflow("echo"))], 2))
    expect("a dispatch missing the manifest's placement exits one",
           _capture(["--manifest", str(manifest()), "--workflow", str(workflow(
               "run_arm front --note-source board-front"))], 1))

    checks = len(results)
    failures = [name for name, passed in results if not passed]
    print(summary(checks, failures))
    return 1 if failures else 0


def _capture(argv: list[str], expected: int) -> bool:
    """`main` with its output held back: the suite's transcript is its assertions."""
    import contextlib
    import io

    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        return main(argv) == expected


if __name__ == "__main__":
    sys.exit(main())
