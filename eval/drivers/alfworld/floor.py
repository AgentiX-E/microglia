"""Measure the held-out floor of the ALFWorld lane without spending a call.

The lane's value is a paired comparison: the same 134 games driven twice, once with a
memory and once without. Whether that comparison can say anything is decided before any
model is called, by three properties of the environment that this script measures rather
than assumes:

  1. **The split is driveable end to end.** `selfcheck.py` drives one game for twelve
     steps and stops, which is a statement about the driver. A lane whose whole budget
     is priced per episode needs the whole split driven to termination at least once, or
     the price is a model of a run that has never happened.
  2. **The environment has no run-to-run variance.** The power calculation behind every
     quoted minimum detectable effect treats the difference between arms as the only
     noise. That is only true if an arm repeated with the same seed replays exactly. If
     it does not, the detectable effect is larger than the arithmetic says and the quote
     is wrong in the direction that wastes money.
  3. **There is headroom between chance and the published baseline.** ExpeL reports
     ReAct at 40.0 and its own method at 59.0 on this split. A random walker that scored
     near 40 would mean the task is mostly navigable by accident, and the 19 points the
     literature attributes to experience would be mostly the environment being easy.

The walker here chooses uniformly among the commands the environment itself publishes,
so it cannot hallucinate, cannot leave the action space, and needs no prompt. Its score
is a property of the corpus. That makes it the one arm in this project that can be run
at zero cost and still be worth reporting.

What is gated and what is merely reported: the split being fully covered, every episode
reaching termination, and a second pass reproducing the first exactly are assertions --
a failure is a defect in the lane. The win count is reported and never gated, because a
floor of zero is a good floor and a floor of thirty percent is a finding, not a bug.

Exit codes are the report: 0 the floor is measured, 1 the lane cannot measure it.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
import time
from pathlib import Path

# ALFWorld resolves its data root before any of its own imports run, so this has to be at
# module scope. The workflow sets the same variable; setting it here as well means a
# developer can run this file directly.
os.environ.setdefault("ALFWORLD_DATA", str(Path.home() / ".cache" / "alfworld"))

DATA_ROOT = Path(os.environ["ALFWORLD_DATA"])
HERE = Path(__file__).resolve().parent
SPLIT = "valid_unseen"
MASK = (1 << 64) - 1


def fail(message: str) -> "None":
    print(f"FAIL {message}")
    raise SystemExit(1)


class Draw:
    """A PRNG whose sequence is fixed by this file rather than by the runtime.

    `random.Random(seed)` would be shorter and is the wrong tool here: its seeding is
    stable but `choice` routes through `_randbelow`, whose rejection loop has changed
    between minor versions, so a recorded floor would not survive a Python upgrade. A
    plain splitmix64 is nine lines, has no version, and can be reimplemented in another
    language if the floor ever has to be reproduced outside Python.
    """

    def __init__(self, seed: int) -> None:
        self.state = seed & MASK

    def u64(self) -> int:
        self.state = (self.state + 0x9E3779B97F4A7C15) & MASK
        z = self.state
        z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & MASK
        z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & MASK
        return (z ^ (z >> 31)) & MASK

    def below(self, bound: int) -> int:
        # Modulo bias is irrelevant at these sizes (a few dozen commands against 2^64) and
        # a rejection loop would make the sequence depend on the bound, which is the one
        # thing that must not happen when the bounds come from the environment.
        return self.u64() % bound


def wilson(wins: int, trials: int, z: float = 1.959963984540054) -> "tuple[float, float]":
    """The interval a proportion deserves at n=134, computed without a stats package.

    A floor near zero is exactly where the normal approximation collapses -- it puts the
    lower bound below zero and the interval spans nothing useful -- and the floor is the
    number this script exists to produce, so the exact-ish form is used rather than the
    textbook one.
    """
    if trials == 0:
        return (0.0, 1.0)
    p = wins / trials
    denominator = 1.0 + z * z / trials
    centre = (p + z * z / (2 * trials)) / denominator
    half = z * math.sqrt(p * (1 - p) / trials + z * z / (4 * trials * trials)) / denominator
    return (max(0.0, centre - half), min(1.0, centre + half))


def digest_of(actions: "list[str]") -> str:
    joined = "\n".join(actions).encode("utf-8")
    return hashlib.sha256(joined).hexdigest()[:16]


def game_key(path: str) -> str:
    """The game identity as the split names it, not as an absolute path spells it.

    An absolute path carries the runner's home directory, so a recorded floor would
    differ between a developer machine and CI for a reason that has nothing to do with
    the environment.
    """
    resolved = Path(path).resolve()
    try:
        return str(resolved.relative_to(DATA_ROOT.resolve()))
    except ValueError:
        # Outside the data root the whole path is kept. Falling back to the file name would
        # collapse all 134 games onto the single string `game.tw-pddl`, and the coverage
        # assertion downstream would then pass on a walker that drove one game 134 times.
        return str(resolved)


def on_disk() -> "set[str]":
    return {game_key(str(path)) for path in DATA_ROOT.glob(f"json_2.1.1/{SPLIT}/*/*/game.tw-pddl")}


def build_env(batch_size: int = 1):
    import yaml

    # The config lives in this repository rather than in the installed package: 0.4.2
    # ships it at `configs/base_config.yaml`, which is not a package and is therefore not
    # installed by `find_packages`. A lane that read whatever the wheel carried would
    # record a different environment for the same commit.
    raw = (HERE / "config.yaml").read_text(encoding="utf-8").replace("$ALFWORLD_DATA", str(DATA_ROOT))
    config = yaml.safe_load(raw)

    # Imported after the environment variable is set: `alfworld.info` reads it at import
    # time, and a module-level import would freeze the default before this file can
    # override it.
    from alfworld.agents.environment.alfred_tw_env import AlfredTWEnv

    # `AlfredTWEnv` is a shell that reads the split and then hands back a textworld gym
    # environment; only the latter has reset and step. The first version of this file
    # called reset on the shell and failed with an AttributeError forty-two seconds into
    # the job, which is the reason the smoke pass exists.
    shell = AlfredTWEnv(config, train_eval="eval_out_of_distribution")
    return shell.init_env(batch_size=batch_size), shell.num_games


def drive(env, draw: Draw, max_steps: int) -> "dict":
    """One episode, chosen by the environment's own command list and terminated by it."""
    observation, info = env.reset()
    # The batch wrapper shapes every info value as a one-element list at batch_size=1, but
    # `extra.gamefile` is injected by a wrapper this repository does not own, so the string
    # form is accepted too. This is a shape tolerance, not a fallback: a missing key still
    # raises rather than being guessed at.
    raw_gamefile = info["extra.gamefile"]
    gamefile = game_key(raw_gamefile[0] if isinstance(raw_gamefile, (list, tuple)) else raw_gamefile)
    admitted_at_reset = len(info.get("admissible_commands", [[]])[0])
    actions: "list[str]" = []
    # Characters, not tokens, because no tokenizer runs in this job and a token count
    # invented here would be the same kind of number the quote is supposed to stop being.
    # A character count is measured, is tokenizer-independent, and converts to a token
    # bound by the one ratio the provider's own usage report can calibrate later.
    observe_chars: "list[int]" = [len(str(observation[0]))]
    steps = 0
    done = False
    won = False
    last = str(observation[0])
    while not done and steps < max_steps:
        admissible = list(info.get("admissible_commands", [[]])[0])
        if not admissible:
            # Not a failure of the walker: an episode with no legal move is a statement
            # about the task, and it is recorded so the split's shape is visible.
            break
        action = admissible[draw.below(len(admissible))]
        actions.append(action)
        observation, _scores, dones, info = env.step([action])
        steps += 1
        done = bool(dones[0])
        last = str(observation[0])
        observe_chars.append(len(last))
        won = bool(info.get("won", [False])[0])
    return {
        "gamefile": gamefile,
        "won": won,
        "steps": steps,
        "admitted_at_reset": admitted_at_reset,
        "truncated": not done,
        "digest": digest_of(actions),
        "observe_chars": observe_chars,
        "observe_fingerprint": digest_of([str(count) for count in observe_chars]),
        "last_line": last.strip().splitlines()[-1][:120] if last.strip() else "",
    }


def pass_over(seed: int, limit: int, max_steps: int, label: str) -> "list[dict]":
    env, num_games = build_env()
    total = num_games if limit <= 0 else min(limit, num_games)
    print(f"{label}: driving {total} games with seed {seed}, at most {max_steps} steps each")
    draw = Draw(seed)
    episodes: "list[dict]" = []
    started = time.monotonic()
    for index in range(total):
        episode = drive(env, draw, max_steps)
        episodes.append(episode)
        if (index + 1) % 25 == 0 or index + 1 == total:
            wins = sum(1 for item in episodes if item["won"])
            elapsed = time.monotonic() - started
            print(f"  {index + 1}/{total}  wins={wins}  {elapsed:.1f}s")
    elapsed = time.monotonic() - started
    print(f"{label}: {total} games in {elapsed:.1f}s ({1000 * elapsed / max(1, total):.0f} ms/game)")
    return episodes


def compare(first: "list[dict]", second: "list[dict]") -> "dict":
    """The second pass exists to be subtracted from the first, not to be averaged with it."""
    mismatches = []
    for index in range(min(len(first), len(second))):
        left, right = first[index], second[index]
        for field in ("gamefile", "won", "steps", "digest", "observe_fingerprint"):
            if left[field] != right[field]:
                mismatches.append(
                    {"episode": index, "field": field, "first": left[field], "second": right[field]}
                )
                break
    return {
        "shadow_episodes": len(second),
        "mismatches": len(mismatches),
        "first_mismatch": mismatches[0] if mismatches else None,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", type=int, default=20261120)
    parser.add_argument("--games", type=int, default=0, help="0 drives the whole split")
    parser.add_argument("--shadow-games", type=int, default=0, help="0 shadows every game driven")
    parser.add_argument("--max-steps", type=int, default=50, help="the environment's own cap")
    parser.add_argument("--out", default=str(HERE / "floor.json"))
    arguments = parser.parse_args()

    if not DATA_ROOT.exists():
        fail(f"no data at {DATA_ROOT}; run `alfworld-download` first")

    expected = on_disk()
    if not expected:
        fail(f"no held-out games under {DATA_ROOT}/json_2.1.1/{SPLIT}")
    print(f"split: {len(expected)} games on disk")

    first = pass_over(arguments.seed, arguments.games, arguments.max_steps, "pass 1")

    # (1) Every game driven is a game the split publishes, and every published game is
    # driven. A lane that silently replayed one game 134 times would report a floor and a
    # variance figure with no defect anywhere in its own output.
    seen = [episode["gamefile"] for episode in first]
    duplicated = len(seen) - len(set(seen))
    missing = sorted(expected - set(seen))
    if duplicated:
        fail(f"{duplicated} games were driven more than once, so the split is not covered")
    if not arguments.games and missing:
        fail(f"{len(missing)} published games were never driven, first {missing[0]}")

    # (2) Every episode reached a verdict. A walker cut off by a step cap is a different
    # measurement from one the environment ended, and mixing them would put a walker
    # defect into the same number as the floor.
    truncated = [episode["gamefile"] for episode in first if episode["truncated"]]
    if truncated:
        fail(
            f"{len(truncated)} of {len(first)} episodes never terminated, first {truncated[0]}; "
            "the step cap is below what the environment itself allows"
        )

    # (3) The same seed replays. This is the assumption the whole power calculation rests
    # on, and it is cheap enough to test rather than assert.
    shadow_limit = arguments.games if arguments.shadow_games <= 0 else arguments.shadow_games
    second = pass_over(arguments.seed, shadow_limit, arguments.max_steps, "pass 2")
    determinism = compare(first, second)
    if determinism["mismatches"]:
        detail = determinism["first_mismatch"]
        fail(f"the same seed did not replay: episode {detail['episode']} {detail['field']}")

    wins = sum(1 for episode in first if episode["won"])
    steps_total = sum(episode["steps"] for episode in first)
    low, high = wilson(wins, len(first))

    # The prompt a turn-based agent would send is the transcript so far, so the transcript's
    # own length is the cost model's input, and it is measured here rather than assumed.
    # `context_chars` is the sum of every observation an episode produced, which is what a
    # ReAct prompt carries by its final turn. A mean over episodes hides the tail, and the
    # tail is what a per-episode price is wrong about, so the median and p90 sit beside it.
    contexts = sorted(sum(episode["observe_chars"]) for episode in first)
    context_mean = sum(contexts) / len(contexts) if contexts else 0
    turns_per_episode = steps_total / len(first) if first else 0

    summary = {
        "seed": arguments.seed,
        "split": SPLIT,
        "games_on_disk": len(expected),
        "episodes": len(first),
        "wins": wins,
        "rate": wins / len(first) if first else 0.0,
        "wilson_low": round(low, 4),
        "wilson_high": round(high, 4),
        "steps_total": steps_total,
        "steps_mean": round(steps_total / len(first), 2) if first else 0.0,
        "admitted_mean": round(sum(e["admitted_at_reset"] for e in first) / len(first), 2) if first else 0.0,
        "empty_admissible": sum(1 for episode in first if episode["admitted_at_reset"] == 0),
        "context_chars": {
            "mean": round(context_mean, 1),
            "median": contexts[len(contexts) // 2] if contexts else 0,
            "p90": contexts[int(0.9 * (len(contexts) - 1))] if contexts else 0,
            "max": contexts[-1] if contexts else 0,
            "per_turn_mean": round(context_mean / turns_per_episode, 1) if turns_per_episode else 0.0,
        },
    }

    payload = {
        "summary": summary,
        "determinism": determinism,
        "episodes": first,
    }
    Path(arguments.out).write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    print("")
    print(f"floor over {summary['episodes']} games: {wins} wins = {100 * summary['rate']:.1f}%")
    print(f"  wilson 95%        [{100 * summary['wilson_low']:.1f}, {100 * summary['wilson_high']:.1f}]")
    print(f"  steps per episode {summary['steps_mean']} of {arguments.max_steps} allowed")
    print(f"  commands at reset {summary['admitted_mean']} on average")
    print(
        f"  transcript chars  mean {summary['context_chars']['mean']} "
        f"median {summary['context_chars']['median']} "
        f"p90 {summary['context_chars']['p90']} "
        f"max {summary['context_chars']['max']}"
    )
    print(f"  replays exactly   {determinism['shadow_episodes']} games, {determinism['mismatches']} mismatches")
    print(f"  written           {arguments.out}")
    print("PASS the split is covered, terminates, and replays")
    print("model calls made by this pass = 0")
    return 0


if __name__ == "__main__":
    sys.exit(main())
