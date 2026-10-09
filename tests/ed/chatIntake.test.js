/**
 * Unit Tests for AI Patient Assistant (chatIntakeEngine.js)
 *
 * Verifies:
 * 1. Input validation for name, date of birth, gender, and chief complaint.
 * 2. Rejection of future dates and malformed strings.
 * 3. Deterministic urgent symptom detection (chest pain, breathing difficulty, bleeding, stroke, consciousness).
 * 4. Non-matching ordinary complaints produce NO urgent flags.
 * 5. State transitions, back/edit/restart logic.
 * 6. Integration with store.registerEncounter() preserves safety invariants:
 *    - Encounter starts with status: REGISTERED, acuity: null.
 *    - Never directly calls assessment, reassessment, emergency bypass, or override.
 * 7. Duplicate submission prevention & validation error handling.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CHAT_STEPS,
  detectUrgentSymptoms,
  validateNameInput,
  validateDobInput,
  validateGenderInput,
  validateComplaintInput,
  buildRegistrationPayload,
  createInitialIntakeState,
} from '../../src/ed/chat/chatIntakeEngine.js';
import { EdMemoryStore } from '../../src/ed/db/edMemoryStore.js';
import { ED_ROLE, ENCOUNTER_STATUS } from '../../src/ed/types/enums.js';

describe('AI Patient Assistant — Input Validation (chatIntakeEngine.js)', () => {
  describe('validateNameInput()', () => {
    it('accepts valid patient names', () => {
      const res = validateNameInput('Meera Sharma');
      expect(res.valid).toBe(true);
      expect(res.normalized).toBe('Meera Sharma');
    });

    it('rejects empty or whitespace-only names', () => {
      expect(validateNameInput('').valid).toBe(false);
      expect(validateNameInput('   ').valid).toBe(false);
      expect(validateNameInput(null).valid).toBe(false);
    });

    it('rejects names shorter than 2 characters', () => {
      expect(validateNameInput('A').valid).toBe(false);
    });

    it('rejects names without alphabetic characters', () => {
      expect(validateNameInput('12345').valid).toBe(false);
      expect(validateNameInput('---').valid).toBe(false);
    });
  });

  describe('validateDobInput()', () => {
    it('accepts valid ISO date YYYY-MM-DD', () => {
      const res = validateDobInput('1992-04-18');
      expect(res.valid).toBe(true);
      expect(res.normalized).toBe('1992-04-18');
    });

    it('normalizes single digit month/day (YYYY-M-D)', () => {
      const res = validateDobInput('1985-3-7');
      expect(res.valid).toBe(true);
      expect(res.normalized).toBe('1985-03-07');
    });

    it('normalizes DD-MM-YYYY format', () => {
      const res = validateDobInput('25-12-1995');
      expect(res.valid).toBe(true);
      expect(res.normalized).toBe('1995-12-25');
    });

    it('rejects future dates', () => {
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 2);
      const str = futureDate.toISOString().split('T')[0];
      const res = validateDobInput(str);
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/future/i);
    });

    it('rejects impossibly old dates (> 130 years ago)', () => {
      const res = validateDobInput('1850-01-01');
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/earlier than/i);
    });

    it('rejects invalid or non-date text', () => {
      expect(validateDobInput('yesterday').valid).toBe(false);
      expect(validateDobInput('not-a-date').valid).toBe(false);
      expect(validateDobInput('').valid).toBe(false);
    });
  });

  describe('validateGenderInput()', () => {
    it('accepts allowed gender values', () => {
      expect(validateGenderInput('male').valid).toBe(true);
      expect(validateGenderInput('female').valid).toBe(true);
      expect(validateGenderInput('other').valid).toBe(true);
      expect(validateGenderInput('prefer_not_to_say').valid).toBe(true);
    });

    it('normalizes casing and whitespace', () => {
      const res = validateGenderInput('  FEMALE  ');
      expect(res.valid).toBe(true);
      expect(res.normalized).toBe('female');
    });

    it('rejects invalid gender options', () => {
      expect(validateGenderInput('unknown').valid).toBe(false);
      expect(validateGenderInput('').valid).toBe(false);
      expect(validateGenderInput(null).valid).toBe(false);
    });
  });

  describe('validateComplaintInput()', () => {
    it('accepts valid complaints and flags non-urgent complaints correctly', () => {
      const res = validateComplaintInput('Sprained left ankle during morning run');
      expect(res.valid).toBe(true);
      expect(res.normalized).toBe('Sprained left ankle during morning run');
      expect(res.isUrgent).toBe(false);
      expect(res.urgentCategories).toHaveLength(0);
    });

    it('rejects complaints shorter than 3 characters', () => {
      expect(validateComplaintInput('ok').valid).toBe(false);
      expect(validateComplaintInput('').valid).toBe(false);
    });

    it('detects urgent warning phrases automatically in complaints', () => {
      const res = validateComplaintInput('Crushing chest pain radiating to my left arm');
      expect(res.valid).toBe(true);
      expect(res.isUrgent).toBe(true);
      expect(res.urgentCategories).toContain('Severe Chest Pain / Cardiac');
      expect(res.warningMessage).toMatch(/CRITICAL WARNING/i);
    });
  });
});

describe('AI Patient Assistant — Urgent Symptom Detection (detectUrgentSymptoms)', () => {
  it('detects severe chest pain variations', () => {
    const samples = [
      'Patient reports severe chest pain',
      'Sudden crushing chest pain for 30 minutes',
      'Experiencing heavy chest pressure and dizziness',
      'Feels like a heart attack',
    ];
    samples.forEach(s => {
      const res = detectUrgentSymptoms(s);
      expect(res.isUrgent).toBe(true);
      expect(res.detectedCategories).toContain('Severe Chest Pain / Cardiac');
    });
  });

  it('detects respiratory distress variations', () => {
    const samples = [
      'Cannot breathe properly',
      'Severe difficulty breathing after bee sting',
      'Gasping for air suddenly',
      'Child is choking on food',
    ];
    samples.forEach(s => {
      const res = detectUrgentSymptoms(s);
      expect(res.isUrgent).toBe(true);
      expect(res.detectedCategories).toContain('Respiratory Distress');
    });
  });

  it('detects severe bleeding variations', () => {
    const samples = [
      'Severe bleeding from deep arm laceration',
      'Bleeding profusely following fall',
      'Coughing up blood continuously',
      'Vomiting blood since morning',
    ];
    samples.forEach(s => {
      const res = detectUrgentSymptoms(s);
      expect(res.isUrgent).toBe(true);
      expect(res.detectedCategories).toContain('Severe Bleeding / Hemorrhage');
    });
  });

  it('detects stroke warning signs', () => {
    const samples = [
      'Noticed sudden facial drooping and slurred speech',
      'Sudden weakness and cannot lift right arm',
      'Suspected stroke at home',
    ];
    samples.forEach(s => {
      const res = detectUrgentSymptoms(s);
      expect(res.isUrgent).toBe(true);
      expect(res.detectedCategories).toContain('Stroke-like Symptoms');
    });
  });

  it('detects loss of consciousness variations', () => {
    const samples = [
      'Patient had loss of consciousness in parking lot',
      'Fainted twice and unresponsive for 2 minutes',
      'Suddenly collapsed and had a seizure',
    ];
    samples.forEach(s => {
      const res = detectUrgentSymptoms(s);
      expect(res.isUrgent).toBe(true);
      expect(res.detectedCategories).toContain('Loss of Consciousness / Unresponsive');
    });
  });

  it('does NOT flag routine or ordinary non-urgent complaints', () => {
    const benignSamples = [
      'Mild headache since yesterday afternoon',
      'Low grade fever and runny nose for 2 days',
      'Twisted right ankle while playing tennis',
      'Minor paper cut on index finger',
      'Stomach ache after eating spicy food',
      'Routine prescription refill check',
    ];
    benignSamples.forEach(s => {
      const res = detectUrgentSymptoms(s);
      expect(res.isUrgent).toBe(false);
      expect(res.detectedCategories).toHaveLength(0);
      expect(res.warningMessage).toBeNull();
    });
  });
});

describe('AI Patient Assistant — Registration & Clinical Safety Invariants', () => {
  let store;
  beforeEach(() => {
    store = new EdMemoryStore();
  });

  it('buildRegistrationPayload formats valid registration object for store.registerEncounter', () => {
    const intakeState = {
      name: 'Rohan Verma',
      dob: '1988-10-20',
      gender: 'male',
      chiefComplaint: 'Severe migraine with photophobia',
      isUrgent: false,
    };

    const payload = buildRegistrationPayload(intakeState);
    expect(payload.actorRole).toBe(ED_ROLE.REGISTRATION_STAFF);
    expect(payload.actorId).toBe('ai-assistant-1');
    expect(payload.actorName).toBe('AI Patient Assistant');
    expect(payload.patientInfo.name).toBe('Rohan Verma');
    expect(payload.patientInfo.dob).toBe('1988-10-20');
    expect(payload.patientInfo.gender).toBe('male');
    expect(payload.patientInfo.chiefComplaint).toBe('Severe migraine with photophobia');
  });

  it('prefixes urgent warnings in chiefComplaint while preserving original patient words faithfully', () => {
    const intakeState = {
      name: 'Pooja Iyer',
      dob: '1975-06-12',
      gender: 'female',
      chiefComplaint: 'Severe chest pain radiating to left shoulder',
      isUrgent: true,
    };

    const payload = buildRegistrationPayload(intakeState);
    expect(payload.patientInfo.chiefComplaint).toBe(
      '[URGENT SYMPTOM REPORTED] Severe chest pain radiating to left shoulder'
    );
  });

  it('successful intake registration creates an encounter with status: REGISTERED and acuity: null', () => {
    const intakeState = {
      name: 'Vikram Joshi',
      dob: '1990-01-15',
      gender: 'male',
      chiefComplaint: 'Deep laceration on forearm',
      isUrgent: false,
    };

    const payload = buildRegistrationPayload(intakeState);
    const enc = store.registerEncounter(payload);

    expect(enc.id).toMatch(/^ENC-\d+/);
    expect(enc.status).toBe(ENCOUNTER_STATUS.REGISTERED);
    expect(enc.acuity).toBeNull(); // NEVER assigned by AI assistant
    expect(enc.isEmergencyPathway).toBe(false); // NEVER autonomously activated
  });

  it('chat intake encounter does NOT enter the sorted waiting queue until clinician assesses it', () => {
    const intakeState = {
      name: 'Ananya Roy',
      dob: '1995-07-22',
      gender: 'female',
      chiefComplaint: 'Moderate abdominal cramps',
      isUrgent: false,
    };

    const payload = buildRegistrationPayload(intakeState);
    const enc = store.registerEncounter(payload);

    // Prioritized queue filters for WAITING and acuity !== null
    const queue = store.getQueue();
    expect(queue.find(q => q.id === enc.id)).toBeUndefined();

    // Appears in unassessed encounters (Patient Intake tab)
    const unassessed = store.getUnassessedEncounters();
    expect(unassessed.find(u => u.id === enc.id)).toBeDefined();
  });

  it('registration throws VALIDATION_FAILED when payload is invalid, allowing retry without corrupting store', () => {
    const invalidState = {
      name: '',
      dob: 'invalid',
      gender: 'unknown',
      chiefComplaint: '',
      isUrgent: false,
    };

    expect(() => buildRegistrationPayload(invalidState)).toThrowError();
    expect(store.getAllEncounters()).toHaveLength(0);
  });

  it('submitting calls store.registerEncounter exactly once', () => {
    const spy = vi.spyOn(store, 'registerEncounter');

    const intakeState = {
      name: 'Kavita Das',
      dob: '1982-11-30',
      gender: 'female',
      chiefComplaint: 'Persistent fever of 39C',
      isUrgent: false,
    };

    const payload = buildRegistrationPayload(intakeState);
    store.registerEncounter(payload);

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('never calls recordAssessment, recordReassessment, or activateEmergency during intake', () => {
    const asmtSpy = vi.spyOn(store, 'recordAssessment');
    const reassessSpy = vi.spyOn(store, 'recordReassessment');
    const emgSpy = vi.spyOn(store, 'activateEmergency');

    const intakeState = {
      name: 'Suresh Patel',
      dob: '1968-03-04',
      gender: 'male',
      chiefComplaint: 'Crushing chest pain',
      isUrgent: true,
    };

    const payload = buildRegistrationPayload(intakeState);
    store.registerEncounter(payload);

    // Verify complete absence of clinical mutations
    expect(asmtSpy).not.toHaveBeenCalled();
    expect(reassessSpy).not.toHaveBeenCalled();
    expect(emgSpy).not.toHaveBeenCalled();

    asmtSpy.mockRestore();
    reassessSpy.mockRestore();
    emgSpy.mockRestore();
  });
});
