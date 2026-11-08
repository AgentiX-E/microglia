import { describe, expect, it } from 'vitest';
import type { DistillCandidate } from '@agentix-e/microglia-core';
import {
  TAU2_DISTILL_FORM,
  guardAgainstToolNames,
  matchesToolName,
  toolInventoryOf,
  toolNameCensus,
} from '../tau2-register.js';

/**
 * R56's instrument: the register a claim is written in, and the ban that makes the register real.
 *
 * R54's store was conditioned (20 of 20) and delivered (1951 of 1951 requests), and its rules shared
 * 8.33% of the request's own terms. Reading the items said why: every condition was written in the
 * procedure's register — *"a request of this shape is resolved by calling find_user, then
 * cancel_pending_order"* — because the `lesson` form's guidance asks `when` to name a property "the
 * reader can check on a different input: which tables or columns it involves". In a lane whose input
 * is a customer asking to cancel an order there is no column, so the model named the tools.
 *
 * Two objects are needed to test that reading, and they are the two this file builds: a mechanical
 * share (no judge) so the claim is falsifiable, and a host-side ban so the prompt's instruction has
 * an enforcement that does not depend on the model obeying it.
 */

const candidate = (statement: string, when?: string): DistillCandidate => ({
  namespace: 'tau2',
  kind: 'procedure',
  scope: { task: 'tau2.act', domain: 'retail' },
  statement,
  ...(when === undefined ? {} : { when }),
  evidence: { feedbackId: 'fb_1', runId: 'run_1', at: 1_700_000_000_000, weight: 0.9, taskId: 't1' },
  trust: 0.9,
  dedupeKey: 'tau2|procedure|k',
});

describe('the τ² register', () => {
  it('asks for the procedural form, and says which form that is', () => {
    // One variable, declared where a reader of the code can see it and a readback can record it: an
    // artefact that cannot say which form ran would let two runs of one form read as an experiment
    // of two, which is R56's own `NO_MEASUREMENT` condition.
    expect(TAU2_DISTILL_FORM).toBe('procedure');
  });
});

describe('the tool inventory a claim may not name', () => {
  it('collects the action names the learning tasks actually used, once each', () => {
    const inventory = toolInventoryOf([
      { actions: [{ name: 'find_user' }, { name: 'cancel_pending_order' }] },
      { actions: [{ name: 'cancel_pending_order' }, { name: 'get_order_details' }] },
    ]);
    expect(inventory).toEqual(['cancel_pending_order', 'find_user', 'get_order_details']);
  });

  it('drops names too short to be evidence of anything', () => {
    // A one- or two-character tool name would match inside ordinary words and the ban would refuse
    // every candidate for a reason that has nothing to do with the register. τ²'s own names are
    // longer than this, so the floor costs nothing real and removes a whole class of false positives.
    const inventory = toolInventoryOf([{ actions: [{ name: 'go' }, { name: 'run' }, { name: 'lookup' }] }]);
    expect(inventory).toEqual(['lookup']);
  });

  it('ignores an empty or whitespace name rather than inventing one', () => {
    const inventory = toolInventoryOf([{ actions: [{ name: '' }, { name: '   ' }, { name: 'issue_refund' }] }]);
    expect(inventory).toEqual(['issue_refund']);
  });

  it('is empty when nothing was learned from a tool call', () => {
    // Reachable: a learn split whose every task passed has no corrections at all. The ban is then
    // vacuous, and the artefact records an empty inventory rather than a ban that silently "held".
    expect(toolInventoryOf([])).toEqual([]);
  });

  it('matches a name inside a sentence, case-insensitively', () => {
    expect(matchesToolName('Then call cancel_pending_order.', ['cancel_pending_order'])).toBe(true);
    expect(matchesToolName('Then call CANCEL_PENDING_ORDER.', ['cancel_pending_order'])).toBe(true);
    expect(matchesToolName('When the customer asks to cancel an order.', ['cancel_pending_order'])).toBe(false);
  });

  it('does not match on an empty inventory, whatever the sentence says', () => {
    expect(matchesToolName('Call cancel_pending_order.', [])).toBe(false);
  });
});

describe('the host-side ban', () => {
  it('refuses a claim whose statement names a tool, and counts the refusal', () => {
    const guard = guardAgainstToolNames(['cancel_pending_order']);
    expect(guard.accept(candidate('Call cancel_pending_order to resolve this.'))).toBe(false);
    expect(guard.refused()).toBe(1);
  });

  it('refuses a claim whose condition names a tool', () => {
    // The condition is the half retrieval reads, so a tool name there is the defect R54 measured
    // even when the statement itself is in the user's register.
    const guard = guardAgainstToolNames(['find_user']);
    expect(
      guard.accept(candidate('Ask the customer to confirm the order first.', 'when find_user returns a match')),
    ).toBe(false);
    expect(guard.refused()).toBe(1);
  });

  it('accepts a claim stated in the customer’s own terms, and counts nothing', () => {
    const guard = guardAgainstToolNames(['find_user', 'cancel_pending_order']);
    const accepted = guard.accept(
      candidate(
        'Confirm which order the customer means before acting, then complete the cancellation.',
        'when the customer asks to cancel an order that has not shipped',
      ),
    );
    expect(accepted).toBe(true);
    expect(guard.refused()).toBe(0);
  });

  it('counts separately from the number it was asked', () => {
    const guard = guardAgainstToolNames(['issue_refund']);
    guard.accept(candidate('Call issue_refund.'));
    guard.accept(candidate('Call issue_refund again.'));
    guard.accept(candidate('Ask for the order id first.'));
    expect(guard.refused()).toBe(2);
  });
});

describe('the mechanical register share', () => {
  it('counts items, not occurrences, so one long sentence cannot move the reading', () => {
    const census = toolNameCensus(
      [
        { statement: 'Call find_user, then find_user, then find_user.', when: 'when find_user matches' },
        { statement: 'Confirm the order before cancelling.' },
      ],
      ['find_user'],
    );
    expect(census.measured).toBe(2);
    expect(census.named).toBe(1);
    expect(census.share).toBeCloseTo(0.5, 9);
  });

  it('counts an item named in its condition or its statement once', () => {
    const census = toolNameCensus(
      [{ statement: 'Look the customer up first.', when: 'when find_user returns one row' }],
      ['find_user'],
    );
    expect(census.named).toBe(1);
  });

  it('is null, not zero, when there is nothing to measure', () => {
    // The distinction this whole project keeps making: a store of no items is not a store with no
    // tool names in it, and a reading of 0% would be quoted as the ban working.
    const census = toolNameCensus([], ['find_user']);
    expect(census.share).toBeNull();
    expect(census.measured).toBe(0);
  });

  it('is null when the inventory is empty, because the test cannot run', () => {
    const census = toolNameCensus([{ statement: 'Call find_user.' }], []);
    expect(census.share).toBeNull();
    expect(census.measured).toBe(1);
    expect(census.named).toBe(0);
  });

  it('says which names it found, so a falling share can be read as a register change', () => {
    const census = toolNameCensus(
      [
        { statement: 'Call find_user then cancel_pending_order.' },
        { statement: 'Call find_user.' },
        { statement: 'Confirm the order first.' },
      ],
      ['find_user', 'cancel_pending_order', 'issue_refund'],
    );
    expect(census.names).toEqual({ find_user: 2, cancel_pending_order: 1 });
  });

  it('reads an item whose condition is absent without inventing one', () => {
    const census = toolNameCensus([{ statement: 'Call issue_refund.' }], ['issue_refund']);
    expect(census.named).toBe(1);
  });
});
