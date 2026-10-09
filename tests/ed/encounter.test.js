/**
 * Tests: Encounter registration, assessment, timeline, emergency.
 * Acceptance criteria: 1, 2, 3, 7, 13, 16
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EdMemoryStore } from '../../src/ed/db/edMemoryStore.js';
import { ED_ROLE, ENCOUNTER_STATUS, TIMELINE_EVENT_TYPE } from '../../src/ed/types/enums.js';

const BASE = 1_700_000_000_000;

const validPatient = {
  name:           'Ravi Shankar',
  dob:            '1980-03-14',
  gender:         'male',
  chiefComplaint: 'Chest pain for 30 minutes',
};

/** Helper: register an encounter */
const registerPatient = (store, patientInfo = validPatient, role = ED_ROLE.REGISTRATION_STAFF, now = BASE) =>
  store.registerEncounter({
    patientInfo,
    actorId:   'reg-1',
    actorRole: role,
    actorName: 'Staff',
    now,
  });

/** Helper: register then record first assessment */
const registerAndAssess = (store, acuity = 'P3', now = BASE) => {
  const { encounter: enc } = registerPatient(store, validPatient, ED_ROLE.TRIAGE_CLINICIAN, now);
  const result = store.recordAssessment({
    encounterId: enc.id,
    acuity,
    notes:       '',
    actorId:     'tri-1',
    actorRole:   ED_ROLE.TRIAGE_CLINICIAN,
    actorName:   'Dr. Test',
    now,
  });
  return { encounterId: enc.id, ...result };
};

describe('Encounter registration (AC #1, #2)', () => {
  let store;
  beforeEach(() => { store = new EdMemoryStore(); });

  it('can register a valid encounter and retrieve it by ID (AC #1)', () => {
    const { encounter } = registerPatient(store);
    expect(encounter.id).toBeTruthy();
    const retrieved = store.getEncounter(encounter.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved.id).toBe(encounter.id);
    expect(retrieved.patientInfo.name).toBe(validPatient.name);
    expect(retrieved.status).toBe(ENCOUNTER_STATUS.REGISTERED);
  });

  it('newly registered encounter has null acuity (not inferred by system)', () => {
    const { encounter } = registerPatient(store);
    expect(encounter.acuity).toBeNull();
  });

  it('registered encounter has isEmergencyPathway = false', () => {
    const { encounter } = registerPatient(store);
    expect(encounter.isEmergencyPathway).toBe(false);
  });

  it('each encounter gets a unique ID', () => {
    const e1 = registerPatient(store, validPatient, ED_ROLE.REGISTRATION_STAFF, BASE);
    const e2 = registerPatient(store, validPatient, ED_ROLE.REGISTRATION_STAFF, BASE + 1000);
    expect(e1.encounter.id).not.toBe(e2.encounter.id);
  });

  it('rejects missing patient name (AC #2)', () => {
    expect(() => store.registerEncounter({
      patientInfo: { ...validPatient, name: '' },
      actorId: 'reg-1', actorRole: ED_ROLE.REGISTRATION_STAFF, actorName: 'Staff', now: BASE,
    })).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
  });

  it('rejects future date of birth (AC #2)', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString().split('T')[0];
    expect(() => store.registerEncounter({
      patientInfo: { ...validPatient, dob: future },
      actorId: 'reg-1', actorRole: ED_ROLE.REGISTRATION_STAFF, actorName: 'Staff', now: BASE,
    })).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
  });

  it('rejects missing chief complaint (AC #2)', () => {
    expect(() => store.registerEncounter({
      patientInfo: { ...validPatient, chiefComplaint: '' },
      actorId: 'reg-1', actorRole: ED_ROLE.REGISTRATION_STAFF, actorName: 'Staff', now: BASE,
    })).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
  });

  it('rejects invalid gender value (AC #2)', () => {
    expect(() => store.registerEncounter({
      patientInfo: { ...validPatient, gender: 'alien' },
      actorId: 'reg-1', actorRole: ED_ROLE.REGISTRATION_STAFF, actorName: 'Staff', now: BASE,
    })).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
  });

  it('rejects registration by unauthorised role', () => {
    expect(() => store.registerEncounter({
      patientInfo: validPatient,
      actorId: 'aud-1', actorRole: ED_ROLE.AUDITOR, actorName: 'Auditor', now: BASE,
    })).toThrow(expect.objectContaining({ code: 'PERMISSION_DENIED' }));
  });
});

describe('Clinician assessment (AC #3, #4)', () => {
  let store;
  beforeEach(() => { store = new EdMemoryStore(); });

  it('authorised clinician can record an assessment (AC #3)', () => {
    const { encounter: enc } = registerPatient(store, validPatient, ED_ROLE.TRIAGE_CLINICIAN);
    const { encounter: after, assessment } = store.recordAssessment({
      encounterId: enc.id, acuity: 'P2', notes: 'Rapid onset',
      actorId: 'tri-1', actorRole: ED_ROLE.TRIAGE_CLINICIAN, actorName: 'Dr. R', now: BASE,
    });
    expect(assessment.acuity).toBe('P2');
    expect(after.acuity).toBe('P2');
    expect(after.status).toBe(ENCOUNTER_STATUS.WAITING);
  });

  it('assessment history is preserved — never silently overwritten', () => {
    const { encounter: enc } = registerPatient(store, validPatient, ED_ROLE.TRIAGE_CLINICIAN);
    store.recordAssessment({
      encounterId: enc.id, acuity: 'P3', notes: 'First assessment',
      actorId: 'tri-1', actorRole: ED_ROLE.TRIAGE_CLINICIAN, actorName: 'Dr. R', now: BASE,
    });
    store.recordAssessment({
      encounterId: enc.id, acuity: 'P2', notes: 'Second assessment — deteriorating',
      actorId: 'tri-1', actorRole: ED_ROLE.TRIAGE_CLINICIAN, actorName: 'Dr. R', now: BASE + 300_000,
    });

    const assessments = store.getAssessments(enc.id);
    expect(assessments).toHaveLength(2);
    expect(assessments[0].acuity).toBe('P3');
    expect(assessments[1].acuity).toBe('P2');
  });

  it('registration staff CANNOT record assessment (AC #4)', () => {
    const { encounter: enc } = registerPatient(store);
    expect(() => store.recordAssessment({
      encounterId: enc.id, acuity: 'P2', notes: '',
      actorId: 'reg-1', actorRole: ED_ROLE.REGISTRATION_STAFF, actorName: 'Staff', now: BASE,
    })).toThrow(expect.objectContaining({ code: 'PERMISSION_DENIED' }));
  });

  it('auditor CANNOT record assessment (AC #4)', () => {
    const { encounter: enc } = registerPatient(store, validPatient, ED_ROLE.ADMINISTRATOR);
    expect(() => store.recordAssessment({
      encounterId: enc.id, acuity: 'P2', notes: '',
      actorId: 'aud-1', actorRole: ED_ROLE.AUDITOR, actorName: 'Auditor', now: BASE,
    })).toThrow(expect.objectContaining({ code: 'PERMISSION_DENIED' }));
  });

  it('rejects invalid acuity code', () => {
    const { encounter: enc } = registerPatient(store, validPatient, ED_ROLE.TRIAGE_CLINICIAN);
    expect(() => store.recordAssessment({
      encounterId: enc.id, acuity: 'CRITICAL', notes: '',
      actorId: 'tri-1', actorRole: ED_ROLE.TRIAGE_CLINICIAN, actorName: 'Dr. R', now: BASE,
    })).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
  });

  it('cannot assess a COMPLETED encounter', () => {
    const { encounterId } = registerAndAssess(store, 'P3');
    store.transitionEncounter({
      encounterId, toStatus: ENCOUNTER_STATUS.CALLED,
      actorId: 'tri-1', actorRole: ED_ROLE.TRIAGE_CLINICIAN, actorName: 'Dr. R', now: BASE + 1000,
    });
    store.transitionEncounter({
      encounterId, toStatus: ENCOUNTER_STATUS.IN_CONSULTATION,
      actorId: 'emg-1', actorRole: ED_ROLE.EMERGENCY_CLINICIAN, actorName: 'Dr. L', now: BASE + 2000,
    });
    store.transitionEncounter({
      encounterId, toStatus: ENCOUNTER_STATUS.COMPLETED,
      actorId: 'emg-1', actorRole: ED_ROLE.EMERGENCY_CLINICIAN, actorName: 'Dr. L', now: BASE + 3000,
    });

    expect(() => store.recordAssessment({
      encounterId, acuity: 'P3', notes: '',
      actorId: 'tri-1', actorRole: ED_ROLE.TRIAGE_CLINICIAN, actorName: 'Dr. R', now: BASE + 4000,
    })).toThrow(expect.objectContaining({ code: 'INVALID_STATE' }));
  });
});

describe('Emergency pathway (AC #7)', () => {
  let store;
  beforeEach(() => { store = new EdMemoryStore(); });

  it('activates emergency pathway for a REGISTERED encounter', () => {
    const { encounter: enc } = registerPatient(store, validPatient, ED_ROLE.EMERGENCY_CLINICIAN);
    const result = store.activateEmergency({
      encounterId: enc.id,
      reason:      'Unresponsive on arrival',
      actorId:     'emg-1',
      actorRole:   ED_ROLE.EMERGENCY_CLINICIAN,
      actorName:   'Dr. L',
      now:         BASE,
    });
    expect(result.emergencyStatus).toBe('active');
    expect(result.encounter.isEmergencyPathway).toBe(true);
    expect(result.encounter.status).toBe(ENCOUNTER_STATUS.EMERGENCY_PATHWAY);
  });

  it('emergency encounter does NOT appear in ordinary queue', () => {
    const { encounter: enc } = registerPatient(store, validPatient, ED_ROLE.EMERGENCY_CLINICIAN);
    store.activateEmergency({
      encounterId: enc.id, reason: 'Emergency on arrival',
      actorId: 'emg-1', actorRole: ED_ROLE.EMERGENCY_CLINICIAN, actorName: 'Dr. L', now: BASE,
    });
    const queue = store.getQueue();
    expect(queue.every(e => e.id !== enc.id)).toBe(true);
  });

  it('getActiveEmergencies() returns the emergency encounter', () => {
    const { encounter: enc } = registerPatient(store, validPatient, ED_ROLE.EMERGENCY_CLINICIAN);
    store.activateEmergency({
      encounterId: enc.id, reason: 'Cardiac arrest',
      actorId: 'emg-1', actorRole: ED_ROLE.EMERGENCY_CLINICIAN, actorName: 'Dr. L', now: BASE,
    });
    const emergencies = store.getActiveEmergencies();
    expect(emergencies.some(e => e.id === enc.id)).toBe(true);
  });

  it('prevents duplicate active emergency for same encounter', () => {
    const { encounter: enc } = registerPatient(store, validPatient, ED_ROLE.EMERGENCY_CLINICIAN);
    store.activateEmergency({
      encounterId: enc.id, reason: 'First emergency',
      actorId: 'emg-1', actorRole: ED_ROLE.EMERGENCY_CLINICIAN, actorName: 'Dr. L', now: BASE,
    });
    expect(() => store.activateEmergency({
      encounterId: enc.id, reason: 'Duplicate emergency',
      actorId: 'emg-1', actorRole: ED_ROLE.EMERGENCY_CLINICIAN, actorName: 'Dr. L', now: BASE + 1000,
    })).toThrow(expect.objectContaining({ code: 'DUPLICATE_EMERGENCY' }));
  });

  it('requires a reason for emergency activation', () => {
    const { encounter: enc } = registerPatient(store, validPatient, ED_ROLE.EMERGENCY_CLINICIAN);
    expect(() => store.activateEmergency({
      encounterId: enc.id, reason: '',
      actorId: 'emg-1', actorRole: ED_ROLE.EMERGENCY_CLINICIAN, actorName: 'Dr. L', now: BASE,
    })).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
  });

  it('registration staff cannot activate emergency', () => {
    const { encounter: enc } = registerPatient(store);
    expect(() => store.activateEmergency({
      encounterId: enc.id, reason: 'Unauthorized attempt',
      actorId: 'reg-1', actorRole: ED_ROLE.REGISTRATION_STAFF, actorName: 'Staff', now: BASE,
    })).toThrow(expect.objectContaining({ code: 'PERMISSION_DENIED' }));
  });

  it('acknowledging emergency records acknowledgement details', () => {
    const { encounter: enc } = registerPatient(store, validPatient, ED_ROLE.EMERGENCY_CLINICIAN);
    const { id: emergencyId } = store.activateEmergency({
      encounterId: enc.id, reason: 'Anaphylaxis',
      actorId: 'emg-1', actorRole: ED_ROLE.EMERGENCY_CLINICIAN, actorName: 'Dr. L', now: BASE,
    });
    const ack = store.acknowledgeEmergency({
      emergencyId,
      actorId:   'emg-2', actorRole: ED_ROLE.EMERGENCY_CLINICIAN, actorName: 'Dr. M', now: BASE + 30_000,
    });
    expect(ack.emergencyStatus).toBe('acknowledged');
    expect(ack.acknowledgedBy).toBe('emg-2');
    expect(ack.acknowledgedAt).toBe(BASE + 30_000);
  });
});

describe('Patient timeline — reflects persisted events (AC #13)', () => {
  let store;
  beforeEach(() => { store = new EdMemoryStore(); });

  it('registration creates a REGISTERED timeline event', () => {
    const { encounter: enc } = registerPatient(store);
    const timeline = store.getTimeline(enc.id);
    expect(timeline.some(e => e.type === TIMELINE_EVENT_TYPE.REGISTERED)).toBe(true);
  });

  it('first assessment creates ASSESSMENT_RECORDED and ENTERED_QUEUE events', () => {
    const { encounter: enc } = registerPatient(store, validPatient, ED_ROLE.TRIAGE_CLINICIAN);
    store.recordAssessment({
      encounterId: enc.id, acuity: 'P3', notes: '',
      actorId: 'tri-1', actorRole: ED_ROLE.TRIAGE_CLINICIAN, actorName: 'Dr. R', now: BASE,
    });
    const timeline = store.getTimeline(enc.id);
    expect(timeline.some(e => e.type === TIMELINE_EVENT_TYPE.ASSESSMENT_RECORDED)).toBe(true);
    expect(timeline.some(e => e.type === TIMELINE_EVENT_TYPE.ENTERED_QUEUE)).toBe(true);
  });

  it('emergency activation creates EMERGENCY_ACTIVATED timeline event', () => {
    const { encounter: enc } = registerPatient(store, validPatient, ED_ROLE.EMERGENCY_CLINICIAN);
    store.activateEmergency({
      encounterId: enc.id, reason: 'Timeline test emergency',
      actorId: 'emg-1', actorRole: ED_ROLE.EMERGENCY_CLINICIAN, actorName: 'Dr. L', now: BASE,
    });
    const timeline = store.getTimeline(enc.id);
    expect(timeline.some(e => e.type === TIMELINE_EVENT_TYPE.EMERGENCY_ACTIVATED)).toBe(true);
  });

  it('timeline events are chronologically ordered by insertion', () => {
    const { encounter: enc } = registerPatient(store, validPatient, ED_ROLE.TRIAGE_CLINICIAN, BASE);
    store.recordAssessment({
      encounterId: enc.id, acuity: 'P3', notes: '',
      actorId: 'tri-1', actorRole: ED_ROLE.TRIAGE_CLINICIAN, actorName: 'Dr. R', now: BASE + 300_000,
    });
    const timeline = store.getTimeline(enc.id);
    // REGISTERED must come before ASSESSMENT_RECORDED
    const regIdx = timeline.findIndex(e => e.type === TIMELINE_EVENT_TYPE.REGISTERED);
    const assIdx = timeline.findIndex(e => e.type === TIMELINE_EVENT_TYPE.ASSESSMENT_RECORDED);
    expect(regIdx).toBeLessThan(assIdx);
  });

  it('timeline does NOT include events for a different encounter', () => {
    const { encounter: e1 } = registerPatient(store, validPatient, ED_ROLE.REGISTRATION_STAFF, BASE);
    const { encounter: e2 } = registerPatient(store, validPatient, ED_ROLE.REGISTRATION_STAFF, BASE + 1000);
    const tl1 = store.getTimeline(e1.id);
    expect(tl1.every(e => e.encounterId === e1.id)).toBe(true);
    expect(tl1.every(e => e.encounterId !== e2.id)).toBe(true);
  });
});

describe('Failed operations do not produce false success (AC #16)', () => {
  let store;
  beforeEach(() => { store = new EdMemoryStore(); });

  it('a failed registration (bad data) throws and does not create encounter', () => {
    const countBefore = store.getAllEncounters().length;
    try {
      store.registerEncounter({
        patientInfo: { name: '', dob: '1990-01-01', gender: 'male', chiefComplaint: 'x' },
        actorId: 'reg-1', actorRole: ED_ROLE.REGISTRATION_STAFF, actorName: 'Staff', now: BASE,
      });
    } catch (_) { /* expected */ }
    expect(store.getAllEncounters().length).toBe(countBefore);
  });

  it('a failed assessment (permission denied) does not alter the encounter', () => {
    const { encounter: enc } = registerPatient(store, validPatient, ED_ROLE.TRIAGE_CLINICIAN);
    try {
      store.recordAssessment({
        encounterId: enc.id, acuity: 'P2', notes: '',
        actorId: 'reg-1', actorRole: ED_ROLE.REGISTRATION_STAFF, actorName: 'Staff', now: BASE,
      });
    } catch (_) { /* expected */ }
    const afterAttempt = store.getEncounter(enc.id);
    expect(afterAttempt.acuity).toBeNull(); // unchanged
    expect(afterAttempt.status).toBe(ENCOUNTER_STATUS.REGISTERED); // unchanged
  });
});
