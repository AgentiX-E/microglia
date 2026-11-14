/**
 * The writer matrix, on the numbers a run printed and on the ones it did not.
 *
 * R111's pre-flight answered `answered` / `empty` / `error`, and R104 then showed why that was not
 * enough: the interpreter's replies were mostly **blank**, which the two-state census counted as
 * healthy, and the claims it did return were never asked whether they carried the condition the
 * prompt makes mandatory. These tests pin the four reply states, the condition count, and the three
 * verdicts — including the one that says the money bought a refusal.
 */
import { describe, expect, it } from 'vitest';
import {
  TRIAL_PREVIEW_CHARS,
  candidateGrid,
  probeWriters,
  readWriterProbe,
  trialOf,
  trialPreview,
  writerLabel,
  writerProbeMarkdown,
  type ProbeTokens,
  type WriterCandidate,
  type WriterOutcome,
  type WriterTrial,
} from '../writer-probe.js';

const TOKENS: ProbeTokens = { prompt: 1400, cached: 0, completion: 90, total: 1490 };
const SPENT = { prompt: 1400, cached: 0, completion: 90, total: 1490, reasoning: 0 } as const;

const LESSON: WriterCandidate = { model: 'deepseek-flash', form: 'lesson' };
const PROCEDURE: WriterCandidate = { model: 'deepseek-flash', form: 'procedure' };

/**
 * A call that returned, with a reply and a claim list that agree.
 *
 * They have to: `classifyReply` reads the reply and `withWhen` reads the claims, and a fixture whose
 * two halves disagreed would let a test assert a verdict no real call could produce. The reply is
 * therefore rendered from the same list the claims come from, unless a test is about a reply the
 * parser cannot read and passes one deliberately.
 */
const answeredWith = (whens: readonly (string | undefined)[], reply?: string): WriterOutcome => {
  const claims = whens.map((when, index) => ({
    statement: `statement ${String(index)}`,
    ...(when === undefined ? {} : { when }),
  }));
  return {
    ok: true,
    reply:
      reply ??
      JSON.stringify({
        candidates: claims.map((claim) => ({
          kind: 'constraint',
          statement: claim.statement,
          ...('when' in claim ? { when: claim.when } : {}),
        })),
      }),
    claims,
    tokens: TOKENS,
    ms: 900,
  };
};

/** A trial built directly, for the ranking tests that are about the reading and not the call. */
function trial(overrides: Partial<WriterTrial> & Pick<WriterTrial, 'model' | 'form'>): WriterTrial {
  return {
    state: 'answered',
    claims: 1,
    withWhen: 1,
    chars: 120,
    preview: '{"candidates":[...]}',
    tokens: { prompt: 0, cached: 0, completion: 0, total: 0 },
    ms: 500,
    ...overrides,
  };
}

describe('naming a writer', () => {
  it('names the pair, because neither axis alone describes a writer', () => {
    expect(writerLabel(LESSON)).toBe('deepseek-flash/lesson');
  });
});

describe('what a trial keeps of a reply', () => {
  it('quotes the start of a reply that has something to quote', () => {
    expect(trialPreview('  [{"statement":"x"}]  ')).toBe('[{"statement":"x"}]');
  });

  it('bounds the quote so a model that echoes its prompt cannot put the prompt in the artefact', () => {
    const long = 'a'.repeat(TRIAL_PREVIEW_CHARS + 40);
    expect(trialPreview(long)).toHaveLength(TRIAL_PREVIEW_CHARS);
  });

  it('describes an empty reply instead of leaving a line that ends after a colon', () => {
    // R104's artefact carried `"MG_E_INVALID_SIGNAL: LLM response is not JSON <- "`: a sample whose
    // quote was empty, beside a count that said everything was fine.
    expect(trialPreview('')).toBe('the reply was empty (0 characters)');
  });

  it('counts the whitespace of a reply that held no visible character', () => {
    expect(trialPreview('\n\n  ')).toBe('the reply held no visible character (4 whitespace character(s))');
  });
});

describe('turning one call into one trial', () => {
  it('counts a claim carrying a condition as the writer having written one', () => {
    const reading = trialOf(LESSON, answeredWith(['the order was already delivered']));
    expect(reading.state).toBe('answered');
    expect(reading.claims).toBe(1);
    expect(reading.withWhen).toBe(1);
    expect(reading.chars).toBeGreaterThan(0);
    expect(reading.preview).toContain('"when":"the order was already delivered"');
  });

  it('keeps a claim with no condition as a claim, and does not count it as a conditioned one', () => {
    const reading = trialOf(LESSON, answeredWith([undefined, 'delivered orders']));
    expect(reading.state).toBe('answered');
    expect(reading.claims).toBe(2);
    expect(reading.withWhen).toBe(1);
  });

  it('refuses a condition that is only whitespace, because the parser would have dropped it', () => {
    const reading = trialOf(LESSON, answeredWith(['   ']));
    expect(reading.claims).toBe(1);
    expect(reading.withWhen).toBe(0);
  });

  it('reads a list of no claims as the writer choosing silence', () => {
    const reading = trialOf(LESSON, { ...answeredWith([]), reply: '{"candidates":[]}' });
    expect(reading.state).toBe('empty');
    expect(reading.claims).toBe(0);
  });

  it('reads a reply with no visible character as blank, not as empty and not as healthy', () => {
    const reading = trialOf(LESSON, { ...answeredWith([]), reply: '\n' });
    expect(reading.state).toBe('blank');
    expect(reading.chars).toBe(1);
    expect(reading.preview).toBe('the reply held no visible character (1 whitespace character(s))');
  });

  it('reads prose as unparsed, which is a writer that answered in a shape the parser cannot read', () => {
    const reading = trialOf(LESSON, { ...answeredWith([]), reply: 'The order was delivered.' });
    expect(reading.state).toBe('unparsed');
  });

  it('keeps the error code and spends no tokens when the call did not return', () => {
    const reading = trialOf(PROCEDURE, { ok: false, code: 'MG_E_PROVIDER_FAILED', sample: 'timeout', ms: 30000 });
    expect(reading.state).toBe('error');
    expect(reading.code).toBe('MG_E_PROVIDER_FAILED');
    expect(reading.preview).toBe('timeout');
    expect(reading.tokens.total).toBe(0);
    expect(reading.withWhen).toBe(0);
  });

  it('refuses a duration that cannot be a duration rather than reporting a negative one', () => {
    expect(trialOf(LESSON, { ...answeredWith(['x']), ms: -5 }).ms).toBe(0);
    expect(trialOf(LESSON, { ...answeredWith(['x']), ms: Number.NaN }).ms).toBe(0);
  });
});

describe('reading the matrix', () => {
  it('says no writer was asked when the grid was empty, which is not a refusal', () => {
    const reading = readWriterProbe([]);
    expect(reading.state).toBe('unanswered');
    expect(reading.errors).toBe(0);
    expect(reading.sentence).toContain('no writer was asked');
  });

  it('says an outage is not a finding when every candidate threw', () => {
    const reading = readWriterProbe([
      trial({ ...LESSON, state: 'error', claims: 0, withWhen: 0, chars: 0, code: 'MG_E_PROVIDER_FAILED' }),
      trial({ ...PROCEDURE, state: 'error', claims: 0, withWhen: 0, chars: 0, code: 'MG_E_PROVIDER_FAILED' }),
    ]);
    expect(reading.state).toBe('unanswered');
    expect(reading.errors).toBe(2);
    expect(reading.sentence).toContain('MG_E_PROVIDER_FAILED');
    expect(reading.sentence).toContain('an outage is not a finding about writers');
  });

  it('reads a grid where everything returned and nothing was usable as no-writer, and counts why', () => {
    const reading = readWriterProbe([
      trial({ ...LESSON, state: 'answered', claims: 1, withWhen: 0 }),
      trial({ ...PROCEDURE, state: 'blank', claims: 0, withWhen: 0, chars: 0 }),
    ]);
    expect(reading.state).toBe('no-writer');
    expect(reading.viable).toEqual([]);
    expect(reading.sentence).toContain('1 answered without one, 0 empty, 1 blank, 0 unparsed, 0 threw');
  });

  it('keeps a refusal readable when part of the grid threw and part of it returned nothing usable', () => {
    // The errors are counted inside the no-writer sentence rather than deciding the verdict: one
    // candidate that answered badly is still an answer about writers.
    const reading = readWriterProbe([
      trial({ ...LESSON, state: 'error', claims: 0, withWhen: 0, chars: 0, code: 'MG_E_STORE_IO' }),
      trial({ ...PROCEDURE, state: 'empty', claims: 0, withWhen: 0 }),
    ]);
    expect(reading.state).toBe('no-writer');
    expect(reading.errors).toBe(1);
    expect(reading.sentence).toContain('0 answered without one, 1 empty, 0 blank, 0 unparsed, 1 threw');
  });

  it('reads one usable writer as viable and names it', () => {
    const reading = readWriterProbe([
      trial({ ...LESSON, withWhen: 2, claims: 2 }),
      trial({ ...PROCEDURE, state: 'blank', claims: 0, withWhen: 0, chars: 0 }),
    ]);
    expect(reading.state).toBe('viable');
    expect(reading.viable).toEqual([LESSON]);
    expect(reading.best).toEqual(LESSON);
    expect(reading.sentence).toContain('1 of 2 candidate writer(s)');
    expect(reading.sentence).toContain('deepseek-flash/lesson with 2 conditioned claim(s) from 2 claim(s)');
  });

  it('does not count a trial whose state is answered but whose claims are conditioned as viable on claims alone', () => {
    // The verdict is `withWhen`, not `claims`: an arm dispatched on a writer that produces claims
    // the store cannot use is the R104 shape one form later.
    const reading = readWriterProbe([trial({ ...LESSON, claims: 3, withWhen: 0 })]);
    expect(reading.state).toBe('no-writer');
  });

  it('prefers the writer with the most conditions when several are viable', () => {
    const reading = readWriterProbe([
      trial({ ...LESSON, withWhen: 1, claims: 2 }),
      trial({ ...PROCEDURE, withWhen: 2, claims: 2 }),
    ]);
    expect(reading.best).toEqual(PROCEDURE);
    expect(reading.viable).toEqual([LESSON, PROCEDURE]);
  });

  it('picks the same writer whichever way round the grid was asked', () => {
    // The comparison has to work in both directions: a grid built from a different model order is
    // the same experiment, and a sort that only demoted one way would name a different writer for it.
    const strong = trial({ ...PROCEDURE, withWhen: 3, claims: 3 });
    const weak = trial({ ...LESSON, withWhen: 1, claims: 1 });
    expect(readWriterProbe([weak, strong]).best).toEqual(PROCEDURE);
    expect(readWriterProbe([strong, weak]).best).toEqual(PROCEDURE);
  });

  it('breaks a tie on conditions with claims, then on the shorter reply', () => {
    const reading = readWriterProbe([
      trial({ model: 'a', form: 'lesson', withWhen: 1, claims: 1, chars: 100 }),
      trial({ model: 'b', form: 'lesson', withWhen: 1, claims: 1, chars: 40 }),
      trial({ model: 'c', form: 'lesson', withWhen: 1, claims: 2, chars: 900 }),
    ]);
    expect(reading.best).toEqual({ model: 'c', form: 'lesson' });
    const shorter = readWriterProbe([
      trial({ model: 'a', form: 'lesson', withWhen: 1, claims: 1, chars: 100 }),
      trial({ model: 'b', form: 'lesson', withWhen: 1, claims: 1, chars: 40 }),
    ]);
    expect(shorter.best).toEqual({ model: 'b', form: 'lesson' });
  });

  it('does not prefer a writer for having spent more time, which is not a quality', () => {
    const reading = readWriterProbe([
      trial({ model: 'slow', form: 'lesson', withWhen: 1, claims: 1, chars: 100, ms: 60_000 }),
      trial({ model: 'fast', form: 'lesson', withWhen: 1, claims: 1, chars: 100, ms: 400 }),
    ]);
    // Equal on every counted quantity, so the first asked keeps the place rather than the slower one
    // winning on a duration nothing in the verdict reads.
    expect(reading.best).toEqual({ model: 'slow', form: 'lesson' });
  });

  it('keeps the order when two writers are equal on every counted quantity', () => {
    // `chars` is a tie-break, and two writers can tie on it too. The sort must then be a no-op
    // rather than a reshuffle, or the same artefact read twice names two different writers.
    const reading = readWriterProbe([
      trial({ model: 'first', form: 'procedure', withWhen: 1, claims: 1, chars: 120 }),
      trial({ model: 'second', form: 'procedure', withWhen: 1, claims: 1, chars: 120 }),
    ]);
    expect(reading.viable.map((c) => c.model)).toEqual(['first', 'second']);
    expect(reading.best).toEqual({ model: 'first', form: 'procedure' });
  });

  it('names a thrown call with no code rather than printing an empty parenthesis', () => {
    // The type allows an error trial without a code, and a reader that printed `(undefined)` would
    // make the one line that explains an outage the line a reader skips.
    const reading = readWriterProbe([
      { ...trial({ ...LESSON, state: 'error', claims: 0, withWhen: 0, chars: 0 }), code: undefined },
    ]);
    expect(reading.state).toBe('unanswered');
    expect(reading.sentence).toContain('(unknown)');
  });
});

describe('asking the grid', () => {
  it('asks every candidate once, in order, and folds the outcome into a trial', async () => {
    const asked: string[] = [];
    const reading = await probeWriters([LESSON, PROCEDURE], async (candidate) => {
      asked.push(writerLabel(candidate));
      return candidate.form === 'lesson'
        ? answeredWith(['delivered orders'])
        : { ...answeredWith([]), reply: '' };
    });
    expect(asked).toEqual(['deepseek-flash/lesson', 'deepseek-flash/procedure']);
    expect(reading.trials.map((entry) => entry.state)).toEqual(['answered', 'blank']);
    expect(reading.state).toBe('viable');
    expect(reading.best).toEqual(LESSON);
  });

  it('asks sequentially rather than at once, because eight simultaneous calls are a burst', async () => {
    let inFlight = 0;
    let peak = 0;
    await probeWriters([LESSON, PROCEDURE], async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return answeredWith(['x']);
    });
    expect(peak).toBe(1);
  });

  it('carries the spent tokens, because a probe whose price is not recorded cannot be budgeted', async () => {
    const reading = await probeWriters([LESSON], async () => ({
      ok: true as const,
      reply: '[]',
      claims: [],
      tokens: SPENT,
      ms: 12,
    }));
    expect(reading.trials[0]?.tokens).toEqual(SPENT);
    expect(reading.trials[0]?.ms).toBe(12);
  });
});

describe('the step summary', () => {
  const meta = { context: 'fixture:retail', thinking: 'off', maxTokens: 700 };

  it('renders the verdict, the table, and the pair to dispatch on', () => {
    const markdown = writerProbeMarkdown(
      readWriterProbe([
        trial({ ...LESSON, withWhen: 2, claims: 2, chars: 130, tokens: SPENT }),
        trial({ ...PROCEDURE, state: 'blank', claims: 0, withWhen: 0, chars: 0 }),
      ]),
      meta,
    );
    expect(markdown).toContain('### viable');
    expect(markdown).toContain('| writer | state | claims | with a `when` | chars | tokens |');
    expect(markdown).toContain('| `deepseek-flash/lesson` | answered | 2 | 2 | 130 | 1490 |');
    expect(markdown).toContain('Dispatch on `deepseek-flash/lesson`');
    expect(markdown).toContain('`thinking: off`');
  });

  it('tells a reader not to dispatch when no writer wrote a conditioned claim', () => {
    const markdown = writerProbeMarkdown(
      readWriterProbe([trial({ ...LESSON, state: 'blank', claims: 0, withWhen: 0, chars: 0 })]),
      meta,
    );
    expect(markdown).toContain('### no-writer');
    expect(markdown).toContain('**Do not dispatch this arm on this backend.**');
    expect(markdown).not.toContain('Dispatch on');
  });
});

describe('the candidate grid', () => {
  it('builds the cross product of models and forms, model-major', () => {
    expect(candidateGrid(['m1', 'm2'], ['lesson', 'procedure'])).toEqual([
      { model: 'm1', form: 'lesson' },
      { model: 'm1', form: 'procedure' },
      { model: 'm2', form: 'lesson' },
      { model: 'm2', form: 'procedure' },
    ]);
  });

  it('drops a pair named twice, because two calls for one reading is a cost with no finding', () => {
    expect(candidateGrid(['m1', 'm1'], ['lesson'])).toEqual([{ model: 'm1', form: 'lesson' }]);
  });

  it('trims a model id rather than sending an id with a space in it', () => {
    expect(candidateGrid([' m1 '], ['lesson'])).toEqual([{ model: 'm1', form: 'lesson' }]);
  });

  it('refuses an empty model id before a call is spent on it', () => {
    expect(() => candidateGrid(['  '], ['lesson'])).toThrow('a writer candidate needs a model id');
  });

  it('returns an empty grid for an empty form list, which the reader calls unanswered', () => {
    expect(candidateGrid(['m1'], [])).toEqual([]);
    expect(readWriterProbe(candidateGrid(['m1'], []).map((c) => trial(c))).state).toBe('unanswered');
  });
});
