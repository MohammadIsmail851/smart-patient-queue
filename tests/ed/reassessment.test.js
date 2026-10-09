/**
 * Tests: Reassessment logic.
 * Acceptance criteria: 9, 10
 *
 * Key safety rule being tested:
 * An overdue reassessment task NEVER automatically changes a patient's acuity.
 * Acuity changes require an explicit, authorised clinician action.
 */

import { describe, it, expect } from 'vitest';
import {
  calculateDueAt,
  getReassessmentStatus,
  getElapsedSinceAssessment,
  buildReassessmentTask,
} from '../../src/ed/logic/reassessmentLogic.js';
import { REASSESSMENT_CONFIG } from '../../src/ed/config/reassessment.js';
import { REASSESSMENT_STATUS }  from '../../src/ed/types/enums.js';
import { EdMemoryStore }        from '../../src/ed/db/edMemoryStore.js';
import { ED_ROLE, ED_OPERATION } from '../../src/ed/types/enums.js';

// Base timestamp for tests
const BASE = 1_700_000_000_000;

describe('calculateDueAt()', () => {
  it('uses configured P1 interval (5 min)', () => {
    const due = calculateDueAt(BASE, 'P1');
    expect(due).toBe(BASE + REASSESSMENT_CONFIG.intervals.P1);
  });

  it('uses configured P5 interval (60 min)', () => {
    const due = calculateDueAt(BASE, 'P5');
    expect(due).toBe(BASE + REASSESSMENT_CONFIG.intervals.P5);
  });

  it('falls back to P5 interval for unknown acuity', () => {
    const due = calculateDueAt(BASE, 'XX');
    expect(due).toBe(BASE + REASSESSMENT_CONFIG.intervals.P5);
  });
});

describe('getReassessmentStatus() — injectable clock (AC #9)', () => {
  const dueAt = BASE + 10 * 60_000; // due in 10 minutes from BASE

  it('returns UPCOMING when well before due time', () => {
    const now = BASE; // 10 min before due
    expect(getReassessmentStatus(dueAt, now)).toBe(REASSESSMENT_STATUS.UPCOMING);
  });

  it('returns DUE within warning window', () => {
    const now = dueAt - REASSESSMENT_CONFIG.warningWindowMs + 1; // just inside warning
    expect(getReassessmentStatus(dueAt, now)).toBe(REASSESSMENT_STATUS.DUE);
  });

  it('returns OVERDUE when past due time', () => {
    const now = dueAt + 1; // 1ms past due
    expect(getReassessmentStatus(dueAt, now)).toBe(REASSESSMENT_STATUS.OVERDUE);
  });

  it('returns OVERDUE long after due time', () => {
    const now = dueAt + 60 * 60_000; // 1 hour late
    expect(getReassessmentStatus(dueAt, now)).toBe(REASSESSMENT_STATUS.OVERDUE);
  });
});

describe('buildReassessmentTask() — safety invariants (AC #9)', () => {
  it('creates task with correct encounterId and acuity snapshot', () => {
    const task = buildReassessmentTask('ENC-001', 'P3', BASE, 'staff-1', BASE);
    expect(task.encounterId).toBe('ENC-001');
    expect(task.currentAcuity).toBe('P3');
  });

  it('task does NOT contain any field that would change encounter acuity', () => {
    const task = buildReassessmentTask('ENC-001', 'P3', BASE, 'staff-1', BASE);
    // These fields must NOT exist — they would imply automatic escalation
    expect(task).not.toHaveProperty('newAcuity');
    expect(task).not.toHaveProperty('escalatedAcuity');
    expect(task).not.toHaveProperty('autoEscalate');
  });

  it('status is UPCOMING when created exactly at assessment time', () => {
    const task = buildReassessmentTask('ENC-001', 'P3', BASE, 'staff-1', BASE);
    expect(task.status).toBe(REASSESSMENT_STATUS.UPCOMING);
  });

  it('status is OVERDUE when "now" is past dueAt', () => {
    const overdueNow = BASE + REASSESSMENT_CONFIG.intervals.P3 + 60_000;
    const task = buildReassessmentTask('ENC-001', 'P3', BASE, 'staff-1', overdueNow);
    expect(task.status).toBe(REASSESSMENT_STATUS.OVERDUE);
  });
});

describe('getElapsedSinceAssessment()', () => {
  it('returns correct elapsed minutes label', () => {
    const { elapsedLabel } = getElapsedSinceAssessment(BASE, BASE + 7 * 60_000);
    expect(elapsedLabel).toBe('7m');
  });

  it('returns hours+minutes for elapsed > 1 hour', () => {
    const { elapsedLabel } = getElapsedSinceAssessment(BASE, BASE + 90 * 60_000);
    expect(elapsedLabel).toBe('1h 30m');
  });
});

describe('EdMemoryStore — reassessment does NOT auto-change acuity (AC #9)', () => {
  it('overdue task status does not mutate the encounter acuity', () => {
    const store = new EdMemoryStore();

    // Register + assess as P3
    const { encounter: enc } = store.registerEncounter({
      patientInfo:  { name: 'Test P', dob: '1990-01-01', gender: 'male', chiefComplaint: 'Headache test' },
      actorId:      'tri-1',
      actorRole:    ED_ROLE.TRIAGE_CLINICIAN,
      actorName:    'Dr. Test',
      now:          BASE,
    });
    store.recordAssessment({
      encounterId: enc.id,
      acuity:      'P3',
      notes:       '',
      actorId:     'tri-1',
      actorRole:   ED_ROLE.TRIAGE_CLINICIAN,
      actorName:   'Dr. Test',
      now:         BASE,
    });

    // Simulate time passing well past the P3 due time
    const farFuture = BASE + 60 * 60_000 * 2; // 2 hours later
    const watchlist = store.getWatchlist(farFuture);

    // Task should be OVERDUE
    const task = watchlist.find(t => t.encounterId === enc.id);
    expect(task.status).toBe(REASSESSMENT_STATUS.OVERDUE);

    // But the encounter's acuity must NOT have changed
    const updatedEnc = store.getEncounter(enc.id);
    expect(updatedEnc.acuity).toBe('P3');
  });
});

describe('EdMemoryStore — clinician can explicitly record reassessment (AC #10)', () => {
  it('retains acuity when newAcuity is null', () => {
    const store = new EdMemoryStore();
    const { encounter: enc } = store.registerEncounter({
      patientInfo: { name: 'Pat A', dob: '1985-05-10', gender: 'female', chiefComplaint: 'Fever 38.5' },
      actorId:     'tri-1', actorRole: ED_ROLE.TRIAGE_CLINICIAN, actorName: 'Dr. R', now: BASE,
    });
    store.recordAssessment({
      encounterId: enc.id, acuity: 'P3', notes: '',
      actorId: 'tri-1', actorRole: ED_ROLE.TRIAGE_CLINICIAN, actorName: 'Dr. R', now: BASE,
    });

    const { encounter: after } = store.recordReassessment({
      encounterId: enc.id,
      newAcuity:   null,   // explicitly retain
      notes:       'Condition stable',
      actorId:     'tri-1', actorRole: ED_ROLE.TRIAGE_CLINICIAN, actorName: 'Dr. R', now: BASE + 900_000,
    });

    expect(after.acuity).toBe('P3');
  });

  it('updates acuity when clinician explicitly provides a new value', () => {
    const store = new EdMemoryStore();
    const { encounter: enc } = store.registerEncounter({
      patientInfo: { name: 'Pat B', dob: '1990-06-15', gender: 'male', chiefComplaint: 'Chest discomfort' },
      actorId:     'tri-1', actorRole: ED_ROLE.TRIAGE_CLINICIAN, actorName: 'Dr. R', now: BASE,
    });
    store.recordAssessment({
      encounterId: enc.id, acuity: 'P3', notes: '',
      actorId: 'tri-1', actorRole: ED_ROLE.TRIAGE_CLINICIAN, actorName: 'Dr. R', now: BASE,
    });

    const { encounter: after } = store.recordReassessment({
      encounterId: enc.id,
      newAcuity:   'P2',  // clinician explicitly escalates
      notes:       'Deteriorating — escalating category',
      actorId:     'emg-1', actorRole: ED_ROLE.EMERGENCY_CLINICIAN, actorName: 'Dr. L', now: BASE + 600_000,
    });

    expect(after.acuity).toBe('P2');
  });

  it('unauthorized role cannot record reassessment', () => {
    const store = new EdMemoryStore();
    const { encounter: enc } = store.registerEncounter({
      patientInfo: { name: 'Pat C', dob: '1995-01-01', gender: 'other', chiefComplaint: 'Nausea' },
      actorId: 'reg-1', actorRole: ED_ROLE.REGISTRATION_STAFF, actorName: 'Staff', now: BASE,
    });

    expect(() => store.recordReassessment({
      encounterId: enc.id, newAcuity: null, notes: '',
      actorId: 'reg-1', actorRole: ED_ROLE.REGISTRATION_STAFF, actorName: 'Staff', now: BASE + 1000,
    })).toThrow(expect.objectContaining({ code: 'PERMISSION_DENIED' }));
  });
});
