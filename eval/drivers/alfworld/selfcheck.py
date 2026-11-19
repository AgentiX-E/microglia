"""Rehearse the ALFWorld lane without spending a call.

The lane exists because every board this project competes on is one-shot, while the
mechanism under study is learning across repeats. ALFWorld is the procedure the
experience-reuse literature uses, so it is the one place where "does a lesson survive
a second attempt" can be asked against somebody else's corpus.

This script answers a narrower question first: **can the environment be driven at all**.
No model is called, so a run costs nothing, and a failure here is an environment defect
rather than a memory result.

What it asserts, and why not the gold plan: the `walkthrough` field in a `.tw-pddl` file
is written in first-release symbolic coordinates (`toilet_bar__minus_00_dot_54...`), which
are the names the embodied release uses. The text environment answers "Nothing happens"
to every one of them, so replaying the file's plan cannot reach the goal in this lane --
three runs were spent proving that, and the third printed all nine rejected steps. The
contract this driver actually depends on is narrower and testable without a model:

  1. a reset returns an observation, a goal, and a non-empty admissible list;
  2. an admissible command changes the observation;
  3. a command outside the list is refused with "Nothing happens";
  4. the environment survives a walk of many steps and still reports a goal.

A gate on those four is a statement about the driver. A gate on the score would be a
statement about a model that this job deliberately does not call.

Exit codes are the report: 0 the environment drives, 1 it does not.
"""

from __future__ import annotations

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
    first = str(observation[0])
    print(f"observation:\n{first}")
    admissible = list(info.get("admissible_commands", [[]])[0])
    print(f"admissible: {len(admissible)} commands, first three {admissible[:3]}")
    if not admissible:
        fail("the episode offered no admissible command, so nothing can be driven")
    if "Your task is to" not in first:
        fail("the observation does not state a task, so the goal is not being rendered")

    # (2) An admissible command must change what the agent sees. `go to` is used because
    # it is the one family every task type admits; a task with no room left to walk to
    # would be a different defect and is reported as such.
    goto = next((command for command in admissible if command.startswith("go to ")), None)
    if goto is None:
        fail(f"no navigation command among {admissible[:5]}, which every task type admits")
    moved, _scores, _dones, info = env.step([goto])
    after = str(moved[0])
    print(f"after {goto!r}:\n{after}")
    if after == first:
        fail("an admissible command left the observation unchanged, so stepping is not wired")

    # (3) A command outside the list must be refused rather than applied. This is the
    # half of the contract that keeps a model's hallucinated action from silently
    # becoming a legal move, and it is the reason the environment can be scored at all.
    refused, _scores, _dones, _info = env.step(["dance the tango"])
    refused_text = str(refused[0])
    print(f"after an inadmissible command: {refused_text.strip()[:80]!r}")
    if "Nothing happens" not in refused_text:
        fail("an inadmissible command was not refused in the words the environment uses")

    # (4) A walk of many steps must keep the environment alive and still reporting a
    # goal. The loop re-reads the admissible list every step because it changes with the
    # room, which is also what an agent loop will have to do.
    for step in range(12):
        current = list(_info.get("admissible_commands", [[]])[0])
        if not current:
            fail(f"step {step}: the episode published no admissible command")
        observation, _scores, dones, _info = env.step([current[0]])
        if bool(dones[0]):
            print(f"episode ended during the walk at step {step + 1}")
            break
    text = str(observation[0])
    print(f"after a 12-step walk: {text.strip().splitlines()[-1][:100]!r}")
    # The goal line is rendered by the intro grammar, so it appears on reset and not on
    # every observation; what a walk has to preserve is a non-empty render rather than
    # that sentence.
    if not text.strip():
        fail("the walk returned an empty observation, so the episode state is not carried")
    if text.strip() == "Nothing happens.":
        fail("every step of the walk was refused, so the admissible list is not the state's")

    print("PASS the environment resets, moves, refuses, and survives a walk")
    return 0


if __name__ == "__main__":
    sys.exit(main())
