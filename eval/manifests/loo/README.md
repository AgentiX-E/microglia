# Draw plans for a top-up

A `loo` draw withholds one rule from a question's pack, chosen by a hash of the question — uniform over
the pack, and blind to which rules still need draws. R77 measured how badly that fits the question it
left behind: of 472 rules, 113 never fired, 105 of them hold fewer than five draws, and silence at the
pack's own 49.9% per-draw live rate is only evidence below about 5% — which five draws is the threshold
for.

A plan names those rules and how many draws each is short. It is generated, never written by hand:

```
pnpm eval:inert --bird <artefact>.json --emit-targets eval/manifests/loo/<name>.json
```

and read by the lane from the registration's `looTargets` header, because which rules are short is a
property of the experiment rather than of the dispatch.

`R77-silent-tail.json` is the plan R77 left: 105 rules, 346 draws short of five. **It is not dispatched
and should not be until the arm it needs exists** — see `prereg/R78-silent-tail.md`, where the arithmetic
of using it with the current `loo` arm comes to 1,875 questions.
