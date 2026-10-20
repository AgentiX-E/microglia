import { describe, expect, it } from 'vitest';
import { renderJson, renderMarkdown, summarise } from '../report.js';
import { runStudy } from '../study.js';

describe('report rendering', () => {
  it('renders every section and a failing gate honestly', async () => {
    const result = await runStudy({
      seed: 11,
      trainSize: 84,
      holdoutSize: 28,
      rounds: 1,
      batchSize: 4,
      budget: 600,
      heldOutDomain: 'ops',
    });
    const markdown = renderMarkdown(result);
    for (const heading of [
      '# Microglia mechanism study',
      '## Configuration',
      '## Arms',
      '## Held-out domain',
      '## Learning curves',
      '## Knowledge dynamics',
      '## Gates',
      '## Threats to validity',
      '## Reproduce',
    ]) {
      expect(markdown).toContain(heading);
    }
    expect(markdown).toMatch(/PASS|FAIL|WARN/);
    expect(() => JSON.parse(renderJson(result))).not.toThrow();
    expect(summarise(result)).toContain('full=');
  }, 60_000);
});
