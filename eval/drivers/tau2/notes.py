"""R206 — the same task twice: a note distilled from a failed attempt, carried one attempt forward.

## What this module is, and what it is not

It is **the material**, not the retrieval. R92 through R205 all served a *block the store rendered* and the
variation was about how much of it to say (R123, R151, R201) or how to say it (R204). The largest published
effect in this literature is a statement about none of those: *More Memory, Worse Agents* measures 49.0 on
stored lessons, 53.5 on raw logs and 59.9 on a summary of the attempt that just failed, on the same tasks — the
material that wins is a sentence about **this** attempt, and it does not survive the task.

So there is no store here, no cross-task retrieval and no facade. The sidecar is this file: the runner writes
`{key: {note, attempt, reward}}` after each round, the agent reads `{note}` at the start of the next one, and
nothing else reads it. A file rather than a service because the two writers are already the same process — the
runner drives `run_tasks` and the agent runs inside it — and a round boundary the runner owns is the one
ordering guarantee a thread pool cannot give.

## The key, and why it is no longer the only identity

The agent is never told which task it is in (R136), so R206 bound the note to the text of the request that
opened the episode. The runner takes it from the simulation's first user message, the agent from the message τ²
handed it, and **both call `note_key`**: an identity defined in one place cannot drift the way a prefix match
between two normalisations does. `keyed_by_task` is what makes a collision visible instead of silent — two task
ids that reduce to one key are counted, and the count travels into the artefact.

R206a measured that key on 168 same-task pairs and it does not identify a task: exact reuse was 0.006, and two
retail tasks can share one scenario, so the nearest text to a paraphrase of task 5 was sometimes task 9's
opening (`eval/verifiers/opening_stability.py`, `NOT_SEPARABLE`). R207 therefore moves the identity from the
message to the **file**: the workflow runs one task per invocation, the sidecar declares `scope: {kind: task,
task: T}`, and the agent serves the file's single entry on a key miss — but *only* when the file declares one
task. `lookup` returns which of the two identities produced the note, because "the text matched" and "the file
was pointed at this task" are different mechanisms and only the second is this arm's.

A sidecar that declares one task and holds an entry for a *different* one is the cross-task defect wearing this
arm's clothes: `lookup` serves nothing rather than serving a neighbour's note, and the count of that state is in
the artefact. `trajectories.json` is the failed attempt each note was distilled from, written beside the sidecar
for one reason only — specificity is a property of a corpus, and one invocation sees one task, so the
cross-task share can only be computed after the tasks are merged (`note_pilot.py`).

## The three refusals

A note is a sentence about a failure. Three things can go wrong and each has its own counter, because a run
whose notes are mostly empty cannot quote its coverage as the arm's own:

  * the summariser declines (`NONE`) — the arm's gate, exactly as R204's refusal was;
  * the provider fails — the note does not exist and the arm reports an unreachable summariser, not a silence;
  * the file cannot be read — the agent serves nothing and records the problem, rather than treating a
    corrupted sidecar as "no note was ever written", which is the collapse this repository has repaired ten
    times.

No imports beyond the standard library, so the self-check runs without a provider, a harness, or a network.

Run: `python3 eval/drivers/tau2/notes.py --self-test`
"""

from __future__ import annotations

import json
import os
import re
import sys

SCHEMA = "microglia.notes/2"

#: The failed attempts beside the notes. A second document rather than a second field, because the sidecar is
#: read by the agent on every turn and the attempts must never be: a sentence is 40 words and an attempt is
#: 2,000 characters, and a reader that could confuse the two is a treatment nobody registered.
TRAJECTORIES_SCHEMA = "microglia.notes-trajectories/1"

#: How much of the opening message identifies the task. Long enough that two retail tasks cannot share it
#: (their openings differ in the first twenty words), short enough that a sidecar of 160 entries stays small.
KEY_CHARS = 500

#: One sentence is ~25 tokens; a paragraph is 4× that. The ceiling is what makes "one sentence" a thing the
#: bill can be read as rather than a hope, and it is the same ceiling R204's transient arm used.
NOTE_MAX_CHARS = 400
NOTE_MAX_TOKENS = 96
NOTE_TIMEOUT_S = 30.0

#: How much of the failed attempt the summariser is shown. R88's measurement: 700 characters bounds a trace
#: statement and a correction is a question plus an answer, so 2,000 is the smallest ceiling that holds a
#: retail failure (the user's complaint, the wrong call, and the tool's answer) without a second call.
TRAJECTORY_CHARS = 2_000

#: How much of the evaluator's verdict the summariser is shown. R208: the trajectory says what the agent did and
#: the verdict says what was wrong with it, and a summariser shown only the first has to infer the second — which
#: is the difference between a note that names the mistake and one that narrates the conversation. Six hundred
#: characters is the four check families at their natural length: a database verdict, one unmet communicate check,
#: one natural-language assertion, and the reward.
VERDICT_CHARS = 600

#: The names a check's own description arrives under. τ² spells them per check type — `info` for a communicate
#: check, `nl_assertion` for a natural-language one, `env_type` for an environment assertion — and a reader that
#: knew one name would print `not met:` with nothing after it, which is a verdict the summariser cannot use.
CHECK_TEXT_KEYS = ("info", "nl_assertion", "env_type", "action", "name", "description")

#: The names a check's outcome arrives under, for the same reason: `met` on three of the four families and
#: `action_match` on the fourth. A reader that knew only `met` would drop every action check silently, and a
#: verdict missing a family looks exactly like a verdict that family had nothing to say about.
CHECK_STATE_KEYS = ("met", "match", "action_match")

#: The instruction. The three properties the material is supposed to have are stated as requirements and each
#: one is checked against the artefact: *specific* (it names what went wrong, not that something did), *about
#: this task* (no restatement of the request), and *actionable* (an imperative for the next attempt). `NONE` is
#: allowed because a gate that cannot decline is a gate that cannot be measured.
NOTE_SYSTEM = (
    "You read one failed attempt at a task by a customer-service agent and write the one sentence of advice "
    "the agent should have read before starting it. Name the specific thing that went wrong: the policy it "
    "broke, the argument it passed wrongly, the step it skipped, or the state it left behind. Write it as an "
    "imperative for the next attempt at the same task. Answer exactly NONE only if the attempt shows no "
    "actionable mistake. Otherwise answer one imperative sentence of at most 40 words, with no preamble, no "
    "quotes, and no restatement of the request."
)

#: Words shorter than this are not entities: they are articles, units and the two-letter codes a retail
#: order id is not. The specificity check below needs a token that can identify *this* task, and `to` has
#: never identified one.
ENTITY_CHARS = 4


# --------------------------------------------------------------------------- the key


def note_key(text) -> str:
    """The identity of a task, from the request that opened it.

    Whitespace is collapsed and the ends are stripped, because τ² hands the runner the message it stored and
    the agent the message it was given, and the two differ by trailing spaces often enough to matter. Nothing
    else is normalised: a caseless key would merge two retail tasks whose openings differ only in a product
    name, and a key built from the instruction *hash* could not be read by a human debugging a sidecar.
    """
    if not isinstance(text, str):
        return ""
    collapsed = " ".join(text.split())
    return collapsed[:KEY_CHARS]


def scope_of(notes) -> dict:
    """Which task a sidecar describes: `{"kind": "task", "task": "5"}`, `{"kind": "none"}`, or broken.

    R207's whole mechanism is this field. The runner runs one task per invocation and declares it, so the agent
    can serve the file's entry without knowing which task τ² put it in — the identity the harness never gives it
    and the message text cannot carry. `many` is a legitimate value for a merge of several tasks' files, and it
    is exactly the state in which the identity is unknown again, so it serves nothing.

    `broken` is separate from `none` on purpose: a scope that claims to name a task and does not is a writer
    defect, and collapsing it into `none` would make a mis-scoped sidecar look like a store-free one.
    """
    scope = notes.get("scope") if isinstance(notes, dict) else None
    if not isinstance(scope, dict):
        return {"kind": "none"}
    kind = scope.get("kind")
    if kind == "task":
        task = scope.get("task")
        if isinstance(task, str) and task.strip() != "":
            return {"kind": "task", "task": task.strip()}
        return {"kind": "broken", "reason": "kind is 'task' and task is empty"}
    if kind in ("none", "many"):
        listed = scope.get("tasks")
        return {"kind": kind, "tasks": [str(entry) for entry in listed] if isinstance(listed, list) else []}
    return {"kind": "broken", "reason": f"kind is {kind!r}"}


def set_scope(notes, task: str) -> dict:
    """Declare the one task this sidecar describes, in the document the caller then saves.

    A path reused for a second task is refused rather than rebound. That is not defensive: the file is the
    identity in this arm, so a runner that pointed task 9 at task 5's file would serve task 5's sentence to task
    9 and every reading of the phase would be about the wrong task — the exact defect R206 measured, arriving
    by the one route R207 opens. The workflow gives each task its own path, so this fires on an operator error
    and not on a normal run.
    """
    task = str(task or "").strip()
    if task == "":
        raise SystemExit("tau2-notes-scope-empty")
    if not isinstance(notes, dict) or notes.get("schema") != SCHEMA:
        notes = empty()
    held = scope_of(notes)
    if held["kind"] == "task" and held["task"] != task:
        raise SystemExit(f"tau2-notes-scope-changed:{held['task']}->{task}")
    notes["scope"] = {"kind": "task", "task": task}
    return notes


def _note_in(entry) -> str:
    """The sentence in one entry, or `""`. One reader, because four places ask this question."""
    note = entry.get("note") if isinstance(entry, dict) else None
    return note if isinstance(note, str) and note.strip() != "" else ""


def _attempt_in(entry) -> int:
    attempt = entry.get("attempt") if isinstance(entry, dict) else None
    return attempt if isinstance(attempt, int) and not isinstance(attempt, bool) else 0


def lookup(notes, text) -> "tuple[str, str]":
    """`(note, how)`, where `how` is `"key"`, `"task"` or `"none"`.

    Two identities in one function because they are one lookup: the key first, because it is a statement about
    *this* request, and the file's scope second, because that is the identity the harness can actually give. A
    note that arrived under the key and a note served because the file names the task are different mechanisms,
    and R207's first prediction is about the second one — a counter that merged them could not tell the new
    binding from R206's broken one.

    The fallback serves the entry from the **latest** attempt: a task that failed twice has two sentences (or
    one, rewritten), and the one written after the most recent failure is the one about the attempt before this
    one. Entries are compared by `attempt` rather than by insertion order, because a dictionary's order is a
    property of the writer and the attempt number is a property of the run.
    """
    entries = notes.get("notes") if isinstance(notes, dict) else None
    if not isinstance(entries, dict):
        return "", "none"
    scope = scope_of(notes)
    task = scope["task"] if scope["kind"] == "task" else ""
    if task != "":
        # A file that declares this task and holds an entry for another one is checked before the key, not after:
        # either the runner wrote two tasks into one sidecar or the file was pointed at the wrong task, and in
        # both cases the *whole file* has lost its identity — including the entry whose key happens to match,
        # which may be the other task's attempt at the same opening. That is the cross-task mechanism R41 and
        # R204 measured, and answering nothing is the only answer that cannot be wrong.
        for entry in entries.values():
            held = entry.get("task") if isinstance(entry, dict) else None
            if isinstance(held, str) and held.strip() != "" and held.strip() != task:
                return "", "none"
    key = note_key(text)
    if key != "":
        found = _note_in(entries.get(key))
        if found:
            return found, "key"
    if task == "":
        return "", "none"
    best: "tuple[int, str] | None" = None
    for entry in entries.values():
        note = _note_in(entry)
        if note == "":
            continue
        attempt = _attempt_in(entry)
        if best is None or attempt >= best[0]:
            best = (attempt, note)
    return ("", "none") if best is None else (best[1], "task")


def note_of(notes, text) -> str:
    """The note written for this task's last failed attempt, or an empty string.

    `""` is five facts — no key, no entry, an entry whose `note` is not a string, a file that names no task, a
    file that names a different task than its own entries — and the caller counts them through `lookup`'s second
    return, because "the agent served nothing" and "the file had nothing for this task" are different sentences
    about the treatment.
    """
    return lookup(notes, text)[0]


# --------------------------------------------------------------------------- the sidecar


def empty() -> dict:
    """A sidecar with nothing in it. `kind: none` is the scope of a file that names no task.

    The scope is part of the empty document rather than added by the writer, because `load` returns this for a
    file that does not exist yet (round one) and the agent must be able to ask `scope_of` the same question of
    every document it is handed.
    """
    return {"schema": SCHEMA, "notes": {}, "collisions": {}, "scope": {"kind": "none"}}


def load(path: str):
    """`(notes, problem)`. A missing file is round one, not a fault; anything else is a problem.

    The distinction is the whole point of returning a pair. `{}` for a corrupted file would make a treatment
    that never ran look like one that ran and found nothing, and every reading of the arm would divide by a
    population the sidecar had lost. The caller serves no note *and* records the problem, which is a state the
    artefact can be graded against.
    """
    if path == "":
        return empty(), None
    if not os.path.exists(path):
        return empty(), None
    try:
        with open(path, encoding="utf-8") as stream:
            document = json.load(stream)
    except Exception as error:  # noqa: BLE001 - any unreadable sidecar means "no notes"
        return empty(), f"{type(error).__name__}: {error}"
    if not isinstance(document, dict) or document.get("schema") != SCHEMA:
        found = document.get("schema") if isinstance(document, dict) else type(document).__name__
        return empty(), f"schema is {found!r}, expected {SCHEMA!r}"
    if not isinstance(document.get("notes"), dict):
        return empty(), "`notes` is not an object"
    document.setdefault("collisions", {})
    # A document written by a reader that did not know about scopes describes no task, which is the safe reading:
    # the key is still consulted and the fallback does not fire. Absent is not the same as broken, and only
    # `scope_of`'s `broken` state is a writer defect.
    document.setdefault("scope", {"kind": "none"})
    return document, None


def save(path: str, notes) -> None:
    """Write the sidecar in one rename, so a reader never sees half a round.

    The runner is the only writer and it writes between rounds, so a torn file is unlikely — but a run that
    dies mid-write must not leave the *next* round reading a truncated document, and the next round is the
    only reader there is.
    """
    directory = os.path.dirname(os.path.abspath(path))
    os.makedirs(directory, exist_ok=True)
    scratch = f"{path}.tmp"
    with open(scratch, "w", encoding="utf-8") as stream:
        json.dump(notes, stream, indent=2, sort_keys=True)
        stream.write("\n")
    os.replace(scratch, path)


def record(notes, text, note: str, *, attempt: int, reward, task: str = "") -> dict:
    """Add one note to the sidecar and return what a reader needs to grade it.

    The entry carries the attempt number and the reward it was distilled from, because the reading this arm
    produces is "the note for attempt k+1 came from attempt k's failure" and a sidecar that stored only the
    sentence could not tell that from a note written once and served four times.
    """
    key = note_key(text)
    if key == "" or note == "":
        return {"written": False, "chars": 0}
    if not isinstance(notes, dict) or notes.get("schema") != SCHEMA:
        notes = empty()
    notes["notes"][key] = {
        "note": note,
        "attempt": int(attempt),
        "reward": None if reward is None else float(reward),
        "task": str(task),
        "chars": len(note),
    }
    return {"written": True, "chars": len(note)}


def keyed_by_task(pairs) -> dict:
    """Which task ids share a key. `{}` when every key names exactly one task.

    A collision is not a cosmetic problem: the note written for one task would be served to another, which is
    the *cross-task* mechanism R41 and R204 measured and this arm exists to not be. The runner can see it
    because it holds the task id beside the first message; the agent cannot, and that is why the check is
    here rather than where the note is read.
    """
    groups: dict = {}
    for task, text in pairs or []:
        key = note_key(text)
        if key == "":
            continue
        groups.setdefault(key, [])
        if str(task) not in groups[key]:
            groups[key].append(str(task))
    return {key: sorted(tasks) for key, tasks in groups.items() if len(tasks) > 1}


# --------------------------------------------------------------------------- the attempts beside the notes


def trajectories_path(path: str) -> str:
    """Where one sidecar's failed attempts are written. Beside it, and derived, so it cannot be forgotten."""
    return f"{path}.trajectories.json" if path else ""


def save_trajectories(path: str, trajectories) -> int:
    """Write `{key: attempt text}` beside the sidecar, one rename, and return how many were kept.

    Kept because specificity is the arm's third gate and it needs the *other* tasks: an invocation that ran one
    task cannot compute a cross-task share, and a `share` of 1.0 from a corpus of one is a number no reader could
    reproduce. This file is what lets the builder compute it over the merged corpus without the runner having to
    invent a second arithmetic.
    """
    if path == "":
        return 0
    kept = {
        str(key): str(text)
        for key, text in (trajectories or {}).items()
        if isinstance(key, str) and key.strip() != "" and isinstance(text, str) and text.strip() != ""
    }
    directory = os.path.dirname(os.path.abspath(path))
    os.makedirs(directory, exist_ok=True)
    scratch = f"{path}.tmp"
    with open(scratch, "w", encoding="utf-8") as stream:
        json.dump({"schema": TRAJECTORIES_SCHEMA, "trajectories": kept}, stream, indent=2, sort_keys=True)
        stream.write("\n")
    os.replace(scratch, path)
    return len(kept)


def load_trajectories(path: str) -> "tuple[dict, str | None]":
    """`(trajectories, problem)`. A missing file is round one; anything else unreadable is a problem.

    Same pairing as `load`, for the same reason: `{}` for a corrupted file would make specificity a share over a
    corpus that lost its failures, and the gate that reads it would pass on nothing.
    """
    if path == "" or not os.path.exists(path):
        return {}, None
    try:
        with open(path, encoding="utf-8") as stream:
            document = json.load(stream)
    except Exception as error:  # noqa: BLE001 - any unreadable document means no attempts
        return {}, f"{type(error).__name__}: {error}"
    if not isinstance(document, dict) or document.get("schema") != TRAJECTORIES_SCHEMA:
        found = document.get("schema") if isinstance(document, dict) else type(document).__name__
        return {}, f"schema is {found!r}, expected {TRAJECTORIES_SCHEMA!r}"
    trajectories = document.get("trajectories")
    if not isinstance(trajectories, dict):
        return {}, "`trajectories` is not an object"
    return {str(key): text for key, text in trajectories.items() if isinstance(text, str)}, None


def merge_trajectories(documents) -> "tuple[dict, int]":
    """One corpus out of one per-task file each, and how many keys two tasks both produced.

    A shared key across two tasks is exactly the collision `keyed_by_task` reports inside one task, one level up:
    the attempt text of two tasks reducing to one key. It is counted rather than refused, because the reading it
    damages — specificity — is a diagnostic and not the arm's gate.
    """
    merged: dict = {}
    collisions = 0
    for document in documents or []:
        for key, text in (document or {}).items():
            if key in merged:
                collisions += 1
                continue
            merged[key] = text
    return merged, collisions




def merge_sidecars(documents) -> dict:
    """One sidecar out of one per-task file each, with the scope it now honestly has: `many`.

    The merged document is what specificity needs — a share over the corpus rather than over one task — and what
    a reader needs to see that the merge happened. A key two tasks both produced is recorded as a collision
    rather than dropped: it is the one state in which the material could cross tasks, and the gate that reads
    collisions is the gate that would otherwise be fooled by the merge.
    """
    merged = empty()
    tasks: list = []
    for document in documents or []:
        if not isinstance(document, dict):
            continue
        scope = scope_of(document)
        if scope["kind"] == "task" and scope["task"] not in tasks:
            tasks.append(scope["task"])
        for key, entry in (document.get("notes") or {}).items():
            if key in merged["notes"]:
                held = merged["notes"][key]
                pair = sorted({str((held or {}).get("task", "")), str((entry or {}).get("task", ""))})
                merged["collisions"][key] = [task for task in pair if task != ""]
                continue
            merged["notes"][key] = entry
        for key, group in (document.get("collisions") or {}).items():
            merged["collisions"].setdefault(key, group)
    merged["scope"] = {"kind": "many", "tasks": tasks} if tasks else {"kind": "none"}
    return merged




# --------------------------------------------------------------------------- the trajectory


def _field(item, name, default=None):
    if isinstance(item, dict):
        return item.get(name, default)
    return getattr(item, name, default)


def _messages_of(simulation):
    reader = _field(simulation, "get_messages")
    if callable(reader):
        try:
            messages = reader()
        except Exception:  # noqa: BLE001 - upstream shape, not our error
            return None
    else:
        messages = _field(simulation, "messages")
    return messages if isinstance(messages, list) else None


def _call_text(call) -> str:
    """One tool call as `name(key=value, …)`, which is how a reader names the argument that was wrong."""
    name = _field(call, "name")
    arguments = _field(call, "arguments")
    if not isinstance(name, str) or name == "":
        return ""
    if isinstance(arguments, str):
        return f"{name}({arguments})"
    if isinstance(arguments, dict):
        try:
            pairs = ", ".join(f"{key}={json.dumps(value)}" for key, value in sorted(arguments.items()))
        except (TypeError, ValueError):
            return name
        return f"{name}({pairs})"
    return name


def trajectory_text(simulation, ceiling: int = TRAJECTORY_CHARS) -> str:
    """The failed attempt as lines the summariser can read, or `""` when it was not readable.

    The shape is the failure, not the conversation: the user's complaint, every call the agent made with its
    arguments, every tool answer that came back wrong, and the last thing either side said. An attempt of
    thirty turns truncated at 2,000 characters keeps its opening and its end — the two places a retail failure
    is visible — because the middle of a successful-looking conversation is the part that did not fail.
    """
    messages = _messages_of(simulation)
    if not messages:
        return ""
    lines = []
    for message in messages:
        role = _field(message, "role")
        if role in ("user", "human"):
            content = _field(message, "content")
            if isinstance(content, str) and content.strip():
                lines.append(f"USER: {' '.join(content.split())}")
                continue
        if role in ("assistant", "agent"):
            content = _field(message, "content")
            if isinstance(content, str) and content.strip():
                lines.append(f"AGENT: {' '.join(content.split())}")
            for call in _field(message, "tool_calls") or []:
                text = _call_text(call)
                if text:
                    lines.append(f"  CALL {text}")
            continue
        if role == "tool":
            content = _field(message, "content")
            error = _field(message, "error")
            if error is True:
                lines.append(f"  FAILED {' '.join(str(content).split())[:200]}")
            elif isinstance(content, str) and content.strip():
                lines.append(f"  RESULT {' '.join(content.split())[:200]}")
    if not lines:
        return ""
    body = "\n".join(lines)
    if len(body) <= ceiling:
        return body
    # The opening and the end, in the proportion a reader needs: who asked for what, and how it ended. A
    # single truncation would keep only the request and hide the mistake the note is supposed to name.
    half = max(1, (ceiling - 40) // 2)
    return f"{body[:half]}\n…\n{body[-half:]}"


def _arguments_text(arguments, ceiling: int = 80) -> str:
    """An action's arguments as `key=value, …`, bounded — the part of a failure a note can actually use.

    `cancel_pending_order(order_id=W2378156)` is the difference between a note that says "cancel the right order"
    and one that says "the right action was not taken"; the arguments are also the only place a retail failure's
    entity appears in the evaluator's own words.
    """
    if not isinstance(arguments, dict) or not arguments:
        return ""
    parts = []
    for key in list(arguments)[:4]:
        value = arguments[key]
        text = value if isinstance(value, str) else str(value)
        text = " ".join(text.split())
        if len(text) > 40:
            text = text[:37] + "..."
        parts.append(f"{key}={text}")
    return ", ".join(parts)[:ceiling]


def _action_text(entry) -> str:
    """An action check's action as `name(arguments)`, from either wire shape.

    τ² hands this process an `Action` object and an artefact holds `{"name": …, "arguments": {…}}`. The first
    version of this reader wanted a string and therefore rendered `ACTION not met` for every failure in the bank —
    85 failures sharing one line, which is a material with a cost and no content.
    """
    action = _field(entry, "action")
    if isinstance(action, str) and action.strip():
        return " ".join(action.split())
    if isinstance(action, dict):
        name = _field(action, "name")
        if isinstance(name, str) and name.strip():
            arguments = _arguments_text(_field(action, "arguments"))
            name = " ".join(name.split())
            return f"{name}({arguments})" if arguments else name
    return ""


def _check_line(kind: str, entry):
    """One check as `(line, met)`, or `("", None)` when it carries no verdict.

    Both spellings of the outcome are read — τ²'s `RewardInfo` says `met` on three of the four check families and
    `db_match` on the fourth — and a check with no outcome is dropped rather than guessed at, because a line that
    invented `met` would tell the summariser the opposite of what the evaluator said.

    The detail is the action when there is one, else the first check text τ² has for the family, and the
    evaluator's `justification` is appended when it says something the detail does not. That field is the richest
    sentence in the artefact — "the agent told the user there are 12 options, not 10" — and dropping it left the
    summariser with `ASSERTION not met` and nothing to act on.
    """
    met = None
    for key in CHECK_STATE_KEYS:
        value = _field(entry, key)
        if isinstance(value, bool):
            met = value
            break
    if not isinstance(met, bool):
        return "", None
    detail = _action_text(entry)
    if detail == "":
        for key in CHECK_TEXT_KEYS:
            value = _field(entry, key)
            if isinstance(value, str) and value.strip():
                detail = " ".join(value.split())[:200]
                break
    justification = _field(entry, "justification")
    if isinstance(justification, str) and justification.strip():
        text = " ".join(justification.split())[:200]
        if text and text not in detail:
            detail = f"{detail} \u2014 {text}" if detail else text
    return f"{kind} {'met' if met else 'not met'}" + (f": {detail}" if detail else ""), met


def verdict_text(simulation, ceiling: int = VERDICT_CHARS) -> str:
    """What the evaluator said was wrong, as lines the summariser can read, or `""` when it said nothing.

    R208. `trajectory_text` is the agent's side of the failure and this is the evaluator's: the reward, the
    database verdict, and every assertion or communicate check with its outcome. They are different documents
    about the same episode, and R207's notes were written from the first alone — which is why a note could
    describe a conversation accurately and still not name the one thing that made it fail.

    The head is kept on truncation, not both ends as the trajectory keeps them: the first line is the reward and
    the second the database verdict, and a tail would keep whichever assertion the evaluator happened to append
    last. `""` is not an error — an episode graded by a stock judge carries no `reward_info` — so the caller
    counts it rather than treating it as a failure.
    """
    info = _field(simulation, "reward_info")
    if info is None:
        return ""
    lines = []
    reward = reward_of(simulation)
    if reward is not None:
        lines.append(f"REWARD {reward:g}")
    db = _field(info, "db_check")
    if db is not None:
        match = _field(db, "db_match")
        if isinstance(match, bool):
            lines.append(f"DB CHECK {'met' if match else 'not met'}")
    # Head first, then the checks that failed, then the ones that passed: a block cut off at the ceiling that shows
    # twelve `ACTION met` lines and loses the one `not met` tells the summariser the attempt was fine.
    failing: list = []
    passing: list = []
    for kind, key in (
        ("ENV", "env_assertions"),
        ("ACTION", "action_checks"),
        ("COMMUNICATE", "communicate_checks"),
        ("ASSERTION", "nl_assertions"),
    ):
        entries = _field(info, key)
        if not isinstance(entries, list):
            continue
        for entry in entries:
            line, met = _check_line(kind, entry)
            if line:
                (passing if met else failing).append(line)
    kept: list = []
    for line in lines + failing + passing:
        candidate = "\n".join(kept + [line])
        if len(candidate) > ceiling and kept:
            break
        kept.append(line)
    if not kept:
        return ""
    return "\n".join(kept)[:ceiling]


#: How much of the verdict is served verbatim when the verdict *is* the material. The same ceiling the
#: summariser was shown, because the point of R213 is that the two arms receive the same evaluator text and
#: differ only in whether a model was asked to rewrite it.
VERDICT_NOTE_CHARS = 600


def note_from_verdict(explained: str, ceiling: int = VERDICT_NOTE_CHARS) -> str:
    """The evaluator's verdict as the note itself: the material without the summariser.

    R213's arm. Every note this lane has written so far was a model's paraphrase of a failure, and the paraphrase
    was the step where the sentence stopped being about the requirement that failed — `memory_debit` measures the
    material naming 48.8% of the unmet requirements of the attempt it came from. The verdict already names 100%
    of them, in the evaluator's words, at 447 characters: the length the paraphrase spent 96 tokens approaching.

    The `REWARD` line is dropped because a scalar is not an instruction; the met lines are kept because the
    material's measured harm is a *break* — a requirement the attempt had met and the next attempt missed — and a
    note that lists what already passed is the only part of it that could prevent one.
    """
    if not isinstance(explained, str):
        return ""
    kept = []
    for line in explained.splitlines():
        if line.strip() == "" or line.startswith("REWARD "):
            continue
        if kept and len("\n".join(kept + [line])) > ceiling:
            break
        kept.append(line)
    return "\n".join(kept)[:ceiling]


def verdict_writer():
    """The note *is* the verdict: no model call, no prompt, no tokens.

    R208 showed the verdict to a summariser and the sentence improved; R212 showed the sentence still named under
    half of the requirements that failed. This arm removes the step in between. `state` is `"sentence"` when a
    verdict existed and `"refused"` when the evaluator explained nothing, which is the same vocabulary the model
    arm uses so a round's counters mean the same thing in either.
    """

    def write(trajectory: str, verdict: str = ""):
        note = note_from_verdict(verdict)
        return (note, "sentence", None, 0) if note else ("", "refused", None, 0)

    return write


def note_prompt(trajectory: str, verdict: str = "") -> str:
    """The user turn: the attempt, quoted as data, and — when one is offered — the verdict, quoted too.

    One block rather than two messages, and quoted, because everything inside it is text a model wrote in a
    previous episode — the same rule R204's guidance prompt applies to records. With `verdict` empty the bytes are
    exactly R207's, which is what keeps a verdict run comparable to the pilot it extends rather than merely
    similar to it.
    """
    clipped = trajectory.strip()[:TRAJECTORY_CHARS]
    prompt = f"ATTEMPT\n<<<\n{clipped}\n>>>\n"
    explained = verdict.strip()[:VERDICT_CHARS]
    if explained:
        prompt += f"VERDICT\n<<<\n{explained}\n>>>\n"
    return prompt


# --------------------------------------------------------------------------- the reply


#: The provider's own reasoning switch, and the reason it is not optional. `deepseek-flash` answers in thinking
#: mode by default and bills the reasoning against `max_tokens`; the note budget is 96 tokens for one sentence, so a
#: call that leaves thinking on spends the whole budget before writing anything and returns an empty message.
#:
#: R208's ablation measured **96.0 completion tokens per call** across 85 failures — every call at the ceiling — and
#: `sentence_of` read the empty answer as the model declining. R206a, R207 and R208 all reported "the summariser
#: refused" on that evidence. It was a truncation, and the note lane's low yield was never a judgement about the
#: material. The driver already knew: its agent and simulator calls pass this body, and the note call was the one
#: copy that did not.
NOTE_EXTRA_BODY = {"thinking": {"type": "disabled"}}


def call_note_model(prompt: str, model: str = ""):
    """One summariser call: `(sentence, state, counts)` with state in {sentence, refused, truncated, failed}.

    One function rather than one per caller, because the defect this replaces was two copies of the same call and
    the second copy had lost a keyword. `counts` carries the provider's own counters and its `finish_reason`, so a
    caller can tell a decision from a cut-off: `sentence_of` answers `""` to both, and three rounds of measurement
    were built on that ambiguity.
    """
    try:
        import litellm  # noqa: PLC0415 - τ²'s dependency, absent in the self-check

        reply = litellm.completion(
            model=model or note_model(),
            messages=[
                {"role": "system", "content": NOTE_SYSTEM},
                {"role": "user", "content": prompt},
            ],
            temperature=0,
            max_tokens=NOTE_MAX_TOKENS,
            timeout=NOTE_TIMEOUT_S,
            extra_body=NOTE_EXTRA_BODY,
        )
    except Exception as error:  # noqa: BLE001 - any failure means "no note"
        return "", "failed", {"error": f"{type(error).__name__}: {error}"}
    usage = getattr(reply, "usage", None)
    counts = {
        "prompt": getattr(usage, "prompt_tokens", 0) or 0,
        "completion": getattr(usage, "completion_tokens", 0) or 0,
    }
    choices = getattr(reply, "choices", None)
    finish = ""
    if isinstance(choices, list) and choices:
        finish = str(getattr(choices[0], "finish_reason", "") or "")
    counts["finish"] = finish
    sentence = sentence_of(reply)
    if sentence:
        return sentence, "sentence", counts
    # A cut-off call is not a refusal: the model was still thinking when the budget ran out and never got to
    # answer. Counting it as `NONE` is how a truncation becomes a decision.
    if finish == "length":
        return "", "truncated", counts
    return "", "refused", counts


def sentence_of(reply) -> str:
    """The sentence in a provider reply, or `""` when the model declined.

    The parser R204's transient arm uses, kept in one place because a second copy is the copy that drifts the
    first time the refusal token changes. `NONE` is *not* a failure: it is the gate doing its job, and a run
    that counted it as an error would report an unreachable provider for a model that behaved exactly as asked.
    """
    choices = getattr(reply, "choices", None)
    if not isinstance(choices, list) or not choices:
        return ""
    message = getattr(choices[0], "message", None)
    content = getattr(message, "content", None)
    if not isinstance(content, str):
        return ""
    text = " ".join(content.split())
    if text == "" or text.strip(" .").upper() == "NONE":
        return ""
    return text[:NOTE_MAX_CHARS]


def note_model(default: str = "") -> str:
    """The summariser's model: the arm's own unless a dispatch names another.

    Defaulted to the arm's model for R204's reason — the mechanism is "the agent that is being measured reads
    its own failure and writes itself a note", and a stronger summariser would be a different experiment.
    """
    override = os.environ.get("MICROGLIA_NOTE_MODEL", "").strip()
    return override or default or os.environ.get("TAU_MODEL", "deepseek/deepseek-flash").strip()


# --------------------------------------------------------------------------- specificity


def entities(text: str) -> set:
    """The tokens of a text that could identify it: lowercase words of `ENTITY_CHARS` or more.

    Digits and punctuation are kept inside the token, because `W2378156` and `#W2378156` are the same order and
    `paypal` and `pay-pal` are the same method; splitting on anything but whitespace would turn one entity into
    two and inflate the share this check reports.
    """
    words = re.split(r"\s+", (text or "").lower())
    return {word.strip(".,;:!?()[]{}\"'") for word in words if len(word.strip(".,;:!?()[]{}\"'")) >= ENTITY_CHARS}


def specificity(notes, trajectories) -> dict:
    """Whether each note names something only its own task's failure contains.

    The registration's third prediction, made checkable: a summariser that copied the request instead of
    reading the failure produces a note whose entities are every task's, and the share is what tells the two
    apart. `own-only` is computed against the *other* tasks in the same phase, so it is a property of this
    corpus rather than of English.
    """
    per_task: dict = {key: entities(text) for key, text in (trajectories or {}).items()}
    counts: dict = {}
    for words in per_task.values():
        for word in words:
            counts[word] = counts.get(word, 0) + 1
    graded = 0
    specific = 0
    lengths = []
    for key, entry in ((notes or {}).get("notes") or {}).items():
        note = entry.get("note") if isinstance(entry, dict) else None
        if not isinstance(note, str) or note == "":
            continue
        own = entities(note)
        if not own:
            continue
        graded += 1
        lengths.append(len(own))
        # An entity that appears in this task's failure and in no other task's. `counts` is over *all* tasks in
        # the phase, so a word that appears in two is not evidence about either.
        if any(word in per_task.get(key, set()) and counts.get(word, 0) == 1 for word in own):
            specific += 1
    return {
        "graded": graded,
        "specific": specific,
        # A share needs a corpus. `specific` is computed against the *other* tasks in the phase, so a phase of one
        # task — which is every R207 invocation — would report 1.0 for every note by construction: the note's own
        # task is trivially the only task, and its entities are trivially unique. R207 computes this again over
        # the merged corpus (`note_pilot.merge_trajectories` + this function), and the null here is what stops the
        # per-invocation number from being quoted by mistake.
        "share": (specific / graded) if graded and len(per_task) >= 2 else None,
        "reason": None
        if len(per_task) >= 2
        else f"a corpus of {len(per_task)} task(s) has no cross-task share",
        "tasks": len(per_task),
        "entitiesPerNote": (sum(lengths) / len(lengths)) if lengths else None,
    }


def reward_of(simulation):
    """The reward τ²'s evaluator attached, or `None` when it attached none.

    `bool` is excluded on purpose: `True` would enter as a pass and a phase whose rewards were all flags would
    read as a perfect one. `None` is not zero — an unscored episode is an infrastructure fact and the note
    census counts it apart, exactly as `toPassAtK` leaves it out of the denominator.

    Read through `_field`, so the JSON shape an artefact holds answers exactly as the object τ² hands this process
    does. R208 found the gap: `verdict_text` is called on both shapes and the reward line vanished on one of them.
    """
    info = _field(simulation, "reward_info")
    reward = _field(info, "reward")
    if isinstance(reward, bool) or not isinstance(reward, (int, float)):
        return None
    return float(reward)


def first_user_text(simulation) -> str:
    """The message that opened this episode, or `""`.

    Both shapes: τ² hands this process message objects, and the same messages arrive as JSON when a document is
    read back. A reader that knew only one would resolve nothing on the other and report an instrument fault.

    One reader for the two callers that need it — the boundary's task resolution (R136) and the note's key
    (R206) — because the key is only symmetric between the runner and the agent while both are reading the same
    string with the same normalisation.
    """
    for message in _messages_of(simulation) or []:
        if _field(message, "role") not in ("user", "human"):
            continue
        content = _field(message, "content")
        if isinstance(content, str) and content.strip():
            return content
        return ""
    return ""



def note_round(simulations, path: str, attempt: int, summarize, trajectories, verdict: bool = False) -> dict:
    """Distil every failed attempt of one round into the sidecar the next round reads.

    Only failures are distilled, and only a failure's *own* trajectory is shown: the reward is the runner's to
    know, which is why this cannot live in the agent, and the material is the attempt rather than a summary of
    the store, which is the one thing that separates this arm from R204's.

    `verdict` is R208's material and it is off by default, because turning it on changes the arm: the summariser
    is shown what the evaluator said as well as what the agent did. What it does *not* change is the schedule, the
    model, or the selection of failures, which is what makes a verdict round comparable to the pilot before it.
    `verdicts` counts the failures the evaluator actually explained, so a round that asked for the verdict and got
    none is visible as that rather than as a summariser mysteriously doing no better.

    `trajectories` accumulates the last failed attempt per key so the specificity check can be computed over the
    phase rather than guessed at from one round.
    """
    document, problem = load(path)
    counters = {
        "round": attempt,
        "episodes": 0,
        "failed": 0,
        "written": 0,
        "refused": 0,
        "truncated": 0,
        "providerFailures": 0,
        "unscored": 0,
        "unreadable": 0,
        "promptChars": 0,
        "noteChars": 0,
        # R208. Whether this round showed a verdict at all, how many failures came with one, and the characters
        # that block added to the prompt — the last is the part of the material's cost that is not a sentence.
        "verdict": bool(verdict),
        "verdicts": 0,
        "verdictChars": 0,
        "problem": problem,
        "firstProviderFailure": None,
    }
    for simulation in simulations or []:
        counters["episodes"] += 1
        text = first_user_text(simulation)
        reward = reward_of(simulation)
        if reward is None:
            counters["unscored"] += 1
            continue
        if reward >= 1.0:
            continue
        counters["failed"] += 1
        trajectory = trajectory_text(simulation)
        if trajectory == "":
            counters["unreadable"] += 1
            continue
        if text:
            trajectories[note_key(text)] = trajectory
        explained = verdict_text(simulation) if verdict else ""
        if explained:
            counters["verdicts"] += 1
            counters["verdictChars"] += len(explained)
        sentence, state, detail, prompt_chars = summarize(trajectory, explained)
        counters["promptChars"] += prompt_chars
        if state == "failed":
            counters["providerFailures"] += 1
            if counters["firstProviderFailure"] is None:
                counters["firstProviderFailure"] = detail
            continue
        if state == "truncated":
            # Measured apart from a refusal: a call cut off at the ceiling never reached an answer, so it is a
            # budget fact rather than a judgement about the attempt. R208's 96.0 tokens per call were all this.
            counters["truncated"] += 1
            continue
        if state == "refused":
            counters["refused"] += 1
            continue
        written = record(
            document,
            text,
            sentence,
            attempt=attempt,
            reward=reward,
            task=str(getattr(simulation, "task_id", "") or ""),
        )
        if written["written"]:
            counters["written"] += 1
            counters["noteChars"] += written["chars"]
    collisions = keyed_by_task([(getattr(s, "task_id", ""), first_user_text(s)) for s in simulations or []])
    if collisions:
        document["collisions"] = collisions
    save(path, document)
    counters["collisions"] = len(collisions)
    return counters


def merge_rounds(paths, out: str, rounds: int) -> None:
    """One `results.json` out of `rounds` documents, with each round written as that trial's index.

    The merged document is what every downstream reader already understands: `parseTauResults` groups by
    `(task_id, trial)` and refuses a duplicate, so a merge that left every round at trial 0 would be refused
    rather than silently scored as forty tasks with four identical attempts. It also refuses an unknown task, so
    the merged `tasks` list is taken from the first round and every later simulation is checked against it.
    """
    base = None
    merged = []
    for index, path in enumerate(paths):
        with open(path, encoding="utf-8") as stream:
            document = json.load(stream)
        if base is None:
            base = document
        known = {
            str((entry or {}).get("id"))
            for entry in (base.get("tasks") or [])
            if isinstance(entry, dict)
        }
        for entry in document.get("simulations") or []:
            if not isinstance(entry, dict):
                continue
            task = str(entry.get("task_id"))
            if known and task not in known:
                raise SystemExit(f"tau2-merge-unknown-task:{task}")
            entry["trial"] = index
            merged.append(entry)
    if base is None:
        raise SystemExit("tau2-merge-no-rounds")
    base["simulations"] = merged
    with open(out, "w", encoding="utf-8") as stream:
        json.dump(base, stream)
        stream.write("\n")




def merge_documents(documents) -> dict:
    """The merged grid, in memory: the union of the tasks and every simulation exactly once.

    Two refusals, and both are states a reader downstream would otherwise read as a grid:

      * one task listed by two documents — the same task simulated twice, whose rewards would enter the pairing
        twice and whose `pass^k` would be decided by whichever copy came second;
      * one `(task, trial)` pair from two documents — the same attempt counted twice, which is precisely what
        `parseTauResults` refuses on the TypeScript side. Caught here as well because the merge is the last place
        that knows which file a duplicate came from.

    The task list is the union in first-seen order, and every other key of the first document is kept: `domain`
    and the release belong to the arm rather than to the task, and rebuilding the document would drop them.
    """
    base = None
    merged: list = []
    tasks: dict = {}
    pairs: set = set()
    for document in documents or []:
        if not isinstance(document, dict):
            raise SystemExit(f"tau2-merge-bad-document:{type(document).__name__}")
        if base is None:
            base = document
        for entry in document.get("tasks") or []:
            if not isinstance(entry, dict):
                continue
            task = str(entry.get("id"))
            if task in tasks:
                raise SystemExit(f"tau2-merge-duplicate-task:{task}")
            tasks[task] = entry
        for entry in document.get("simulations") or []:
            if not isinstance(entry, dict):
                continue
            pair = (str(entry.get("task_id")), entry.get("trial"))
            if pair in pairs:
                raise SystemExit(f"tau2-merge-duplicate-trial:{pair[0]}/{pair[1]}")
            pairs.add(pair)
            merged.append(entry)
    if base is None:
        raise SystemExit("tau2-merge-no-tasks")
    base = dict(base)
    base["tasks"] = list(tasks.values())
    base["simulations"] = merged
    return base


def merge_tasks(paths, out: str) -> int:
    """`merge_documents` over files, written to `out`, and the number of simulations it holds.

    R207 runs one task per invocation, so an arm's six invocations leave six documents, each already merged over
    its rounds. This is the reader that joins them for a caller that holds paths rather than documents.
    """
    documents = []
    for path in paths:
        with open(path, encoding="utf-8") as stream:
            document = json.load(stream)
        if not isinstance(document, dict):
            raise SystemExit(f"tau2-merge-bad-document:{path}")
        documents.append(document)
    base = merge_documents(documents)
    with open(out, "w", encoding="utf-8") as stream:
        json.dump(base, stream)
        stream.write("\n")
    return len(base["simulations"])


# --------------------------------------------------------------------------- self-test


def _self_test() -> int:
    failures = []
    cases = 0

    def check(name, condition, detail=""):
        nonlocal cases
        cases += 1
        if not condition:
            failures.append(f"{name}{': ' + detail if detail else ''}")

    # The key: whitespace-insensitive, case-sensitive, bounded, and empty for nothing.
    check("key collapses whitespace", note_key("  a   b \n c ") == "a b c")
    check("key keeps case", note_key("Order W1") != note_key("order w1"))
    check("key is bounded", len(note_key("x" * 900)) == KEY_CHARS)
    check("key of nothing is empty", note_key(None) == "" and note_key("   ") == "")

    # Lookup: five ways to have no note, none of which is a note.
    notes = empty()
    record(notes, "first task", "Ask for the order id before cancelling.", attempt=1, reward=0.0, task="1")
    check("note found", note_of(notes, "first task") == "Ask for the order id before cancelling.")
    check("note keyed exactly", note_of(notes, "first task ") == "Ask for the order id before cancelling.")
    check("other task has none", note_of(notes, "second task") == "")
    check("empty text has none", note_of(notes, "") == "")
    check("entry not a string has none", note_of({"notes": {"k": {"note": 7}}}, "k") == "")
    check("notes not an object has none", note_of({"notes": []}, "k") == "")

    # Writing: the entry carries the attempt and the reward, so "k+1 from k" is checkable.
    written = record(notes, "first task", "Second sentence.", attempt=2, reward=0.0, task="1")
    check("write reports chars", written == {"written": True, "chars": 16}, str(written))
    entry = notes["notes"][note_key("first task")]
    check("entry keeps attempt", entry["attempt"] == 2)
    check("entry keeps reward", entry["reward"] == 0.0)
    check("empty note is not written", record(notes, "t", "", attempt=1, reward=0.0)["written"] is False)
    check("empty key is not written", record(notes, "", "x", attempt=1, reward=0.0)["written"] is False)
    check("a bad document is rebuilt", record({"schema": "other"}, "t", "x", attempt=1, reward=1.0)["written"] is True)

    # Round trip: absent is round one, corrupted is a problem, wrong schema is a problem.
    import tempfile

    with tempfile.TemporaryDirectory() as directory:
        path = os.path.join(directory, "notes", "r206.json")
        fresh, problem = load(path)
        check("absent file is not a problem", fresh == empty() and problem is None, str(problem))
        save(path, notes)
        reloaded, problem = load(path)
        check("round trip keeps the note", note_of(reloaded, "first task") == "Second sentence.", str(problem))
        check("round trip is not a problem", problem is None)
        check("no scratch file is left", not os.path.exists(f"{path}.tmp"))
        with open(path, "w", encoding="utf-8") as stream:
            stream.write("{ not json")
        broken, problem = load(path)
        check("corrupt file is a problem", problem is not None and "JSONDecodeError" in problem, str(problem))
        check("corrupt file has no notes", broken == empty())
        with open(path, "w", encoding="utf-8") as stream:
            json.dump({"schema": "microglia.notes/0", "notes": {}}, stream)
        _, problem = load(path)
        check("wrong schema is a problem", problem is not None and "notes/0" in problem, str(problem))
        with open(path, "w", encoding="utf-8") as stream:
            json.dump({"schema": SCHEMA, "notes": []}, stream)
        _, problem = load(path)
        check("notes not an object is a problem", problem is not None and "`notes`" in problem, str(problem))
        empty_path, problem = load("")
        check("no path is no problem", empty_path == empty() and problem is None)

    # Collisions: one key, two tasks.
    collided = keyed_by_task([("1", "same opening"), ("2", "same  opening"), ("3", "other")])
    check("collision found", list(collided.values()) == [["1", "2"]], str(collided))
    check("no collision is empty", keyed_by_task([("1", "a"), ("2", "b")]) == {})
    check("blank keys are not collisions", keyed_by_task([("1", ""), ("2", "   ")]) == {})

    # The trajectory: calls with arguments, failures, and a ceiling that keeps both ends.
    attempt = {
        "get_messages": lambda: [
            {"role": "user", "content": "Where is my order?"},
            {"role": "assistant", "content": "", "tool_calls": [{"name": "get_order", "arguments": {"order_id": "W1"}}]},
            {"role": "tool", "content": "not found", "error": True},
            {"role": "assistant", "content": "I will cancel it."},
            {"role": "user", "content": "No, I asked where it is."},
        ]
    }
    text = trajectory_text(attempt)
    check("trajectory names the user", "USER: Where is my order?" in text, text[:120])
    check("trajectory names the call and its argument", 'CALL get_order(order_id="W1")' in text, text[:200])
    check("trajectory names the failure", "FAILED not found" in text, text[:200])
    check("trajectory keeps the last word", text.rstrip().endswith("No, I asked where it is."))
    check("no messages means no trajectory", trajectory_text({"get_messages": lambda: []}) == "")
    check("unreadable messages means no trajectory", trajectory_text({}) == "")
    check("a raising reader means no trajectory", trajectory_text({"get_messages": lambda: (_ for _ in ()).throw(ValueError())}) == "")
    long_attempt = {"get_messages": lambda: [{"role": "user", "content": "A" * 4000}, {"role": "assistant", "content": "tail"}]}
    clipped = trajectory_text(long_attempt, ceiling=200)
    check("ceiling is honoured", len(clipped) <= 200 + 2, str(len(clipped)))
    check("both ends survive the ceiling", clipped.startswith("USER: AAAA") and clipped.endswith("tail"), clipped[-40:])
    check("string arguments are rendered", "get_order(W1)" in trajectory_text({"messages": [{"role": "assistant", "tool_calls": [{"name": "get_order", "arguments": "W1"}]}]}))
    check("a nameless call is dropped", trajectory_text({"messages": [{"role": "assistant", "tool_calls": [{"name": "", "arguments": "x"}]}]}) == "")

    # The prompt: quoted, bounded, and one block.
    prompt = note_prompt("  USER: x\n" + "y" * 5000)
    check("prompt quotes the attempt", prompt.startswith("ATTEMPT\n<<<"))
    check("prompt is bounded", len(prompt) <= TRAJECTORY_CHARS + 40, str(len(prompt)))

    # The reply: NONE, empty, a wall of text, and a real sentence.
    class _Reply:
        def __init__(self, content):
            self.choices = [type("_C", (), {"message": type("_M", (), {"content": content})()})()]

    check("sentence kept", sentence_of(_Reply("Ask for the id first.")) == "Ask for the id first.")
    check("NONE is a refusal", sentence_of(_Reply("NONE")) == "")
    check("NONE with a period is a refusal", sentence_of(_Reply(" none. ")) == "")
    check("empty is a refusal", sentence_of(_Reply("   ")) == "")
    check("no choices is a refusal", sentence_of(object()) == "")
    check("non-string content is a refusal", sentence_of(_Reply(None)) == "")
    check("a wall of text is clipped", len(sentence_of(_Reply("z" * 900))) == NOTE_MAX_CHARS)
    check("a reply is one line", sentence_of(_Reply("a\n\n b")) == "a b")

    # The episode's opening message: objects and JSON, both read the same way.
    class _M:
        def __init__(self, role, content):
            self.role = role
            self.content = content

    opening = {"get_messages": lambda: [_M("assistant", "hi"), _M("user", "Where is my order?")]}
    check("opening message read from objects", first_user_text(opening) == "Where is my order?")
    check("opening message read from json", first_user_text({"messages": [{"role": "user", "content": "x"}]}) == "x")
    check("no user message is no opening", first_user_text({"messages": [_M("assistant", "hi")]}) == "")
    check("empty opening is no opening", first_user_text({"messages": [_M("user", "  ")]}) == "")
    check("unreadable episode is no opening", first_user_text(object()) == "")

    # The reward: `None` is unscored and `True` is not a pass.
    class _Info:
        def __init__(self, reward):
            self.reward = reward

    check("reward read", reward_of(type("_S", (), {"reward_info": _Info(0.5)})()) == 0.5)
    check("no reward info is None", reward_of(object()) is None)
    check("a boolean reward is not a reward", reward_of(type("_S", (), {"reward_info": _Info(True)})()) is None)
    check("a missing reward is None", reward_of(type("_S", (), {"reward_info": _Info(None)})()) is None)

    # R209. The call itself. Every other check in this file reads what the summariser *said*; these read what it was
    # *asked*, because R208's ablation measured 96.0 completion tokens per call — the whole budget — and read the
    # empty answer as a refusal. `deepseek-flash` thinks by default, the note budget is one sentence, and a call
    # that leaves thinking on spends the budget before writing anything. The three rounds that counted that as the
    # model declining were counting a truncation.
    import types as _types

    def _reply(content, finish="stop", prompt_tokens=400, completion_tokens=20):
        return _types.SimpleNamespace(
            choices=[_types.SimpleNamespace(message=_types.SimpleNamespace(content=content),
                                            finish_reason=finish)],
            usage=_types.SimpleNamespace(prompt_tokens=prompt_tokens, completion_tokens=completion_tokens),
        )

    seen: list = []
    module = _types.ModuleType("litellm")

    def _completion(**kwargs):
        seen.append(kwargs)
        if "RAISE" in kwargs["messages"][1]["content"]:
            raise RuntimeError("provider down")
        return _reply("", "length") if "CUT" in kwargs["messages"][1]["content"] else _reply("Ask for the id first.")

    module.completion = _completion
    sys.modules["litellm"] = module
    try:
        sentence, state, counts = call_note_model("ATTEMPT\n<<<\nplease\n>>>\n")
        check("a written sentence is a sentence", (sentence != "", state) == (True, "sentence"), state)
        check("the counters come back", counts.get("completion") == 20, str(counts))
        check("thinking is switched off on every call",
              seen[-1].get("extra_body") == {"thinking": {"type": "disabled"}}, str(seen[-1].get("extra_body")))
        check("the budget is one sentence", seen[-1].get("max_tokens") == NOTE_MAX_TOKENS, str(seen[-1].get("max_tokens")))
        check("the call is deterministic", seen[-1].get("temperature") == 0)
        check("the system turn is the note's own", seen[-1]["messages"][0]["content"] == NOTE_SYSTEM)
        check("a call cut off at the ceiling is a truncation, not a refusal",
              call_note_model("CUT")[1] == "truncated", call_note_model("CUT 2")[1])
        check("a truncation says so in its counters", call_note_model("CUT")[2].get("finish") == "length")
        check("a provider exception is a failure", call_note_model("RAISE")[1] == "failed")
        check("a failure carries its error", "provider down" in str(call_note_model("RAISE")[2].get("error")))
        no_key = os.environ.pop("MICROGLIA_NOTE_MODEL", None)
        try:
            os.environ["TAU_MODEL"] = "deepseek/deepseek-flash"
            call_note_model("ATTEMPT\n<<<\nplease\n>>>\n")
            check("the arm's model is the default", seen[-1].get("model") == "deepseek/deepseek-flash",
                  str(seen[-1].get("model")))
            call_note_model("ATTEMPT\n<<<\nplease\n>>>\n", "deepseek/deepseek-v4-pro")
            check("a named model wins", seen[-1].get("model") == "deepseek/deepseek-v4-pro")
        finally:
            os.environ.pop("TAU_MODEL", None)
            if no_key is not None:
                os.environ["MICROGLIA_NOTE_MODEL"] = no_key
    finally:
        del sys.modules["litellm"]

    # R208. The verdict: what the evaluator said was wrong with the attempt, which the trajectory cannot say.
    # The four check families τ² reports, a passing check, and the shapes an artefact carries them in.
    class _Check:
        def __init__(self, **fields):
            self.__dict__.update(fields)

    graded = type(
        "_S",
        (),
        {
            "reward_info": _Check(
                reward=0.0,
                db_check=_Check(db_match=False, db_reward=0.0),
                communicate_checks=[_Check(info="the agent must tell the user the refund total", met=False)],
                nl_assertions=[_Check(nl_assertion="the agent apologises", met=True)],
                env_assertions=[_Check(env_type="retail", met=False)],
            )
        },
    )()
    verdict = verdict_text(graded)
    check("verdict names the reward", "REWARD 0" in verdict, verdict)
    check("verdict names the db check", "DB CHECK not met" in verdict, verdict)
    check(
        "verdict names the unmet communicate check",
        "COMMUNICATE not met: the agent must tell the user the refund total" in verdict,
        verdict,
    )
    check("verdict names an unmet environment assertion", "ENV not met: retail" in verdict, verdict)
    check("verdict names a met assertion as met", "ASSERTION met: the agent apologises" in verdict, verdict)
    check(
        "a passing db check says so",
        "DB CHECK met" in verdict_text({"reward_info": {"db_check": {"db_match": True}}}),
        verdict_text({"reward_info": {"db_check": {"db_match": True}}}),
    )
    check(
        "a check without a description still says which kind failed",
        verdict_text({"reward_info": {"communicate_checks": [{"met": False}]}}) == "COMMUNICATE not met",
        verdict_text({"reward_info": {"communicate_checks": [{"met": False}]}}),
    )
    check(
        "a check with no verdict is dropped",
        verdict_text({"reward_info": {"communicate_checks": [{"info": "x"}]}}) == "",
        verdict_text({"reward_info": {"communicate_checks": [{"info": "x"}]}}),
    )
    check(
        "json and objects read the same verdict",
        verdict_text({"reward_info": {"reward": 0.0, "db_check": {"db_match": False}}})
        == verdict_text(type("_S", (), {"reward_info": _Check(reward=0.0, db_check=_Check(db_match=False))})()),
    )
    # R213. The verdict as the note: the material with no model in it.
    graded_note = verdict_text({"reward_info": {"reward": 0.0, "db_check": {"db_match": True},
                                                "nl_assertions": [{"nl_assertion": "Exchange both kettles", "met": False}]}})
    from_verdict = note_from_verdict(graded_note)
    check("the note drops the reward line", "REWARD" not in from_verdict, from_verdict)
    check("and keeps the unmet requirement", "Exchange both kettles" in from_verdict, from_verdict)
    check("and keeps what was met", "DB CHECK met" in from_verdict, from_verdict)
    check("an absent verdict is no note", note_from_verdict("") == "")
    check("a verdict that is not a string is no note", note_from_verdict(None) == "")
    check("a verdict of only a reward is no note", note_from_verdict("REWARD 0") == "")
    check("blank lines are dropped", note_from_verdict("A\n\nB") == "A\nB")
    check("the ceiling cuts on a line, never mid-line",
          note_from_verdict("one\ntwo\nthree", ceiling=7) == "one\ntwo", note_from_verdict("one\ntwo\nthree", ceiling=7))
    check("a single line over the ceiling is the line", note_from_verdict("x" * 50, ceiling=10) == "x" * 10)
    written, state, detail, prompt_chars = verdict_writer()("a trajectory", graded_note)
    check("the verdict writer returns the verdict", "Exchange both kettles" in written, written)
    check("and calls it a sentence", state == "sentence", state)
    check("and spends no prompt", prompt_chars == 0 and detail is None, str((prompt_chars, detail)))
    empty_note, empty_state, _, _ = verdict_writer()("a trajectory", "")
    check("a failure with no verdict is a refusal, not a silent sentence", empty_note == "" and empty_state == "refused",
          str((empty_note, empty_state)))
    check("no reward info is no verdict", verdict_text(object()) == "")
    check("an empty reward info is no verdict", verdict_text({"reward_info": {}}) == "")
    check(
        "a verdict of one reward is still a verdict",
        verdict_text({"reward_info": {"reward": 0.5}}) == "REWARD 0.5",
        verdict_text({"reward_info": {"reward": 0.5}}),
    )
    check(
        "an action check's outcome is read from its own spelling",
        verdict_text({"reward_info": {"action_checks": [{"action": "cancel_pending_order", "action_match": False}]}})
        == "ACTION not met: cancel_pending_order",
        verdict_text({"reward_info": {"action_checks": [{"action": "cancel_pending_order", "action_match": False}]}}),
    )
    check("a non-numeric reward is not cited", verdict_text({"reward_info": {"reward": True}}) == "")

    # R210. The verdict's *content*, which the first version lost in three ways at once. τ²'s action check carries
    # its action as an object — `{"name": …, "arguments": {…}}` — so a reader that wanted a string rendered
    # `ACTION not met` for every failure in the bank, and 77 of the 85 then had an empty exclusive vocabulary: the
    # material was informationally degenerate and the ablation measured its cost without its content.
    action = {"action": {"action_id": "0_0", "name": "cancel_pending_order",
                         "arguments": {"order_id": "W2378156", "reason": "no longer needed"}},
              "action_match": False}
    rendered = verdict_text({"reward_info": {"reward": 0.0, "action_checks": [action]}})
    check("an action object is rendered by its name", "cancel_pending_order" in rendered, rendered)
    check("an action object is rendered by its arguments", "W2378156" in rendered, rendered)
    check("a passing action is still named", "cancel_pending_order" in verdict_text(
        {"reward_info": {"action_checks": [{**action, "action_match": True}]}}))
    check("an empty argument is not rendered as a hole", "()" not in verdict_text(
        {"reward_info": {"action_checks": [{"action": {"name": "sync"}, "action_match": False}]}}),
        verdict_text({"reward_info": {"action_checks": [{"action": {"name": "sync"}, "action_match": False}]}}))
    # The evaluator's own explanation, which is the richest sentence in the artefact and was dropped entirely.
    explained = {"nl_assertions": [{"nl_assertion": "Agent should tell the user there are 10 t-shirt options.",
                                    "met": False,
                                    "justification": "The agent told the user there are 12 options, not 10."}]}
    check("the evaluator's justification is quoted",
          "12 options" in verdict_text({"reward_info": explained}), verdict_text({"reward_info": explained}))
    check("a communicate check's explanation is quoted", "not communicated" in verdict_text(
        {"reward_info": {"communicate_checks": [{"info": "10", "met": False,
                                                 "justification": "Information '10' not communicated."}]}}))
    check("the justification is not quoted twice",
          verdict_text({"reward_info": {"nl_assertions": [{"nl_assertion": "same text", "met": False,
                                                           "justification": "same text"}]}}).count("same text") == 1)

    # Ordering: the head is the reward and the database verdict, and after them the **failures** come before the
    # passes. A block truncated at 600 characters that shows twelve `ACTION met` lines and cuts the one `not met`
    # is worse than no block, because it tells the summariser the attempt was fine.
    mixed = {"reward_info": {"reward": 0.0, "db_check": {"db_match": True},
                             "action_checks": [{"action": {"name": f"step_{index}"}, "action_match": True}
                                               for index in range(12)]
                             + [{"action": {"name": "the_one_that_failed"}, "action_match": False}]}}
    truncated = verdict_text(mixed, ceiling=200)
    check("a failure is kept ahead of a pass", "the_one_that_failed" in truncated, truncated)
    check("the failure comes first", truncated.index("the_one_that_failed") < truncated.index("step_0"), truncated)
    check("the reward stays at the head", truncated.startswith("REWARD 0"), truncated)

    check(
        "the verdict ceiling is honoured",
        len(verdict_text({"reward_info": {"reward": 0.0, "nl_assertions": [{"met": False, "nl_assertion": "z" * 900}]}}, ceiling=80)) <= 80,
    )

    # The prompt: the same bytes R207 sent when no verdict is offered, and a second quoted block when one is.
    check(
        "no verdict leaves the prompt byte for byte as R207 sent it",
        note_prompt("ATTEMPT-BODY") == "ATTEMPT\n<<<\nATTEMPT-BODY\n>>>\n",
        repr(note_prompt("ATTEMPT-BODY")),
    )
    check("a blank verdict is no verdict", note_prompt("x", "   ") == note_prompt("x"))
    check("the verdict is a quoted block of its own", note_prompt("x", "DB CHECK not met").count("<<<") == 2)
    check("the prompt names the verdict block", "\nVERDICT\n<<<\nDB CHECK not met\n>>>\n" in note_prompt("x", "DB CHECK not met"))
    check("the verdict block is bounded", len(note_prompt("x", "v" * 5000)) <= VERDICT_CHARS + 200, str(len(note_prompt("x", "v" * 5000))))

    # A round: failures are distilled, passes are not, and the three ways of producing no note are counted apart.
    with tempfile.TemporaryDirectory() as directory:
        path = os.path.join(directory, "notes.json")
        rounds = []

        def sim(task, reward, text="fail here", unreadable=False):
            body = [] if unreadable else [{"role": "user", "content": text}]
            return type(
                "_S",
                (),
                {
                    "task_id": task,
                    "get_messages": staticmethod(
                        (lambda: (_ for _ in ()).throw(ValueError())) if unreadable else (lambda: body)
                    ),
                    "reward_info": _Info(reward),
                },
            )()

        seen = []
        seen_verdicts = []
        states = {"fail here": ("Ask for the id first.", "sentence"), "refuse here": ("", "refused"), "fail hard": ("", "failed")}

        def summarise(trajectory, verdict=""):
            seen.append(trajectory)
            seen_verdicts.append(verdict)
            for needle, (sentence, state) in states.items():
                if needle in trajectory:
                    return sentence, state, None, len(trajectory)
            return "Note.", "sentence", None, len(trajectory)

        first = note_round(
            [sim("1", 0.0), sim("2", 1.0, "passed"), sim("3", 0.0, "refuse here"), sim("4", None), sim("5", 0.0, "fail hard")],
            path,
            1,
            summarise,
            {},
        )
        rounds.append(first)
        check("round counts its episodes", first["episodes"] == 5, str(first))
        check("round counts the failures", first["failed"] == 3, str(first))
        check("round writes only the sentence", first["written"] == 1, str(first))
        check("round counts the refusal", first["refused"] == 1, str(first))
        check("round counts the provider failure", first["providerFailures"] == 1, str(first))
        check("round counts the unscored episode", first["unscored"] == 1, str(first))
        check("round did not see the pass", not any("passed" in text for text in seen))
        check("a round without the verdict shows none", first["verdict"] is False, str(first))
        check("a round without the verdict shows no verdict text", first["verdicts"] == 0, str(first))
        check("the summariser was offered no verdict", seen_verdicts == ["" for _ in seen_verdicts], str(seen_verdicts))
        stored, problem = load(path)
        check("round wrote the note to the file", note_of(stored, "fail here") == "Ask for the id first.", str(problem))
        check("round kept the attempt", stored["notes"][note_key("fail here")]["attempt"] == 1)
        check("round recorded the task", stored["notes"][note_key("fail here")]["task"] == "1")

        # An unreadable trajectory is not a note, and it is not the provider's fault either.
        second = note_round([sim("6", 0.0, unreadable=True)], path, 2, summarise, {})
        check("unreadable attempt is counted", second["unreadable"] == 1, str(second))
        check("unreadable attempt writes nothing", second["written"] == 0, str(second))

        # A collision is visible: two tasks that reduce to one key.
        collided = note_round([sim("7", 0.0, "same"), sim("8", 0.0, "same")], path, 3, summarise, {})
        check("collision counted", collided["collisions"] == 1, str(collided))
        check("collision recorded", load(path)[0]["collisions"] != {}, str(load(path)[0].get("collisions")))

        # R208. A round asked for the verdict shows it to the summariser, counts what it showed, and bills its
        # characters — because the prompt is the bill and a block added to it is a block paid for.
        seen_verdicts.clear()
        graded_round = note_round([sim("9", 0.0, "fail here")], path, 4, summarise, {}, verdict=True)
        check("a verdict round says it showed one", graded_round["verdict"] is True, str(graded_round))
        check("a verdict round counts the failures it could explain", graded_round["verdicts"] == 1, str(graded_round))
        check("a verdict round bills the verdict", graded_round["verdictChars"] > 0, str(graded_round))
        check("the summariser was shown the verdict", seen_verdicts == ["REWARD 0"], str(seen_verdicts))
        # Only a failure is distilled, so only a failure's verdict is shown: a pass has nothing to explain.
        seen_verdicts.clear()
        passed_round = note_round([sim("10", 1.0, "passed")], path, 5, summarise, {}, verdict=True)
        check("a pass is not shown to the summariser", seen_verdicts == [], str(seen_verdicts))
        check("a verdict round with no failure shows no verdict", passed_round["verdicts"] == 0, str(passed_round))

    # The merge: one document, one trial index per round, and a refusal for a task no round listed.
    with tempfile.TemporaryDirectory() as directory:
        paths = []
        for index in range(2):
            path = os.path.join(directory, f"round{index}.json")
            with open(path, "w", encoding="utf-8") as stream:
                json.dump(
                    {
                        "tasks": [{"id": "1"}, {"id": "2"}],
                        "simulations": [
                            {"task_id": "1", "trial": 0, "reward_info": {"reward": 0.0}},
                            {"task_id": "2", "trial": 0, "reward_info": {"reward": 1.0}},
                        ],
                    },
                    stream,
                )
            paths.append(path)
        merged_path = os.path.join(directory, "merged.json")
        merge_rounds(paths, merged_path, 2)
        with open(merged_path, encoding="utf-8") as stream:
            merged = json.load(stream)
        check("merge keeps every simulation", len(merged["simulations"]) == 4, str(len(merged["simulations"])))
        check("merge numbers the rounds", [entry["trial"] for entry in merged["simulations"]] == [0, 0, 1, 1], str([e["trial"] for e in merged["simulations"]]))
        check("merge keeps the tasks once", len(merged["tasks"]) == 2)

        stranger = os.path.join(directory, "stranger.json")
        with open(stranger, "w", encoding="utf-8") as stream:
            json.dump({"tasks": [{"id": "1"}], "simulations": [{"task_id": "9", "trial": 0}]}, stream)
        raised = False
        try:
            merge_rounds([paths[0], stranger], merged_path, 2)
        except SystemExit as error:
            raised = str(error) == "tau2-merge-unknown-task:9"
        check("merge refuses an unknown task", raised)

    # Specificity: the note that names its own failure's entity is specific; the echo is not.
    trajectories = {
        "task one W2378156": "USER: cancel W2378156",
        "task two": "USER: refund paypal",
    }
    graded = empty()
    record(graded, "task one W2378156", "Confirm W2378156 is cancelled before promising a refund.", attempt=1, reward=0.0)
    record(graded, "task two", "Be careful and check the method before acting.", attempt=1, reward=0.0)
    reading = specificity(graded, trajectories)
    check("specificity grades both notes", reading["graded"] == 2, str(reading))
    check("only the naming note is specific", reading["specific"] == 1, str(reading))
    check("specificity share is one half", abs(reading["share"] - 0.5) < 1e-9, str(reading))
    check("no notes is no share", specificity(empty(), trajectories)["share"] is None)
    check("entities keep ids whole", "w2378156" in entities("Cancel W2378156 now"))
    check("entities drop short words", entities("to be or not") == set(), str(entities("to be or not")))

    # The scope: which task a sidecar describes, and the one state that is a writer defect.
    check("no scope describes no task", scope_of({}) == {"kind": "none"})
    check("a scope of none says so", scope_of({"scope": {"kind": "none"}})["kind"] == "none")
    check("a scope of one task names it", scope_of({"scope": {"kind": "task", "task": "5"}}) == {"kind": "task", "task": "5"})
    check("the scope's task is stripped", scope_of({"scope": {"kind": "task", "task": " 5 "}})["task"] == "5")
    broken_scope = scope_of({"scope": {"kind": "task", "task": "  "}})
    check("a task scope with no task is broken", broken_scope["kind"] == "broken", str(broken_scope))
    check("so is an unknown kind", scope_of({"scope": {"kind": "several"}})["kind"] == "broken")
    many = scope_of({"scope": {"kind": "many", "tasks": ["5", "9"]}})
    check("a merged scope lists its tasks", many == {"kind": "many", "tasks": ["5", "9"]}, str(many))
    check("a scope that is not an object describes no task", scope_of({"scope": []})["kind"] == "none")
    check("a document that is not an object describes no task", scope_of(None)["kind"] == "none")

    # Declaring it: the writer's half, including the one refusal that stops a reused path.
    declared = set_scope(empty(), "5")
    check("declaring a scope names the task", declared["scope"] == {"kind": "task", "task": "5"})
    check("declaring it twice is idempotent", set_scope(declared, "5")["scope"] == declared["scope"])
    rebound = False
    try:
        set_scope(declared, "9")
    except SystemExit as error:
        rebound = str(error) == "tau2-notes-scope-changed:5->9"
    check("a path reused for another task is refused", rebound)
    blank = False
    try:
        set_scope(empty(), "")
    except SystemExit as error:
        blank = str(error) == "tau2-notes-scope-empty"
    check("a scope with no task is refused", blank)
    check("a bad document is rebuilt with a scope", set_scope({"schema": "other"}, "7")["scope"]["task"] == "7")
    kept = empty()
    record(kept, "a task", "Do the thing.", attempt=1, reward=0.0, task="5")
    check("declaring a scope keeps the notes", note_of(set_scope(kept, "5"), "a task") == "Do the thing.")

    # The two identities, told apart by what they returned.
    keyed = empty()
    record(keyed, "the opening", "Ask for the id first.", attempt=1, reward=0.0, task="5")
    check("a key hit is reported as one", lookup(keyed, "the opening") == ("Ask for the id first.", "key"))
    scoped = set_scope(empty(), "5")
    record(scoped, "an opening the agent will paraphrase", "Ask for the id first.", attempt=1, reward=0.0, task="5")
    check("a paraphrase is served by the file", lookup(scoped, "a paraphrase of that opening") == ("Ask for the id first.", "task"))
    check("and `note_of` is the same answer", note_of(scoped, "a paraphrase of that opening") == "Ask for the id first.")
    later = set_scope(empty(), "5")
    record(later, "first", "First sentence.", attempt=1, reward=0.0, task="5")
    record(later, "second", "Second sentence.", attempt=3, reward=0.0, task="5")
    check("the fallback serves the latest attempt", lookup(later, "unrelated text")[0] == "Second sentence.")
    crossed = set_scope(empty(), "5")
    record(crossed, "task five", "Five's sentence.", attempt=1, reward=0.0, task="5")
    record(crossed, "task nine", "Nine's sentence.", attempt=2, reward=0.0, task="9")
    check("an entry for another task is not served", lookup(crossed, "neither opening") == ("", "none"))
    # And not even the entry whose key matches: the contradiction is about the *file*, and the matching entry may
    # be the other task's attempt at the same opening — which is exactly the pair R206a measured as unseparatable.
    check("a key hit in a file that contradicts itself is refused",
          lookup(crossed, "task five") == ("", "none"))
    check("a merged file serves nothing on a miss", lookup({"schema": SCHEMA, "notes": {"k": {"note": "x", "task": "5"}},
                                                            "scope": {"kind": "many", "tasks": ["5"]}}, "other") == ("", "none"))
    check("an untyped entry is not evidence of another task",
          lookup({"schema": SCHEMA, "notes": {"k": {"note": "x"}}, "scope": {"kind": "task", "task": "5"}}, "o") == ("x", "task"))
    check("a blank note is not served from the file",
          lookup({"schema": SCHEMA, "notes": {"k": {"note": "  ", "task": "5"}}, "scope": {"kind": "task", "task": "5"}}, "o") == ("", "none"))

    # The attempts beside the notes: written in one rename, read back, and reported when unreadable.
    with tempfile.TemporaryDirectory() as directory:
        sidecar = os.path.join(directory, "notes", "notes-5.json")
        attempts = trajectories_path(sidecar)
        check("the attempts live beside the sidecar", attempts == f"{sidecar}.trajectories.json")
        check("no sidecar means no attempts path", trajectories_path("") == "")
        check("nothing to write is nothing written", save_trajectories("", {"k": "v"}) == 0)
        written = save_trajectories(attempts, {"k": "USER: x", "": "junk", "j": 7})
        check("only the attempts that are text are kept", written == 1, str(written))
        loaded, problem = load_trajectories(attempts)
        check("the attempts read back", loaded == {"k": "USER: x"} and problem is None, str(problem))
        check("no scratch file is left beside them", not os.path.exists(f"{attempts}.tmp"))
        check("a missing file is round one", load_trajectories(os.path.join(directory, "absent.json")) == ({}, None))
        check("no path is no attempts", load_trajectories("") == ({}, None))
        with open(attempts, "w", encoding="utf-8") as stream:
            stream.write("{ truncated")
        _, problem = load_trajectories(attempts)
        check("a corrupt attempts file is a problem", problem is not None and "JSONDecodeError" in problem, str(problem))
        with open(attempts, "w", encoding="utf-8") as stream:
            json.dump({"schema": "microglia.notes-trajectories/0", "trajectories": {}}, stream)
        _, problem = load_trajectories(attempts)
        check("an attempts file from another writer is a problem", problem is not None and "trajectories/0" in problem, str(problem))
        with open(attempts, "w", encoding="utf-8") as stream:
            json.dump({"schema": TRAJECTORIES_SCHEMA, "trajectories": []}, stream)
        _, problem = load_trajectories(attempts)
        check("attempts that are not an object are a problem", problem is not None and "`trajectories`" in problem, str(problem))

    merged_attempts, collisions = merge_trajectories([{"a": "one", "b": "two"}, {"b": "other", "c": "three"}])
    check("attempts merge across tasks", sorted(merged_attempts) == ["a", "b", "c"], str(merged_attempts))
    check("the first task's attempt wins a shared key", merged_attempts["b"] == "two")
    check("a shared key is counted", collisions == 1, str(collisions))
    check("no attempts is no collision", merge_trajectories([]) == ({}, 0))

    # The sidecars of several tasks into the corpus specificity needs.
    five = set_scope(empty(), "5")
    record(five, "five's opening", "Five's sentence.", attempt=1, reward=0.0, task="5")
    nine = set_scope(empty(), "9")
    record(nine, "nine's opening", "Nine's sentence.", attempt=1, reward=0.0, task="9")
    corpus = merge_sidecars([five, nine])
    check("the merged corpus lists both tasks", corpus["scope"] == {"kind": "many", "tasks": ["5", "9"]}, str(corpus["scope"]))
    check("and holds both notes", len(corpus["notes"]) == 2, str(corpus))
    overlap = set_scope(empty(), "9")
    record(overlap, "five's opening", "Nine's sentence.", attempt=1, reward=0.0, task="9")
    crossed_corpus = merge_sidecars([five, overlap])
    check("a key two tasks produced is a collision", list(crossed_corpus["collisions"]) == [note_key("five's opening")], str(crossed_corpus["collisions"]))
    check("a collision keeps the first task's sentence", len(crossed_corpus["notes"]) == 1)
    check("no sidecars is no evidence", merge_sidecars([])["scope"]["kind"] == "none")

    # Specificity over a corpus of one: the note's own task is the only task, so the share is not a measurement.
    lonely = empty()
    record(lonely, "only task", "Cancel W2378156 before refunding.", attempt=1, reward=0.0, task="5")
    single = specificity(lonely, {"only task": "USER: cancel W2378156"})
    check("one task has no cross-task share", single["share"] is None, str(single))
    check("and says why", "corpus of 1" in (single["reason"] or ""), str(single.get("reason")))
    check("it still grades the note", single["graded"] == 1 and single["specific"] == 1, str(single))
    pair_reading = specificity(graded, trajectories)
    check("two tasks have a share", pair_reading["share"] is not None and pair_reading["tasks"] == 2, str(pair_reading))

    # The cross-task merge: one arm's per-task documents into one grid.
    with tempfile.TemporaryDirectory() as directory:
        def per_task(task: str, trials: int = 2) -> str:
            path = os.path.join(directory, f"results-{task}.json")
            with open(path, "w", encoding="utf-8") as stream:
                json.dump(
                    {
                        "domain": "retail",
                        "tasks": [{"id": task}],
                        "simulations": [
                            {"task_id": task, "trial": index, "reward_info": {"reward": 1.0}} for index in range(trials)
                        ],
                    },
                    stream,
                )
            return path

        joined = os.path.join(directory, "merged.json")
        count = merge_tasks([per_task("5"), per_task("9")], joined)
        with open(joined, encoding="utf-8") as stream:
            document = json.load(stream)
        check("the merge counts every simulation", count == 4, str(count))
        check("the merge keeps both tasks", [entry["id"] for entry in document["tasks"]] == ["5", "9"])
        check("the merge keeps the arm's own keys", document["domain"] == "retail")
        check("the merge keeps the trial indices", sorted(entry["trial"] for entry in document["simulations"]) == [0, 0, 1, 1])

        for name, paths, code in (
            ("a task two documents both list is refused", [per_task("5"), per_task("5")], "tau2-merge-duplicate-task:5"),
            ("a document with no tasks is refused", [], "tau2-merge-no-tasks"),
        ):
            raised = False
            try:
                merge_tasks(paths, joined)
            except SystemExit as error:
                raised = str(error) == code
            check(name, raised)

        twice = os.path.join(directory, "second-5.json")
        with open(twice, "w", encoding="utf-8") as stream:
            json.dump({"tasks": [{"id": "7"}], "simulations": [{"task_id": "5", "trial": 0}]}, stream)
        raised = False
        try:
            merge_tasks([per_task("5"), twice], joined)
        except SystemExit as error:
            raised = str(error) == "tau2-merge-duplicate-trial:5/0"
        check("an attempt two documents both hold is refused", raised)

        broken = os.path.join(directory, "list.json")
        with open(broken, "w", encoding="utf-8") as stream:
            json.dump([], stream)
        raised = False
        try:
            merge_tasks([broken], joined)
        except SystemExit as error:
            raised = str(error).startswith("tau2-merge-bad-document:")
        check("a document that is not an object is refused", raised)

    for failure in failures:
        print(f"FAIL {failure}", file=sys.stderr)
    print(f"{cases} case(s), {len(failures)} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(_self_test())
