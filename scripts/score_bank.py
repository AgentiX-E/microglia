"""Score a bank's entries offline, before any of them is bought.

The admission family in the literature scores a candidate skill *without a rollout*
(`arXiv:2608.20274`, "Break It Down, Pass It On": utility = specificity x abstractness). This lane has
never tried it, and it has the corpus to check it against: twenty-one banks, of which several have a
measured paired delta. R190 is therefore a script and its tests, and no model call.

**Three units, and the pack is the one that matters.** A bank is a set of entries; an entry is a
sentence; a *pack* is what one game reads — the entries whose `kinds` admit that game's task type, under
the entry with no tags, rendered by the driver's own `render_pack`. The treatment is the pack, so the pack
is what is scored, and the selection is imported from `agent.py` rather than re-implemented: a score over
a text the model was not shown is a score of nothing.

**Specificity is the share of the text that is command notation** — quoted spans and `<placeholders>`,
because that notation is how this environment writes an action. A sentence about commands is not a
command: R188 bought a 259-character instruction that names none for 3.03 CNY and read it as inert, and
this score reads it as zero.

**Abstractness is the share of the words that are frame words** — `if`, `when`, `before`, `every`,
`instead`, and the rest of the list below. A bare imperative states an incident; a conditional states a
rule, and the difference between an entry that transfers and one that does not is that difference.

**Both factors are rates, and that is a requirement rather than a style.** A share cannot be bought with
length, so a 551-character pack and an 814-character one are compared on content and not on size
(reading 2). Both are also order-free — bag of characters for one, bag of words for the other — which is
a design constraint: R188 measured a sentence against its own word-shuffled placebo and found no
difference, so a scorer that separated them would be reading a signal the corpus says is not there
(reading 3).

**What this file does not do, and the round's finding.** It does not read the measured effect: the scoring
functions take a path and return numbers computed from `text` and `kinds` only, and the effect table is a
separate file read after every score is printed (the registration's void clause, as an interface). Run
that way, the scorer reproduces the record's own counterexample: `bank-putscope-2` and
`bank-putscope-3` hold the same two sentences byte for byte and are measured 3.65 pp apart, so a
content-only score cannot be the gate. See `REGISTRATION.md` R190 amendment 1.

Usage:
    python3 scripts/score_bank.py eval/drivers/alfworld/banks/bank-putscope-2.json
    python3 scripts/score_bank.py --effects eval/drivers/alfworld/measured-effects.json --json <banks...>
"""

import argparse
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
LANE = HERE.parent / "eval" / "drivers" / "alfworld"
if str(LANE) not in sys.path:
    sys.path.insert(0, str(LANE))

import agent  # noqa: E402

# The six task types, in the driver's own order. Read rather than rewritten: the pack selection below uses
# the same table the episode loop uses, so a kind this scorer knows and the driver does not cannot exist.
KINDS = tuple(kind for _, kind in agent.TASK_KIND_PREFIXES)

# Command notation: a quoted span, or one of the environment's `<placeholders>`. An unterminated quote is
# not a literal -- it is a typo, and rewarding it with specificity would reward the typo.
LITERAL = re.compile(r'"[^"\n]*"|<[^<>\n]*>')

# The frame words. This list *is* the definition of abstractness, so it is closed and short: a sentence
# that states a rule names a class or a condition, and a sentence that states an incident does neither.
FRAMES = frozenset(
    """
    if when whenever before after once unless until while despite though although because since so that
    whether every any all each both either neither other another same different
    repeatedly often usually always never still only just first then instead rather
    anything nothing something everything anything
    """.split()
)

# What each task type's terminal step is called, in the corpus's own vocabulary. Coverage is a *scope*
# check and not a score: R177 measured the published `put` entry at -12.9 pp on `examine` on both
# sections, because an `examine` game (`look_at_obj_in_light`) has no placement step for the entry to
# repair. That is a fact about reach, and reach is not in the sentence's form.
REFERENTS = {
    "put": ("put", "move", "place"),
    "puttwo": ("put", "move", "place", "two", "second"),
    "clean": ("clean", "wash", "sinkbasin", "sink"),
    "heat": ("heat", "hot", "microwave", "cook"),
    "cool": ("cool", "cold", "fridge", "refrigerat"),
    "examine": ("look", "examine", "desklamp", "lamp", "light"),
}


def fail(message: str) -> "None":
    """Refuse with the reason on stdout, the way the lane's other checkers do."""
    print(f"score_bank: {message}")
    raise SystemExit(1)


def specificity(text: str) -> float:
    """The share of the text that is command notation. Order-free and length-normalised."""
    if not text:
        return 0.0
    literal = sum(len(match.group(0)) for match in LITERAL.finditer(text))
    return literal / len(text)


def abstractness(text: str) -> float:
    """The share of the words that are frame words. Order-free and length-normalised."""
    words = re.findall(r"[a-z]+", text.lower())
    if not words:
        return 0.0
    return sum(1 for word in words if word in FRAMES) / len(words)


def utility(text: str) -> float:
    """The product, as the literature defines it: either factor can zero the score, for its own reason."""
    return specificity(text) * abstractness(text)


def covers(text: str, kind: str) -> bool:
    """Does the entry name the operation `kind` ends on? Lexical, and the tests record where that is fooled."""
    lowered = text.lower()
    return any(re.search(rf"\b{re.escape(token)}", lowered) for token in REFERENTS[kind])


def load_bank(path: Path) -> "tuple[list[str], list[list[str]]]":
    """A bank file as its rules and per-rule kind tags, through the driver's own loader."""
    try:
        rules, kinds = agent.load_bank(str(path))
    except (KeyError, TypeError, ValueError):
        # `load_bank` reads `entries[*].text` directly, so a file missing one raises rather than returning an
        # empty string. That is the behaviour this wrapper wants: a missing entry was not read, and an empty
        # string is a reading of zero.
        fail(f"{path} is not a bank the driver would load")
    if not rules:
        fail(f"{path} holds no entries: a bank that renders nothing is not a treatment")
    for index, text in enumerate(rules, start=1):
        if not isinstance(text, str) or not text.strip():
            fail(f"{path} entry {index} has no text: an empty entry scores zero, a missing one was not read")
    return rules, kinds


def score_bank(path: "str | Path") -> dict:
    """Every number this file can compute about one bank, and nothing about what it measured."""
    path = Path(path)
    rules, kinds = load_bank(path)
    entries = []
    for index, text in enumerate(rules):
        entries.append(
            {
                "index": index + 1,
                "text": text,
                "kinds": list(kinds[index]) if kinds else [],
                "specificity": specificity(text),
                "abstractness": abstractness(text),
                "utility": utility(text),
                "covers": {kind: covers(text, kind) for kind in KINDS},
            }
        )
    packs = {}
    for kind in KINDS:
        selected = agent.applicable(rules, kinds, kind)
        rendered = agent.render_pack(selected)
        packs[kind] = {
            "chars": len(rendered),
            "entries": len(selected),
            "specificity": specificity(rendered),
            "abstractness": abstractness(rendered),
            "utility": utility(rendered),
        }
    return {
        "bank": path.stem,
        "entries": entries,
        "packs": packs,
        "pack_specificity": sum(pack["specificity"] for pack in packs.values()) / len(packs),
        "pack_abstractness": sum(pack["abstractness"] for pack in packs.values()) / len(packs),
        "pack_utility": sum(pack["utility"] for pack in packs.values()) / len(packs),
    }


def spearman(pairs: "list[tuple[float, float]]") -> float:
    """Rank correlation with ties averaged. Refuses fewer than three points, because two give +-1 always."""
    if len(pairs) < 3:
        fail(f"a rank correlation over {len(pairs)} points is +-1 by arithmetic: three is the floor")

    def ranks(values: "list[float]") -> "list[float]":
        order = sorted(range(len(values)), key=lambda index: values[index])
        out = [0.0] * len(values)
        position = 0
        while position < len(order):
            end = position
            while end + 1 < len(order) and values[order[end + 1]] == values[order[position]]:
                end += 1
            shared = (position + end) / 2 + 1
            for index in range(position, end + 1):
                out[order[index]] = shared
            position = end + 1
        return out

    left, right = ranks([pair[0] for pair in pairs]), ranks([pair[1] for pair in pairs])
    mean_left, mean_right = sum(left) / len(left), sum(right) / len(right)
    covariance = sum((a - mean_left) * (b - mean_right) for a, b in zip(left, right))
    spread = (sum((a - mean_left) ** 2 for a in left) * sum((b - mean_right) ** 2 for b in right)) ** 0.5
    return covariance / spread if spread else 0.0


def load_effects(path: "str | Path") -> dict:
    """The measured deltas, each of which must name the comparison and the quantity it is.

    R190's first reading compared four rows whose deltas were three different quantities -- a bank against
    its control, an entry against its placebo, and one row that was an artefact of a run that drove no
    games. A correlation over such a table is a correlation over nothing, so each row now carries the
    quantity it is an instance of, and the correlation is computed inside one quantity.
    """
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    rows = payload.get("banks") or []
    if not rows:
        fail(f"{path} names no banks")
    for row in rows:
        for field in ("bank", "delta_pp", "quantity", "comparison", "round", "games"):
            if field not in row:
                fail(f"{path} row {row.get('bank', '?')} has no `{field}`: every delta names the comparison it is")
        if not str(row["comparison"]).strip() or not str(row["quantity"]).strip():
            fail(f"{path} row {row['bank']} has an empty comparison: every delta names the comparison it is")
    return payload


def readback(effects: dict, scored: "dict[str, dict]") -> "None":
    """Print the effect of each measured bank beside its score, then the correlation if it is computable."""
    rows = effects["banks"]
    print("\nmeasured effects, each with the comparison it is")
    by_quantity: "dict[str, list[tuple[float, float]]]" = {}
    for row in rows:
        name = Path(row["bank"]).stem
        delta = float(row["delta_pp"])
        if name not in scored:
            print(f"  {name:30} {delta:+7.2f} pp  [{row['quantity']}]  not scored in this run")
            continue
        score = scored[name]["pack_utility"]
        print(f"  {name:30} {delta:+7.2f} pp  utility {score:.5f}  [{row['quantity']}]  {row['comparison']}")
        by_quantity.setdefault(row["quantity"], []).append((score, delta))
    # One quantity at a time. Rows that are different experiments are not points on one axis, and pooling
    # them is the defect this table was rebuilt to stop making.
    for quantity, points in sorted(by_quantity.items(), key=lambda item: -len(item[1])):
        if len(points) < 3:
            print(f"  rank correlation `{quantity}`: not computable -- {len(points)} point(s), and three is the floor")
        else:
            rho = spearman(points)
            print(f"  rank correlation `{quantity}`: rho = {rho:+.3f} over {len(points)} banks")
            if len(points) < 6:
                print(f"    and {len(points)} points is a sample in which one inversion moves rho by "
                      f"{2 / (len(points) - 1):.2f}: read the sign, not the magnitude")

    kinds = effects.get("kinds")
    if not kinds:
        return
    print(f"\nper-kind cells, {kinds['round']}, {kinds['games']} games, one entry read on all six kinds")
    name = Path(kinds["bank"]).stem
    text = scored[name]["entries"][0]["text"] if name in scored else ""
    agree = 0
    for cell in kinds["cells"]:
        named = covers(text, cell["kind"])
        positive = float(cell["delta_pp"]) > 0
        agree += 1 if named == positive else 0
        print(
            f"  {cell['kind']:8} {cell['won']:3}/{cell['of']:<3} {float(cell['delta_pp']):+7.2f} pp  "
            f"entry names it: {'yes' if named else 'no ':3}  "
            f"{'agrees' if named == positive else 'DISAGREES'}"
        )
    print(
        f"  a vocabulary test reproduces the sign on {agree} of {len(kinds['cells'])} kinds: "
        "reach is a mechanism and not a word list"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("banks", nargs="+", help="bank files to score")
    parser.add_argument("--json", action="store_true", help="emit the scores as one JSON array instead of a table")
    parser.add_argument("--effects", default="", help="a measured-effects table to print beside the scores")
    parser.add_argument("--verbose", action="store_true", help="one line per entry as well as per bank")
    arguments = parser.parse_args()

    scored = {Path(path).stem: score_bank(path) for path in arguments.banks}

    if arguments.json:
        print(json.dumps(list(scored.values()), indent=1))
    else:
        print("score  offline: specificity x abstractness over the pack the driver renders, no model call")
        for name, bank in scored.items():
            pack = bank["packs"]
            chars = sorted({entry["chars"] for entry in pack.values()})
            counts = sorted({entry["entries"] for entry in pack.values()})
            reached = sorted({kind for kind, entry in pack.items() if entry["entries"]})
            print(
                f"bank {name:34} specificity {bank['pack_specificity']:.4f}  "
                f"abstractness {bank['pack_abstractness']:.4f}  utility {bank['pack_utility']:.5f}  "
                f"packs {'/'.join(str(value) for value in chars)} ch x {'/'.join(str(value) for value in counts)} entries  "
                f"reaches {','.join(reached) if reached else 'nothing'}"
            )
            if arguments.verbose:
                for entry in bank["entries"]:
                    print(
                        f"  entry {entry['index']}  specificity {entry['specificity']:.4f}  "
                        f"abstractness {entry['abstractness']:.4f}  utility {entry['utility']:.5f}  "
                        f"tags {','.join(entry['kinds']) or 'none'}  "
                        f"covers {','.join(kind for kind, hit in entry['covers'].items() if hit) or 'nothing'}"
                    )

    if arguments.effects:
        readback(load_effects(arguments.effects), scored)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
