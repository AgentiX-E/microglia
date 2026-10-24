"""Run one phase of the tau2-bench lane and write the upstream result document.

Three phases, because the lane needs three different things and a single script
with a mode flag is easier to reason about than three scripts that must agree:

  list   print the task ids of a task set, so the caller can split them
  learn  run a split with the plain agent and save what happened, so failures can
         be turned into corrections
  eval   run a split with `MicrogliaAgent` (or the plain agent) and save it

The output is upstream's own `results.json`, which `packages/eval/src/l4.ts` already
knows how to read in both of its storage forms. Nothing here re-implements scoring:
tau2's evaluator decides the reward, and this script only decides which tasks and
which agent.

Everything that can be decided without running is decided in TypeScript
(`packages/eval/src/tau2.ts`): the split, the corrections, and the argv itself. What
is left here is the part that must touch tau2.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

from tau2.registry import registry
from tau2.run import get_tasks, run_tasks


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="tau2 phase runner for the microglia L4 lane")
    parser.add_argument("--domain", default="retail")
    parser.add_argument("--phase", choices=["list", "learn", "eval"], required=True)
    parser.add_argument("--agent", default="llm_agent")
    parser.add_argument("--trials", type=int, default=1)
    parser.add_argument("--out", required=True)
    parser.add_argument("--tasks", default="")
    parser.add_argument("--memory-url", default="")
    parser.add_argument("--max-steps", type=int, default=100)
    parser.add_argument("--seed", type=int, default=300)
    return parser.parse_args(argv)


def task_ids(domain: str, wanted: list[str]) -> list[str]:
    tasks = get_tasks(domain, wanted or None)
    if wanted and len(tasks) != len(wanted):
        found = {task.id for task in tasks}
        missing = [task for task in wanted if task not in found]
        raise SystemExit(f"tau2-task-missing:{','.join(missing)}")
    return [task.id for task in tasks]


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    wanted = [entry for entry in args.tasks.split(",") if entry]

    if args.phase == "list":
        ids = task_ids(args.domain, wanted)
        with open(args.out, "w", encoding="utf-8") as stream:
            json.dump({"domain": args.domain, "tasks": ids}, stream)
        print(f"[tau2] {len(ids)} task(s) in {args.domain}")
        return 0

    if args.agent == "microglia_agent":
        # Registering under the same name `run_tasks` is asked to look up. The
        # registry refuses a duplicate, so a second registration in one process is
        # a bug rather than something to shrug at.
        from microglia_agent import MicrogliaAgent

        if "microglia_agent" not in registry.get_agents():
            registry.register_agent(MicrogliaAgent, "microglia_agent")
    if args.memory_url:
        os.environ["MICROGLIA_MEMORY_URL"] = args.memory_url
    os.environ.setdefault("MICROGLIA_DOMAIN", args.domain)

    model = os.environ.get("TAU_MODEL", "deepseek/deepseek-chat")
    tasks = get_tasks(args.domain, wanted or None)
    if not tasks:
        raise SystemExit("tau2-no-tasks")
    print(f"[tau2] {args.phase}: {len(tasks)} task(s), {args.trials} trial(s), agent={args.agent}", file=sys.stderr)

    results = run_tasks(
        domain=args.domain,
        tasks=tasks,
        agent=args.agent,
        user="user_simulator",
        llm_agent=model,
        llm_user=model,
        num_trials=args.trials,
        max_steps=args.max_steps,
        save_to=args.out,
        console_display=False,
        max_concurrency=int(os.environ.get("TAU_CONCURRENCY", "4")),
        seed=args.seed,
    )
    simulations = getattr(results, "simulations", None)
    print(
        json.dumps(
            {
                "phase": args.phase,
                "out": args.out,
                "tasks": len(tasks),
                "trials": args.trials,
                "simulations": len(simulations) if simulations is not None else None,
                "agent": args.agent,
                "memory_url": args.memory_url,
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
