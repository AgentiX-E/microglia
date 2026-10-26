/**
 * A distillation cache that survives the process, because the treatment has to survive it too.
 *
 * Every dispatch of the benchmark distils its rules from model replies, so the *store* — not
 * just the measurement — is resampled each run. Three dispatches of identical code produced
 * `full` deltas of −3.71pp, −4.00pp and +0.86pp against baselines that themselves moved from
 * 54.00% to 52.57%: the arm called "memory on" was not the same arm. Comparing two arms
 * inside one run is still valid, because they share a store; comparing one arm across runs is
 * not, and a programme whose whole method is cross-run replication cannot afford that.
 *
 * The cache does not make the model deterministic. It makes a *replayed* run identical to the
 * one before it: the same prompts return the same replies, so the same events distil into the
 * same rules, and an arm comparison across dispatches finally varies in one thing.
 *
 * Keyed by model, prompt version and the prompt text. The prompt already carries the event, so
 * its digest covers what was learned; the model and version are in the key because the same
 * promise from a different model is a different fact.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type DistillCacheStats = { readonly hits: number; readonly misses: number; readonly size: number };

export class DistillCache {
  private readonly entries: Map<string, string>;
  private hits = 0;
  private misses = 0;
  private readonly path: string | undefined;

  private constructor(entries: Map<string, string>, path: string | undefined) {
    this.entries = entries;
    this.path = path;
  }

  /**
   * Read a cache from disk, tolerating a missing file and a corrupt one.
   *
   * A corrupt cache is a warning rather than a failure: the run can always pay for its
   * replies again, and refusing to start because a cache file was truncated would turn a
   * performance optimisation into an availability dependency.
   */
  public static load(path: string | undefined): DistillCache {
    if (path === undefined || path === '' || !existsSync(path)) return new DistillCache(new Map(), path);
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
      if (typeof parsed !== 'object' || parsed === null) return new DistillCache(new Map(), path);
      const entries = new Map<string, string>();
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value === 'string') entries.set(key, value);
      }
      return new DistillCache(entries, path);
    } catch {
      return new DistillCache(new Map(), path);
    }
  }

  public static keyOf(model: string, promptVersion: string, prompt: string): string {
    return createHash('sha256').update(`${model}\u0000${promptVersion}\u0000${prompt}`).digest('hex').slice(0, 32);
  }

  public get(key: string): string | undefined {
    const hit = this.entries.get(key);
    if (hit === undefined) {
      this.misses += 1;
      return undefined;
    }
    this.hits += 1;
    return hit;
  }

  public set(key: string, reply: string): void {
    this.entries.set(key, reply);
  }

  public get stats(): DistillCacheStats {
    return { hits: this.hits, misses: this.misses, size: this.entries.size };
  }

  /**
   * Write atomically, so an interrupted run cannot leave a half-written cache behind.
   *
   * A cache that is half a file is worse than no cache: the next run would load what it
   * could and silently distil a store that is neither this run's nor that one's.
   */
  public save(): void {
    if (this.path === undefined || this.path === '') return;
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.partial`;
    writeFileSync(temporary, JSON.stringify(Object.fromEntries([...this.entries].sort())), 'utf8');
    renameSync(temporary, this.path);
  }
}
