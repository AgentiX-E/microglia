"""Join the slices of a sharded pass into one paired reading, and bill the whole thing.

A 134-game pass at 50 steps is 20,100 calls; on one runner that is a job longer than the host allows, so a
pass is dispatched as several jobs over contiguous slices of the split (`agent.py --shard i/n`). Each slice
writes its own `arm.json`. This file is what turns those files back into the one number the design is
about — a **paired** difference between two arms, where the pairing is the game.

**Why the pairing is the whole point.** Two arms over the same 134 games disagree on some games and agree
on the rest. The variance that matters is the disagreement, not the spread of each arm's win rate: an
unpaired interval would be dominated by the fact that one task type is harder than another, which both
arms suffer equally. So the delta is `mean(a - b)` over games where both arms ran, the interval is a
**bootstrap over games**, and the discordance `b + c` is reported beside it because that is what decides
whether the split could have seen the effect at all (`mde = 2.802 · sqrt(b + c) / n`).

**What is refused rather than averaged.** Two slices that drove the same game, an arm whose slices do not
tile the split, and a pair of arms whose games do not coincide on every one of them. A missing game is not
a zero: dropping it would silently change the denominator and make two arms' rates incomparable while
still printing a delta.

**Four readings beside the delta, because a delta is a question and not an answer.** *Engagement* is how
many games the pack actually changed — with the action digest as the instrument, so a treatment that was
never read reports a divergence of zero and its null is about delivery rather than about memory. *Harm
share* is the share of those engagements that made the outcome worse, which is the same quantity
`COMPETITIVE.md` Appendix AS reports for the τ² lane, at the episode as the unit instead of the item.
*Strata* splits the delta by what the control did unaided, which is the prediction `arXiv:2604.27003`
makes (negative transfer concentrates on the hard cases). *Kinds* splits it by task type, which is what
turns "the bank did nothing" into "the bank helped the procedures and hurt the searches".

Exit codes are the report: 0 the reading is written, 1 the slices cannot produce one.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

ARMS = ("none", "always-in", "retrieved", "sham")

# The two readers `agent.py` can drive, restated here because the join does not import the driver: it is run against
# artefacts on a laptop, and the driver imports the environment. The pair is small, fixed, and the disagreement it
# guards against is checked below rather than assumed -- a channel name no arm file could carry is refused.
REFERENCE_PARSER = "reference"
PARSERS = (REFERENCE_PARSER, "any-line")

# The turn budget every reading before R184 was driven at: the environment's own cap and the driver's default. It is
# the same kind of field as the channel — a property of the harness rather than of the prompt — and it is read the same
# way: a missing value is the default rather than unknown, because that is the only budget that existed. R184 is the
# first round that moves it, and the reason the join has to know is arithmetic: a shorter cap costs the slow arm more
# than the fast one (15 games against 40 at cap 30), so a delta across two caps is partly a statement about the budget.
REFERENCE_CAP = 50

# A reply that carries no command is charged to the same turn budget as one that moves the world, so a game can be
# lost without the environment ever being touched. `THOUGHT_HEAVY` is where that stops being an episode and becomes a
# class: no won game in R186's 264 has twenty thoughts, and five of its ten losses have 24 to 46 of them. The number is
# a property of the recorded artefacts rather than of this file, which is why it is a reading and not a gate.
THOUGHT_HEAVY = 20


def fail(message: str) -> "None":
    print(f"FAIL {message}")
    raise SystemExit(1)


class Draw:
    """The same splitmix64 `floor.py` uses, so an interval can be reproduced from its seed alone."""

    MASK = (1 << 64) - 1

    def __init__(self, seed: int) -> None:
        self.state = seed & self.MASK

    def u64(self) -> int:
        self.state = (self.state + 0x9E3779B97F4A7C15) & self.MASK
        z = self.state
        z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & self.MASK
        z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & self.MASK
        return (z ^ (z >> 31)) & self.MASK

    def below(self, bound: int) -> int:
        return self.u64() % bound


def load_slices(
    paths: "list[Path]",
    relabel_specs: "list[str] | tuple[str, ...]" = (),
    expect_splits: "tuple[str, ...]" = (),
    expect_parsers: "tuple[str, ...]" = (),
    expect_caps: "tuple[int, ...]" = (),
    expect_guard: "tuple[str, ...]" = (),
    expect_ledger: "tuple[str, ...]" = (),
) -> "dict[str, list[dict]]":
    """Every episode of every slice, grouped by the arm that drove it.

    A spec may name an **arm** or a **path**. The path form is what makes two dispatches of the *same* arm joinable:
    they carry the same `arm_label`, so they would land in one group and `tile` would refuse the duplicate games —
    which is the right refusal, and it left the lane's most common comparison (two blocks, one arm name, two runs)
    with no command at all. A rename has to keep the family, so `run.json=always-in@placement` is accepted and
    `run.json=placement` is not: the family is what `aggregate` validates against, and a label without one is an
    arm nobody can check.
    """
    path_specs: "dict[str, str]" = {}
    arm_specs: "list[str]" = []
    # Four shards of one arm carry four names and two dispatches carry the same four again, so a basename can
    # name more than one input. Renaming the first and leaving the rest is the exact failure this file exists to
    # prevent — one run's episodes under a name the other run also owns — so an ambiguous name is refused here
    # rather than resolved by iteration order.
    basenames: "dict[str, int]" = {}
    for path in paths:
        basenames[path.name] = basenames.get(path.name, 0) + 1
    for spec in relabel_specs:
        old, new = parse_spec(spec)
        if old in basenames:
            if basenames[old] > 1:
                fail(
                    f"--relabel {spec!r}: {old!r} names {basenames[old]} inputs in this join, so renaming it "
                    f"would leave {basenames[old] - 1} of them under their old label; name the directory too"
                )
            path_specs[old] = new
        elif any(old == str(path) for path in paths):
            path_specs[old] = new
        else:
            arm_specs.append(spec)
    grouped: "dict[str, list[dict]]" = {}
    sections: "dict[str, str]" = {}
    channels: "dict[str, str]" = {}
    label_channels: "dict[str, set[str]]" = {}
    caps: "dict[str, int]" = {}
    label_caps: "dict[str, set[int]]" = {}
    label_banks: "dict[str, set[str]]" = {}
    for path in paths:
        payload = json.loads(path.read_text(encoding="utf-8"))
        summary = payload.get("summary") or {}
        arm = summary.get("arm")
        # Which corpus section this slice was driven from. It is recorded per slice because a reading has to be
        # able to grade itself by section: `eval_out_of_distribution` is 134 games and `eval_in_distribution` is
        # 140, and a delta that pools them is an average over two populations (see the check after this loop).
        section = summary.get("split")
        if section is not None and not isinstance(section, str):
            fail(f"{path}: summary.split is {section!r}, which is not a split name")
        if section:
            sections[str(path)] = section
        # What a configuration is called: the family, plus the knobs that were moved off their registered values.
        # An artefact written before the field existed groups by its arm, so a reading of the failed run's slices
        # still works, and a label that does not belong to its family is refused rather than trusted.
        label = summary.get("arm_label") or arm
        episodes = payload.get("episodes")
        policy = summary.get("policy")
        if arm not in ARMS:
            fail(f"{path}: summary.arm is {arm!r}, which is not one of {ARMS}")
        if label != arm and not str(label).startswith(f"{arm}@"):
            fail(f"{path}: summary.arm_label is {label!r}, which is neither {arm!r} nor a configuration of it")
        for key in (str(path), path.name):
            if key in path_specs:
                renamed = path_specs.pop(key)
                if renamed != arm and not renamed.startswith(f"{arm}@"):
                    fail(
                        f"--relabel {key}={renamed}: {renamed!r} is neither {arm!r} nor a configuration of it; "
                        f"a rename keeps the family, as in {key}={arm}@{renamed}"
                    )
                label = renamed
                break
        if not isinstance(episodes, list) or not episodes:
            fail(f"{path}: no episodes, so this slice contributes nothing and its cost is unexplained")
        if policy == "seed" or policy == "first":
            fail(f"{path}: a model-free slice cannot be paired with a billed one; policy is {policy!r}")
        # Which reader drove this slice. An artefact written before R183 was driven by the reference parser -- the
        # only one that existed -- so a missing field is the reference channel rather than unknown: reading it as
        # unknown would make the one comparison the channel exists for impossible, and reading it as anything else
        # would be a guess about a harness that is written down in the driver (AUDIT 34.262).
        # The bank the pass was handed, as content. One per run, so it is read from the summary; an arm that renders
        # nothing (`none`) and every artefact from before R185 record the empty string, which is the only value that
        # can be proven for them.
        bank = summary.get("bank_digest", "")
        if not isinstance(bank, str):
            fail(f"{path}: summary.bank_digest is {bank!r}, which is not a bank digest")
        label_banks.setdefault(label, set()).add(bank)
        channel = summary.get("parser") or REFERENCE_PARSER
        if channel not in PARSERS:
            fail(f"{path}: summary.parser is {channel!r}, which is not one of {PARSERS}")
        channels[str(path)] = channel
        label_channels.setdefault(label, set()).add(channel)
        # The turn budget this slice was driven at, read and validated here because it arrives from JSON rather than
        # from a parser: a string in that field would otherwise be compared against an integer three checks later and
        # read as a different cap rather than as a malformed artefact (R184, and the test that drove this line).
        recorded_cap = summary.get("max_steps")
        if recorded_cap is None:
            cap = REFERENCE_CAP
        elif isinstance(recorded_cap, bool) or not isinstance(recorded_cap, int):
            fail(f"{path}: summary.max_steps is {recorded_cap!r}, which is not a step count")
        else:
            cap = recorded_cap
        caps[str(path)] = cap
        label_caps.setdefault(label, set()).add(cap)
        if section:
            # Derived at join time rather than stored in the artefact: an episode is "from" the section its
            # parent said it was, and writing it into the artefact too would be two places to disagree.
            for episode in episodes:
                if isinstance(episode, dict):
                    episode.setdefault("section", section)
        for episode in episodes:
            if isinstance(episode, dict):
                episode.setdefault("parser", channel)
                # The run's bank, not this game's pack: a gated pass hands one bank to several kinds and each game
                # reads a different entry, so grouping on the pack would refuse the very round the guard exists for.
                episode.setdefault("bank_digest", bank)
                episode.setdefault("max_steps", cap)
        # The header's own claim about the guard, held to its episodes. Both are written by one flag in one process, so
        # a disagreement is a file that was merged, resumed across a change, or edited -- and joining it would report an
        # arm under a state its own games did not run in. The lane's precedent is a bank swapped under an unchanged
        # label, which no field in the artefact could see either (AUDIT 34.269).
        claimed = summary.get("guard_commandless")
        if claimed is not None:
            if not isinstance(claimed, bool):
                fail(f"{path}: summary.guard_commandless is {claimed!r}, which is not a flag")
            for episode in episodes:
                if isinstance(episode, dict) and "guard" in episode and bool(episode.get("guard")) != claimed:
                    fail(
                        f"{path}: summary.guard_commandless={claimed} contradicts {episode.get('gamefile')}, which "
                        f"records guard={episode.get('guard')}; the header is a claim and the episodes are the fact, so "
                        "this file is joined by neither"
                    )
        # The ledger's claim, held to its episodes by the same rule and for the same reason: R191's two arms differ by
        # one flag that is invisible in the pack, the channel and the cap, and a file whose header and episodes disagree
        # about it is an arm that ran as neither of the two that were registered (R191).
        claimed_counts = summary.get("state_ledger_counts")
        if claimed_counts is not None:
            if not isinstance(claimed_counts, bool):
                fail(f"{path}: summary.state_ledger_counts is {claimed_counts!r}, which is not a flag")
            for episode in episodes:
                if isinstance(episode, dict) and "ledger_counts" in episode and bool(episode.get("ledger_counts")) != claimed_counts:
                    fail(
                        f"{path}: summary.state_ledger_counts={claimed_counts} contradicts {episode.get('gamefile')}, "
                        f"which records ledger_counts={episode.get('ledger_counts')}; the two renderers are two "
                        "treatments and a file that cannot say which one it drove is joined by neither (R193)"
                    )
        claimed_ledger = summary.get("state_ledger")
        if claimed_ledger is not None:
            if not isinstance(claimed_ledger, bool):
                fail(f"{path}: summary.state_ledger is {claimed_ledger!r}, which is not a flag")
            for episode in episodes:
                if isinstance(episode, dict) and "ledger" in episode and bool(episode.get("ledger")) != claimed_ledger:
                    fail(
                        f"{path}: summary.state_ledger={claimed_ledger} contradicts {episode.get('gamefile')}, which "
                        f"records ledger={episode.get('ledger')}; the header is a claim and the episodes are the fact, so "
                        "this file is joined by neither"
                    )
        grouped.setdefault(label, []).extend(episodes)
    # A join across sections is legal and sometimes the point — a second section is the only place this lane can
    # buy resolution — but it is never silent. Two sections in one reading is a different claim from a reading on
    # one section: the arms drove different rooms, so the delta is an average over two populations and has to be
    # reported per section beside the pooled number. So the declaration is required and the sections are graded
    # (`by_section`), and an undeclared mixture is refused rather than pooled.
    present = set(sections.values())
    if len(present) > 1 and not expect_splits:
        listed = ", ".join(f"{Path(path).name}: {section}" for path, section in sorted(sections.items()))
        fail(
            f"this join mixes corpus sections ({listed}); name them with --expect-splits to pool them, because "
            "a pooled rate over two sections is an average over two populations and has to be read beside both"
        )
    if expect_splits:
        # An artefact written before `summary.split` existed cannot prove which section it drove, and "cannot
        # prove" is refused rather than assumed: the whole value of naming the section is that the reading's
        # denominator is the section's own published size.
        unnamed = sorted(Path(path).name for path in paths if str(path) not in sections)
        if unnamed:
            fail(
                f"--expect-splits {list(expect_splits)} cannot be checked against {unnamed}, which record no "
                "section; re-drive them rather than joining a slice whose denominator is unknown"
            )
        if present != set(expect_splits):
            fail(f"--expect-splits {sorted(expect_splits)} but the slices drove {sorted(present)}")
    # A channel is the harness, not the prompt, so the rules are one notch stricter than the section's. Two channels
    # under one label is never legal -- that is an arm that is two harnesses, and averaging it would print a rate
    # nobody designed. Two channels across the join is legal, because re-running both arms on a second reader is
    # exactly what R183 buys, but it is never silent: a rate pooled over two harnesses is the same category error as
    # a rate pooled over two corpus sections, and it is refused until the join says it is comparing them.
    mixed = sorted(label for label, seen in label_channels.items() if len(seen) > 1)
    if mixed:
        listed = ", ".join(f"{label}: {sorted(label_channels[label])}" for label in mixed)
        fail(
            f"one arm cannot span two channels ({listed}); a label is one harness, so re-drive the slice or give it "
            "a label of its own rather than averaging two readers into one rate"
        )
    driven = set(channels.values())
    if len(driven) > 1 and not expect_parsers:
        listed = ", ".join(f"{Path(path).name}: {channel}" for path, channel in sorted(channels.items()))
        fail(
            f"this join mixes parser channels ({listed}); name them with --expect-parsers to compare them, because a "
            "pooled rate over two readers is a rate about the harness and has to be read as that"
        )
    if expect_parsers and driven != set(expect_parsers):
        fail(f"--expect-parsers {sorted(expect_parsers)} but the slices drove {sorted(driven)}")
    # The budget is the harness as well, and it is the stricter case of the two: the cap's price is not symmetric
    # between arms, so an undeclared span is not an average of two populations but a difference that is partly
    # arithmetic. One label at two caps is two treatments; a join across caps is legal when it is named.
    spanned = sorted(label for label, seen in label_caps.items() if len(seen) > 1)
    if spanned:
        listed = ", ".join(f"{label}: {sorted(label_caps[label])}" for label in spanned)
        fail(
            f"one arm cannot span two budgets ({listed}); a label is one step cap, so re-drive the slice or label it "
            "after the cap rather than averaging two budgets into one rate"
        )
    budgets = set(caps.values())
    if len(budgets) > 1 and not expect_caps:
        listed = ", ".join(f"{Path(path).name}: {cap}" for path, cap in sorted(caps.items()))
        fail(
            f"this join mixes step caps ({listed}); name them with --expect-caps to compare them, because a shorter "
            "cap costs the slow arm more than the fast one and the delta is then partly arithmetic (R184)"
        )
    if expect_caps and budgets != set(expect_caps):
        fail(f"--expect-caps {sorted(expect_caps)} but the slices were driven at {sorted(budgets)}")
    # The guard is the fourth harness knob and the only one that changes the driver's own answer, so it is refused and
    # graded exactly as the reader and the budget are: one label at two states is two treatments, a join across states
    # is legal only when it names them, and a guarded episode with no ledger is refused outright -- it claims to have
    # been armed and does not say how often it fired, which is the number the round is read from (R189).
    state_of = guards(grouped)
    span = sorted(label for label, state in state_of.items() if "+" in state)
    if span:
        listed = ", ".join(f"{label}: {state_of[label]}" for label in span)
        fail(
            f"one arm cannot span two guard states ({listed}); a label is one driver, so re-drive the slice or label "
            "it after the guard rather than averaging two treatments into one rate"
        )
    for label, episodes in grouped.items():
        for episode in episodes:
            if episode.get("guard") is True and "guard_fires" not in episode:
                fail(
                    f"{label}: {episode.get('gamefile')} was guarded but carries no guard_fires, so the round's first "
                    "reading cannot be computed from it; re-drive the slice rather than joining an arm whose "
                    "engagement is unknown"
                )
    # For the span checks `absent` reads as `off`: an artefact from before the flag existed was driven without the
    # guard, which is a fact about the driver and not a third state. The print keeps `absent` because the counter
    # cannot show a fire it never counted, and the reader has to know which of the two it is looking at.
    driven_states = {"on" if state == "on" else "off" for state in state_of.values()}
    if len(driven_states) > 1 and not expect_guard:
        listed = ", ".join(f"{label}: {state}" for label, state in sorted(state_of.items()))
        fail(
            f"this join mixes guard states ({listed}); name them with --expect-guard to compare them, because an armed "
            "arm and an unarmed one are two treatments and their average is neither"
        )
    if expect_guard and driven_states != set(expect_guard):
        fail(f"--expect-guard {sorted(expect_guard)} but the slices were driven {sorted(driven_states)}")
    # The ledger is the fifth knob and is the guard's sibling in everything but the turn it fires on: it answers a
    # command that moved nothing rather than a reply that carried none, and R191 compares armed against unarmed at one
    # pack, one channel, one cap and one guard. So it is refused and graded exactly as the guard is -- one label at two
    # ledger states is two treatments, and an armed episode with no `ledger_fires` is an episode that claims to have
    # been given a state line and does not say how often, which is the number the round's first reading is (R191).
    ledger_of = ledgers(grouped)
    ledger_span = sorted(label for label, state in ledger_of.items() if "+" in state)
    if ledger_span:
        listed = ", ".join(f"{label}: {ledger_of[label]}" for label in ledger_span)
        fail(
            f"one arm cannot span two ledger states ({listed}); a label is one driver, so re-drive the slice or label "
            "it after the ledger rather than averaging two treatments into one rate"
        )
    for label, episodes in grouped.items():
        for episode in episodes:
            if episode.get("ledger") is True and "ledger_fires" not in episode:
                fail(
                    f"{label}: {episode.get('gamefile')} carried the ledger but records no ledger_fires, so the round's "
                    "first reading cannot be computed from it; re-drive the slice rather than joining an arm whose "
                    "engagement is unknown"
                )
    ledger_states = {"on" if state == "on" else "off" for state in ledger_of.values()}
    if len(ledger_states) > 1 and not expect_ledger:
        listed = ", ".join(f"{label}: {state}" for label, state in sorted(ledger_of.items()))
        fail(
            f"this join mixes ledger states ({listed}); name them with --expect-ledger to compare them, because an arm "
            "given the tried-commands line and one given the observation alone are two treatments and their average is "
            "neither"
        )
    if expect_ledger and ledger_states != set(expect_ledger):
        fail(f"--expect-ledger {sorted(expect_ledger)} but the slices were driven {sorted(ledger_states)}")
    # And the pack is the harness too. The rule is the channel's and the cap's with one difference: a treatment and
    # its control are always two packs (the control renders none), so a join across labels is the normal case and
    # only *one label* spanning two banks is illegal. R185 is the first round to swap a bank under an unchanged label
    # at an unchanged 551 characters, which is why no other field in the artefact could have caught the pooling.
    swapped = sorted(label for label, seen in label_banks.items() if len(seen) > 1)
    if swapped:
        listed = ", ".join(f"{label}: {sorted(label_banks[label])}" for label in swapped)
        fail(
            f"one arm cannot span two banks ({listed}); a label is one pack, so re-drive the slice or give the new "
            "bank a label of its own rather than averaging two prompts into one rate"
        )
    return relabel(grouped, arm_specs)


def parse_spec(spec: str) -> "tuple[str, str]":
    """`old=new`, with the three ways it can be malformed refused in one place.

    One parser rather than two: the spec is read when the rename may be keyed on a path and again when it is keyed
    on an arm, and a second copy of these four conditions is a second place for them to disagree. `=` may not appear
    in the new name because the first `partition` would then have produced a name the caller did not mean.
    """
    old, separator, new = spec.partition("=")
    old, new = old.strip(), new.strip()
    if not separator or not old or not new or "=" in new:
        fail(f"--relabel {spec!r} is not 'old=new'")
    return old, new


def relabel(groups: "dict[str, list[dict]]", specs: "list[str]") -> "dict[str, list[dict]]":
    """Rename a group, so that two dispatches' *treatments* can be paired as two arms.

    A reading inside one dispatch pairs a treatment with the `none` arm bought in the same run, because the
    control moves about seven points between dispatches and a cross-run delta would be measuring that. Two
    treatments are a different quantity: both drove every game in the split through the same model and the
    same harness, so the difference between them is the difference between two blocks and not between two
    afternoons. Four blocks have now been scored against four controls on the same 134 games — 80, 81, 89
    and 90 wins for `none` against 99, 105, 80 and 80 for the blocks — and the treatment readings repeat
    while the control's does not. This switch is what turns that comparison into a command.

    A rename that would land on a group already present is refused rather than merged: two arms' episodes
    under one name is a doubled denominator wearing one arm's label, which is the failure mode this file's
    docstring is entirely about. The caller prints the rename, because a pairing whose provenance is silent
    reads like an ordinary within-run reading.
    """
    renamed = dict(groups)
    for spec in specs:
        old, new = parse_spec(spec)
        if old not in renamed:
            fail(f"--relabel {spec!r}: no slice carries {old!r}; the file(s) hold {sorted(renamed)}")
        if new != old and new in renamed:
            fail(
                f"--relabel {spec!r}: {new!r} is already an arm in this join, and merging two arms would "
                f"double a denominator while printing one rate"
            )
        renamed[new] = renamed.pop(old)
    return renamed


def tile(episodes: "list[dict]", expected: int, label: str) -> "dict[str, dict]":
    """One entry per game, refusing a duplicate — a game driven twice is two votes for one question."""
    by_game: "dict[str, dict]" = {}
    for episode in episodes:
        game = episode.get("gamefile")
        if not isinstance(game, str) or game == "":
            fail(f"{label}: an episode carries no gamefile")
        if game in by_game:
            fail(f"{label}: {game} was driven twice, so the slices overlap")
        by_game[game] = episode
    if expected > 0 and len(by_game) != expected:
        fail(f"{label}: {len(by_game)} distinct games, expected {expected}")
    return by_game


def discordance(pairs: "list[tuple[bool, bool]]") -> "tuple[int, int]":
    """`(b, c)`: the games the first arm won and the second lost, and the reverse."""
    b = sum(1 for first, second in pairs if first and not second)
    c = sum(1 for first, second in pairs if second and not first)
    return b, c


def mde_of(discordant: int, games: int, z_sum: float = 2.802) -> "float":
    """The smallest effect this sample could see, at 5% two-sided and 80% power.

    `2.802 = 1.96 + 0.84`, the two quantiles the standard formula sums. Reported because a delta whose
    interval spans zero is not automatically evidence of no effect: it may be evidence that the sample
    could not have produced one, and the two readings require different next steps.
    """
    if games <= 0:
        return float("nan")
    return z_sum * math.sqrt(discordant) / games


def bootstrap_delta(pairs: "list[tuple[bool, bool]]", rounds: int, seed: int, alpha: float = 0.05) -> dict:
    """A percentile interval for `mean(a - b)`, resampling **games** with replacement.

    Games, not episodes: the unit that was assigned to an arm is a game, and two episodes of one game
    would be two views of one task. Resampling episodes would shrink the interval by pretending the split
    is larger than it is — which is the mistake a clustered design makes when it is analysed as a
    binomial.
    """
    n = len(pairs)
    if n == 0:
        fail("no pairs, so there is no delta")
    observed = sum(first - second for first, second in pairs) / n
    draw = Draw(seed)
    deltas = []
    for _ in range(rounds):
        total = 0
        for _ in range(n):
            first, second = pairs[draw.below(n)]
            total += first - second
        deltas.append(total / n)
    deltas.sort()
    low = deltas[int((alpha / 2) * (rounds - 1))]
    high = deltas[int((1 - alpha / 2) * (rounds - 1))]
    # Two-sided percentile p: the share of resamples on the other side of zero, doubled. Reported beside
    # the interval rather than instead of it, because a reader who wants "is zero inside" can have both.
    left = sum(1 for delta in deltas if delta <= 0) / rounds
    right = sum(1 for delta in deltas if delta >= 0) / rounds
    p = min(1.0, 2 * min(left, right))
    return {
        "delta": round(observed, 4),
        "ci_low": round(low, 4),
        "ci_high": round(high, 4),
        "p_two_sided": round(p, 4),
        "rounds": rounds,
        "seed": seed,
        "unit": "game",
    }


def bill_of_slices(paths: "list[Path]") -> dict:
    """The pass's bill: what each slice said it spent, summed, with the band it was spent in."""
    usd = 0.0
    usd_other = 0.0
    bands = set()
    usage = {"prompt_tokens": 0, "completion_tokens": 0, "cache_hit_tokens": 0, "cache_miss_tokens": 0}
    calls = 0
    for path in paths:
        summary = json.loads(path.read_text(encoding="utf-8")).get("summary") or {}
        bill = summary.get("bill") or {}
        usd += float(bill.get("usd", 0.0))
        usd_other += float(bill.get("usd_in_other_band", 0.0))
        bands.add(bill.get("band", "unknown"))
        calls += int(summary.get("calls", 0))
        for key in usage:
            usage[key] += int((summary.get("usage") or {}).get(key, 0))
    return {
        "usd": round(usd, 4),
        "usd_in_other_band": round(usd_other, 4),
        "bands": sorted(bands),
        "calls": calls,
        "usage": usage,
        "cache_hit_rate": round(usage["cache_hit_tokens"] / usage["prompt_tokens"], 4) if usage["prompt_tokens"] else None,
    }


# --------------------------------------------------------------------------------------------------
# The decomposition: did the pack reach the game, and what did it do where it reached it
# --------------------------------------------------------------------------------------------------


def shared_games(left: "dict[str, dict]", right: "dict[str, dict]") -> "list[str]":
    """The games both arms drove, which is the only population a paired quantity is defined on."""
    games = sorted(set(left) & set(right))
    if not games:
        fail("the two arms share no game, so nothing here is paired")
    return games


def engagement(left: "dict[str, dict]", right: "dict[str, dict]") -> dict:
    """How many games the pack actually changed, and what the change was worth on those.

    The unconditional delta answers *what would change if this arm were shipped*; this answers *what the
    mechanism does when it engages*. They differ by the share of games in which the treatment's action
    sequence is identical to the control's, and that share is not a detail: at 134 games a pack can be
    worth 20pp on the games it reaches and 2pp pooled, and only one of those numbers tells a reader
    whether the mechanism or the sample is the problem.

    The digest is over the action sequence, and the environment is a deterministic simulator, so equal
    digests imply equal verdicts. A contradiction is refused rather than reported: it means the join is
    wrong, not that the memory did something subtle.
    """
    games = shared_games(left, right)
    blank = [game for game in games if not isinstance(left[game].get("digest"), str) or not isinstance(right[game].get("digest"), str)
             or left[game].get("digest") == "" or right[game].get("digest") == ""]
    if blank:
        fail(f"{len(blank)} games carry no action digest (first {blank[0]}), so engagement cannot be read")

    identical = [game for game in games if left[game]["digest"] == right[game]["digest"]]
    contradictions = [
        game for game in identical if bool(left[game].get("won")) != bool(right[game].get("won"))
    ]
    if contradictions:
        fail(
            f"{len(contradictions)} games took the same actions and reached different verdicts "
            f"(first {contradictions[0]}); the environment replays deterministically, so this is a "
            "defect in the join rather than an effect of the arm"
        )
    diverged = [game for game in games if left[game]["digest"] != right[game]["digest"]]
    won = lambda side, game: 1.0 if bool(side[game].get("won")) else 0.0  # noqa: E731
    unconditional = sum(won(left, game) - won(right, game) for game in games) / len(games)
    helped = sum(1 for game in diverged if bool(left[game].get("won")) and not bool(right[game].get("won")))
    harmed = sum(1 for game in diverged if bool(right[game].get("won")) and not bool(left[game].get("won")))
    report = {
        "identical": len(identical),
        "diverged": len(diverged),
        "divergence_rate": round(len(diverged) / len(games), 4),
        "delta_unconditional": round(unconditional, 4),
        # Where the pack changed nothing the change is worth exactly nothing, by the determinism above;
        # writing 0.0 rather than omitting it keeps a reader from reading an absence as a measurement.
        "delta_among_identical": 0.0,
        "delta_among_diverged": (
            round(sum(won(left, game) - won(right, game) for game in diverged) / len(diverged), 4) if diverged else None
        ),
        # The same two columns `COMPETITIVE.md` Appendix AS reports for the τ² lane, with the episode as the
        # unit instead of the served item: of the games the pack changed, the share it repaired and the share
        # it broke. The denominator is what makes them a share rather than a rate, and at zero engagement
        # there is no share to report — a pack nobody read did not harm nothing.
        "help_share": round(helped / len(diverged), 4) if diverged else None,
        "harm_share": round(harmed / len(diverged), 4) if diverged else None,
        "helped": helped,
        "harmed": harmed,
    }
    return report


def strata(left: "dict[str, dict]", right: "dict[str, dict]", labels: "tuple[str, str]" = ("treatment", "control")) -> dict:
    """The paired delta split by what the control did unaided: the easy games and the hard ones.

    `arXiv:2604.27003` studies experience reuse as continual learning and reports two asymmetries: raw
    trajectories transfer badly, and negative transfer concentrates on **the cases the agent cannot solve
    on its own**, while cases it already handles are robust. `arXiv:2610.07311` (memory over-reliance)
    adds the reason: harm is largest when the stored evidence only partly matches the question.

    Both are predictions about this lane's 134 games, and neither is visible in a pooled delta — a pack
    that wins four hard games and loses four easy ones is a delta of zero that is not a null. The control
    is the stratifier because "hard" has to mean hard *for this skeleton*, not hard in the abstract.
    """
    treatment, control = labels
    table: "dict[str, dict]" = {
        "hard": {"games": 0, "wins": {treatment: 0, control: 0}},
        "easy": {"games": 0, "wins": {treatment: 0, control: 0}},
    }
    for game in shared_games(left, right):
        first = bool(left[game].get("won"))
        second = bool(right[game].get("won"))
        # The stratum is named by the control's verdict, which is the arm with no memory in it.
        key = "easy" if second else "hard"
        table[key]["games"] += 1
        table[key]["wins"][treatment] += int(first)
        table[key]["wins"][control] += int(second)
    for row in table.values():
        row["delta"] = (
            round((row["wins"][treatment] - row["wins"][control]) / row["games"], 4) if row["games"] else None
        )
    return table


def by_field(
    left: "dict[str, dict]",
    right: "dict[str, dict]",
    labels: "tuple[str, str]" = ("treatment", "control"),
    field: str = "task_kind",
) -> dict:
    """The paired delta of each value of one episode field, on the games both arms drove.

    Pooling is how a mechanism that helps three groups and hurts three reads as a null, and there are two such
    groupings in this lane: the task type (`task_kind`) and the corpus section (`section`, derived at join time).
    The registration predicts *where* a rule should help in both, and this is the view that confirms or refutes it.
    One function rather than two because the arithmetic is identical and a second copy is a second place for the
    discordance counts to disagree with the pooled reading.
    """
    treatment, control = labels
    table: "dict[str, dict]" = {}
    for game in shared_games(left, right):
        kind = left[game].get(field) or right[game].get(field) or "unknown"
        row = table.setdefault(
            kind,
            {
                "games": 0,
                "wins": {treatment: 0, control: 0},
                "treatment_only": 0,
                "control_only": 0,
                # A format event counted per stratum. `recovered` is 91% `put` in every round that has measured it,
                # so the pooled counter says "the pack changed" when it means "the `put` pack changed" (AUDIT 34.268).
                # Summed here rather than re-read in the print so that the number in the report and the number in the
                # JSON are one number.
                "recovered": {treatment: 0, control: 0},
                "calls": {treatment: 0, control: 0},
                "recovered_seen": 0,
            },
        )
        first = bool(left[game].get("won"))
        second = bool(right[game].get("won"))
        row["games"] += 1
        row["wins"][treatment] += int(first)
        row["wins"][control] += int(second)
        row["treatment_only"] += int(first and not second)
        row["control_only"] += int(second and not first)
        for arm, record in ((treatment, left[game]), (control, right[game])):
            row["recovered"][arm] += int(record.get("recovered_actions") or 0)
            row["calls"][arm] += int(record.get("calls") or 0)
            row["recovered_seen"] += int("recovered_actions" in record)
    for row in table.values():
        row["delta"] = round((row["wins"][treatment] - row["wins"][control]) / row["games"], 4)
        row["discordant"] = row["treatment_only"] + row["control_only"]
        # Whether either arm counted the field at all, carried through to the print so that a stratum from an arm file
        # written before AUDIT 34.262 shows nothing rather than a zero it never measured.
        row["recovered_counted"] = row["recovered_seen"] > 0
        row["recovered_per_call"] = {
            arm: round(row["recovered"][arm] / row["calls"][arm], 4) if row["calls"][arm] else None
            for arm in (treatment, control)
        }
    # Descending by games, then by name: the largest population first, and a stable order for a diff.
    return dict(sorted(table.items(), key=lambda item: (-item[1]["games"], item[0])))


def by_kind(left: "dict[str, dict]", right: "dict[str, dict]", labels: "tuple[str, str]" = ("treatment", "control")) -> dict:
    """The paired delta of each of the six task types."""
    return by_field(left, right, labels, "task_kind")


def by_section(left: "dict[str, dict]", right: "dict[str, dict]", labels: "tuple[str, str]" = ("treatment", "control")) -> dict:
    """The paired delta of each corpus section, which is what makes a pooled cross-section reading honest.

    A 274-game join over two sections is an average over two populations, and the question R177 registers is
    precisely whether the effect is one of them or both. Printing the sections beside the pooled delta is the
    difference between an average and a claim about memory.
    """
    return by_field(left, right, labels, "section")


def parsers(grouped: "dict[str, list[dict]]") -> "dict[str, str]":
    """Which reader drove each arm, from the episodes rather than from the labels.

    The label carries the channel (`always-in@anyline`), but a label is a name a dispatcher chose and an episode is
    what happened. The report reads the second: a reading whose arms came off two harnesses has to say so above the
    delta, because the number is then a comparison of two readers and nothing else in the output would reveal it.
    """
    return {
        arm: "+".join(sorted({str(episode.get("parser") or REFERENCE_PARSER) for episode in episodes}))
        for arm, episodes in grouped.items()
    }


def caps(grouped: "dict[str, list[dict]]") -> "dict[str, str]":
    """Which step cap drove each arm, from the episodes rather than from the labels.

    The counterpart of `parsers`, and it exists for the same reason one round later: the cap is a harness, so a
    reading whose arms ran at two budgets has to print both above the delta. The value is the default for any episode
    that predates the field, and a joined span is spelled `30+50` so that a report cannot show one number where two
    were driven.
    """
    return {
        arm: "+".join(sorted({str(episode.get("max_steps") or REFERENCE_CAP) for episode in episodes}))
        for arm, episodes in grouped.items()
    }


def guards(grouped: "dict[str, list[dict]]") -> "dict[str, str]":
    """Whether each arm answered a commandless turn with the guard's line, from the episodes rather than the labels.

    The fourth harness knob, and the first that changes the driver's own answer rather than the prompt or the reader:
    R189's two arms are one family, one bank, one channel and one cap, so this token is the whole difference between
    them and a join that could not read it would pool two treatments into one rate. `absent` is the pre-R189 state and
    is said rather than defaulted: an episode that predates the field made no claim about the guard, while a control
    written after it claims `off` explicitly.
    """
    states: "dict[str, str]" = {}
    for arm, episodes in grouped.items():
        seen = set()
        for episode in episodes:
            if "guard" not in episode:
                seen.add("absent")
            else:
                seen.add("on" if episode.get("guard") else "off")
        states[arm] = "+".join(sorted(seen))
    return states


def ledgers(grouped: "dict[str, list[dict]]") -> "dict[str, str]":
    """Whether each arm answered a turn that moved nothing with the tried-commands line, from the episodes.

    The fifth harness knob and the guard's sibling: R191's two arms are one family, one bank, one channel, one cap and
    one guard, so this token is the whole difference between them. `absent` is the pre-R191 state and is said rather than
    defaulted, for the reason `guards` says it: an episode that predates the field made no claim about the ledger, while
    an arm written after it claims `off` explicitly.
    """
    states: "dict[str, str]" = {}
    for arm, episodes in grouped.items():
        seen = set()
        for episode in episodes:
            if "ledger" not in episode:
                seen.add("absent")
            else:
                seen.add("on" if episode.get("ledger") else "off")
        states[arm] = "+".join(sorted(seen))
    return states


def banks(grouped: "dict[str, list[dict]]") -> "dict[str, str]":
    """Which pack each arm rendered, from the episodes rather than from the labels.

    The third of the three: R183 moved the reader, R184 the budget, and R185 the bank — all three are harness and all
    three are invisible in a name. The value is a content digest, so the same sentence loaded from two files is one
    bank and two banks rendering to the same length are two; `""` means the arm rendered no pack (the control) or the
    artefact predates the field.
    """
    return {
        arm: "+".join(sorted({str(episode.get("bank_digest") or "") for episode in episodes}))
        for arm, episodes in grouped.items()
    }


def refusals(left: "list[dict]", right: "list[dict] | None" = None, labels: "tuple[str, str]" = ("left", "right")) -> dict:
    """The counters the arm is expected to move, per arm and independent of any verdict.

    A memory that raises the score while raising the refusal rate is a memory whose effect came from
    somewhere other than the knowledge it carries; a memory that lowers the refusal rate without raising
    the score is a memory that reached the world but not the task. Both are readable here and neither is
    readable from a win count.
    """

    def summarise(episodes: "list[dict]") -> dict:
        calls = sum(int(episode.get("calls") or 0) for episode in episodes)
        actions = sum(int(episode.get("actions") or 0) for episode in episodes)
        invalid = sum(int(episode.get("invalid_actions") or 0) for episode in episodes)
        off_space = sum(int(episode.get("off_space_actions") or 0) for episode in episodes)
        # A command the first-line rule refused: absent from every arm file written before AUDIT 34.259, which
        # is why it is summed with a default. An old arm reports zero because it never counted, not because it
        # never happened, and the print below says which is which by naming the field only when a file has it.
        refused = sum(int(episode.get("refused_actions") or 0) for episode in episodes)
        counted = any("refused_actions" in episode for episode in episodes)
        # The same event on the other side of the parser. A reply whose first line is a thought and whose later line
        # is a command is one format event either way; the reference channel drops it and counts it above, the
        # any-line channel executes it and counts it here. Printing only one of the two would make the second channel
        # look like a cure for the format rather than a different end for the same turn (AUDIT 34.262).
        recovered = sum(int(episode.get("recovered_actions") or 0) for episode in episodes)
        recovered_counted = any("recovered_actions" in episode for episode in episodes)
        # The turn a reply spends on a thought is charged to the pass budget and moves nothing, which is the third way
        # a turn can fail to reach the world and the only one that costs the whole episode rather than a step. R186's
        # ten losses split cleanly on it: five spend 24 to 46 turns on thoughts and 4 to 26 on the environment, five
        # spend 0 or 1 on thoughts and 49 or 50 on the environment. The class is read as `thought_heavy` rather than as
        # a mean because the two families are not a distribution around anything.
        thoughts = sum(int(episode.get("thoughts") or 0) for episode in episodes)
        thoughts_counted = any("thoughts" in episode for episode in episodes)
        heavy = sum(1 for episode in episodes if int(episode.get("thoughts") or 0) >= THOUGHT_HEAVY)
        # The guard's ledger. `checked` is the denominator the registered reading needs and `relapsed` its numerator: a
        # fire nobody answered is not evidence that the model re-entered the loop, and a fire answered by another
        # commandless reply is exactly that evidence. Counted only when a file has the field, for the reason `dropped`
        # is: a zero over an arm that never counted is not a measurement (R189).
        guard_fires = sum(int(episode.get("guard_fires") or 0) for episode in episodes)
        guard_checked = sum(int(episode.get("guard_checked") or 0) for episode in episodes)
        guard_relapsed = sum(int(episode.get("guard_relapsed") or 0) for episode in episodes)
        guard_counted = any("guard_fires" in episode for episode in episodes)
        # The ledger's engagement and its price. `fires` is the number of turns whose answer carried the tried-commands
        # line and `chars` the characters those lines added, so the cost reading is a measurement of the treatment's own
        # text rather than a difference between two prompts that also differ by their pack -- the arithmetic that made
        # R188's price unreadable. Counted only when a file has the field, for the reason `dropped` is: a zero over an
        # arm that never counted is not a measurement (R191).
        ledger_fires = sum(int(episode.get("ledger_fires") or 0) for episode in episodes)
        ledger_chars = sum(int(episode.get("ledger_chars") or 0) for episode in episodes)
        ledger_counted = any("ledger_fires" in episode for episode in episodes)
        # The turns R193's change gate silenced. Reported beside the fires rather than folded into them: a counted arm
        # with 400 fires and 0 silences did not run the gate, and an arm with many silences spent its tail on one state.
        ledger_suppressed = sum(int(episode.get("ledger_suppressed") or 0) for episode in episodes)
        return {
            "games": len(episodes),
            "calls": calls,
            "actions": actions,
            "invalid_actions": invalid,
            "off_space_actions": off_space,
            "refused_actions": refused,
            "refused_counted": counted,
            "recovered_actions": recovered,
            "recovered_counted": recovered_counted,
            "thoughts": thoughts,
            "thoughts_counted": thoughts_counted,
            "thought_heavy": heavy,
            "guard_fires": guard_fires,
            "guard_checked": guard_checked,
            "guard_relapsed": guard_relapsed,
            "guard_counted": guard_counted,
            "ledger_fires": ledger_fires,
            "ledger_chars": ledger_chars,
            "ledger_counted": ledger_counted,
            "ledger_suppressed": ledger_suppressed,
            # A rate over no games is undefined rather than zero, for the reason the call rates below are: a slice
            # that recorded no episode did not think nothing, it did not happen.
            "thoughts_per_game": round(thoughts / len(episodes), 2) if episodes else None,
            # A rate over no calls is not zero, it is undefined: a slice that recorded no call did not
            # refuse nothing, it did not happen.
            "invalid_per_call": round(invalid / calls, 4) if calls else None,
            "invalid_per_action": round(invalid / actions, 4) if actions else None,
            "off_space_per_action": round(off_space / actions, 4) if actions else None,
            "refused_per_call": round(refused / calls, 4) if calls else None,
            "recovered_per_call": round(recovered / calls, 4) if calls else None,
        }

    report = {labels[0]: summarise(left)}
    if right is not None:
        report[labels[1]] = summarise(right)
    return report


def carried(episodes: "list[dict]") -> dict:
    """What an arm actually put in front of the model, from the artefact's own `pack_entries`.

    R174.2 is why this exists. That arm was labelled `retrieved@g0.2`, it carried **zero** entries in 134 of
    134 games, and every other counter in this report looked healthy: engagement 88.1%, a paired delta to four
    places, a by-kind row for all six kinds. A reading of an empty pack is a reading of `none` wearing a
    treatment's name, and nothing in the report said so — the number was quotable and it was not a gate.

    The counter is per arm and it is the first thing printed, because the pack is the treatment: a bank of four
    rules and a bank of twenty are two arms with one label, and an arm whose pack is empty is not that arm.
    """
    by_entries: "dict[int, int]" = {}
    by_chars: "dict[int, int]" = {}
    for episode in episodes:
        count = episode.get("pack_entries")
        if not isinstance(count, int):
            continue
        by_entries[count] = by_entries.get(count, 0) + 1
        chars = episode.get("pack_chars")
        if isinstance(chars, int):
            by_chars[chars] = by_chars.get(chars, 0) + 1
    games = sum(by_entries.values())
    if games:
        mean = round(sum(count * games_with for count, games_with in by_entries.items()) / games, 3)
    else:
        mean = None
    # The pack's own length, which a length-matched experiment has to read before it reads the delta: an arm that
    # was supposed to carry 505 characters and carried 1,280 is a different experiment, and `prefix_chars` cannot
    # say so because it also contains the few-shot examples. Absent from artefacts written before the field
    # existed, and then reported as absent rather than as zero.
    unlike = {chars: games_with for chars, games_with in by_chars.items()}
    return {
        "games": games,
        "by_entries": dict(sorted(by_entries.items())),
        "mean": mean,
        "by_chars": dict(sorted(unlike.items())),
    }


def empty_pack_reason(arm: str, counts: dict) -> "str | None":
    """Why an arm's reading is not a reading, or None. `none` may carry nothing; a pack arm may not.

    Both directions are refused, because both are a label that does not describe the prompt: a pack arm whose
    pack is empty measured the control, and a `none` arm that carried entries measured a treatment. An artefact
    written before `pack_entries` existed has no counts and is passed over rather than failed — the check is
    about what it can see, and it says so instead of assuming.
    """
    if counts["games"] == 0:
        return None
    nonempty = sum(games_with for count, games_with in counts["by_entries"].items() if count > 0)
    family = arm.split("@")[0]
    if family == "none":
        if nonempty:
            return f"arm none carried entries in {nonempty} of {counts['games']} games"
        return None
    if family not in ("always-in", "sham", "retrieved"):
        # A renamed arm is a cross-dispatch pairing the operator stated, and its name no longer carries the
        # family the check would key on; the rename is printed as provenance and this function stays quiet.
        return None
    if not nonempty:
        return (
            f"arm {arm} carried an empty pack in {counts['games']} of {counts['games']} games, so its score is "
            "the control's score and its label does not describe the prompt"
        )
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Join sliced arms into one paired reading")
    parser.add_argument("--input", action="append", default=[], required=True, help="an arm.json, one per slice")
    parser.add_argument(
        "--compare",
        default="always-in,none",
        help="the two arms, treatment first; several pairs may be given, separated by ';'",
    )
    parser.add_argument(
        "--relabel",
        action="append",
        default=[],
        help="rename an arm for cross-dispatch pairing, as old=new; repeatable",
    )
    parser.add_argument("--expect", type=int, default=0, help="games each arm must tile; 0 skips the check")
    parser.add_argument(
        "--expect-splits",
        default="",
        help="the corpus sections this join must span, comma separated; a mixture is refused until it is named here",
    )
    parser.add_argument(
        "--expect-parsers",
        default="",
        help="the parser channels this join compares, comma separated; `reference` is the competitor's first-line "
        "rule and `any-line` executes the command it refuses. A span is refused until it is named here, because a "
        "rate pooled over two readers is a rate about the harness (AUDIT 34.262)",
    )
    parser.add_argument(
        "--expect-caps",
        default="",
        help="the step caps this join compares, comma separated; `50` is the environment's own and every reading "
        "before R184 ran at it. A span is refused until it is named here, because a shorter cap costs the slow arm "
        "more than the fast one and the delta is then partly arithmetic (R184)",
    )
    parser.add_argument(
        "--expect-guard",
        default="",
        help="the guard states this join compares, comma separated: `on` answers a commandless turn with the guard's "
        "line and `off` with `OK.`. A span is refused until it is named here, because an armed arm and an unarmed one "
        "are two treatments and their average is neither (R189)",
    )
    parser.add_argument(
        "--expect-ledger",
        default="",
        help="the ledger states this join compares, comma separated: `on` answers a turn that moved nothing with the "
        "observation plus the last three commands tried, `off` with the observation alone. A span is refused until it "
        "is named here, because an arm given the state line and one without are two treatments and their average is "
        "neither (R191)",
    )
    parser.add_argument("--rounds", type=int, default=10000)
    parser.add_argument("--seed", type=int, default=20261120)
    parser.add_argument("--out", default="")
    arguments = parser.parse_args()

    paths = [Path(item) for item in arguments.input]
    declared = tuple(item.strip() for item in arguments.expect_splits.split(",") if item.strip())
    declared_parsers = tuple(item.strip() for item in arguments.expect_parsers.split(",") if item.strip())
    declared_caps = []
    for item in arguments.expect_caps.split(","):
        item = item.strip()
        if not item:
            continue
        # A cap is read through `int` below, so a malformed one has to be refused here: `--expect-caps 3o` would
        # otherwise raise from a place that reads as a crash rather than as a declaration with a typo in it.
        if not item.isdigit():
            fail(f"--expect-caps {item!r} is not a step count")
        declared_caps.append(int(item))
    declared_caps = tuple(declared_caps)
    declared_guard = []
    for item in arguments.expect_guard.split(","):
        item = item.strip()
        if not item:
            continue
        # Refused here rather than three frames down: `--expect-guard onn` would otherwise read as a declaration that
        # matched nothing rather than as a typo, and the failure would be reported against the slices.
        if item not in ("on", "off"):
            fail(f"--expect-guard {item!r} is not a guard state; say on or off")
        declared_guard.append(item)
    declared_ledger = []
    for item in arguments.expect_ledger.split(","):
        item = item.strip()
        if not item:
            continue
        # Refused here for the guard's reason: `--expect-ledger onn` would otherwise read as a declaration that matched
        # nothing rather than as a typo, and the failure would be reported against the slices.
        if item not in ("on", "off"):
            fail(f"--expect-ledger {item!r} is not a ledger state; say on or off")
        declared_ledger.append(item)
    grouped = load_slices(
        paths,
        arguments.relabel,
        declared,
        declared_parsers,
        declared_caps,
        tuple(declared_guard),
        tuple(declared_ledger),
    )
    # Printed rather than implied: a reading that crosses dispatches is the one kind of reading whose
    # provenance a reader cannot recover from the arms' names in the report.
    for spec in arguments.relabel:
        print(f"  relabelled      {spec}")
    # Parsed before anything is tiled, and a malformed pair is refused here rather than at unpacking time:
    # `--compare always-in` would otherwise raise a ValueError from a tuple unpacking three frames down,
    # which reads as a crash rather than as a dispatch that named one arm where a pair was wanted.
    pairs = []
    for spec in arguments.compare.split(";"):
        parts = [part.strip() for part in spec.split(",")]
        if len(parts) != 2 or not all(parts):
            fail(f"--compare {arguments.compare!r} does not name two arms per pair")
        pairs.append((parts[0], parts[1]))
    for treatment, control in pairs:
        for arm in (treatment, control):
            if arm not in grouped:
                fail(f"no slice carries arm {arm!r}; the file(s) hold {sorted(grouped)}")

    # Before any delta, what each arm put in the prompt. A pack arm that carried nothing is the control with a
    # treatment's label, and a `none` arm that carried entries is the reverse; both are refused here rather
    # than reported, because both produce a number that reads like a reading (R174.2, AUDIT 34.243).
    per_arm_carried = {arm: carried(grouped[arm]) for arm in sorted(grouped)}
    for arm, counts in per_arm_carried.items():
        reason = empty_pack_reason(arm, counts)
        if reason:
            fail(reason)

    # The counters belong to the arm rather than to a pair, so they are computed once per arm over
    # everything the dispatch produced and printed beside the readings rather than inside one of them.
    readings = []
    for treatment, control in pairs:
        left = tile(grouped[treatment], arguments.expect, treatment)
        right = tile(grouped[control], arguments.expect, control)
        shared = shared_games(left, right)
        only_left = sorted(set(left) - set(right))
        only_right = sorted(set(right) - set(left))
        if only_left or only_right:
            fail(
                f"the arms did not drive the same games: {len(only_left)} only in {treatment} "
                f"(first {only_left[0] if only_left else '-'}), {len(only_right)} only in {control}"
            )

        pairs_of_verdicts = [(bool(left[game]["won"]), bool(right[game]["won"])) for game in shared]
        b, c = discordance(pairs_of_verdicts)
        wins_left = sum(1 for first, _ in pairs_of_verdicts if first)
        wins_right = sum(1 for _, second in pairs_of_verdicts if second)
        readings.append(
            {
                "treatment": treatment,
                "control": control,
                "games": len(shared),
                "wins": {treatment: wins_left, control: wins_right},
                "rate": {treatment: round(wins_left / len(shared), 4), control: round(wins_right / len(shared), 4)},
                "discordant": {"treatment_only": b, "control_only": c, "total": b + c},
                "mde": round(mde_of(b + c, len(shared)), 4),
                "paired": bootstrap_delta(pairs_of_verdicts, arguments.rounds, arguments.seed),
                "engagement": engagement(left, right),
                "strata": strata(left, right, (treatment, control)),
                "kinds": by_kind(left, right, (treatment, control)),
                "sections": by_section(left, right, (treatment, control)),
            }
        )

    per_arm = {arm: refusals(grouped[arm])["left"] for arm in sorted(grouped)}
    payload = {
        "readings": readings,
        "refusals": per_arm,
        "carried": per_arm_carried,
        "bill": bill_of_slices(paths),
        "slices": [str(path) for path in paths],
    }
    if arguments.out:
        Path(arguments.out).write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    for reading in readings:
        treatment, control = reading["treatment"], reading["control"]
        print("")
        print(f"{treatment} {reading['wins'][treatment]}/{reading['games']} vs {control} {reading['wins'][control]}/{reading['games']}")
        # Printed above the delta rather than below it: the first question about any pack reading is whether the
        # pack was there, and the second is what it did.
        for arm in (treatment, control):
            counts = per_arm_carried[arm]
            print(f"  carried         {arm} mean {counts['mean']} entries over {counts['games']} games, {counts['by_entries']}")
            if counts["by_chars"]:
                rendered = ", ".join(f"{chars} ch x{games_with}" for chars, games_with in counts["by_chars"].items())
                print(f"  pack chars      {arm} {rendered}")
        # Which reader drove each arm, above the delta and only when it is not the one every earlier reading used:
        # a number that compares two harnesses is a different claim from a number that compares two prompts inside
        # one, and nothing else in the output would say which it is (AUDIT 34.262).
        channel_of = parsers(grouped)
        if treatment in channel_of and control in channel_of and len({channel_of[treatment], channel_of[control], REFERENCE_PARSER}) > 1:
            print(f"  channel         {treatment} {channel_of[treatment]} vs {control} {channel_of[control]}")
        bank_of = banks(grouped)
        if treatment in bank_of and bank_of.get(treatment):
            other = bank_of.get(control) or ""
            print(f"  bank            {treatment} {bank_of[treatment][:8]} vs {control} {other[:8] if other else 'no pack'}")
        cap_of = caps(grouped)
        if treatment in cap_of and control in cap_of and len({cap_of[treatment], cap_of[control], str(REFERENCE_CAP)}) > 1:
            print(f"  budget          {treatment} {cap_of[treatment]} vs {control} {cap_of[control]}")
        print(
            f"  paired delta    {reading['paired']['delta']:+.4f} "
            f"[{reading['paired']['ci_low']:+.4f}, {reading['paired']['ci_high']:+.4f}]  "
            f"p={reading['paired']['p_two_sided']}"
        )
        print(f"  discordant      {reading['discordant']['treatment_only']} + {reading['discordant']['control_only']} = {reading['discordant']['total']} games")
        print(f"  mde at that     {reading['mde']:.4f}  (this is what the split could see)")
        moved = reading["engagement"]
        print(
            f"  engagement      {moved['diverged']}/{reading['games']} games changed course "
            f"({100 * moved['divergence_rate']:.1f}%), delta on those {moved['delta_among_diverged']}"
        )
        print(
            f"  harm share      {moved['harmed']}/{moved['diverged']} = {moved['harm_share']}  "
            f"(helped {moved['helped']}/{moved['diverged']} = {moved['help_share']})"
        )
        for name, row in reading["strata"].items():
            # The hard stratum is where 2604.27003 predicts the harm; printing it beside the pooled
            # delta is what makes that prediction checkable in the report rather than in a footnote.
            print(f"    {name:<6} {row['wins'][treatment]}/{row['games']} vs {row['wins'][control]}/{row['games']}  delta {row['delta']}")
        for kind, row in reading["kinds"].items():
            line = f"    {kind:<9} {row['wins'][treatment]}/{row['games']} vs {row['wins'][control]}/{row['games']}  delta {row['delta']:+.4f}"
            # On the kind's own line, because the pooled counter was read twice as a statement about the pack when it
            # was a statement about `put`: 269 of R183's recovered events and 246 of them are `put`, so a pool that
            # falls by 101 while five of six packs are byte-identical is a pool whose only moving part is `put`
            # (AUDIT 34.268). A reader who has the stratum cannot make that mistake.
            if row.get("recovered_counted"):
                line += (
                    f"  recovered {row['recovered'][treatment]} vs {row['recovered'][control]}"
                    f" ({row['recovered_per_call'][treatment]} vs {row['recovered_per_call'][control]} per call)"
                )
            print(line)
        # Only when the join actually spans more than one: a one-section reading would print the same numbers a
        # second time under a different heading, which is how a reader learns to skip a line.
        if len(reading["sections"]) > 1:
            for section, row in reading["sections"].items():
                print(
                    f"  by section      {section:<24} {row['wins'][treatment]}/{row['games']} vs "
                    f"{row['wins'][control]}/{row['games']}  delta {row['delta']:+.4f}  mde {mde_of(row['discordant'], row['games']):.4f}"
                )
        left_counts = per_arm[treatment]
        right_counts = per_arm[control]
        print(
            f"  refusals        {treatment} {left_counts['invalid_per_call']} "
            f"vs {control} {right_counts['invalid_per_call']} (per call)"
        )
        # The second way a turn can fail to reach the world, and the one no arm file could show before
        # AUDIT 34.259. Printed as `not counted` when the file predates the field, so that a zero here is
        # never read as "the model wrote no command under a thought".
        def refused_cell(counts: dict) -> str:
            if not counts["refused_counted"]:
                return "not counted"
            return f"{counts['refused_actions']} ({counts['refused_per_call']} per call)"

        print(f"  dropped         {treatment} {refused_cell(left_counts)} vs {control} {refused_cell(right_counts)}")

        # The same format event counted on the other side of the parser. Printed on the line below `dropped` because
        # the two are one quantity: a channel that executes what the rule refused has `dropped` near zero and
        # `recovered` at the rate the reference channel's `dropped` would have been, and a reader who sees only the
        # first will read the channel as a cure for the format rather than as a different end for the same turn.
        def recovered_cell(counts: dict) -> str:
            if not counts["recovered_counted"]:
                return "not counted"
            return f"{counts['recovered_actions']} ({counts['recovered_per_call']} per call)"

        if left_counts["recovered_counted"] or right_counts["recovered_counted"]:
            print(
                f"  recovered       {treatment} {recovered_cell(left_counts)} "
                f"vs {control} {recovered_cell(right_counts)}"
            )

        # The third way a turn fails to reach the world, and the one that ends an episode rather than costing a step:
        # a reply with no command spends the pass budget and moves nothing. Printed with the heavy count beside the
        # mean because the two families of loss R186 recorded are disjoint — five games at 24 to 46 thoughts and five
        # at 0 or 1 — so a mean alone would average two classes into a number neither of them has.
        def rumination_cell(counts: dict) -> str:
            if not counts["thoughts_counted"]:
                return "not counted"
            return f"{counts['thoughts_per_game']} per game, {counts['thought_heavy']} heavy"

        print(
            f"  rumination      {treatment} {rumination_cell(left_counts)} "
            f"vs {control} {rumination_cell(right_counts)}"
        )

        # The guard's engagement, printed only when a slice counted it: an arm that was armed and never fired has the
        # control's score for the control's reason, and this is the only line that can say so. Beside `rumination`
        # because the two are one question -- the heavy count says the loop happened, this says whether it was
        # interrupted and whether the model came back with a command (R189).
        def guard_cell(counts: dict) -> str:
            if not counts["guard_counted"]:
                return "not counted"
            return f"{counts['guard_fires']} fires, {counts['guard_relapsed']} relapsed of {counts['guard_checked']} checked"

        if left_counts["guard_counted"] or right_counts["guard_counted"]:
            print(
                f"  guard           {treatment} {guard_cell(left_counts)} "
                f"vs {control} {guard_cell(right_counts)}"
            )

        def ledger_cell(counts: dict) -> str:
            if not counts["ledger_counted"]:
                return "not counted"
            cell = f"{counts['ledger_fires']} fires, {counts['ledger_chars']} chars added"
            if counts["ledger_suppressed"]:
                cell += f", {counts['ledger_suppressed']} silenced"
            return cell

        if left_counts["ledger_counted"] or right_counts["ledger_counted"]:
            print(
                f"  ledger          {treatment} {ledger_cell(left_counts)} "
                f"vs {control} {ledger_cell(right_counts)}"
            )
    print(f"  bill            ${payload['bill']['usd']} over {payload['bill']['calls']} calls")
    if arguments.out:
        print(f"  written         {arguments.out}")
    print("PASS the slices tile the split and the pairing is complete")
    return 0


if __name__ == "__main__":
    sys.exit(main())
