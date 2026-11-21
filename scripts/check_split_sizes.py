#!/usr/bin/env python3
"""Hold the lane's table of split sizes to the corpus the jobs actually install.

`agent.py` refuses a `--games` larger than the section it names, and `aggregate.py` refuses a join that crosses
two sections — both from `SPLIT_SIZES`, which is a hand-written table. A table that agrees with the corpus on the
day it was typed and disagrees a corpus release later is the worst kind of wrong here: every dispatch still runs,
every reading still prints, and the denominator is the only thing that moved. This file is the check that makes
the table a measurement rather than a memory.

It counts `game.tw-pddl` files, which is what a game *is* in this corpus: `valid_unseen` holds 47 task
directories and 134 games, so counting directories would be wrong by a factor of three and read plausibly.

Exit codes are the report, the same convention as `floor.py`: 0 the table is the corpus, 1 it is not.

Usage:
  check_split_sizes.py                      # against $ALFWORLD_DATA/data/json_2.1.1
  check_split_sizes.py --data /tmp/corpus   # against a given root
  check_split_sizes.py --self-test          # the three failures, on a corpus this file builds
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "eval" / "drivers" / "alfworld"))

import agent  # noqa: E402  (the lane's own table, which this file exists to check)


def locate(home: Path) -> "Path | None":
    """The directory that holds the sections under `home`, found rather than assumed.

    `alfworld-download` unpacks the release into `<data>/data/json_2.1.1` on one path and `<data>/json_2.1.1` on
    another, and the archive carries its own top-level directory besides. A checker that hard-codes one layout
    passes on the machine it was written on and fails on the runner — which is what happened on the first green
    tree that ran it, with every section reported missing (AUDIT 34.252). The search is for the section
    directories the table names, so it finds the corpus wherever the download put it.
    """
    if not home.is_dir():
        return None
    for directory in sorted(set(agent.SPLIT_DIRS.values())):
        found = sorted(path.parent for path in home.rglob(directory) if path.is_dir())
        if found:
            # Shallowest first: a corpus checked into a repository would otherwise be found inside a test fixture
            # that happens to have the same directory names.
            return min(found, key=lambda path: len(path.parts))
    return None


def counted(root: Path, directory: str) -> "int | None":
    """The games in one section, or None when the section is not installed.

    None rather than 0: a corpus that was fetched without a section is not a corpus with an empty section, and
    the two have different repairs.
    """
    section = root / directory
    if not section.is_dir():
        return None
    return sum(1 for _ in section.rglob("game.tw-pddl"))


def disagreements(
    root: Path, sizes: "dict[str, int] | None" = None, dirs: "dict[str, str] | None" = None
) -> "list[str]":
    """Every way the table and the corpus differ, as sentences a reader can act on.

    The table is a parameter rather than a global read so that `--self-test` can exercise this function against a
    four-game corpus instead of building 3,829 files: a self-test that costs a second is a self-test people stop
    running, and one that builds the real corpus cannot run where the corpus is not installed.
    """
    sizes = agent.SPLIT_SIZES if sizes is None else sizes
    dirs = agent.SPLIT_DIRS if dirs is None else dirs
    problems: "list[str]" = []
    for split, published in sizes.items():
        directory = dirs[split]
        actual = counted(root, directory)
        if actual is None:
            problems.append(f"{split}: no {directory}/ under {root}, so its size is unknown rather than {published}")
        elif actual != published:
            problems.append(
                f"{split}: SPLIT_SIZES says {published} and {directory}/ holds {actual}; count the corpus and "
                "update eval/drivers/alfworld/agent.py, because every --expect and every tiling check reads it"
            )
    return problems


# The self-test as data: a corpus to build, the table to hold it to, and the sentence the check must produce —
# "" meaning the corpus must pass. Written as cases rather than as a script so that a fourth edge is a tuple, and
# so that the loop below has two failure branches a test can reach by handing it a case whose expectation is wrong.
SELF_CASES = (
    (
        "a short corpus is reported per section",
        {"alpha": 2, "beta": 3},
        {"alpha": "seen", "beta": "unseen"},
        {"seen": 2, "unseen": 1},
        "holds 1",
    ),
    (
        "a corpus that matches passes",
        {"alpha": 2, "beta": 3},
        {"alpha": "seen", "beta": "unseen"},
        {"seen": 2, "unseen": 3},
        "",
    ),
    (
        "a missing section is unknown rather than empty",
        {"alpha": 2},
        {"alpha": "seen"},
        {},
        "no seen/",
    ),
)


def build_corpus(root: Path, dirs: "dict[str, str]", counts: "dict[str, int]") -> None:
    """Lay out `counts` games per directory, each under its own task directory, replacing whatever was there.

    Replaced rather than added to: the cases share one temporary root, and a section left over from the previous
    case would make the next one's expectation true for the wrong reason.
    """
    for directory in dirs.values():
        shutil.rmtree(root / directory, ignore_errors=True)
    for directory, count in counts.items():
        # Only the directories a case names are created, so "a section that is missing" is a section that is not
        # there rather than an empty one — the two have different sentences and different repairs.
        (root / directory).mkdir(parents=True, exist_ok=True)
        for index in range(count):
            task = root / directory / f"trial_{index}"
            task.mkdir(parents=True, exist_ok=True)
            (task / "game.tw-pddl").write_text("x", encoding="utf-8")


def self_test(cases=SELF_CASES) -> int:
    """The check's own edges, on corpora this file builds.

    The table is local and small — five games, not four thousand — because the arithmetic under test does not
    depend on the real corpus's size, and a self-test that builds the real one cannot run where it is not
    installed. `cases` is a parameter so that a test can hand this function a case whose expectation is wrong:
    the failure branches are then exercised by a real failure rather than excluded from measurement.
    """
    failures = 0
    with tempfile.TemporaryDirectory() as scratch:
        root = Path(scratch)
        for name, sizes, dirs, counts, wanted in cases:
            build_corpus(root, dirs, counts)
            problems = disagreements(root, sizes, dirs)
            if wanted and not any(wanted in problem for problem in problems):
                failures += 1
                print(f"FAIL {name}: expected {wanted!r}, got {problems}")
            elif not wanted and problems:
                failures += 1
                print(f"FAIL {name}: expected no problem, got {problems}")
            else:
                print(f"ok   {name}")
    if failures:
        print(f"FAIL {failures} of {len(cases)} cases")
        return 1
    print(f"OK   the checker fires on each disagreement ({len(cases)} cases on built corpora)")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Check the lane's split sizes against the installed corpus")
    parser.add_argument(
        "--data",
        default="",
        help="the directory holding the sections; defaults to searching $ALFWORLD_DATA (then ~/.cache/alfworld)",
    )
    parser.add_argument("--self-test", dest="self_test", action="store_true")
    arguments = parser.parse_args()
    if arguments.self_test:
        return self_test()
    if arguments.data:
        root = Path(arguments.data)
    else:
        home = Path(os.environ.get("ALFWORLD_DATA", str(Path.home() / ".cache" / "alfworld")))
        located = locate(home)
        if located is None:
            print(f"FAIL no section directory under {home}; the corpus is not installed, so its sizes are unknown")
            return 1
        root = located
    problems = disagreements(root)
    if problems:
        for problem in problems:
            print(f"FAIL {problem}")
        return 1
    print(f"OK   {len(agent.SPLIT_SIZES)} sections match {root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
