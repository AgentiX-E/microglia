import { describe, expect, it } from 'vitest';
import { WRITE_ADMISSION_MODE, resolveWriteAdmissionPlan } from '../write-admission-plan.js';

describe('the admission switch', () => {
  it('is off when unset, which is every artefact before this switch', () => {
    expect(resolveWriteAdmissionPlan({})).toEqual({ mode: 'off', options: {} });
  });

  it('is off when explicitly off, and off when blank', () => {
    // A workflow variable that is not configured renders as '', and `??` would
    // have kept it: a blank must read as unset rather than as a mode name.
    expect(resolveWriteAdmissionPlan({ TAU_WRITE_ADMISSION: 'off' }).mode).toBe('off');
    expect(resolveWriteAdmissionPlan({ TAU_WRITE_ADMISSION: '   ' }).mode).toBe('off');
  });

  it('enables the neighbour decision by name', () => {
    expect(resolveWriteAdmissionPlan({ TAU_WRITE_ADMISSION: WRITE_ADMISSION_MODE })).toEqual({
      mode: 'neighbours',
      options: {},
    });
  });

  it('trims the name rather than requiring a spotless environment', () => {
    expect(resolveWriteAdmissionPlan({ TAU_WRITE_ADMISSION: ' neighbours ' }).mode).toBe('neighbours');
  });

  it('passes a registered threshold through', () => {
    expect(
      resolveWriteAdmissionPlan({ TAU_WRITE_ADMISSION: WRITE_ADMISSION_MODE, TAU_WRITE_ADMISSION_THRESHOLD: '0.9' }),
    ).toEqual({ mode: 'neighbours', options: { threshold: 0.9 } });
  });

  it('refuses a mode it does not implement', () => {
    // 'on', 'true' and 'yes' all read as "enable something" to a human, and all
    // three would run the store under a name the artefact cannot report.
    for (const raw of ['on', 'true', 'yes', '1', 'Neighbours']) {
      expect(() => resolveWriteAdmissionPlan({ TAU_WRITE_ADMISSION: raw })).toThrow(/TAU_WRITE_ADMISSION/);
    }
  });

  it('refuses a threshold outside (0, 1] rather than clamping it', () => {
    for (const raw of ['0', '-0.5', '1.5', 'high', 'NaN']) {
      expect(() =>
        resolveWriteAdmissionPlan({ TAU_WRITE_ADMISSION: WRITE_ADMISSION_MODE, TAU_WRITE_ADMISSION_THRESHOLD: raw }),
      ).toThrow(/TAU_WRITE_ADMISSION_THRESHOLD/);
    }
  });

  it('ignores a threshold when the mode is off', () => {
    // A stale threshold beside an off switch is not an error: the arm was turned
    // off, and the number describes a run that did not happen.
    expect(resolveWriteAdmissionPlan({ TAU_WRITE_ADMISSION_THRESHOLD: '0.9' })).toEqual({
      mode: 'off',
      options: {},
    });
  });
});
