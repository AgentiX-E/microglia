# R49 verifier fixtures

These two documents are **not measurements**. They are written by the real L4
lane (`packages/eval/src/bin/l4.ts`) driven by a stand-in driver that returns
fixed per-task rows and a fixed paired verdict, so that
`eval/verifiers/r49_readback.py` can be tested against the shape the lane
actually produces rather than against a hand-written approximation.

The stand-in driver is `packages/eval/src/__tests__/l4-facade-pair.test.ts`'s
`DRIVER_PAIRED`, which is the same shape R49's real dispatch writes.

Every number here is a stub: `pass4 = 1`, `delta = 0`, `p = 1`. Nothing in this
directory may be quoted as a result, and the self-test treats them as inputs to
be mutated, not as evidence.
