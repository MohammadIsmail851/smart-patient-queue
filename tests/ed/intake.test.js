import { describe, it, expect, beforeEach } from 'vitest';
import { EdMemoryStore } from '../../src/ed/db/edMemoryStore.js';
import { ED_ROLE, ENCOUNTER_STATUS } from '../../src/ed/types/enums.js';

describe('Patient Intake View & Triage Workflow (Part 3)', () => {
  let store;

  beforeEach(() => {
    store = new EdMemoryStore();
  });

  it('displays registered encounters without acuity in getUnassessedEncounters()', () => {
    // Register 2 patients
    const { encounter: enc1 } = store.registerEncounter({
      patientInfo: { name: 'Intake Patient 1', dob: '1990-01-01', gender: 'female', chiefComplaint: 'Fever' },
      actorId: 'reg-1', actorRole: ED_ROLE.REGISTRATION_STAFF, actorName: 'Clerk', now: 1000,
    });
    const { encounter: enc2 } = store.registerEncounter({
      patientInfo: { name: 'Intake Patient 2', dob: '1985-05-05', gender: 'male', chiefComplaint: 'Knee injury' },
      actorId: 'reg-1', actorRole: ED_ROLE.REGISTRATION_STAFF, actorName: 'Clerk', now: 2000,
    });

    // Both are unassessed
    const unassessed = store.getUnassessedEncounters();
    expect(unassessed).toHaveLength(2);
    expect(unassessed[0].id).toBe(enc1.id);
    expect(unassessed[1].id).toBe(enc2.id);

    // Waiting queue is empty because neither has been triaged
    expect(store.getQueue()).toHaveLength(0);
  });

  it('moves encounter into waiting queue only when clinician triage assessment is recorded', () => {
    const { encounter: enc } = store.registerEncounter({
      patientInfo: { name: 'Workflow Patient', dob: '1995-10-10', gender: 'female', chiefComplaint: 'Abdominal pain' },
      actorId: 'reg-1', actorRole: ED_ROLE.REGISTRATION_STAFF, actorName: 'Clerk', now: 1000,
    });

    expect(store.getUnassessedEncounters()).toHaveLength(1);
    expect(store.getQueue()).toHaveLength(0);

    // Clinician performs triage assessment
    store.recordAssessment({
      encounterId: enc.id,
      acuity: 'P3',
      notes: 'Moderate pain, hemodynamically stable',
      actorId: 'tri-1',
      actorRole: ED_ROLE.TRIAGE_CLINICIAN,
      actorName: 'Nurse Patel',
      now: 2000,
    });

    // Patient is removed from unassessed intake
    expect(store.getUnassessedEncounters()).toHaveLength(0);

    // Patient enters prioritized waiting queue
    const queue = store.getQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].id).toBe(enc.id);
    expect(queue[0].acuity).toBe('P3');
    expect(queue[0].status).toBe(ENCOUNTER_STATUS.WAITING);
    expect(queue[0].queuePosition).toBe(1);
  });

  it('rejects registration staff attempting to record assessment in intake', () => {
    const { encounter: enc } = store.registerEncounter({
      patientInfo: { name: 'Auth Test Patient', dob: '1990-01-01', gender: 'male', chiefComplaint: 'Ear ache' },
      actorId: 'reg-1', actorRole: ED_ROLE.REGISTRATION_STAFF, actorName: 'Clerk', now: 1000,
    });

    expect(() => store.recordAssessment({
      encounterId: enc.id,
      acuity: 'P4',
      notes: 'Attempted by registration clerk',
      actorId: 'reg-1',
      actorRole: ED_ROLE.REGISTRATION_STAFF, // Non-clinical role
      actorName: 'Clerk',
      now: 2000,
    })).toThrowError(/permission denied/i);

    // Patient remains unassessed in intake
    expect(store.getUnassessedEncounters()).toHaveLength(1);
    expect(store.getQueue()).toHaveLength(0);
  });

  it('never infers or automatically sets acuity on intake registration', () => {
    const { encounter: enc } = store.registerEncounter({
      patientInfo: { name: 'Critical Text Patient', dob: '1980-01-01', gender: 'male', chiefComplaint: 'SEVEREST CHEST PAIN EVER' },
      actorId: 'reg-1', actorRole: ED_ROLE.REGISTRATION_STAFF, actorName: 'Clerk', now: 1000,
    });

    // Even if chief complaint sounds critical, acuity MUST be null until authorized clinician assigns it
    const stored = store.getEncounter(enc.id);
    expect(stored.acuity).toBeNull();
    expect(stored.status).toBe(ENCOUNTER_STATUS.REGISTERED);
  });
});
