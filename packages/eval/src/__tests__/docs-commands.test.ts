/**
 * The guide's commands have to exist.
 *
 * R127 wrote three lines of `USER-GUIDE.md` that told a reader to run `pnpm eval:tau2`. There is no such
 * script. The page was committed, the gates were green, and the failure would have surfaced as a user's
 * terminal rather than as a build — which is the same class as a `TAU_*` the source reads and no workflow can
 * set, and it has the same fix: read the surface the documentation is about and compare it to the surface the
 * repository ships.
 *
 * The check is deliberately narrow. It reads fenced code blocks and inline backticks for `pnpm <script>`,
 * compares each name against `package.json`, and ignores anything that is not a script invocation. A guide is
 * allowed to name a directory, a file or a workflow input; it is not allowed to name a command that does not
 * run.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

function shippedScripts(): Set<string> {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  return new Set(Object.keys(pkg.scripts ?? {}));
}

/** Every `pnpm <name>` the guide mentions, with the page that mentions it. */
function mentionedCommands(): { name: string; page: string }[] {
  const found: { name: string; page: string }[] = [];
  for (const page of readdirSync(join(ROOT, 'docs'))) {
    if (!page.endsWith('.md')) continue;
    const text = readFileSync(join(ROOT, 'docs', page), 'utf8');
    for (const match of text.matchAll(/pnpm (?:run )?([a-z0-9:_-]+)/g)) {
      const name = match[1] as string;
      // `--` flags and the package-manager's own verbs are not scripts.
      if (name.startsWith('-')) continue;
      found.push({ name, page });
    }
  }
  return found;
}

describe('the commands the guide tells a reader to run', () => {
  it('all exist in package.json', () => {
    const scripts = shippedScripts();
    const missing = mentionedCommands().filter((entry) => !scripts.has(entry.name));
    expect(
      missing.map((entry) => `${entry.page}: pnpm ${entry.name}`),
      'a guide that names a script the repository does not ship sends a reader to a failing terminal',
    ).toEqual([]);
  });

  it('finds the pages it claims to check, so a silent walk cannot pass for a clean one', () => {
    // The failure this guards is a glob that matches nothing: every assertion above would then pass
    // vacuously, which is the shape `R126`'s census made familiar one denominator up.
    const commands = mentionedCommands();
    expect(commands.length).toBeGreaterThan(50);
    expect(new Set(commands.map((entry) => entry.page)).size).toBeGreaterThan(1);
  });
});
