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

API = "https://api.github.com"
REPO = "AgentiX-E/microglia"
WORKFLOW = "alfworld.yml"
# The arms `aggregate.py` groups by. `sham` is a real arm: it carries a bank whose rules have been permuted
# into other rules, which is what separates "a rule bank helps" from "a longer prompt helps".
ARMS = ("none", "always-in", "retrieved", "sham")
CONTROL = "none"
# The six task kinds the ALFWorld split publishes, which is all `--distill-kinds` may name.
TASK_KINDS = ("put", "clean", "heat", "cool", "examine", "puttwo")


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


def check(arguments):
    """Every reason this dispatch must not be bought.

    Order matters: the checks that reject the cheapest mistake come first, so a command line with three
    things wrong is repaired one round trip at a time rather than three. Returns the sweep's arm list,
    which the payload then serialises back, so that the validation is the only place the list is parsed.
    """
    if arguments.games and not arguments.arm:
        raise Refused("a dispatch with games but no arm is a calibration of nothing")
    if arguments.arm not in ("",) + ARMS:
        raise Refused(f"{arguments.arm} is not an arm this lane has; it has {list(ARMS)}")
    named = sweep_arms(arguments.arms) if arguments.arms else []
    if arguments.control_run and not named:
        raise Refused("--control-run says where the control comes from, so it needs --arms to say what it is for")
    if named:
        # A treatment sweep without its control is the failure `pairs.json` was built to refuse: the run
        # would produce a rate with nothing on the other side of it. The one legal way to leave the control
        # out is to name the run that already paid for it — the control arm carries no bank, so an
        # unchanged tree makes it reusable, and naming the run is what makes that assumption visible.
        if CONTROL not in named and not arguments.control_run:
            raise Refused(f"{named} has treatments but no control; pair it with {CONTROL!r} or name --control-run")
        if CONTROL in named and arguments.control_run:
            raise Refused("this dispatch buys its own control; --control-run would name a second one")
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
        check(arguments)
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
    if arguments.control_run:
        print(f"[alf] the control is the {CONTROL} slices of run {arguments.control_run}, already paid for", flush=True)
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
