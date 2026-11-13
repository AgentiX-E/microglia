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
  deadline   a step that runs on the lane's own clock derives its timeout from that clock
  catalogue  a job that runs the lane asks the host what it serves, and asks before the first call

  The last one is R82's instrument: a dispatch naming a model the host does not serve fails as a `4xx`
  per prompt, trips the eight-prompt breaker, and reports "the endpoint stopped answering" about a host
  that answered every time — twenty minutes and about a dollar to learn that a string was wrong.

  The last one is R68's third attempt: `deadline_min` 300 against a literal step timeout of 200, so the
  runner killed the step a hundred minutes before the lane's own clock would have and the run wrote no
  artefact — the one outcome the deadline exists to prevent.

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


def duplicate_keys(text: str, name) -> list[str]:
    """Every mapping key, by the path its ancestors give it; a repeat on one path is the error.

    GitHub refuses to parse a file that declares a key twice in one mapping and PyYAML keeps the last
    one without a word, so `yaml.safe_load` cannot see this and a reader looking at the diff cannot
    either. R92 paid for it: `sota.yml` declared `TAU_VERSION` twice inside one `env:` block, the file
    parsed here, every push of it produced a run named after the file with **no jobs**, and the first
    dispatch was answered `422 (Line: 1491, Col: 11): 'TAU_VERSION' is already defined` — a line number
    in an API body, which is where the diagnosis had to come from because nothing local had one.

    The path is built from a stack of enclosing keys rather than from indentation alone, because the
    same key legitimately recurs under different parents: `TAU_VERSION` appears in both arms' `env`
    blocks and both are correct. Sequence entries are indexed so two steps cannot look like one
    mapping, and a block scalar's body is skipped because it is a shell script rather than YAML.
    """
    failures: list[str] = []
    seen: dict[str, int] = {}
    stack: list[tuple[int, str]] = []
    counters: dict[tuple[str, int], int] = {}
    scalar_above: int | None = None
    for number, raw in enumerate(text.splitlines(), start=1):
        stripped = raw.strip()
        indent = len(raw) - len(raw.lstrip())
        if scalar_above is not None:
            if stripped == "" or indent > scalar_above:
                continue
            scalar_above = None
        if stripped == "" or stripped.startswith("#"):
            continue
        if stripped.startswith("- "):
            while stack and stack[-1][0] >= indent:
                stack.pop()
            parent = "/".join(key for _, key in stack)
            counters[(parent, indent)] = counters.get((parent, indent), 0) + 1
            stack.append((indent, f"[{counters[(parent, indent)]}]"))
            stripped = stripped[2:].strip()
            indent += 2
            if stripped == "":
                continue
        while stack and stack[-1][0] >= indent:
            stack.pop()
        if ":" not in stripped:
            continue
        key, value = stripped.split(":", 1)
        key = key.strip().strip('"').strip("'")
        if key == "":
            continue
        path = "/".join([*(inner for _, inner in stack), key])
        if path in seen:
            failures.append(
                f"{name}: `{key}` is declared twice in one mapping (line {seen[path]} and line {number}"
                f", path `{path}`); GitHub refuses to parse the file, so no dispatch of it can start"
            )
            continue
        seen[path] = number
        if value.strip() in ("|", "|-", "|+", ">", ">-", ">+"):
            scalar_above = indent
            continue
        stack.append((indent, key))
    return failures


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


def shell_syntax(document: dict, name) -> list[str]:
    """Every `run:` block must be a shell script bash can parse.

    The cap and the runner were the only things checked here, and R69's first dispatch paid for the
    gap: its new step wrote ```echo "${VALUE:-the lane's default}"```, and inside the `word` part of a
    parameter expansion the shell parses quotes even though the whole thing sits inside double
    quotes. The apostrophe opened a string that never closed, the step died in one second, and the
    dispatch was over before its first model call. Two dispatches died that way, on a step whose
    only job was printing one word into a summary.

    `bash -n` is a parse and not an execution: no step runs, no variable is read, and the file's
    `${{ }}` expressions are just characters to the parser. It is the cheapest check that would have
    caught this, and it catches the whole class -- an unbalanced quote, a missing `fi`, a heredoc
    that is never closed -- in every workflow in the repository rather than in the one that broke.
    """
    import subprocess

    failures: list[str] = []
    jobs = document.get("jobs") or {}
    if not isinstance(jobs, dict):
        return failures
    for job, body in jobs.items():
        if not isinstance(body, dict):
            continue
        steps = body.get("steps")
        if not isinstance(steps, list):
            continue
        for index, step in enumerate(steps):
            if not isinstance(step, dict):
                continue
            script = step.get("run")
            if not isinstance(script, str):
                continue
            parsed = subprocess.run(
                ["bash", "-n"], input=script, text=True, capture_output=True, check=False
            )
            if parsed.returncode != 0:
                detail = (parsed.stderr or "").strip().splitlines()
                failures.append(
                    f"{name}: job `{job}` step {index + 1} does not parse as a shell script: "
                    f"{detail[-1] if detail else 'bash -n refused it'}"
                )
    return failures


def deadline_headroom(document: dict, name) -> list[str]:
    """A step that runs on the lane's own clock may not carry a literal timeout of its own.

    R68's third attempt is the incident. `deadline_min` was 300, the step that runs the benchmark had
    `timeout-minutes: 200`, and nothing anywhere compared the two: the lane spent 2,961 calls over four
    folds, the runner killed the step 100 minutes before the lane's own clock would have, and the run
    produced **no artefact at all** -- exactly the outcome the lane's deadline exists to prevent, since
    a lane that stops itself writes the folds it has finished. The two numbers are one claim about one
    run, so the timeout is derived from the deadline now, and this rule refuses the literal.

    Only steps that read the deadline variable are covered, because a step with an unrelated timeout
    (a publish step, an upload) is not making that claim.
    """
    failures: list[str] = []
    jobs = document.get("jobs") or {}
    if not isinstance(jobs, dict):
        return failures
    for job, body in jobs.items():
        if not isinstance(body, dict):
            continue
        steps = body.get("steps")
        if not isinstance(steps, list):
            continue
        for index, step in enumerate(steps):
            if not isinstance(step, dict):
                continue
            env = step.get("env")
            # The key or the value, because a step names the variable in its key in this repository and
            # a step elsewhere might pass it through in the value. Looking only at values found nothing
            # in the file that pays for this rule, which is how the rule's first self-test failed.
            reads = isinstance(env, dict) and any(
                str(key) == "SOTA_DEADLINE_MIN"
                or (isinstance(value, str) and "deadline_min" in value)
                for key, value in env.items()
            )
            timeout = step.get("timeout-minutes")
            if reads and timeout is not None and not isinstance(timeout, str):
                failures.append(
                    f"{name}: job `{job}` step {index + 1} runs on the lane's deadline and also "
                    f"declares a literal timeout of {timeout}; a dispatch whose deadline is larger is "
                    "killed by the runner before the lane can stop itself and writes no artefact "
                    "(R68) -- derive the timeout from `deadline_min` instead"
                )
    return failures


def backbone_catalogue(document: dict, name) -> list[str]:
    """A job that runs the lane asks the host what it serves, and asks before the first call.

    The defect is a wrong string in a dispatch. `SOTA_MODEL` names a model the host does not serve; the
    host answers `404` per prompt; `verdictOf` calls that a refusal; eight refusals trip the breaker; and
    the artefact then reports that the endpoint stopped answering — twenty minutes and about a dollar
    after a check that takes one request and ten seconds.

    **Order is the rule, not presence.** A probe that runs after the lane is a probe that reports on
    money already spent, so the step index is compared rather than the step's existence. The lane is
    found by the variable it is paid through (`deadline_min` in a step's env), which is the same signal
    `deadline_headroom` uses and for the same reason: it names the run without reading a step's title.
    """
    failures: list[str] = []
    jobs = document.get("jobs") or {}
    if not isinstance(jobs, dict):
        return failures
    for job, body in jobs.items():
        if not isinstance(body, dict):
            continue
        steps = body.get("steps")
        if not isinstance(steps, list):
            continue
        lane_at = None
        probe_at = None
        for index, step in enumerate(steps):
            if not isinstance(step, dict):
                continue
            script = step.get("run")
            if isinstance(script, str) and "eval:backbone-probe" in script and probe_at is None:
                probe_at = index
            env = step.get("env")
            if lane_at is None and isinstance(env, dict) and "SOTA_DEADLINE_MIN" in env:
                lane_at = index
        if lane_at is None:
            continue
        if probe_at is None:
            failures.append(
                f"{name}: job `{job}` runs the lane and never asks the host what it serves; a dispatch "
                "naming a model the host does not list spends its budget learning that at the "
                "four-hundredth call rather than at the first (R82) -- add a step running "
                "`pnpm eval:backbone-probe` before the run"
            )
        elif probe_at > lane_at:
            failures.append(
                f"{name}: job `{job}` asks the host what it serves at step {probe_at + 1}, after the "
                f"lane at step {lane_at + 1}; a probe that runs after the first model call reports on "
                "money already spent (R82) -- move it above the run"
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
        return duplicate_keys(path.read_text(), name) + literal_checks(path, name)
    text = path.read_text()
    # Before the parse, not after: a duplicate key is the one defect PyYAML resolves silently, and a
    # file that also fails to parse should be reported for the reason GitHub would give first.
    failures.extend(duplicate_keys(text, name))
    try:
        document = yaml.safe_load(text)
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
    failures.extend(shell_syntax(document, name))
    failures.extend(deadline_headroom(document, name))
    failures.extend(backbone_catalogue(document, name))
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
        step_run: str | None = None,
        step_env: str | None = None,
        step_timeout: int | None = None,
        leading_step_run: str | None = None,
        second_step_run: str | None = None,
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
        if step_run is None:
            tail.append("    steps: []")
        else:
            tail.append("    steps:")

            def emit(script: str, env: str | None = None, timeout: int | None = None) -> None:
                tail.append("      - name: a step")
                if timeout is not None:
                    tail.append(f"        timeout-minutes: {timeout}")
                if env is not None:
                    tail.extend(["        env:", f"          {env}"])
                tail.append("        run: |")
                tail.extend(f"          {line}" for line in script.rstrip("\n").split("\n"))

            if leading_step_run is not None:
                emit(leading_step_run)
            emit(step_run, step_env, step_timeout)
            if second_step_run is not None:
                emit(second_step_run)
        return "\n".join(header + body + tail) + "\n"

    # R92: one key twice in one `env:` block, which YAML resolves by keeping the last and GitHub refuses.
    # The incident is in `duplicate_keys`' docstring; the two cases here are the firing and the silence,
    # because a checker that refused every repeated key would also refuse both arms declaring the same
    # variable -- which is required, since the two arms must differ in the store and in nothing else.
    same_mapping = """on:
  workflow_dispatch:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: a step
        env:
          TAU_VERSION: one
          TAU_THINKING: off
          TAU_VERSION: two
        run: |
          echo hi
"""
    two_mappings = """on:
  workflow_dispatch:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: one
        env:
          TAU_VERSION: one
        run: |
          echo hi
      - name: two
        env:
          TAU_VERSION: one
        run: |
          echo hi
"""
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
        # The case R69 and R68 paid for: `set -euo pipefail` and an English sentence inside a
        # parameter expansion. A checker that only counted inputs and runners called this file clean.
        (
            "a step bash cannot parse is refused",
            workflow(2, step_run='VALUE=""\necho "${VALUE:-the lane\'s default}"\n'),
            False,
            "does not parse as a shell script",
        ),
        (
            "a step that is a valid script is clean",
            workflow(2, step_run='VALUE=""\nfor x in a b; do echo "$x"; done\n'),
            True,
            None,
        ),
        # R68: a step on the lane's clock with a timeout of its own. The lane had no way to know, and
        # the runner killed it a hundred minutes early with nothing to publish.
        (
            "a step on the lane's deadline may not carry a literal timeout",
            workflow(
                2,
                step_run="echo run\n",
                step_env="SOTA_DEADLINE_MIN: ${{ github.event.inputs.deadline_min || '130' }}",
                step_timeout=200,
            ),
            False,
            "derive the timeout from",
        ),
        (
            "the same step with the timeout derived is clean",
            workflow(
                2,
                step_run="echo run\n",
                step_env="SOTA_DEADLINE_MIN: ${{ github.event.inputs.deadline_min || '130' }}",
                step_timeout=None,
                leading_step_run="pnpm eval:backbone-probe --out a.json\n",
            ),
            True,
            None,
        ),
        # R82: a dispatch names a model the host does not serve, and the lane pays twenty minutes to
        # find out. The probe is cheap, so its absence is a defect and its *position* is the second one.
        (
            "a lane job that never asks the host what it serves is refused",
            workflow(
                2,
                step_run="echo run\n",
                step_env="SOTA_DEADLINE_MIN: ${{ github.event.inputs.deadline_min || '130' }}",
            ),
            False,
            "never asks the host what it serves",
        ),
        (
            "a probe after the lane is refused, because it reports on money already spent",
            workflow(
                2,
                step_run="echo run\n",
                step_env="SOTA_DEADLINE_MIN: ${{ github.event.inputs.deadline_min || '130' }}",
                second_step_run="pnpm eval:backbone-probe --out a.json\n",
            ),
            False,
            "after the",
        ),
        ("a key declared twice in one mapping is refused", same_mapping, False, "declared twice"),
        ("the same key in two steps' env blocks is clean", two_mappings, True, None),
        (
            "a probe before the lane is clean",
            workflow(
                2,
                step_run="echo run\n",
                step_env="SOTA_DEADLINE_MIN: ${{ github.event.inputs.deadline_min || '130' }}",
                leading_step_run="pnpm eval:backbone-probe --out a.json\n",
            ),
            True,
            None,
        ),
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
        print(
            f"workflow: {len(paths)} file(s) parse, declare at most {MAX_INPUTS} inputs, name runners, "
            "derive the lane's timeout from its deadline, ask the host what it serves before the first "
            "call, and every run: block is a script bash can parse"
        )
    else:
        print(f"workflow: {len(paths)} file(s) declare at most {MAX_INPUTS} inputs; PyYAML is absent, so "
              "they were counted rather than parsed")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
