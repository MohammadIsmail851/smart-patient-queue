/**
 * Tests: Override validation and audit record building.
 * Acceptance criteria: 11, 12
 */

import { describe, it, expect } from 'vitest';
import { validateOverride, buildOverrideRecord } from '../../src/ed/logic/overrideLogic.js';
import { EdMemoryStore }  from '../../src/ed/db/edMemoryStore.js';
import { ED_ROLE, ED_OPERATION, AUDIT_EVENT_TYPE } from '../../src/ed/types/enums.js';

const BASE = 1_700_000_000_000;

describe('validateOverride() (AC #11)', () => {
  const base = {
    reason:        'Valid reason for override',
    actorRole:     ED_ROLE.FLOW_COORDINATOR,
    operation:     ED_OPERATION.PERFORM_OVERRIDE,
    previousState: 'P3',
    newState:      'P2',
  };

  it('accepts a valid override', () => {
    const result = validateOverride(base);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects missing reason', () => {
    const result = validateOverride({ ...base, reason: '' });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /reason/i.test(e))).toBe(true);
  });

  it('rejects null reason', () => {
    const result = validateOverride({ ...base, reason: null });
    expect(result.valid).toBe(false);
  });

  it('rejects reason shorter than 5 characters', () => {
    const result = validateOverride({ ...base, reason: 'abc' });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /5 characters/i.test(e))).toBe(true);
  });

  it('rejects missing actorRole', () => {
    const result = validateOverride({ ...base, actorRole: null });
    expect(result.valid).toBe(false);
  });

  it('rejects missing operation', () => {
    const result = validateOverride({ ...base, operation: null });
    expect(result.valid).toBe(false);
  });

  it('rejects null previousState', () => {
    const result = validateOverride({ ...base, previousState: null });
    expect(result.valid).toBe(false);
  });

  it('rejects null newState', () => {
    const result = validateOverride({ ...base, newState: null });
    expect(result.valid).toBe(false);
  });

  it('accepts previousState=0 (falsy but valid)', () => {
    // 0 is a valid queue position
    const result = validateOverride({ ...base, previousState: 0 });
    expect(result.valid).toBe(true);
  });
});

describe('buildOverrideRecord() (AC #12)', () => {
  const params = {
    encounterId:   'ENC-001',
    actorId:       'staff-coo-001',
    actorRole:     ED_ROLE.FLOW_COORDINATOR,
    actorName:     'Vikram P.',
    operation:     ED_OPERATION.PERFORM_OVERRIDE,
    previousState: 'P4',
    newState:      'P2',
    reason:        'Observed rapid deterioration — escalating per protocol',
    timestamp:     BASE,
  };

  it('returns a valid override record with all required fields', () => {
    const record = buildOverrideRecord(params);
    expect(record.encounterId).toBe('ENC-001');
    expect(record.actorId).toBe('staff-coo-001');
    expect(record.actorRole).toBe(ED_ROLE.FLOW_COORDINATOR);
    expect(record.actorName).toBe('Vikram P.');
    expect(record.operation).toBe(ED_OPERATION.PERFORM_OVERRIDE);
    expect(record.previousState).toBe('P4');
    expect(record.newState).toBe('P2');
    expect(record.reason).toBe('Observed rapid deterioration — escalating per protocol');
    expect(record.timestamp).toBe(BASE);
  });

  it('trims whitespace from reason', () => {
    const record = buildOverrideRecord({ ...params, reason: '  padded reason here  ' });
    expect(record.reason).toBe('padded reason here');
  });

  it('throws when reason is empty', () => {
    expect(() => buildOverrideRecord({ ...params, reason: '' }))
      .toThrow(expect.objectContaining({ code: 'OVERRIDE_VALIDATION_FAILED' }));
  });

  it('thrown error exposes the validation errors array', () => {
    try {
      buildOverrideRecord({ ...params, reason: '' });
    } catch (e) {
      expect(Array.isArray(e.errors)).toBe(true);
      expect(e.errors.length).toBeGreaterThan(0);
    }
  });

  it('timestamps default to current time when not provided', () => {
    const before = Date.now();
    const record = buildOverrideRecord({ ...params, timestamp: undefined });
    const after  = Date.now();
    expect(record.timestamp).toBeGreaterThanOrEqual(before);
    expect(record.timestamp).toBeLessThanOrEqual(after);
  });
});

describe('EdMemoryStore — performOverride() (AC #11, #12)', () => {
  // Helper: register + assess a patient
  const setupEncounter = (store, acuity = 'P4') => {
    const { encounter: enc } = store.registerEncounter({
      patientInfo: { name: 'Override Test', dob: '1980-01-01', gender: 'male', chiefComplaint: 'Test complaint' },
      actorId: 'tri-1', actorRole: ED_ROLE.TRIAGE_CLINICIAN, actorName: 'Dr T', now: BASE,
    });
    store.recordAssessment({
      encounterId: enc.id, acuity, notes: '',
      actorId: 'tri-1', actorRole: ED_ROLE.TRIAGE_CLINICIAN, actorName: 'Dr T', now: BASE,
    });
    return enc.id;
  };

  it('performs a valid override and returns the override record', () => {
    const store = new EdMemoryStore();
    const encId = setupEncounter(store, 'P4');

    const { overrideRecord } = store.performOverride({
      encounterId:   encId,
      operation:     ED_OPERATION.PERFORM_OVERRIDE,
      previousState: 'P4',
      newState:      'P2',
      reason:        'Witnessed deterioration — supervisor approved escalation',
      actorId:       'coo-1',
      actorRole:     ED_ROLE.FLOW_COORDINATOR,
      actorName:     'Coordinator',
      applyFn:       (enc) => ({ ...enc, acuity: 'P2' }),
      now:           BASE + 60_000,
    });

    expect(overrideRecord.previousState).toBe('P4');
    expect(overrideRecord.newState).toBe('P2');
    expect(overrideRecord.reason).toBeTruthy();
    expect(overrideRecord.actorId).toBe('coo-1');
    expect(overrideRecord.actorRole).toBe(ED_ROLE.FLOW_COORDINATOR);
    expect(overrideRecord.timestamp).toBe(BASE + 60_000);
  });

  it('override without a reason is rejected (AC #11)', () => {
    const store = new EdMemoryStore();
    const encId = setupEncounter(store);

    expect(() => store.performOverride({
      encounterId:   encId,
      operation:     ED_OPERATION.PERFORM_OVERRIDE,
      previousState: 'P4',
      newState:      'P2',
      reason:        '',   // empty — must be rejected
      actorId:       'coo-1',
      actorRole:     ED_ROLE.FLOW_COORDINATOR,
      actorName:     'Coordinator',
      now:           BASE,
    })).toThrow(expect.objectContaining({ code: 'OVERRIDE_VALIDATION_FAILED' }));
  });

  it('override is recorded in the audit log', () => {
    const store = new EdMemoryStore();
    const encId = setupEncounter(store);

    store.performOverride({
      encounterId:   encId,
      operation:     ED_OPERATION.PERFORM_OVERRIDE,
      previousState: 'P4',
      newState:      'P1',
      reason:        'Emergency supervisor override',
      actorId:       'sup-1',
      actorRole:     ED_ROLE.SUPERVISOR,
      actorName:     'Supervisor',
      applyFn:       (enc) => ({ ...enc, acuity: 'P1' }),
      now:           BASE,
    });

    const logs = store.getAuditLogs();
    expect(logs.some(l => l.type === AUDIT_EVENT_TYPE.OVERRIDE_PERFORMED)).toBe(true);
  });

  it('override appears in the encounter timeline', () => {
    const store = new EdMemoryStore();
    const encId = setupEncounter(store);

    store.performOverride({
      encounterId:   encId,
      operation:     ED_OPERATION.PERFORM_OVERRIDE,
      previousState: 'P4',
      newState:      'P2',
      reason:        'Clinical review — updating priority',
      actorId:       'coo-1',
      actorRole:     ED_ROLE.FLOW_COORDINATOR,
      actorName:     'Coordinator',
      applyFn:       (enc) => ({ ...enc, acuity: 'P2' }),
      now:           BASE,
    });

    const timeline = store.getTimeline(encId);
    expect(timeline.some(e => e.type === 'override_performed')).toBe(true);
  });

  it('unauthorized role cannot perform override', () => {
    const store = new EdMemoryStore();
    const encId = setupEncounter(store);

    expect(() => store.performOverride({
      encounterId:   encId,
      operation:     ED_OPERATION.PERFORM_OVERRIDE,
      previousState: 'P4',
      newState:      'P2',
      reason:        'Attempting unauthorized override',
      actorId:       'tri-1',
      actorRole:     ED_ROLE.TRIAGE_CLINICIAN,  // cannot override
      actorName:     'Clinician',
      now:           BASE,
    })).toThrow(expect.objectContaining({ code: 'PERMISSION_DENIED' }));
  });
});
