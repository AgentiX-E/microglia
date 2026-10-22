#!/usr/bin/env node
/**
 * Repository audit: the rules that are cheaper to enforce than to review.
 *
 * Every check here exists because it caught — or would have caught — a real
 * mistake in this repository. The audit is part of `pnpm check`, so a violation
 * fails the build rather than living in a style guide.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const failures = [];
const fail = (check, message) => failures.push(`${check}: ${message}`);

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
    if (entry.name === 'coverage' || entry.name === '.cache') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

const isCode = (path) => path.endsWith('.ts') || path.endsWith('.mjs');
const isTest = (path) => path.includes('__tests__') || path.endsWith('.test.ts');

const RUNTIME_ALLOWLIST = {
  'packages/node/package.json': new Set(['hono', '@hono/node-server']),
};

const SECRET = /\b(sk-[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9]{20,})\b/;
const CJK = /[\u4e00-\u9fff]/;
const FORBIDDEN = [
  { pattern: /\bTODO\b|\bFIXME\b|\bXXX\b|\bHACK\b/, why: 'unfinished marker' },
  { pattern: /v8 ignore|istanbul ignore|c8 ignore/, why: 'coverage suppression' },
  { pattern: /\bas any\b|:\s*any\b|<any>/, why: 'untyped escape hatch' },
  { pattern: /\.skip\(|\.todo\(/, why: 'skipped test' },
  { pattern: /\bonly\(/, why: 'focused test' },
  { pattern: /console\.(log|debug)\(/, why: 'stray logging' },
];

for await (const path of walk(ROOT)) {
  const rel = relative(ROOT, path);
  if (rel.startsWith('poc/results') || rel.startsWith('bench/results')) continue;
  // The audit states the forbidden patterns as data, so it cannot be scanned by
  // the same rules without matching its own source.
  if (rel === 'scripts/audit.mjs') continue;
  if (!isCode(rel)) continue;
  const text = await readFile(path, 'utf8');
  for (const line of text.split('\n')) {
    if (SECRET.test(line)) fail('secrets', `${rel}: looks like a credential`);
    if (CJK.test(line)) fail('language', `${rel}: non-English text in code`);
  }
  if (isTest(rel)) continue;
  for (const rule of FORBIDDEN) {
    if (rule.pattern.test(text)) fail('code-quality', `${rel}: ${rule.why}`);
  }
}

// Package manifests: the exports contract a consumer depends on.
for await (const path of walk(join(ROOT, 'packages'))) {
  if (!path.endsWith('package.json')) continue;
  const rel = relative(ROOT, path);
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  for (const field of ['name', 'version', 'license', 'type', 'exports', 'files']) {
    if (manifest[field] === undefined) fail('manifest', `${rel}: missing ${field}`);
  }
  if (manifest.sideEffects !== false) fail('manifest', `${rel}: sideEffects must be false`);
  if (manifest.engines?.node === undefined) fail('manifest', `${rel}: missing engines.node`);
  // Internal packages are the point of a monorepo; an external runtime
  // dependency is what would break the zero-install and browser guarantees.
  //
  // One package is allowed a named exception: the server speaks HTTP and nothing
  // else, so it may depend on a router. The allowlist is exact — adding a second
  // dependency to `node`, or any dependency to `core` or `browser`, is a decision
  // that has to be written here rather than discovered in a lockfile.
  const allowed = RUNTIME_ALLOWLIST[rel] ?? new Set();
  const external = Object.keys(manifest.dependencies ?? {}).filter(
    (name) => !name.startsWith('@agentix-e/') && !allowed.has(name),
  );
  if (external.length > 0) {
    fail('manifest', `${rel}: external runtime dependency (${external.join(', ')})`);
  }
}

// Workflows: no soft failures. A green build must mean the checks ran.
for await (const path of walk(join(ROOT, '.github'))) {
  if (!path.endsWith('.yml') && !path.endsWith('.yaml')) continue;
  const rel = relative(ROOT, path);
  const text = await readFile(path, 'utf8');
  if (/continue-on-error:\s*true/.test(text)) fail('workflow', `${rel}: continue-on-error`);
  if (/\|\|\s*true/.test(text)) fail('workflow', `${rel}: "|| true" masks failures`);
  if (/\bnpx\s+.*--no-verify\b/.test(text)) fail('workflow', `${rel}: skipped hooks`);
}

// The repository must carry both documents a reader needs.
for (const doc of ['README.md', 'docs/USER-GUIDE.md', 'docs/ARCHITECTURE.md', 'docs/GLOSSARY.md']) {
  const exists = await stat(join(ROOT, doc)).then(() => true, () => false);
  if (!exists) fail('docs', `${doc} is missing`);
}

// The repository boundary, enforced rather than remembered.
//
// This repo is the product and the evidence that gates it: code, the external
// documents a developer needs, and the workflows that run both. Internal records
// — the whitepaper, the technical design, the roadmap, the audit, the progress
// log — live in `microglia-docs`, because they describe the project rather than
// the library. Keeping the list here means a document that drifts back is a red
// build instead of a slow untangling two releases later.
for (const internal of ['WHITEPAPER.md', 'TECH-DESIGN.md', 'ROADMAP.md', 'AUDIT.md', 'PROGRESS.md']) {
  const exists = await stat(join(ROOT, internal)).then(() => true, () => false);
  if (exists) fail('boundary', `${internal} belongs in microglia-docs, not here`);
  const nested = await stat(join(ROOT, 'docs', internal)).then(() => true, () => false);
  if (nested) fail('boundary', `docs/${internal} belongs in microglia-docs, not here`);
}

// What ships is what can hurt a consumer. The library declares no runtime
// dependency at all, so this is a statement about the artefact rather than a
// formality; dev-only advisories are reported separately in the audit document
// with the toolchain migration that clears them.
{
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  try {
    await promisify(execFile)('pnpm', ['audit', '--prod'], { cwd: ROOT });
  } catch (error) {
    fail('dependencies', `published dependencies have advisories: ${String(error).slice(0, 200)}`);
  }
}

if (failures.length > 0) {
  process.stderr.write(`audit failed (${failures.length})\n`);
  for (const failure of failures) process.stderr.write(`  - ${failure}\n`);
  process.exit(1);
}
process.stdout.write('audit: ok\n');
