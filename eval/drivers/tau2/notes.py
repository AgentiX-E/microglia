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


def note_prompt(trajectory: str) -> str:
    """The user turn: the attempt, quoted as data.

    One block rather than two messages, and quoted, because everything inside it is text a model wrote in a
    previous episode — the same rule R204's guidance prompt applies to records.
    """
    clipped = trajectory.strip()[:TRAJECTORY_CHARS]
    return f"ATTEMPT\n<<<\n{clipped}\n>>>\n"


# --------------------------------------------------------------------------- the reply


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
    """
    info = getattr(simulation, "reward_info", None)
    reward = getattr(info, "reward", None)
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



def note_round(simulations, path: str, attempt: int, summarize, trajectories) -> dict:
    """Distil every failed attempt of one round into the sidecar the next round reads.

    Only failures are distilled, and only a failure's *own* trajectory is shown: the reward is the runner's to
    know, which is why this cannot live in the agent, and the material is the attempt rather than a summary of
    the store, which is the one thing that separates this arm from R204's.

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
        "providerFailures": 0,
        "unscored": 0,
        "unreadable": 0,
        "promptChars": 0,
        "noteChars": 0,
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
        sentence, state, detail, prompt_chars = summarize(trajectory)
        counters["promptChars"] += prompt_chars
        if state == "failed":
            counters["providerFailures"] += 1
            if counters["firstProviderFailure"] is None:
                counters["firstProviderFailure"] = detail
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
        states = {"fail here": ("Ask for the id first.", "sentence"), "refuse here": ("", "refused"), "fail hard": ("", "failed")}

        def summarise(trajectory):
            seen.append(trajectory)
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
