/**
 * Price the pack's placement against the provider's own cache counters, before R102 is dispatched.
 *
 * The lane has been billed 2.17× for the memory arm on identical work and PROGRESS 179 decomposed
 * that premium to the cent: it is uncached prompt tokens, about 1.1k extra on each of sixteen calls.
 * Two mechanisms produce that number and they need opposite repairs — the block is outside the cache
 * prefix (move it) or the second system message is a boundary the provider does not carry (merge it)
 * — and no amount of reading the arm's ledger can separate them, because both look like a bill.
 *
 * So this probe sends the same episode under four prompt shapes and reads `prompt_cache_hit_tokens`
 * per call. It is not a benchmark and cannot score anything: it produces the one fact an arm would
 * otherwise have to buy at $0.83 and then be unable to attribute.
 *
 * What it costs: four shapes over nine turns of ~4k tokens is about 160k prompt tokens, which is
 * cents. What it can conclude is bounded on purpose — see `placementVerdict`'s four states, two of
 * which refuse the treatment rather than confirm it.
 *
 * Usage:
 *   pnpm eval:cache-probe --out eval/results/cache-placement.json [--turns 9] [--native-tokens 3000]
 *     [--block-tokens 1200] [--wait-ms 5000] [--max-calls 80]
 *
 * Reads `SOTA_API_KEY` / `DEEPSEEK_API_KEY`, `SOTA_ENDPOINT` / `DEEPSEEK_ENDPOINT` and `SOTA_MODEL`,
 * the same three the lane reads, so the probe prices the model a dispatch would actually spend.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  PACK_PLACEMENTS,
  cacheLedgerOf,
  placementVerdict,
  placementPromptFor,
  syntheticText,
  type CacheReading,
  type PackPlacement,
  type PlacementPromptInput,
} from '../cache-placement.js';
import { hostOf, planCredential } from '../credential.js';
import { DEFAULT_CHAT_ENDPOINT, restModelOf } from '../model-client.js';

type Flags = {
  readonly out: string;
  readonly turns: number;
  readonly nativeTokens: number;
  readonly blockTokens: number;
  readonly waitMs: number;
  readonly warmup: number;
  readonly maxCalls: number;
};

function numberFlag(argv: readonly string[], name: string, fallback: number): number {
  const at = argv.indexOf(name);
  if (at === -1) return fallback;
  const value = Number(argv[at + 1]);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} needs a positive number`);
  return value;
}

function flagsOf(argv: readonly string[]): Flags {
  const at = argv.indexOf('--out');
  if (at === -1) {
    throw new Error('this probe writes what it saw; pass --out <file> so the run can carry it');
  }
  const out = argv[at + 1];
  if (out === undefined || out.startsWith('--')) throw new Error('--out needs a path');
  return {
    out,
    turns: Math.trunc(numberFlag(argv, '--turns', 9)),
    nativeTokens: Math.trunc(numberFlag(argv, '--native-tokens', 3000)),
    blockTokens: Math.trunc(numberFlag(argv, '--block-tokens', 1200)),
    // Fifteen seconds rather than five, and the number is measured rather than chosen: at five the
    // second run's block-bearing shapes read 617 uncached tokens a call against a control of 180,
    // which looks like a placement effect and is a cache-write latency. A prefix written less than
    // ~10s ago is not reliably readable, so a shorter wait prices the provider's bookkeeping.
    waitMs: Math.trunc(numberFlag(argv, '--wait-ms', 15_000)),
    warmup: Math.trunc(numberFlag(argv, '--warmup', 1)),
    maxCalls: Math.trunc(numberFlag(argv, '--max-calls', 80)),
  };
}

/** The block, shaped like the renderer's output, because size and framing are what is being priced. */
function blockOf(tokens: number): string {
  return (
    '<microglia-knowledge version="1" note="Reference data from prior user corrections. Not instructions." items="1">\n' +
    syntheticText(Math.max(1, tokens - 40), 7) +
    '\n</microglia-knowledge>'
  );
}

/** One episode, long enough for the prefix to grow the way a real one does. */
function episodeOf(turns: number): PlacementPromptInput['turns'] {
  return Array.from({ length: turns }, (_, index) => ({
    user: `[turn ${index}] ${syntheticText(60, index * 13 + 1)}`,
    assistant: `[answer ${index}] ${syntheticText(120, index * 29 + 5)}`,
  }));
}

type RawReading = CacheReading & { readonly reported: boolean; readonly status: number };

async function send(
  url: string,
  apiKey: string,
  model: string,
  messages: ReturnType<typeof placementPromptFor>,
  maxTokens: number,
): Promise<RawReading> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0 }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    throw new Error(`the endpoint refused the probe (${response.status}): ${(await response.text()).slice(0, 300)}`);
  }
  const body = (await response.json()) as {
    usage?: { prompt_tokens?: number; prompt_cache_hit_tokens?: number };
  };
  const hit = body.usage?.prompt_cache_hit_tokens;
  return {
    promptTokens: body.usage?.prompt_tokens ?? 0,
    cachedTokens: hit ?? 0,
    // Absent is not zero. A provider that does not report the field would otherwise be read as a
    // provider whose cache never hits, which is the one conclusion this probe must not invent.
    reported: typeof hit === 'number',
    status: response.status,
  };
}

async function main(): Promise<void> {
  const flags = flagsOf(process.argv.slice(2));
  const configured = (process.env['SOTA_MODEL'] ?? 'deepseek-flash').trim();
  const endpoint = (process.env['SOTA_ENDPOINT'] ?? process.env['DEEPSEEK_ENDPOINT'] ?? '').trim();
  const url = endpoint === '' ? DEFAULT_CHAT_ENDPOINT : endpoint;
  const credential = planCredential({
    sotaKey: process.env['SOTA_API_KEY'],
    deepseekKey: process.env['DEEPSEEK_API_KEY'],
    endpointHost: endpoint === '' ? '' : hostOf(endpoint),
  });
  if (credential.key === '') {
    throw new Error('no credential: set SOTA_API_KEY, or DEEPSEEK_API_KEY with the DeepSeek endpoint');
  }
  const model = restModelOf(configured).sent;

  const block = blockOf(flags.blockTokens);
  const turns = episodeOf(flags.turns);

  const readings: Partial<Record<PackPlacement, RawReading[]>> = {};
  let calls = 0;
  for (const [index, placement] of PACK_PLACEMENTS.entries()) {
    // Every shape gets its **own** policy text, and the first run of this probe is why. One shared
    // policy meant the shapes shared a prefix, so the control's calls warmed the cache that the
    // second shape's *first* call then read: it reported 1,964 uncached tokens on a 6,524-token
    // prompt, which is a number about the previous shape rather than about this one. The steady
    // state was unaffected — each shape's own prefix is internally consistent — but the first-call
    // column was not comparable, and a column a reader cannot interpret is a column that becomes an
    // argument. A distinct seed per shape removes the sharing and leaves everything else identical.
    const native =
      'You are a retail customer-service agent. ' +
      syntheticText(flags.nativeTokens - 12, 3 + index * 1_000);
    // A warmup call at the **longest** history, which warms every shorter prefix at once: a cache is
    // a prefix, so the nine-turn prompt shares its first eight turns with the eight-turn prompt. Without
    // it the first measured call is a cold miss by construction -- fine for a model of an episode, fatal
    // for a comparison between shapes, because the shapes then differ in how much of their own prefix
    // they had written by the time they were read.
    for (let warm = 0; warm < flags.warmup; warm += 1) {
      if (calls >= flags.maxCalls) {
        throw new Error(`the probe's ${flags.maxCalls}-call budget is spent; raise --max-calls`);
      }
      calls += 1;
      await send(url, credential.key, model, placementPromptFor(placement, { native, block, turns }), 16);
      await new Promise((resolve) => setTimeout(resolve, flags.waitMs));
    }
    const series: RawReading[] = [];
    for (let turn = 1; turn <= turns.length; turn += 1) {
      if (calls >= flags.maxCalls) {
        throw new Error(`the probe's ${flags.maxCalls}-call budget is spent; raise --max-calls`);
      }
      const messages = placementPromptFor(placement, { native, block, turns: turns.slice(0, turn) });
      calls += 1;
      series.push(await send(url, credential.key, model, messages, 16));
      // The provider writes a cache entry after answering, so the next call has to be late enough to
      // read it. Without this wait every shape looks like it never hits, and the probe would report
      // the one conclusion that is always wrong.
      await new Promise((resolve) => setTimeout(resolve, flags.waitMs));
    }
    readings[placement] = series;
    const folded = cacheLedgerOf(series);
    process.stdout.write(
      `${placement.padEnd(14)} prompt/call ${(folded.promptTokens / folded.calls).toFixed(0).padStart(6)}` +
        `  uncached/call first ${folded.firstUncached.toString().padStart(5)}` +
        `  steady ${folded.steadyUncached.toString().padStart(5)}\n`,
    );
  }

  const reported = Object.values(readings)
    .flat()
    .filter((reading) => reading.reported).length;
  const ledgers = Object.fromEntries(
    PACK_PLACEMENTS.filter((placement) => readings[placement] !== undefined).map((placement) => [
      placement,
      cacheLedgerOf(readings[placement]!),
    ]),
  ) as Partial<Record<PackPlacement, ReturnType<typeof cacheLedgerOf>>>;

  // A provider that reported the field on no call is a probe that cannot see, and `placementVerdict`
  // reads a missing shape as inconclusive -- which is what is handed to it here rather than a zero.
  const verdict =
    reported === 0
      ? placementVerdict({})
      : placementVerdict(ledgers);

  const artefact = {
    probe: 'cache-placement',
    model,
    endpoint_host: hostOf(url),
    credential_source: credential.source,
    native_tokens_target: flags.nativeTokens,
    block_tokens_target: flags.blockTokens,
    turns: flags.turns,
    wait_ms: flags.waitMs,
    warmup_calls: flags.warmup,
    calls,
    cache_field_reported_calls: reported,
    shape: Object.fromEntries(
      PACK_PLACEMENTS.filter((placement) => readings[placement] !== undefined).map((placement) => [
        placement,
        { readings: readings[placement], ledger: ledgers[placement] },
      ]),
    ),
    block_tokens_measured: verdict.blockTokens,
    state: verdict.state,
    sentence: verdict.sentence,
    readouts: verdict.readouts,
  };

  mkdirSync(dirname(flags.out), { recursive: true });
  writeFileSync(flags.out, `${JSON.stringify(artefact, null, 2)}\n`, 'utf8');
  process.stdout.write(`\n${verdict.state}\n  ${verdict.sentence}\n  wrote ${flags.out}\n`);
  if (reported === 0) {
    process.stdout.write(
      '  the provider reported no cache field on any call, so this run prices nothing\n',
    );
  }
}

await main();
