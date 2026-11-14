/**
 * The step that explains a red dispatch, tested on the shapes that produced a red one.
 *
 * R111 wrote this logic inline as `node -e "…"` in the workflow and R104 crashed it: line 9 of the
 * script quotes a sentence containing `"`, the double quotes closed the shell's own string, and the
 * script was cut in half at a comment. The step's whole job is to explain a red run, and it produced
 * a second failure instead.
 *
 * The tests below hold three properties, and the third is the one R104 was missing: a dispatch that
 * measured something says nothing; a dispatch that did not is described by the driver's own reason;
 * and no state may print an empty reason — a warning whose text stops after the colon is not a
 * diagnosis.
 */
import { describe, expect, it } from 'vitest';
import { noMeasurementNote } from '../no-measurement-note.js';

describe('what a workflow may say about a dispatch', () => {
  it('says nothing when the dispatch measured', () => {
    const note = noMeasurementNote({ metrics: { status_no_measurement: 0, status_not_run: 0 }, notes: ['ok'] });
    expect(note.state).toBe('measured');
    expect(note.warning).toBeUndefined();
    expect(note.summary).toEqual([]);
  });

  it('reports an artefact nobody wrote as absent, which is not a measurement of zero', () => {
    const note = noMeasurementNote(undefined);
    expect(note.state).toBe('absent');
    expect(note.warning).toBe('L4 wrote no artefact');
    expect(note.summary.join(' ')).toContain('No result is claimed');
  });

  it('quotes the driver\'s own first note, because this step does not know why the run stopped', () => {
    const note = noMeasurementNote({
      metrics: { status_no_measurement: 1 },
      notes: ['the store held nothing to serve', 'a second note'],
    });
    expect(note.state).toBe('silent');
    expect(note.warning).toBe('L4 produced no measurement: the store held nothing to serve');
    expect(note.summary[0]).toContain('the store held nothing to serve');
  });

  it('never prints an empty reason, in either of the two ways a reason can be missing', () => {
    // The failure mode a diagnostic may not have. `notes: []` and `notes: ['']` are different
    // documents and both would print `L4 produced no measurement: ` and stop.
    const missing = noMeasurementNote({ metrics: { status_no_measurement: 1 }, notes: [] });
    expect(missing.warning).toBe('L4 produced no measurement: the driver wrote no reason');
    const blank = noMeasurementNote({ metrics: { status_no_measurement: 1 }, notes: ['   '] });
    expect(blank.warning).toBe('L4 produced no measurement: the driver wrote a note, and it was blank');
  });

  it('names the driver failure when the arm never ran, rather than calling it no measurement', () => {
    const missing = noMeasurementNote({ metrics: { status_not_run: 1, status_driver_missing: 1 } });
    expect(missing.warning).toBe('L4 did not run: TAU_DRIVER names a module that does not exist');
    const unset = noMeasurementNote({ metrics: { status_not_run: 1 } });
    expect(unset.warning).toBe('L4 did not run: neither TAU_RESULTS nor TAU_DRIVER is set');
  });

  it('carries the writer before the funnel, because the next arm is chosen from it', () => {
    const note = noMeasurementNote({
      metrics: { status_no_measurement: 1 },
      notes: ['the distiller wrote nothing'],
      diagnostics: {
        distillWriter: { state: 'fallback', sentence: '63 of 73 event(s) fell back' },
        funnel: { asked: 73, candidates: 0 },
        distill: { replies: { calls: 73, blank: 63 } },
      },
    });
    const text = note.summary.join('\n');
    expect(text.indexOf('Writer')).toBeLessThan(text.indexOf('Funnel'));
    expect(text).toContain('63 of 73 event(s) fell back');
    expect(text).toContain('"blank":63');
  });

  it('bounds every section it quotes, because an artefact is a document', () => {
    const note = noMeasurementNote({
      metrics: { status_no_measurement: 1 },
      notes: ['x'],
      diagnostics: { funnel: { padding: 'y'.repeat(5000) } },
    });
    const funnel = note.summary.find((line) => line.startsWith('Funnel:'));
    expect(funnel).toBeDefined();
    expect(funnel!.length).toBeLessThan(700);
  });
});

describe('an artefact that does not answer the question', () => {
  it('says so when the metrics block is missing, rather than defaulting to silence', () => {
    // Silence is what a clean run prints. A corrupt write that also printed nothing would be
    // indistinguishable from a measurement, which is the one confusion this step exists to prevent.
    const note = noMeasurementNote({ notes: ['something happened'] });
    expect(note.state).toBe('absent');
    expect(note.warning).toBe('L4 wrote an artefact with no metrics');
    expect(note.summary.join(' ')).toContain('No result is claimed');
  });
});
