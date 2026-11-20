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

Exit codes are the report: 0 the reading is written, 1 the slices cannot produce one.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

ARMS = ("none", "always-in", "retrieved")


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


def load_slices(paths: "list[Path]") -> "dict[str, list[dict]]":
    """Every episode of every slice, grouped by the arm that drove it."""
    grouped: "dict[str, list[dict]]" = {}
    for path in paths:
        payload = json.loads(path.read_text(encoding="utf-8"))
        summary = payload.get("summary") or {}
        arm = summary.get("arm")
        episodes = payload.get("episodes")
        policy = summary.get("policy")
        if arm not in ARMS:
            fail(f"{path}: summary.arm is {arm!r}, which is not one of {ARMS}")
        if not isinstance(episodes, list) or not episodes:
            fail(f"{path}: no episodes, so this slice contributes nothing and its cost is unexplained")
        if policy == "seed" or policy == "first":
            fail(f"{path}: a model-free slice cannot be paired with a billed one; policy is {policy!r}")
        grouped.setdefault(arm, []).extend(episodes)
    return grouped


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


def main() -> int:
    parser = argparse.ArgumentParser(description="Join sliced arms into one paired reading")
    parser.add_argument("--input", action="append", default=[], required=True, help="an arm.json, one per slice")
    parser.add_argument("--compare", default="always-in,none", help="the two arms, treatment first")
    parser.add_argument("--expect", type=int, default=0, help="games each arm must tile; 0 skips the check")
    parser.add_argument("--rounds", type=int, default=10000)
    parser.add_argument("--seed", type=int, default=20261120)
    parser.add_argument("--out", default="")
    arguments = parser.parse_args()

    paths = [Path(item) for item in arguments.input]
    grouped = load_slices(paths)
    treatment, control = (part.strip() for part in arguments.compare.split(","))
    for arm in (treatment, control):
        if arm not in grouped:
            fail(f"no slice carries arm {arm!r}; the file(s) hold {sorted(grouped)}")

    left = tile(grouped[treatment], arguments.expect, treatment)
    right = tile(grouped[control], arguments.expect, control)
    shared = sorted(set(left) & set(right))
    only_left = sorted(set(left) - set(right))
    only_right = sorted(set(right) - set(left))
    if only_left or only_right:
        fail(
            f"the arms did not drive the same games: {len(only_left)} only in {treatment} "
            f"(first {only_left[0] if only_left else '-'}), {len(only_right)} only in {control}"
        )

    pairs = [(bool(left[game]["won"]), bool(right[game]["won"])) for game in shared]
    b, c = discordance(pairs)
    wins_left = sum(1 for first, _ in pairs if first)
    wins_right = sum(1 for _, second in pairs if second)
    reading = {
        "treatment": treatment,
        "control": control,
        "games": len(shared),
        "wins": {treatment: wins_left, control: wins_right},
        "rate": {treatment: round(wins_left / len(shared), 4), control: round(wins_right / len(shared), 4)},
        "discordant": {"treatment_only": b, "control_only": c, "total": b + c},
        "mde": round(mde_of(b + c, len(shared)), 4),
        "paired": bootstrap_delta(pairs, arguments.rounds, arguments.seed),
    }
    payload = {"reading": reading, "bill": bill_of_slices(paths), "slices": [str(path) for path in paths]}
    if arguments.out:
        Path(arguments.out).write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    print("")
    print(f"{treatment} {wins_left}/{len(shared)} vs {control} {wins_right}/{len(shared)}")
    print(
        f"  paired delta    {reading['paired']['delta']:+.4f} "
        f"[{reading['paired']['ci_low']:+.4f}, {reading['paired']['ci_high']:+.4f}]  "
        f"p={reading['paired']['p_two_sided']}"
    )
    print(f"  discordant      {b} + {c} = {b + c} games")
    print(f"  mde at that     {reading['mde']:.4f}  (this is what the split could see)")
    print(f"  bill            ${payload['bill']['usd']} over {payload['bill']['calls']} calls")
    if arguments.out:
        print(f"  written         {arguments.out}")
    print("PASS the slices tile the split and the pairing is complete")
    return 0


if __name__ == "__main__":
    sys.exit(main())
