/**
 * Automated Test Suite: System Validation for ED Triage Prototype
 *
 * Validates:
 * 1. Deterministic acuity-first queue ordering (P1 -> P5) and FIFO tie-breaking.
 * 2. Emergency bypass isolation from ordinary waiting queue.
 * 3. Overdue reassessment safety invariant (never auto-changes clinical acuity).
 * 4. Reassessment history preservation (append-only assessments).
 * 5. Input validation, invalid state transitions, and failed persistence isolation.
 * 6. Role permission enforcement in service layer and client-side role selector constraints.
 * 7. Persistence characteristics across re-instantiation (browser refresh simulation).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EdMemoryStore } from '../../src/ed/db/edMemoryStore.js';
import {
  ED_ROLE,
  ED_OPERATION,
  ACUITY_CATEGORY,
  ENCOUNTER_STATUS,
  EMERGENCY_STATUS,
  REASSESSMENT_STATUS,
} from '../../src/ed/types/enums.js';
import { SYNTHETIC_PATIENTS } from '../../src/ed/data/syntheticPatients.js';
import { hasPermission, requirePermission } from '../../src/ed/logic/permissionLogic.js';
import { canTransition } from '../../src/ed/logic/stateMachine.js';

const BASE_TIME = 1_700_000_000_000;

describe('Task 4: Deterministic acuity-first queue ordering & FIFO tie-breaking', () => {
  let store;
  beforeEach(() => {
    store = new EdMemoryStore();
  });

  it('orders encounters strictly by acuity priority (P1 > P2 > P3 > P4 > P5)', () => {
    const acuities = ['P5', 'P3', 'P1', 'P4', 'P2'];
    acuities.forEach((acuity, i) => {
      const { encounter } = store.registerEncounter({
        patientInfo: {
          name: `Patient ${acuity}`,
          dob: '1990-01-01',
          gender: 'female',
          chiefComplaint: `Complaint for ${acuity}`,
        },
        actorId: 'staff-reg',
        actorRole: ED_ROLE.REGISTRATION_STAFF,
        actorName: 'Reg Staff',
        now: BASE_TIME + i * 1000,
      });

      store.recordAssessment({
        encounterId: encounter.id,
        acuity,
        notes: `Assessed as ${acuity}`,
        actorId: 'tri-1',
        actorRole: ED_ROLE.TRIAGE_CLINICIAN,
        actorName: 'Triage Nurse',
        now: BASE_TIME + 10_000 + i * 1000,
      });
    });

    const queue = store.getQueue();
    expect(queue).toHaveLength(5);
    expect(queue.map(q => q.acuity)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5']);
    expect(queue[0].queuePosition).toBe(1);
    expect(queue[4].queuePosition).toBe(5);
  });

  it('breaks ties using registration timestamp FIFO among equal acuity encounters', () => {
    const times = [BASE_TIME + 20_000, BASE_TIME + 10_000, BASE_TIME + 30_000];
    const registeredIds = [];

    times.forEach((t, i) => {
      const { encounter } = store.registerEncounter({
        patientInfo: {
          name: `Patient P3 #${i}`,
          dob: '1985-02-02',
          gender: 'male',
          chiefComplaint: 'Moderate abdominal pain',
        },
        actorId: 'staff-reg',
        actorRole: ED_ROLE.REGISTRATION_STAFF,
        actorName: 'Reg Staff',
        now: t,
      });
      registeredIds.push({ id: encounter.id, registeredAt: t });

      store.recordAssessment({
        encounterId: encounter.id,
        acuity: 'P3',
        notes: 'Initial P3 assessment',
        actorId: 'tri-1',
        actorRole: ED_ROLE.TRIAGE_CLINICIAN,
        actorName: 'Triage Nurse',
        now: t + 5000,
      });
    });

    const queue = store.getQueue();
    expect(queue).toHaveLength(3);
    // Should be sorted by registeredAt ascending: index 1 (BASE_TIME+10k), index 0 (BASE_TIME+20k), index 2 (BASE_TIME+30k)
    expect(queue[0].id).toBe(registeredIds[1].id);
    expect(queue[1].id).toBe(registeredIds[0].id);
    expect(queue[2].id).toBe(registeredIds[2].id);
  });

  it('FIFO tie-breaking never supersedes clinical acuity', () => {
    // P4 registered very early
    const { encounter: encP4 } = store.registerEncounter({
      patientInfo: { name: 'Early P4', dob: '1980-01-01', gender: 'female', chiefComplaint: 'Sprain' },
      actorId: 'staff-reg',
      actorRole: ED_ROLE.REGISTRATION_STAFF,
      actorName: 'Reg Staff',
      now: BASE_TIME,
    });
    store.recordAssessment({
      encounterId: encP4.id,
      acuity: 'P4',
      notes: 'Sprain',
      actorId: 'tri-1',
      actorRole: ED_ROLE.TRIAGE_CLINICIAN,
      actorName: 'Triage Nurse',
      now: BASE_TIME + 1000,
    });

    // P2 registered hours later
    const { encounter: encP2 } = store.registerEncounter({
      patientInfo: { name: 'Late P2', dob: '1970-01-01', gender: 'male', chiefComplaint: 'Chest tightness' },
      actorId: 'staff-reg',
      actorRole: ED_ROLE.REGISTRATION_STAFF,
      actorName: 'Reg Staff',
      now: BASE_TIME + 2 * 3600 * 1000,
    });
    store.recordAssessment({
      encounterId: encP2.id,
      acuity: 'P2',
      notes: 'Chest tightness',
      actorId: 'tri-1',
      actorRole: ED_ROLE.TRIAGE_CLINICIAN,
      actorName: 'Triage Nurse',
      now: BASE_TIME + 2 * 3600 * 1000 + 1000,
    });

    const queue = store.getQueue();
    expect(queue[0].id).toBe(encP2.id); // P2 must be ahead of P4
    expect(queue[1].id).toBe(encP4.id);
  });
});

describe('Task 5: Emergency bypass separation from ordinary waiting queue', () => {
  let store;
  beforeEach(() => {
    store = new EdMemoryStore();
  });

  it('completely excludes emergency-pathway patients from getQueue', () => {
    const { encounter: normalEnc } = store.registerEncounter({
      patientInfo: { name: 'Normal Patient', dob: '1992-04-12', gender: 'male', chiefComplaint: 'Cough' },
      actorId: 'reg-1',
      actorRole: ED_ROLE.REGISTRATION_STAFF,
      actorName: 'Reg Staff',
      now: BASE_TIME,
    });
    store.recordAssessment({
      encounterId: normalEnc.id,
      acuity: 'P4',
      notes: 'Mild symptoms',
      actorId: 'tri-1',
      actorRole: ED_ROLE.TRIAGE_CLINICIAN,
      actorName: 'Triage Nurse',
      now: BASE_TIME + 1000,
    });

    const { encounter: emgEnc } = store.registerEncounter({
      patientInfo: { name: 'Critical Patient', dob: '1960-08-20', gender: 'female', chiefComplaint: 'Cardiac arrest' },
      actorId: 'reg-1',
      actorRole: ED_ROLE.REGISTRATION_STAFF,
      actorName: 'Reg Staff',
      now: BASE_TIME + 2000,
    });
    store.recordAssessment({
      encounterId: emgEnc.id,
      acuity: 'P1',
      notes: 'Unresponsive',
      actorId: 'tri-1',
      actorRole: ED_ROLE.TRIAGE_CLINICIAN,
      actorName: 'Triage Nurse',
      now: BASE_TIME + 2500,
    });

    // Trigger emergency bypass
    store.activateEmergency({
      encounterId: emgEnc.id,
      reason: 'Immediate resuscitation required',
      actorId: 'emg-1',
      actorRole: ED_ROLE.EMERGENCY_CLINICIAN,
      actorName: 'Dr. Emergency',
      now: BASE_TIME + 3000,
    });

    const queue = store.getQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].id).toBe(normalEnc.id);

    // Emergency list contains only the activated emergency event
    const emergencies = store.getEmergencyList();
    expect(emergencies).toHaveLength(1);
    expect(emergencies[0].encounterId).toBe(emgEnc.id);
    expect(emergencies[0].emergencyStatus).toBe(EMERGENCY_STATUS.ACTIVE);
  });

  it('getActiveEmergencies returns encounter with status EMERGENCY_PATHWAY', () => {
    const { encounter } = store.registerEncounter({
      patientInfo: { name: 'Trauma Patient', dob: '1995-10-10', gender: 'male', chiefComplaint: 'Major trauma' },
      actorId: 'reg-1',
      actorRole: ED_ROLE.REGISTRATION_STAFF,
      actorName: 'Reg Staff',
      now: BASE_TIME,
    });
    store.activateEmergency({
      encounterId: encounter.id,
      reason: 'Hypovolemic shock following trauma',
      actorId: 'emg-1',
      actorRole: ED_ROLE.EMERGENCY_CLINICIAN,
      actorName: 'Dr. Trauma',
      now: BASE_TIME + 500,
    });

    const activeEmergencies = store.getActiveEmergencies();
    expect(activeEmergencies).toHaveLength(1);
    expect(activeEmergencies[0].id).toBe(encounter.id);
    expect(activeEmergencies[0].status).toBe(ENCOUNTER_STATUS.EMERGENCY_PATHWAY);
    expect(activeEmergencies[0].isEmergencyPathway).toBe(true);
  });
});

describe('Task 6: Overdue reassessment does NOT automatically change clinical acuity', () => {
  let store;
  beforeEach(() => {
    store = new EdMemoryStore();
  });

  it('marks task OVERDUE after interval expires but preserves encounter acuity strictly', () => {
    const { encounter } = store.registerEncounter({
      patientInfo: { name: 'Monitored Patient', dob: '1988-11-15', gender: 'female', chiefComplaint: 'Chest discomfort' },
      actorId: 'reg-1',
      actorRole: ED_ROLE.REGISTRATION_STAFF,
      actorName: 'Reg Staff',
      now: BASE_TIME,
    });

    store.recordAssessment({
      encounterId: encounter.id,
      acuity: 'P2', // 10 min reassessment interval
      notes: 'Initial evaluation',
      actorId: 'tri-1',
      actorRole: ED_ROLE.TRIAGE_CLINICIAN,
      actorName: 'Triage Nurse',
      now: BASE_TIME,
    });

    // Advance time by 3 hours
    const farFuture = BASE_TIME + 3 * 3600 * 1000;
    const watchlist = store.getWatchlist(farFuture);
    const task = watchlist.find(t => t.encounterId === encounter.id);

    expect(task).toBeDefined();
    expect(task.status).toBe(REASSESSMENT_STATUS.OVERDUE);

    // Verify encounter acuity remains unchanged
    const encAfter = store.getEncounter(encounter.id);
    expect(encAfter.acuity).toBe('P2');
    expect(encAfter.acuity).not.toBe('P1'); // NEVER auto-escalates to P1
  });
});

describe('Task 7: Reassessment saves a new assessment and preserves history', () => {
  let store;
  beforeEach(() => {
    store = new EdMemoryStore();
  });

  it('appends reassessment records and preserves complete audit trail of prior assessments', () => {
    const { encounter } = store.registerEncounter({
      patientInfo: { name: 'History Patient', dob: '1975-03-25', gender: 'female', chiefComplaint: 'Abdominal cramping' },
      actorId: 'reg-1',
      actorRole: ED_ROLE.REGISTRATION_STAFF,
      actorName: 'Reg Staff',
      now: BASE_TIME,
    });

    // Assessment 1: P3
    store.recordAssessment({
      encounterId: encounter.id,
      acuity: 'P3',
      notes: 'First assessment note',
      actorId: 'tri-1',
      actorRole: ED_ROLE.TRIAGE_CLINICIAN,
      actorName: 'Nurse One',
      now: BASE_TIME + 1000,
    });

    // Assessment 2 (Reassessment): clinician escalates to P2
    store.recordReassessment({
      encounterId: encounter.id,
      newAcuity: 'P2',
      notes: 'Pain worsening, vital signs trending unstable',
      actorId: 'tri-2',
      actorRole: ED_ROLE.TRIAGE_CLINICIAN,
      actorName: 'Nurse Two',
      now: BASE_TIME + 20_000,
    });

    // Assessment 3 (Reassessment): condition improves to P4
    store.recordReassessment({
      encounterId: encounter.id,
      newAcuity: 'P4',
      notes: 'Pain resolved following analgesia',
      actorId: 'tri-1',
      actorRole: ED_ROLE.TRIAGE_CLINICIAN,
      actorName: 'Nurse One',
      now: BASE_TIME + 60_000,
    });

    const assessments = store.getAssessments(encounter.id);
    expect(assessments).toHaveLength(3);

    expect(assessments[0].acuity).toBe('P3');
    expect(assessments[0].notes).toBe('First assessment note');

    expect(assessments[1].acuity).toBe('P2');
    expect(assessments[1].previousAcuity).toBe('P3');
    expect(assessments[1].acuityChanged).toBe(true);
    expect(assessments[1].isReassessment).toBe(true);

    expect(assessments[2].acuity).toBe('P4');
    expect(assessments[2].previousAcuity).toBe('P2');

    const enc = store.getEncounter(encounter.id);
    expect(enc.acuity).toBe('P4');
  });
});

describe('Task 8: Input validation, invalid state transitions, and failed persistence isolation', () => {
  let store;
  beforeEach(() => {
    store = new EdMemoryStore();
  });

  it('rejects registration with invalid date of birth, empty name, or empty complaint', () => {
    expect(() => store.registerEncounter({
      patientInfo: { name: '', dob: '1990-01-01', gender: 'male', chiefComplaint: 'Headache' },
      actorId: 'reg-1', actorRole: ED_ROLE.REGISTRATION_STAFF, actorName: 'Reg',
    })).toThrowError(/name is required/i);

    expect(() => store.registerEncounter({
      patientInfo: { name: 'John Doe', dob: '2099-01-01', gender: 'male', chiefComplaint: 'Headache' },
      actorId: 'reg-1', actorRole: ED_ROLE.REGISTRATION_STAFF, actorName: 'Reg',
    })).toThrowError(/date of birth cannot be in the future/i);

    expect(() => store.registerEncounter({
      patientInfo: { name: 'John Doe', dob: '1990-01-01', gender: 'male', chiefComplaint: '' },
      actorId: 'reg-1', actorRole: ED_ROLE.REGISTRATION_STAFF, actorName: 'Reg',
    })).toThrowError(/chief complaint is required/i);
  });

  it('rejects invalid state transitions via state machine guards', () => {
    // REGISTERED cannot jump directly to IN_CONSULTATION or COMPLETED
    expect(canTransition(ENCOUNTER_STATUS.REGISTERED, ENCOUNTER_STATUS.IN_CONSULTATION).allowed).toBe(false);
    expect(canTransition(ENCOUNTER_STATUS.REGISTERED, ENCOUNTER_STATUS.COMPLETED).allowed).toBe(false);

    // COMPLETED is a terminal status and cannot transition to anything
    expect(canTransition(ENCOUNTER_STATUS.COMPLETED, ENCOUNTER_STATUS.WAITING).allowed).toBe(false);
    expect(canTransition(ENCOUNTER_STATUS.COMPLETED, ENCOUNTER_STATUS.CALLED).allowed).toBe(false);
  });

  it('failed operation isolates persistence state without leaving dirty records', () => {
    const encountersCountBefore = store.getAllEncounters().length;
    const timelineCountBefore = store.timelineEvents.length;

    // Attempt invalid registration
    try {
      store.registerEncounter({
        patientInfo: { name: '', dob: '1990-01-01', gender: 'invalid_gender', chiefComplaint: '' },
        actorId: 'reg-1', actorRole: ED_ROLE.REGISTRATION_STAFF, actorName: 'Reg',
      });
    } catch (_) {}

    expect(store.getAllEncounters()).toHaveLength(encountersCountBefore);
    expect(store.timelineEvents).toHaveLength(timelineCountBefore);
  });
});

describe('Task 9: Role permissions enforcement at service layer vs client-side role selector', () => {
  let store;
  beforeEach(() => {
    store = new EdMemoryStore();
  });

  it('service layer strictly denies unauthorized role operations (e.g. registration staff cannot assign acuity)', () => {
    const { encounter } = store.registerEncounter({
      patientInfo: { name: 'Perm Patient', dob: '1985-05-05', gender: 'female', chiefComplaint: 'Dizziness' },
      actorId: 'reg-1', actorRole: ED_ROLE.REGISTRATION_STAFF, actorName: 'Reg',
    });

    expect(() => store.recordAssessment({
      encounterId: encounter.id,
      acuity: 'P3',
      notes: 'Unauthorized assessment',
      actorId: 'reg-1',
      actorRole: ED_ROLE.REGISTRATION_STAFF, // Registration staff NOT authorized
      actorName: 'Reg',
    })).toThrowError(/permission denied/i);
  });

  it('service layer strictly denies emergency activation by registration staff', () => {
    const { encounter } = store.registerEncounter({
      patientInfo: { name: 'Emergency Test', dob: '1980-01-01', gender: 'male', chiefComplaint: 'Chest pain' },
      actorId: 'reg-1', actorRole: ED_ROLE.REGISTRATION_STAFF, actorName: 'Reg',
    });

    expect(() => store.activateEmergency({
      encounterId: encounter.id,
      reason: 'Staff attempting bypass',
      actorId: 'reg-1',
      actorRole: ED_ROLE.REGISTRATION_STAFF,
      actorName: 'Reg',
    })).toThrowError(/permission denied/i);
  });

  it('demonstrates client-side limitation: store trusts actorRole argument blindly', () => {
    // If an untrusted caller passes actorRole = ED_ROLE.TRIAGE_CLINICIAN, store permits it because there is no cryptographically verified token/session
    const { encounter } = store.registerEncounter({
      patientInfo: { name: 'Spoofed Role Patient', dob: '1980-01-01', gender: 'male', chiefComplaint: 'Ear ache' },
      actorId: 'unverified-client',
      actorRole: ED_ROLE.REGISTRATION_STAFF,
      actorName: 'Client',
    });

    // In a browser with a client-side role dropdown, switching dropdown to TRIAGE_CLINICIAN sends actorRole: TRIAGE_CLINICIAN
    const result = store.recordAssessment({
      encounterId: encounter.id,
      acuity: 'P4',
      notes: 'Assessed with client-selected role',
      actorId: 'unverified-client',
      actorRole: ED_ROLE.TRIAGE_CLINICIAN, // Frontend supplies this role
      actorName: 'Client',
    });

    expect(result.encounter.acuity).toBe('P4');
  });
});

describe('Task 10: Persistence behavior across browser refresh simulation', () => {
  it('data is entirely in-memory and does not survive store re-instantiation (browser refresh simulation)', () => {
    // Simulate Tab Session 1
    const session1Store = new EdMemoryStore();
    const { encounter } = session1Store.registerEncounter({
      patientInfo: { name: 'Session 1 Patient', dob: '1991-07-07', gender: 'female', chiefComplaint: 'Migraine' },
      actorId: 'reg-1', actorRole: ED_ROLE.REGISTRATION_STAFF, actorName: 'Reg',
    });
    session1Store.recordAssessment({
      encounterId: encounter.id,
      acuity: 'P3',
      notes: 'Initial',
      actorId: 'tri-1', actorRole: ED_ROLE.TRIAGE_CLINICIAN, actorName: 'Nurse',
    });

    expect(session1Store.getQueue()).toHaveLength(1);
    expect(session1Store.getEncounter(encounter.id)).toBeDefined();

    // Simulate Browser Refresh: React remounts App component, creating a new EdMemoryStore() instance
    const session2Store = new EdMemoryStore();

    // Encounter from Session 1 does NOT exist in the new instance
    expect(session2Store.getEncounter(encounter.id)).toBeNull();
    expect(session2Store.getQueue()).toHaveLength(0);
  });
});
