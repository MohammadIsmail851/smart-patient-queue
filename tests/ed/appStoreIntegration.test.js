import { describe, it, expect } from 'vitest';
import { EdMemoryStore } from '../../src/ed/db/edMemoryStore.js';
import { SYNTHETIC_PATIENTS } from '../../src/ed/data/syntheticPatients.js';
import { ED_ROLE, EMERGENCY_STATUS } from '../../src/ed/types/enums.js';

describe('App & EdMemoryStore integration contract', () => {
  it('provides getQueue and getSortedQueue returning prioritized queue', () => {
    const store = new EdMemoryStore();
    const enc1 = store.registerEncounter({
      patientInfo: SYNTHETIC_PATIENTS[0],
      actorId: 'reg-1',
      actorRole: ED_ROLE.REGISTRATION_STAFF,
      actorName: 'Clerk',
      now: 1000,
    });
    const enc2 = store.registerEncounter({
      patientInfo: SYNTHETIC_PATIENTS[1],
      actorId: 'reg-1',
      actorRole: ED_ROLE.REGISTRATION_STAFF,
      actorName: 'Clerk',
      now: 2000,
    });

    store.recordAssessment({
      encounterId: enc1.id,
      acuity: 'P3',
      notes: 'Notes',
      actorId: 'tri-1',
      actorRole: ED_ROLE.TRIAGE_CLINICIAN,
      actorName: 'Nurse',
      now: 3000,
    });

    store.recordAssessment({
      encounterId: enc2.id,
      acuity: 'P2',
      notes: 'Notes',
      actorId: 'tri-1',
      actorRole: ED_ROLE.TRIAGE_CLINICIAN,
      actorName: 'Nurse',
      now: 4000,
    });

    expect(typeof store.getQueue).toBe('function');
    expect(typeof store.getSortedQueue).toBe('function');

    const queue = store.getQueue();
    const sortedQueue = store.getSortedQueue();

    expect(queue).toHaveLength(2);
    expect(sortedQueue).toEqual(queue);

    // P2 precedes P3
    expect(queue[0].acuity).toBe('P2');
    expect(queue[1].acuity).toBe('P3');

    // Expected App.jsx properties
    expect(queue[0]).toHaveProperty('id');
    expect(queue[0]).toHaveProperty('enteredQueueAt');
    expect(typeof queue[0].enteredQueueAt).toBe('number');
    expect(queue[0]).toHaveProperty('queuePosition', 1);
    expect(queue[0]).toHaveProperty('queueExplanation');
    expect(queue[0].patientInfo.name).toBe(SYNTHETIC_PATIENTS[1].name);
  });

  it('provides getEmergencyList returning emergency events expected by App.jsx', () => {
    const store = new EdMemoryStore();
    const enc = store.registerEncounter({
      patientInfo: SYNTHETIC_PATIENTS[0],
      actorId: 'reg-1',
      actorRole: ED_ROLE.REGISTRATION_STAFF,
      actorName: 'Clerk',
      now: 1000,
    });

    expect(typeof store.getEmergencyList).toBe('function');
    expect(store.getEmergencyList()).toHaveLength(0);

    store.activateEmergency({
      encounterId: enc.id,
      reason: 'Cardiac arrest',
      actorId: 'emg-1',
      actorRole: ED_ROLE.EMERGENCY_CLINICIAN,
      actorName: 'Dr. Emergency',
      now: 2000,
    });

    const emergencies = store.getEmergencyList();
    expect(emergencies).toHaveLength(1);
    expect(emergencies[0].emergencyStatus).toBe(EMERGENCY_STATUS.ACTIVE);
    expect(emergencies[0].reason).toBe('Cardiac arrest');
    expect(emergencies[0].activatedAt).toBe(2000);
  });

  it('provides getPendingReassessments returning watchlist items with acuity', () => {
    const store = new EdMemoryStore();
    const enc = store.registerEncounter({
      patientInfo: SYNTHETIC_PATIENTS[0],
      actorId: 'reg-1',
      actorRole: ED_ROLE.REGISTRATION_STAFF,
      actorName: 'Clerk',
      now: 1000,
    });

    store.recordAssessment({
      encounterId: enc.id,
      acuity: 'P3',
      notes: 'Notes',
      actorId: 'tri-1',
      actorRole: ED_ROLE.TRIAGE_CLINICIAN,
      actorName: 'Nurse',
      now: 2000,
    });

    expect(typeof store.getPendingReassessments).toBe('function');
    const reassessments = store.getPendingReassessments();
    expect(reassessments).toHaveLength(1);
    expect(reassessments[0].encounterId).toBe(enc.id);
    expect(reassessments[0].acuity).toBe('P3');
    expect(reassessments[0]).toHaveProperty('status');
    expect(reassessments[0]).toHaveProperty('dueAt');
  });
});
