import { describe, it, expect, beforeEach } from 'vitest';
import { EdMemoryStore } from '../../src/ed/db/edMemoryStore.js';
import { ED_ROLE, TIMELINE_EVENT_TYPE, AUDIT_EVENT_TYPE } from '../../src/ed/types/enums.js';

describe('Audit Log & Patient Timeline (Part 4)', () => {
  let store;

  beforeEach(() => {
    store = new EdMemoryStore();
  });

  it('records chronological timeline events for registration and assessment', () => {
    const { encounter: enc } = store.registerEncounter({
      patientInfo: { name: 'Timeline Patient', dob: '1992-06-15', gender: 'female', chiefComplaint: 'Fever' },
      actorId: 'reg-staff-1',
      actorRole: ED_ROLE.REGISTRATION_STAFF,
      actorName: 'Alice Clerk',
      now: 1000,
    });

    store.recordAssessment({
      encounterId: enc.id,
      acuity: 'P3',
      notes: 'Initial clinical evaluation',
      actorId: 'triage-nurse-1',
      actorRole: ED_ROLE.TRIAGE_CLINICIAN,
      actorName: 'Bob Nurse',
      now: 2000,
    });

    const timeline = store.getTimeline(enc.id);
    expect(timeline.length).toBeGreaterThanOrEqual(2);

    expect(timeline[0].type).toBe(TIMELINE_EVENT_TYPE.REGISTERED);
    expect(timeline[0].actorName).toBe('Alice Clerk');
    expect(timeline[0].timestamp).toBe(1000);

    expect(timeline[1].type).toBe(TIMELINE_EVENT_TYPE.ASSESSMENT_RECORDED);
    expect(timeline[1].actorName).toBe('Bob Nurse');
    expect(timeline[1].data.acuity).toBe('P3');
    expect(timeline[1].timestamp).toBe(2000);
  });

  it('records append-only audit log entries when emergency bypass is activated and acknowledged', () => {
    const { encounter: enc } = store.registerEncounter({
      patientInfo: { name: 'Emergency Audit Patient', dob: '1975-02-20', gender: 'male', chiefComplaint: 'Trauma' },
      actorId: 'reg-1', actorRole: ED_ROLE.REGISTRATION_STAFF, actorName: 'Clerk', now: 1000,
    });

    const emg = store.activateEmergency({
      encounterId: enc.id,
      reason: 'Major arterial bleeding',
      actorId: 'emg-doc-1',
      actorRole: ED_ROLE.EMERGENCY_CLINICIAN,
      actorName: 'Dr. Trauma',
      now: 2000,
    });

    store.acknowledgeEmergency({
      emergencyId: emg.id,
      actorId: 'emg-doc-2',
      actorRole: ED_ROLE.EMERGENCY_CLINICIAN,
      actorName: 'Dr. Resuscitation',
      now: 3000,
    });

    const auditLogs = store.getAllAuditLogs();
    expect(auditLogs).toHaveLength(2);

    expect(auditLogs[0].type).toBe(AUDIT_EVENT_TYPE.EMERGENCY_ACTIVATED);
    expect(auditLogs[0].encounterId).toBe(enc.id);
    expect(auditLogs[0].reason).toBe('Major arterial bleeding');
    expect(auditLogs[0].actorName).toBe('Dr. Trauma');

    expect(auditLogs[1].type).toBe(AUDIT_EVENT_TYPE.EMERGENCY_ACKNOWLEDGED);
    expect(auditLogs[1].encounterId).toBe(enc.id);
    expect(auditLogs[1].actorName).toBe('Dr. Resuscitation');
  });

  it('records audit log for clinical overrides with mandatory justification', () => {
    const { encounter: enc } = store.registerEncounter({
      patientInfo: { name: 'Override Patient', dob: '1980-01-01', gender: 'female', chiefComplaint: 'Abdominal pain' },
      actorId: 'reg-1', actorRole: ED_ROLE.REGISTRATION_STAFF, actorName: 'Clerk', now: 1000,
    });
    store.recordAssessment({
      encounterId: enc.id, acuity: 'P3', notes: '',
      actorId: 'tri-1', actorRole: ED_ROLE.TRIAGE_CLINICIAN, actorName: 'Nurse', now: 2000,
    });

    store.performOverride({
      encounterId: enc.id,
      operation: 'EXPEDITE_FOR_DIAGNOSTIC_IMAGING',
      previousState: { queuePosition: 4 },
      newState: { queuePosition: 1 },
      reason: 'Urgent CT scan slot opened in radiology',
      actorId: 'flow-coord-1',
      actorRole: ED_ROLE.FLOW_COORDINATOR,
      actorName: 'Lead Coordinator',
      now: 3000,
    });

    const auditLogs = store.getAllAuditLogs();
    const overrideLog = auditLogs.find(l => l.type === AUDIT_EVENT_TYPE.OVERRIDE_PERFORMED);

    expect(overrideLog).toBeDefined();
    expect(overrideLog.encounterId).toBe(enc.id);
    expect(overrideLog.reason).toBe('Urgent CT scan slot opened in radiology');
    expect(overrideLog.actorRole).toBe(ED_ROLE.FLOW_COORDINATOR);
  });

  it('getAllTimelineEvents aggregates events across encounters without mutation', () => {
    const { encounter: e1 } = store.registerEncounter({
      patientInfo: { name: 'Patient 1', dob: '1990-01-01', gender: 'male', chiefComplaint: 'Cough' },
      actorId: 'reg-1', actorRole: ED_ROLE.REGISTRATION_STAFF, actorName: 'Clerk', now: 1000,
    });
    const { encounter: e2 } = store.registerEncounter({
      patientInfo: { name: 'Patient 2', dob: '1995-01-01', gender: 'female', chiefComplaint: 'Sprain' },
      actorId: 'reg-1', actorRole: ED_ROLE.REGISTRATION_STAFF, actorName: 'Clerk', now: 2000,
    });

    const allEvents = store.getAllTimelineEvents();
    expect(allEvents.length).toBeGreaterThanOrEqual(2);
    expect(allEvents.some(e => e.encounterId === e1.id)).toBe(true);
    expect(allEvents.some(e => e.encounterId === e2.id)).toBe(true);
  });
});
