/**
 * Inverted index over knowledge statements.
 *
 * A linear scan would be correct and too slow the moment a host accumulates a
 * year of corrections. The index is rebuilt on open from the journal, which is
 * the honest cost of an embedded, crash-safe store: no separate index file to
 * fall out of sync with the data.
 */
import { tokenize } from '../kernel/index.js';

export class LexicalIndex {
  private readonly postings = new Map<string, Set<string>>();
  private readonly documents = new Map<string, { tokens: string[]; length: number }>();
  private totalLength = 0;

  public add(id: string, text: string): void {
    this.remove(id);
    const tokens = tokenize(text);
    this.documents.set(id, { tokens, length: tokens.length });
    this.totalLength += tokens.length;
    for (const token of tokens) {
      let bucket = this.postings.get(token);
      if (!bucket) {
        bucket = new Set<string>();
        this.postings.set(token, bucket);
      }
      bucket.add(id);
    }
  }

  public remove(id: string): void {
    const existing = this.documents.get(id);
    if (!existing) return;
    this.documents.delete(id);
    this.totalLength -= existing.length;
    for (const token of new Set(existing.tokens)) {
      const bucket = this.postings.get(token);
      if (!bucket) continue;
      bucket.delete(id);
      if (bucket.size === 0) this.postings.delete(token);
    }
  }

  /** Candidate ids whose documents mention at least one query token. */
  public candidates(queryTokens: readonly string[]): Set<string> {
    const result = new Set<string>();
    for (const token of queryTokens) {
      const bucket = this.postings.get(token);
      if (!bucket) continue;
      for (const id of bucket) result.add(id);
    }
    return result;
  }

  public documentFrequency(token: string): number {
    return this.postings.get(token)?.size ?? 0;
  }

  public documentCount(): number {
    return this.documents.size;
  }

  public averageLength(): number {
    if (this.documents.size === 0) return 0;
    return this.totalLength / this.documents.size;
  }

  public tokensOf(id: string): readonly string[] {
    return this.documents.get(id)?.tokens ?? [];
  }

  public lengthOf(id: string): number {
    return this.documents.get(id)?.length ?? 0;
  }
}
