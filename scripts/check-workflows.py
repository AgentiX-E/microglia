#!/usr/bin/env python3
"""The rules a workflow file has to satisfy before GitHub will read it.

Every check here exists because one of them failed on a push: `.github/workflows/sota.yml` grew two
`workflow_dispatch` inputs onto a file that already had twenty-five, GitHub refused to parse it
("you may only define up to 25 `inputs` for a `workflow_dispatch` event"), and the consequence was not
a red gate — it was the absence of every gate. The push produced a run named after the file and
nothing else, and no dispatch could start an arm. Nothing in this repository noticed, because `ci.yml`
never looked at the other workflow.

A workflow file is executable configuration and it is not compiled, so the only cheap moment to find
this class of mistake is before the push. The checks are deliberately structural rather than
opinionated:

  parse      every `.yml` under `.github/workflows` is valid YAML
  cap        a `workflow_dispatch` declares at most twenty-five inputs, GitHub's own limit
  unique     no input is declared twice, which YAML resolves by keeping the last one in silence
  dispatch   a `workflow_dispatch` that exists declares `inputs` only under `on`
  runs-on    every job names a runner, because a job without one is rejected at parse time upstream

Usage:
  python3 scripts/check-workflows.py            # exits 1 on the first rule that fails
  python3 scripts/check-workflows.py --list     # what it checked, without failing on purpose
  python3 scripts/check-workflows.py --self-test
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    import yaml

    HAS_YAML = True
except ModuleNotFoundError:  # pragma: no cover - both this sandbox and the runner ship it
    # Degrade rather than refuse. The check that would have caught the incident this file exists for --
    # the twenty-five-input cap -- is a count over the literal declarations and needs no parser, and a
    # repository whose CI is red because a runner image lacks a Python library has traded one silent
    # failure for one loud, wrong one. What is lost without the parser is the YAML validity check and
    # the duplicate-key check, and the run says so on its own line rather than passing quietly.
    yaml = None  # type: ignore[assignment]
    HAS_YAML = False

ROOT = Path(__file__).resolve().parent.parent
WORKFLOWS = ROOT / ".github" / "workflows"

# GitHub's documented cap on a `workflow_dispatch`'s inputs. Hard-coded because the platform rejects
# the file rather than warning, and a number read from the platform at check time would let the check
# pass on a version of the platform that no longer matches.
MAX_INPUTS = 25


def dispatch_inputs(document: dict) -> dict | None:
    """The `workflow_dispatch` configuration, whichever way YAML spelled `on`."""
    trigger = document.get("on", document.get(True))
    if not isinstance(trigger, dict):
        return None
    dispatch = trigger.get("workflow_dispatch")
    return dispatch if isinstance(dispatch, dict) else None


def input_declarations(lines: list[str]) -> list[tuple[str, int]]:
    """Every key one level under `inputs:`, in order, with the line it was declared on.

    A **list** rather than a mapping, because a mapping cannot hold a duplicate and a duplicate is one
    of the two things the platform counts: a file that declares `planted` twice and stays under the cap
    is a file whose second declaration silently replaced the first.

    The indentation is **derived from the `inputs:` line** rather than assumed, because the number this
    file cares about is the platform's count and a rule holding six where the file holds four would
    silently count nothing. That is not a hypothetical: the first version of this function looked for
    keys at eight spaces while `sota.yml` writes them at six, so it counted zero inputs on a file with
    twenty-seven and reported the broken file as clean.
    """
    indent: int | None = None
    out: list[tuple[str, int]] = []
    for number, line in enumerate(lines, start=1):
        stripped = line.strip()
        if stripped == "inputs:":
            indent = len(line) - len(line.lstrip())
            continue
        if indent is None or stripped == "" or stripped.startswith("#"):
            continue
        current = len(line) - len(line.lstrip())
        if current <= indent:
            indent = None
            continue
        if current == indent + 2:
            key = stripped.split(":", 1)[0]
            if key:
                out.append((key, number))
    return out


def literal_checks(path: Path, name) -> list[str]:
    """The subset that needs no parser, used when PyYAML is absent.

    The cap and the duplicate keys are both counts over the literal text, and the cap is the check this
    file exists for, so a missing parser costs the validity check and nothing else.
    """
    failures: list[str] = []
    declared = input_declarations(path.read_text().splitlines())
    if len(declared) > MAX_INPUTS:
        failures.append(
            f"{name}: declares {len(declared)} `workflow_dispatch` inputs against a cap of {MAX_INPUTS}"
        )
    return failures


def check(path: Path) -> list[str]:
    failures: list[str] = []
    # A path outside the repository is still a workflow file to whoever handed it over, and a check
    # that raised `ValueError` instead of answering would be a check nobody could use on a copy.
    try:
        name = path.relative_to(ROOT)
    except ValueError:
        name = path
    if not HAS_YAML:
        return literal_checks(path, name)
    try:
        document = yaml.safe_load(path.read_text())
    except yaml.YAMLError as error:
        return [f"{name}: does not parse: {error}"]
    if not isinstance(document, dict):
        return [f"{name}: is not a mapping"]

    dispatch = dispatch_inputs(document)
    if dispatch is not None:
        inputs = dispatch.get("inputs") or {}
        if not isinstance(inputs, dict):
            failures.append(f"{name}: `inputs` is not a mapping")
        elif len(inputs) > MAX_INPUTS:
            # The count is the whole point: the platform refuses to parse the file, so the failure is
            # total rather than partial, and the message has to say so or the next author will read it
            # as a style note.
            failures.append(
                f"{name}: declares {len(inputs)} `workflow_dispatch` inputs, and GitHub refuses to "
                f"parse a file with more than {MAX_INPUTS} -- no dispatch of any workflow in this "
                "repository can start while this is true"
            )
    # A duplicated key is invisible in YAML: the parser keeps the last and the first is gone. Counting
    # the literal declarations is the only way to see it, and it is cheap because the shape is fixed.
    if dispatch is not None:
        # The parsed mapping cannot show a duplicate -- the parser kept the last -- so the literal
        # count runs beside it, and a disagreement between the two means one of them is counting
        # something that is not an input.
        literal = input_declarations(path.read_text().splitlines())
        parsed = dispatch.get("inputs") or {}
        if isinstance(parsed, dict) and len(literal) != len(parsed):
            counts: dict[str, int] = {}
            for key, _ in literal:
                counts[key] = counts.get(key, 0) + 1
            dupes = sorted(key for key, count in counts.items() if count > 1)
            failures.append(
                f"{name}: {len(literal)} literal input declarations against {len(parsed)} parsed"
                + (f" (declared twice: {', '.join(dupes)})" if dupes else "")
            )

    jobs = document.get("jobs") or {}
    if not isinstance(jobs, dict):
        failures.append(f"{name}: `jobs` is not a mapping")
    else:
        for job, body in jobs.items():
            if not isinstance(body, dict):
                failures.append(f"{name}: job `{job}` is not a mapping")
            elif "runs-on" not in body:
                failures.append(f"{name}: job `{job}` names no runner")
    return failures


def self_test() -> int:
    """Seven cases, each of which is a way this checker could be a checker that says nothing.

    The fourth exists because the first version of `input_declarations` assumed the wrong indentation
    and reported a twenty-seven-input file as clean; a case that only ever feeds it well-formed input
    would have agreed with it.
    """
    import tempfile

    def workflow(
        inputs: int,
        job_runner: bool = True,
        duplicate: str | None = None,
        base: int = 2,
    ) -> str:
        # `base` exists so one case can nest the block deeper: the counter derives its indent from the
        # `inputs:` line, and a case that only ever fed it one indentation would agree with a version
        # that assumed one.
        pad = " " * base
        key = " " * (base + 4)
        field = " " * (base + 6)
        header = [
            "on:",
            f"{pad}push:",
            f"{pad}workflow_dispatch:",
            f"{key}inputs:",
        ]
        body = []
        for index in range(inputs):
            name = duplicate if duplicate is not None and index == inputs - 1 else f"input_{index}"
            body.extend(
                [
                    f"{field}{name}:",
                    f"{field}  description: 'number {index}'",
                    f"{field}  required: false",
                    f"{field}  default: ''",
                ]
            )

        tail = ["jobs:", "  build:"]
        if job_runner:
            tail.append("    runs-on: ubuntu-latest")
        tail.append("    steps: []")
        return "\n".join(header + body + tail) + "\n"

    cases: list[tuple[str, str, bool, str | None]] = [
        ("a workflow at the cap is clean", workflow(MAX_INPUTS), True, None),
        (
            "one input over the cap is refused",
            workflow(MAX_INPUTS + 1),
            False,
            "refuses to parse a file with more than",
        ),
        (
            "a duplicated key is counted against the cap",
            workflow(MAX_INPUTS + 1, duplicate="input_0"),
            False,
            "literal input declarations",
        ),
        (
            "an inputs block nested deeper is still counted",
            workflow(MAX_INPUTS + 1, base=4),
            False,
            "refuses to parse a file with more than",
        ),
        ("a job without a runner is refused", workflow(2, job_runner=False), False, "names no runner"),
        ("a file that is not YAML is refused", "on: [unclosed\n", False, "does not parse"),
    ]
    failures = 0
    with tempfile.TemporaryDirectory() as directory:
        for label, text, clean, fragment in cases:
            path = Path(directory) / "case.yml"
            path.write_text(text)
            found = check(path)
            ok = (not found) if clean else any(fragment in line for line in found)
            if not ok:
                failures += 1
            print(f"  {'ok  ' if ok else 'FAIL'} {label} -> {found or 'clean'}")
        # The degraded path is the one that runs on an image without PyYAML, and it has to keep the
        # cap: that count is the whole incident.
        global HAS_YAML
        stored = HAS_YAML
        HAS_YAML = False
        try:
            path = Path(directory) / "over.yml"
            path.write_text(workflow(MAX_INPUTS + 1))
            found = check(path)
            ok = any("cap of 25" in line for line in found)
            if not ok:
                failures += 1
            print(f"  {'ok  ' if ok else 'FAIL'} without PyYAML the cap is still counted -> {found or 'clean'}")
        finally:
            HAS_YAML = stored
    print()
    print("SELF-TEST PASSED" if failures == 0 else f"SELF-TEST FAILED ({failures})")
    return 0 if failures == 0 else 1


def main(argv: list[str]) -> int:
    if "--self-test" in argv:
        return self_test()
    listing = "--list" in argv
    paths = sorted(WORKFLOWS.glob("*.yml")) + sorted(WORKFLOWS.glob("*.yaml"))
    if not paths:
        print(f"no workflow files under {WORKFLOWS}")
        return 2
    failures: list[str] = []
    for path in paths:
        found = check(path)
        failures.extend(found)
        if listing:
            state = "ok" if not found else "FAIL"
            print(f"  {state} {path.relative_to(ROOT)}")
    if failures:
        for line in failures:
            print(f"workflow: {line}")
        return 1
    if HAS_YAML:
        print(f"workflow: {len(paths)} file(s) parse, declare at most {MAX_INPUTS} inputs, and name runners")
    else:
        print(f"workflow: {len(paths)} file(s) declare at most {MAX_INPUTS} inputs; PyYAML is absent, so "
              "they were counted rather than parsed")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
