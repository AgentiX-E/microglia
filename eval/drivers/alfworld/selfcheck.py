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

    # `alfworld.agents.environment` also exports the embodied environment, and importing
    # the package therefore requires `ai2thor` -- a visual simulator that the text lane
    # never constructs. The text class is reachable on its own, which is one dependency
    # fewer on a job that reads a .tw-pddl file.
    from alfworld.agents.environment.alfred_tw_env import AlfredTWEnv

    config_path = Path(__file__).resolve().parents[0] / "config.yaml"
    if not config_path.exists():
        # The package ships one; copy it beside this script so a run records which
        # config it used rather than which config the installed version happened to
        # carry.
        import alfworld

        shipped = Path(alfworld.__file__).parent / "agents" / "config" / "base_config.yaml"
        config_path.write_text(shipped.read_text(), encoding="utf-8")
    config = yaml.safe_load(config_path.read_text(encoding="utf-8"))

    env = AlfredTWEnv(config, train_eval="eval_out_of_distribution")
    env = env.init_env(batch_size=1)

    observation, info = env.reset()
    print(f"observation:\n{observation[0]}")
    admissible = info.get("admissible_commands", [[]])[0]
    print(f"admissible: {len(admissible)} commands, first three {admissible[:3]}")

    # The walkthrough is per trial and the environment hands back one game at a time,
    # so the plan is read from the file the environment just opened rather than from
    # index 0 of the split.
    game = json.loads(games[0].read_text(encoding="utf-8"))
    plan = game.get("walkthrough") or []
    if not plan:
        fail("the game carries no walkthrough, so there is nothing to assert against")
    print(f"plan: {len(plan)} steps")

    done = False
    for step, action in enumerate(plan):
        observation, _scores, dones, info = env.step([action])
        done = bool(dones[0])
        print(f"  {step + 1}. {action} -> done={done}")
        if done:
            break

    if not done:
        fail("the gold plan did not end the game, so the driver is not driving")
    print("PASS the environment drives and the gold plan reaches the goal")
    return 0


if __name__ == "__main__":
    sys.exit(main())
