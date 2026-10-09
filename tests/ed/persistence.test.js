import { describe, it, expect, beforeEach } from 'vitest';
import { EdMemoryStore } from '../../src/ed/db/edMemoryStore.js';
import {
  serializeStore,
  deserializeStore,
  saveStoreToStorage,
  loadStoreFromStorage,
  clearStoreStorage,
  STORAGE_KEY,
} from '../../src/ed/db/edPersistence.js';
import { ED_ROLE, EMERGENCY_STATUS } from '../../src/ed/types/enums.js';

class MockStorage {
  constructor() {
    this.store = {};
  }
  getItem(key) {
    return this.store[key] || null;
  }
  setItem(key, value) {
    this.store[key] = String(value);
  }
  removeItem(key) {
    delete this.store[key];
  }
  clear() {
    this.store = {};
  }
}

describe('Persistence Adapter Tests (edPersistence.js)', () => {
  let mockStorage;
  let sourceStore;

  beforeEach(() => {
    mockStorage = new MockStorage();
    sourceStore = new EdMemoryStore();
  });

  it('serializes and deserializes complete store state including encounters, assessments, and timeline', () => {
    // 1. Register encounter
    const { encounter: enc } = sourceStore.registerEncounter({
      patientInfo: { name: 'Persistence Patient', dob: '1988-04-12', gender: 'female', chiefComplaint: 'Acute headache' },
      actorId: 'reg-1',
      actorRole: ED_ROLE.REGISTRATION_STAFF,
      actorName: 'Clerk Jones',
      now: 1000,
    });

    // 2. Assess encounter
    sourceStore.recordAssessment({
      encounterId: enc.id,
      acuity: 'P3',
      notes: 'Initial clinical notes',
      actorId: 'tri-1',
      actorRole: ED_ROLE.TRIAGE_CLINICIAN,
      actorName: 'Nurse Patel',
      now: 2000,
    });

    // 3. Save to storage
    const saveResult = saveStoreToStorage(sourceStore, mockStorage);
    expect(saveResult.success).toBe(true);
    expect(mockStorage.getItem(STORAGE_KEY)).toBeTruthy();

    // 4. Hydrate into a fresh store instance (simulating browser reload)
    const targetStore = new EdMemoryStore();
    const loadResult = loadStoreFromStorage(targetStore, mockStorage);
    expect(loadResult.success).toBe(true);
    expect(loadResult.loaded).toBe(true);

    // Verify encounter survived
    const restoredEnc = targetStore.getEncounter(enc.id);
    expect(restoredEnc).toBeDefined();
    expect(restoredEnc.patientInfo.name).toBe('Persistence Patient');
    expect(restoredEnc.acuity).toBe('P3');

    // Verify queue reflects loaded state
    const queue = targetStore.getQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].id).toBe(enc.id);

    // Verify assessments survived
    const assessments = targetStore.getAssessments(enc.id);
    expect(assessments).toHaveLength(1);
    expect(assessments[0].notes).toBe('Initial clinical notes');

    // Verify timeline survived
    const timeline = targetStore.getTimeline(enc.id);
    expect(timeline.length).toBeGreaterThanOrEqual(2);
  });

  it('preserves emergency events across persistence restore', () => {
    const { encounter: enc } = sourceStore.registerEncounter({
      patientInfo: { name: 'Cardiac Patient', dob: '1970-01-01', gender: 'male', chiefComplaint: 'Chest pain' },
      actorId: 'reg-1',
      actorRole: ED_ROLE.REGISTRATION_STAFF,
      actorName: 'Clerk',
      now: 1000,
    });

    sourceStore.activateEmergency({
      encounterId: enc.id,
      reason: 'Sudden collapse',
      actorId: 'emg-1',
      actorRole: ED_ROLE.EMERGENCY_CLINICIAN,
      actorName: 'Dr. Trauma',
      now: 2000,
    });

    saveStoreToStorage(sourceStore, mockStorage);

    const freshStore = new EdMemoryStore();
    loadStoreFromStorage(freshStore, mockStorage);

    const emergencies = freshStore.getEmergencyList();
    expect(emergencies).toHaveLength(1);
    expect(emergencies[0].encounterId).toBe(enc.id);
    expect(emergencies[0].reason).toBe('Sudden collapse');
    expect(emergencies[0].emergencyStatus).toBe(EMERGENCY_STATUS.ACTIVE);
  });

  it('handles corrupted storage data without crashing and reports error cleanly', () => {
    mockStorage.setItem(STORAGE_KEY, '{ invalid_json ::: }');
    const freshStore = new EdMemoryStore();
    const loadResult = loadStoreFromStorage(freshStore, mockStorage);

    expect(loadResult.success).toBe(false);
    expect(loadResult.loaded).toBe(false);
    expect(loadResult.error).toBeDefined();
  });

  it('never reports success if storage write throws (e.g. quota exceeded)', () => {
    const brokenStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError: storage is full');
      },
    };

    const saveResult = saveStoreToStorage(sourceStore, brokenStorage);
    expect(saveResult.success).toBe(false);
    expect(saveResult.error).toMatch(/quota/i);
  });
});
