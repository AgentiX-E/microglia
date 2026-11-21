#!/usr/bin/env python3
"""Dispatch the `alfworld` lane and find the run it produced.

The workflow's own guards cover the things a dispatch can say about itself: `arm` cannot be empty and the
training split is named rather than defaulted. What this script adds is the guard that costs money to
skip — **the tree the dispatch would buy must be green** — plus the arithmetic that turns one command line
into the workflow's input payload, so that the contrasts this lane still owes (the placebo, `k=1` against
`k=3`, the gated retrieval) are dispatch flags rather than edits to a file.

Everything that can be decided without the network is a pure function, because three of the guards below
exist to stop a payment and a guard that is only exercised by paying is a guard nobody has tested:

  * ``check(arguments)``   the reasons this dispatch must not be bought, in the order that reads cheapest
  * ``payload(arguments)`` the inputs the workflow receives, with the unnamed ones left at its defaults
  * ``green_tree(...)``    the CI conclusion on the head of master, which is what licenses the purchase

The file name carries no hyphen so that `test_alf_dispatch.py` can import it: a guard that only a payment
exercises is a guard nobody has tested, and a test that has to reach into a hyphenated path with a loader is
a test somebody deletes.

Usage:
  alf_dispatch.py --train 140 --chain true                     # train -> bank -> sweep in one run
  alf_dispatch.py --train 140 --chain true --train-shards '["0","1","2"]' --train-run-ids 44738148591
  alf_dispatch.py --sweep true --arms '["none","sham"]' --rules banks/expel-140.json
  alf_dispatch.py --arm none --games 134 --shard 0/4 --dry-run
"""

import argparse
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

API = "https://api.github.com"
REPO = "AgentiX-E/microglia"
WORKFLOW = "alfworld.yml"
# The arms `aggregate.py` groups by. `sham` is a real arm: it carries a bank whose rules have been permuted
# into other rules, which is what separates "a rule bank helps" from "a longer prompt helps".
ARMS = ("none", "always-in", "retrieved", "sham")
CONTROL = "none"
# The six task kinds the ALFWorld split publishes, which is all `--distill-kinds` may name.
TASK_KINDS = ("put", "clean", "heat", "cool", "examine", "puttwo")
# The corpus sections and their published sizes. Duplicated rather than imported: this script decides whether to
# *buy* a pass and has to run where the lane's environment import chain is not installed. `test_alf_dispatch.py`
# asserts the copy equals `agent.SPLIT_SIZES`, so a drift is a test failure rather than a wrong denominator.
SPLIT_SIZES = {"eval_out_of_distribution": 134, "eval_in_distribution": 140, "train": 3553}
# The section every published number in this lane comes from, and the one a dispatch gets when it names none.
HELD_OUT = "eval_out_of_distribution"
# The two readers `agent.py` can drive. Restated for the same reason the workflow's defaults are: this script's job is
# to refuse a dispatch that would spend money on an argument the driver cannot honour, and it refuses before the API
# call rather than inside twelve jobs.
PARSERS = ("reference", "any-line")


class Refused(Exception):
    """A dispatch this script will not send, carrying the sentence a reader needs to fix it."""


def parser():
    """The command line, which is also the record of what a dispatch can say about itself."""
    result = argparse.ArgumentParser(description="Dispatch the ALFWorld lane")
    result.add_argument("--arm", default="")
    result.add_argument("--games", default="")
    result.add_argument("--shard", default="0/1")
    result.add_argument("--max-steps", dest="max_steps", default="50")
    result.add_argument("--rules", default="")
    result.add_argument("--trace", default="0")
    result.add_argument("--train", default="")
    result.add_argument("--sweep", default="")
    result.add_argument("--chain", default="")
    result.add_argument("--not-before", dest="not_before", default="")
    result.add_argument("--train-shards", dest="train_shards", default="")
    result.add_argument("--train-run-ids", dest="train_run_ids", default="")
    result.add_argument("--bank-only", dest="bank_only", default="")
    # The task kinds a bank is distilled from. Empty is the registered bank; naming two is the only control this
    # lane can build for what a bank *says*, since a permutation keeps every word the bank had.
    result.add_argument("--distill-kinds", dest="distill_kinds", default="")
    # The sweep's arm list, its retrieval budget and its read-time gate. They are dispatch flags rather
    # than file edits because the three contrasts still owed differ from the registered sweep in exactly
    # these strings, and a contrast that has to be typed into a file is a contrast nobody runs twice.
    result.add_argument("--arms", default="")
    result.add_argument("--control-run", dest="control_run", default="")
    result.add_argument("--top-k", dest="top_k", default="")
    result.add_argument("--gate-share", dest="gate_share", default="")
    # The kind gate, which selects by the task the game names rather than by the room it starts in. Flagged
    # separately from `--gate-share` because the two are different signals on different objects, and R174.2
    # measured the overlap one admitting nothing at all on this corpus.
    result.add_argument("--gate-kind", dest="gate_kind", default="")
    result.add_argument("--parser", default="")
    # The comparison this sweep is half of, when the other half was bought in an earlier dispatch. A two-treatment
    # comparison is the one this lane trusts — the control moves eight to eleven wins between dispatches, the
    # treatments repeat — and a sweep that can only buy a control it does not need pays for a band (AUDIT 34.232).
    result.add_argument("--against", default="")
    # The corpus section. It is a dispatch flag rather than a constant because R177's first purchase is games,
    # and a second section is the only place this lane can buy resolution it does not already own.
    result.add_argument("--split", default="")
    result.add_argument("--dry-run", dest="dry_run", action="store_true")
    return result


def sweep_arms(text):
    """The arm list as data, refused unless every name in it is one `aggregate.py` can group by."""
    try:
        named = json.loads(text)
    except json.JSONDecodeError as error:
        raise Refused(f"--arms is not JSON: {error}") from error
    if not isinstance(named, list) or not named:
        raise Refused(f"--arms is a non-empty JSON list of arm names, not {text!r}")
    unknown = sorted({arm for arm in named if arm not in ARMS})
    if unknown:
        raise Refused(f"{unknown} are not arms this lane has; it groups by {list(ARMS)}")
    return named


def check(arguments, tree=None):
    """Every reason this dispatch must not be bought.

    Order matters: the checks that reject the cheapest mistake come first, so a command line with three
    things wrong is repaired one round trip at a time rather than three. Returns the sweep's arm list,
    which the payload then serialises back, so that the validation is the only place the list is parsed.

    `tree` is the root of the checkout the dispatch would buy. When it is given, a relative `--rules` is
    resolved against it, because the workflow runs from that root while the banks live beside the driver.
    Run `44779423772` spent eight jobs on the difference: the path was written the way a reader of this
    repository sees it, and every job exited at the "no bank at ..." guard before making a single call.
    """
    if arguments.games and not arguments.arm:
        raise Refused("a dispatch with games but no arm is a calibration of nothing")
    if arguments.arm not in ("",) + ARMS:
        raise Refused(f"{arguments.arm} is not an arm this lane has; it has {list(ARMS)}")
    named = sweep_arms(arguments.arms) if arguments.arms else []
    if arguments.control_run:
        # The flag used to be accepted and sent, and the workflow declared no such input, so it was dropped
        # between the two and the dispatch bought a treatment with no control while saying it had one. Naming a
        # previous run cannot be made safe on this path either: nothing here can prove that run drove the same
        # commit and the same games, and the control arm moved six wins between two dispatches of identical code
        # (AUDIT 34.232). It is refused rather than ignored.
        raise Refused(
            "--control-run names a control an earlier run paid for, and nothing on this path can prove that run "
            "drove the same commit and the same games; buy the control in this dispatch by naming "
            f"{CONTROL!r} in --arms"
        )
    if named and CONTROL not in named and not arguments.against:
        # A treatment sweep without its control is the failure `pairs.json` was built to refuse: the run would
        # produce a rate with nothing on the other side of it. `--against` is the one exception, and it is not an
        # escape hatch: it names the arm the reading will be paired with, so the sweep is half of a comparison
        # that already exists rather than a rate nobody can place.
        raise Refused(
            f"{named} has treatments but no control; pair it with {CONTROL!r}, or name the arm this sweep is "
            "half of with --against"
        )
    if arguments.against and CONTROL in named:
        # Both would be true and the reading would not know which comparison it is: a sweep that buys its own
        # control and also names one from an earlier dispatch is two designs in one dispatch.
        raise Refused("--against names an existing arm, so the sweep must not also buy the control")
    if arguments.bank_only:
        # The mode exists for the failure that costs the most: the slices are bought and the bank dies. It reads
        # from `train_run_ids`, so a dispatch that names none would distil from nothing while looking like a
        # recovery, and `train` is still needed because it is the slice size the tiling check holds to.
        if not arguments.train:
            raise Refused("--bank-only still needs --train: it is the size of the slice the union must cover")
        if not arguments.train_run_ids:
            raise Refused("--bank-only reads its slices from --train-run-ids, and none were named")
        if arguments.train_shards:
            raise Refused("--bank-only drives no slice, so --train-shards would name games nobody drives")
    if arguments.distill_kinds:
        if not arguments.train:
            raise Refused("--distill-kinds filters the bank, so it needs --train (or --bank-only) to build one")
        named = [item.strip() for item in arguments.distill_kinds.split(",") if item.strip()]
        unknown = sorted(set(named) - set(TASK_KINDS))
        if unknown:
            raise Refused(f"--distill-kinds names {unknown}; the split publishes {list(TASK_KINDS)}")
    if arguments.rules and tree is not None and not os.path.isabs(arguments.rules):
        root = Path(tree)
        candidate = root / arguments.rules
        if not candidate.is_file():
            beside_the_driver = root / "eval" / "drivers" / "alfworld" / arguments.rules
            hint = f"; the same path inside the lane is eval/drivers/alfworld/{arguments.rules}" if beside_the_driver.is_file() else ""
            raise Refused(
                f"--rules {arguments.rules} is not a file in this tree (it resolves to {candidate}), and the "
                f"workflow runs from the repository root rather than from the lane's own directory{hint}"
            )
        if arguments.gate_kind:
            # The one check that can be made here rather than at the arm: a `--gate-kind` pointed at an untagged
            # bank is refused by `agent.py` before it makes a call, but that refusal arrives four jobs into a
            # dispatch. Read the file this dispatch would buy and say so now, when the answer is free.
            tagged = [
                entry
                for entry in json.loads(candidate.read_text(encoding="utf-8")).get("entries") or []
                if isinstance(entry, dict) and entry.get("kinds")
            ]
            if not tagged:
                raise Refused(
                    f"--gate-kind needs a bank whose entries carry `kinds`, and {arguments.rules} tags none: the "
                    "gate would carry nothing and the arm would be the control wearing a treatment's name"
                )
    section = arguments.split or HELD_OUT
    if section not in SPLIT_SIZES:
        raise Refused(f"--split {section} is not a section this corpus publishes; it has {sorted(SPLIT_SIZES)}")
    if arguments.games and arguments.games.isdigit() and int(arguments.games) > SPLIT_SIZES[section]:
        raise Refused(
            f"--games {arguments.games} is more than {section} publishes ({SPLIT_SIZES[section]}); the pass would "
            "be shortened and its rate would read like a full one"
        )
    if arguments.chain and section != HELD_OUT:
        # The chain's bank is distilled from `valid_seen`, so a chain that scored it there would report a rate
        # nobody can interpret. A hand-written bank on `valid_seen` is a different purchase and is allowed.
        raise Refused(
            f"--chain distils its bank from valid_seen and would then score it on {section}; a bank has to be "
            f"scored on a section it was not built from ({HELD_OUT})"
        )
    if arguments.rules and arguments.split and arguments.split != HELD_OUT:
        # A bank says which section distilled it (`source.train_split`, written by `distill.py`). A bank distilled
        # from the section it is about to be scored on is the one leak this lane can commit without noticing: the
        # rate is real and means nothing. `None` is an artefact older than the field, and it is refused on a
        # non-held-out section because "cannot prove" is not "did not". Checked against whatever path resolves,
        # because the absolute form is the one a resume uses.
        resolved = Path(arguments.rules)
        if not resolved.is_absolute() and tree is not None:
            resolved = Path(tree) / arguments.rules
        if resolved.is_file():
            source = json.loads(resolved.read_text(encoding="utf-8")).get("source") or {}
            bank_split = source.get("train_split")
            # A *distilled* bank is a function of the episodes it read, so it may not be scored on the section it
            # read: `episodes` is distill.py's own field, and a bank carrying it without `train_split` is one whose
            # provenance cannot be proved. A *hand-written* bank (one verbatim trajectory, one sentence) is not a
            # function of any section, and refusing it on `valid_seen` would refuse the one purchase R177 needs —
            # the arm's own provenance says where its text came from, and it is not a rate over that set.
            distilled = "episodes" in source or "train_split" in source
            if bank_split == arguments.split or (distilled and bank_split is None):
                raise Refused(
                    f"--split {arguments.split} would score {arguments.rules} on the section its provenance "
                    f"names ({bank_split!r}); distilled-on and scored-on have to differ, and a distilled artefact "
                    "with no recorded provenance cannot prove that they do"
                )
    if arguments.chain and not arguments.train:
        raise Refused("--chain needs --train: the chain starts with the training pass")
    if arguments.sweep and (arguments.games or arguments.train):
        raise Refused("--sweep drives its own split and its own slice count; drop --games and --train")
    if arguments.train and arguments.games:
        raise Refused("--train and --games in one dispatch buys two runs' worth of inputs")
    if arguments.sweep and not arguments.chain and not arguments.rules:
        raise Refused("a standalone sweep needs --rules: the bank artefact only exists inside the run that distilled it")
    if arguments.top_k:
        if not arguments.top_k.isdigit() or int(arguments.top_k) < 1:
            raise Refused(f"--top-k {arguments.top_k} is not a retrieval budget; it is how many rules one turn may carry")
    if arguments.gate_kind and not arguments.rules:
        # `distill.py` tags the bank, not its entries, so a chained dispatch cannot produce a bank this flag can
        # select on: the gate has to be pointed at a tagged bank in the repository, and a chain that looks like
        # it would build one would fail in four treatment jobs after the environment install.
        raise Refused(
            "--gate-kind selects among a bank's entries by the task kind each entry is tagged with, and a chained "
            "dispatch distils an untagged bank, so it needs --rules naming a tagged bank"
        )
    # `--gate-kind` on the control is **not** refused. The workflow hands its inputs to every arm in the matrix,
    # so a flag that is only meaningful for a treatment cannot be an error on the control: the refusal ran once
    # and killed the control arm of a gated sweep, four shards of it, leaving a treatment with nothing in its own
    # dispatch to pair against (AUDIT 34.246). The arm itself records `gate_kind: null`. A control-only dispatch
    # that names the flag is still a legal purchase: it is how the missing control of a gated sweep is re-bought
    # against the same commit, and refusing it would make that repair impossible by flag.
    if arguments.parser and arguments.parser not in PARSERS:
        # A channel is spelled exactly or not driven at all: `any_line` would reach `agent.py` as an argument error
        # after the environment install, in twelve jobs, with the money committed. Checked here, where the refusal is
        # still free.
        raise Refused(f"--parser {arguments.parser!r} is not one of {PARSERS}")
    if arguments.gate_share:
        try:
            share = float(arguments.gate_share)
        except ValueError as error:
            raise Refused(f"--gate-share {arguments.gate_share} is not a number") from error
        if not 0.0 <= share < 1.0:
            raise Refused(f"--gate-share {share} is not a share of the observation; 0 is the registered arm")
    return named


def payload(arguments):
    """The workflow's inputs, with every unnamed one left at the workflow's own default.

    An empty string is a value the workflow would have to interpret. Leaving the key out is what makes
    the default in `alfworld.yml` the one place each default is written.
    """
    section = arguments.split or HELD_OUT
    inputs = {
        "arm": arguments.arm,
        "games": arguments.games,
        "shard": arguments.shard,
        "max_steps": arguments.max_steps,
        "rules": arguments.rules,
        "trace": arguments.trace,
        "train": arguments.train,
        "sweep": arguments.sweep,
        "chain": arguments.chain,
        "not_before": arguments.not_before,
    }
    named = (
        ("train_shards", arguments.train_shards),
        ("train_run_ids", arguments.train_run_ids),
        ("bank_only", arguments.bank_only),
        ("distill_kinds", arguments.distill_kinds),
        ("arms", arguments.arms),
        ("top_k", arguments.top_k),
        ("gate_share", arguments.gate_share),
        ("gate_kind", arguments.gate_kind),
        ("parser", arguments.parser),
        ("split", arguments.split),
        # The size travels with the section, because the workflow's join tiles to it and a section without its
        # published size is a sweep whose twelve jobs drive one number and whose reading checks another.
        ("split_games", str(SPLIT_SIZES[section]) if arguments.split else ""),
    )
    for key, value in named:
        if value:
            inputs[key] = value
    return inputs


def call(method, path, token, body=None):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(API + path, data=data, method=method)
    request.add_header("Authorization", f"Bearer {token}")
    request.add_header("Accept", "application/vnd.github+json")
    if data is not None:
        request.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(request, timeout=120) as response:
        raw = response.read()
        return json.loads(raw) if raw else {}


def green_tree(token, call=call):
    """The head of master, licensed by the CI conclusion on that same commit.

    The gate is the tree's own CI, not the newest run of any workflow. The lane's floor job drives the whole
    split twice and takes half an hour, and it is a corpus assertion rather than a statement about the code
    being bought; waiting for it would mean a dispatch could never overlap with it. `ci.yml` is the workflow
    that compiles, tests and audits the tree, so it is the one whose conclusion decides.
    """
    master = call("GET", f"/repos/{REPO}/git/ref/heads/master", token)["object"]["sha"]
    runs = call("GET", f"/repos/{REPO}/actions/workflows/ci.yml/runs?branch=master&per_page=1", token)
    gate = runs["workflow_runs"][0]
    if gate["head_sha"] != master:
        raise Refused(f"CI has not seen {master[:8]} yet; it last saw {gate['head_sha'][:8]}, so the tree is uncertified")
    if gate["status"] != "completed" or gate["conclusion"] != "success":
        raise Refused(f"the tree this would buy is {gate['status']}/{gate['conclusion']}; refusing to dispatch")
    return master, gate


def main(argv=None, token=None, call=call, sleep=time.sleep):
    arguments = parser().parse_args(argv)
    token = token or os.environ.get("GH_TOKEN", "")
    try:
        check(arguments, tree=Path(__file__).resolve().parent.parent)
    except Refused as refusal:
        sys.stderr.write(f"{refusal}\n")
        return 2
    if not token and not arguments.dry_run:
        sys.stderr.write("GH_TOKEN is not set; a dry run is the only thing this can do without one\n")
        return 2
    if not arguments.dry_run:
        try:
            master, gate = green_tree(token, call=call)
        except Refused as refusal:
            sys.stderr.write(f"{refusal}\n")
            return 2
        print(f"[alf] master {master[:8]}  ci {gate['head_sha'][:8]} {gate['status']} {gate['conclusion']}", flush=True)

    inputs = payload(arguments)
    if arguments.dry_run:
        print(f"[alf] dry run inputs={json.dumps(inputs)}")
        return 0

    before = {run["id"] for run in call("GET", f"/repos/{REPO}/actions/runs?per_page=10", token)["workflow_runs"]}
    call("POST", f"/repos/{REPO}/actions/workflows/{WORKFLOW}/dispatches", token, {"ref": "master", "inputs": inputs})
    print(f"[alf] dispatched inputs={json.dumps(inputs)}", flush=True)
    for _ in range(12):
        sleep(5)
        runs = call("GET", f"/repos/{REPO}/actions/runs?per_page=10", token)["workflow_runs"]
        for run in runs:
            if run["id"] not in before and run["name"] == "alfworld":
                print(f"[alf] run {run['id']} {run['status']} {run['html_url']}")
                return 0
    sys.stderr.write("dispatched, but no new run appeared; check the actions page\n")
    return 1


if __name__ == "__main__":
    sys.exit(main())
