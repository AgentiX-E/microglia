"""Rehearse the ALFWorld lane without spending a call.

The lane exists because every board this project competes on is one-shot, while the
mechanism under study is learning across repeats. ALFWorld is the procedure the
experience-reuse literature uses, so it is the one place where "does a lesson survive
a second attempt" can be asked against somebody else's corpus.

This script answers a narrower question first: **can the environment be driven at
all**. It loads one held-out game, replays the file's own gold plan, and asserts the
game ends in the goal state. No model is called, so a run costs nothing, and a
failure here is an environment defect rather than a memory result.

Why the gold plan and not a random walk: a random walk fails for a reason that has
nothing to do with this driver, so it cannot tell a broken driver from a hard game.
The walkthrough is the one trajectory the file guarantees, which makes it the only
assertion available before a model is in the loop.

Exit codes are the report: 0 the environment drives, 1 it does not, and the printed
lines say what was seen rather than what was expected.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# ALFWorld resolves its data root from the environment before any of its own imports
# run, so this has to happen at module scope. The workflow sets the same variable;
# setting it here as well means a developer can run this file directly.
os.environ.setdefault("ALFWORLD_DATA", str(Path.home() / ".cache" / "alfworld"))

DATA_ROOT = Path(os.environ["ALFWORLD_DATA"])
HERE = Path(__file__).resolve().parent


def fail(message: str) -> "None":
    print(f"FAIL {message}")
    raise SystemExit(1)


def main() -> int:
    if not DATA_ROOT.exists():
        fail(f"no data at {DATA_ROOT}; run `alfworld-download` first")

    # The layout the download writes: <root>/json_2.1.1/<split>/<task>/<trial>/game.tw-pddl
    games = sorted(DATA_ROOT.glob("json_2.1.1/valid_unseen/*/*/game.tw-pddl"))
    if not games:
        fail(f"no held-out games under {DATA_ROOT}/json_2.1.1/valid_unseen")
    print(f"games: {len(games)} held-out")

    import yaml

    # The config lives in this repository rather than in the installed package: version
    # 0.4.2 ships it at `configs/base_config.yaml`, which is not a package and is
    # therefore not installed by `find_packages`. A lane that read whatever the wheel
    # happened to carry would record a different environment for the same commit.
    raw = (HERE / "config.yaml").read_text(encoding="utf-8").replace("$ALFWORLD_DATA", str(DATA_ROOT))
    config = yaml.safe_load(raw)

    # Imported after the environment variable is set: `alfworld.info` reads it at import
    # time, and a module-level import here would freeze the default before this file can
    # override it.
    from alfworld.agents.environment.alfred_tw_env import AlfredTWEnv

    env = AlfredTWEnv(config, train_eval="eval_out_of_distribution")
    env = env.init_env(batch_size=1)

    observation, info = env.reset()
    print(f"observation:\n{observation[0]}")
    admissible = info.get("admissible_commands", [[]])[0]
    print(f"admissible: {len(admissible)} commands, first three {admissible[:3]}")
    print(f"info keys: {sorted(info.keys())}")

    # The plan has to come from the episode the environment opened. `extra.gamefile` is
    # the path it opened, which is the only reliable way to reach that trial's own plan:
    # the split also carries files whose walkthroughs are written in first-release
    # symbolic coordinates (`desk_bar__minus_00_dot_57...`), and replaying one of those
    # against a textworld episode produces "Nothing happens" on every step -- a report
    # that reads like a broken driver and is really a plan from another release.
    #
    # This cost two runs: the first asserted against `games[0]` and the second against
    # the same file without saying so in the log.
    plan = None
    gamefile = info.get("extra.gamefile")
    if isinstance(gamefile, (list, tuple)):
        gamefile = gamefile[0] if gamefile else None
    if gamefile:
        plan = json.loads(Path(str(gamefile)).read_text(encoding="utf-8")).get("walkthrough") or []
        print(f"plan source: {gamefile}")
    if not plan:
        fail("the episode published no game file, so there is no plan to assert against")
    print(f"plan: {len(plan)} steps")

    done = False
    for step, action in enumerate(plan):
        observation, _scores, dones, info = env.step([action])
        done = bool(dones[0])
        line = str(observation[0]).replace("\n", " ")[:110]
        print(f"  {step + 1}. {action} -> done={done} :: {line}")
        if done:
            break

    if not done:
        fail("the gold plan did not end the game, so the driver is not driving")
    print("PASS the environment drives and the gold plan reaches the goal")
    return 0


if __name__ == "__main__":
    sys.exit(main())
