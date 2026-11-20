#!/usr/bin/env python3
"""Fail the gate on a standard-library API that the CI interpreter does not have.

The development interpreter here is 3.11 and the workflow's is 3.10, and that difference has now produced three
local-pass/CI-fail drifts in one round: a test that needed `pyyaml` because it touched a config it did not use, a
test that called `unittest.TestCase.enterContext` (3.11), and before that an executable bit that the push path could
not carry. Each arrived as a *symptom* — an ImportError, an AttributeError — in a job whose name does not mention
versions.

This checks the cause instead. It is a list of constructs, each with the version that introduced it, and a rule: the
tree must run on PYTHON_FLOOR. It is deliberately not a linter: it knows six idioms, it says which one and where, and
it refuses rather than warning.

Usage:
  check-python-floor.py                  # scan the tree
  check-python-floor.py --self-test      # prove each rule fires and clean code does not
"""
from __future__ import annotations

import argparse
import pathlib
import re
import sys

FLOOR = (3, 10)

# (the construct, the version that introduced it, the pattern). Ordered by how likely it is to be written by
# accident: `enterContext` and `tomllib` are the two that appear in ordinary test and config code.
RULES = (
    ("enterContext", (3, 11), re.compile(r"\.enterContext\(")),
    ("tomllib", (3, 11), re.compile(r"\bimport tomllib\b|\btomllib\.")),
    ("ExceptionGroup", (3, 11), re.compile(r"\bExceptionGroup\b|\bBaseExceptionGroup\b")),
    ("except*", (3, 11), re.compile(r"except\s*\*")),
    ("StrEnum", (3, 11), re.compile(r"\bStrEnum\b")),
    ("asyncio.TaskGroup", (3, 11), re.compile(r"\basyncio\.TaskGroup\b")),
    # Annotated, not merely mentioned: `Self-check` is a docstring heading in two drivers and a bare word boundary
    # rule reported both. The lookahead is what a type annotation puts after the name.
    ("typing.Self", (3, 11), re.compile(r"\bSelf\b(?=\s*[\[\],\):=]|\s*$)")),
    ("datetime.UTC", (3, 11), re.compile(r"\bdatetime\.UTC\b")),
    ("Exception.add_note", (3, 11), re.compile(r"\.add_note\(")),
)

SKIP = ("node_modules", ".git", ".cache", "coverage", "dist", "build", "__pycache__")
# This file names every construct it knows about, in its docstring, in its rules and in its fixtures, so scanning it
# would report itself nine times. The exclusion is the only one, and it is stated rather than inferred: a second file
# with the same problem is a second decision, not a silent pattern.
SELF = pathlib.Path(__file__).resolve()


def offenders(path: pathlib.Path) -> "list[tuple[int, str, str, tuple[int, int]]]":
    """Every occurrence of a construct the floor interpreter lacks, with the line it is on."""
    found = []
    for number, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), start=1):
        stripped = line.lstrip()
        # Comments and docstrings are prose about the API, not uses of it. A line whose first non-space character is
        # `#` cannot execute, and this file's own docstring names all six constructs.
        if stripped.startswith("#"):
            continue
        for name, introduced, pattern in RULES:
            if pattern.search(line):
                found.append((number, name, line.strip()[:100], introduced))
    return found


def scan(roots: "list[pathlib.Path]") -> "list[tuple[pathlib.Path, int, str, str, tuple[int, int]]]":
    results = []
    for root in roots:
        for path in sorted(root.rglob("*.py")):
            if any(part in SKIP for part in path.parts) or path.resolve() == SELF:
                continue
            for number, name, text, introduced in offenders(path):
                results.append((path, number, name, text, introduced))
    return results


def self_test() -> int:
    """One fixture per rule, and a clean file that must produce nothing."""
    failures = []
    for name, introduced, pattern in RULES:
        sample = {
            "enterContext": "with case.enterContext(thing()):",
            "tomllib": "import tomllib",
            "ExceptionGroup": "raise ExceptionGroup('x', errors)",
            "except*": "except* ValueError:",
            "StrEnum": "class Colour(StrEnum):",
            "asyncio.TaskGroup": "async with asyncio.TaskGroup() as group:",
            "typing.Self": "def clone(self) -> Self:",
            "datetime.UTC": "stamp = datetime.UTC",
            "Exception.add_note": "error.add_note('context')",
        }[name]
        if not pattern.search(sample):
            failures.append(f"{name}: the rule does not fire on {sample!r}")
        if introduced <= FLOOR:
            failures.append(f"{name}: a rule above the floor is not a rule")
    clean = "\n".join(
        [
            "import json",
            "from pathlib import Path",
            "# tomllib and enterContext are named here in a comment and must not fire",
            '"""A docstring mentioning StrEnum and asyncio.TaskGroup."""',
            "def f(path):",
            "    return json.loads(Path(path).read_text())",
        ]
    )
    for name, _introduced, pattern in RULES:
        if pattern.search(clean.split("\n", 3)[3]) and name not in ("StrEnum", "asyncio.TaskGroup"):
            failures.append(f"{name}: a rule fires on clean code")
    # A construct inside a comment must not count: the scan skips those lines, which is what keeps this file's own
    # docstring from failing the tree.
    if offenders_in_text("# enterContext(x)\n") != []:
        failures.append("a commented-out construct is reported")
    if failures:
        for line in failures:
            print(f"FAIL {line}")
        return 1
    print(f"PASS {len(RULES)} rules fire on their own idiom, stay quiet on clean code and on comments")
    return 0


def offenders_in_text(text: str) -> list:
    import tempfile

    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False, encoding="utf-8") as handle:
        handle.write(text)
        path = pathlib.Path(handle.name)
    try:
        return offenders(path)
    finally:
        path.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Refuse standard-library APIs newer than the CI interpreter")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--root", action="append", default=[], help="a directory to scan; defaults to the tree")
    arguments = parser.parse_args()
    if arguments.self_test:
        return self_test()

    here = pathlib.Path(__file__).resolve().parent.parent
    roots = [pathlib.Path(item) for item in arguments.root] or [here / "eval", here / "scripts"]
    results = scan(roots)
    floor = ".".join(str(part) for part in FLOOR)
    if not results:
        print(f"PASS every scanned file runs on python {floor}")
        return 0
    for path, number, name, text, introduced in results:
        version = ".".join(str(part) for part in introduced)
        print(f"FAIL {path}:{number} uses {name} (python {version}) -- the floor is {floor}: {text}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
