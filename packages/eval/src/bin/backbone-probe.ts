/**
 * Refuse a dispatch that named a model its host does not list, before the first call.
 *
 * The lane's own failure mode for a wrong model id is quiet and expensive: `402`/`404` per prompt,
 * classified as a refusal, an eight-prompt breaker, and an artefact whose `model_endpoint` field says
 * "the endpoint stopped answering" about a host that answered every time. Twenty minutes and about a
 * dollar to learn that a string was wrong, and the string was in the dispatch.
 *
 * So the dispatch asks the provider's catalogue first. Ten seconds, one request, and the served list
 * printed when the answer is no. **`unlistable` does not fail the step**: a host may serve chat
 * completions and no catalogue, and a check that cannot run must not veto a run — it records that it
 * could not see, which is a different fact from seeing nothing. Only `absent` refuses.
 *
 * Usage: pnpm eval:backbone-probe --out <file>
 * Reads SOTA_MODEL, SOTA_ENDPOINT / DEEPSEEK_ENDPOINT and the credential the lane would spend.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { catalogueLine, probeBackbone } from '../backbone.js';
import { planCredential, hostOf } from '../credential.js';
import { DEFAULT_CHAT_ENDPOINT, restModelOf } from '../model-client.js';

function outArgOf(argv: readonly string[]): string {
  const at = argv.indexOf('--out');
  if (at === -1) {
    throw new Error('this probe writes what it saw; pass --out <file> so the run can carry it');
  }
  const value = argv[at + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error('--out needs a path');
  }
  return value;
}

async function main(): Promise<void> {
  const out = outArgOf(process.argv.slice(2));
  const configured = (process.env['SOTA_MODEL'] ?? 'deepseek-flash').trim();
  const endpoint = (process.env['SOTA_ENDPOINT'] ?? process.env['DEEPSEEK_ENDPOINT'] ?? '').trim();
  const credential = planCredential({
    sotaKey: process.env['SOTA_API_KEY'],
    deepseekKey: process.env['DEEPSEEK_API_KEY'],
    endpointHost: endpoint === '' ? '' : hostOf(endpoint),
  });

  const reading =
    credential.key === ''
      ? {
          model: restModelOf(configured).sent,
          configured,
          verdict: 'unlistable' as const,
          url: '',
          models: [] as readonly string[],
          why: 'no credential is configured, so the catalogue was not asked',
        }
      : await probeBackbone({ endpoint, model: configured, apiKey: credential.key });

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(reading, null, 2)}\n`);
  const where = reading.url === '' ? DEFAULT_CHAT_ENDPOINT : reading.url;
  process.stdout.write(
    `${catalogueLine(reading)}\n[backbone] model=${reading.model} host=${hostOf(where)} ` +
      `credential=${credential.source} catalogue=${out}\n`,
  );

  if (reading.verdict !== 'absent') return;
  process.stderr.write(
    '[backbone] the host does not list this model, and a run that names it spends its budget learning ' +
      'that at the four-hundredth call rather than at the first. Set the dispatch\'s `backbone` (or the ' +
      'repository variable `SOTA_MODEL`) to one of the ids above.\n',
  );
  process.exitCode = 1;
}

await main();
