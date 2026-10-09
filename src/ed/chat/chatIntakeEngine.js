/**
 * Chat Intake Engine — Pure logic & state machine for AI Patient Assistant.
 *
 * WhatsApp-banking style guided patient intake flow:
 * 1. Welcome & Triage Safety Disclaimer
 * 2. Self vs. Other context check
 * 3. Full Name
 * 4. Date of Birth (YYYY-MM-DD)
 * 5. Gender (male | female | other | prefer_not_to_say)
 * 6. Chief Complaint (patient's own words)
 * 7. Urgent symptom screening & immediate alert
 * 8. Summary Review
 * 9. Explicit Confirmation
 * 10. Registration submission
 *
 * ⚠️ Safety Invariants:
 * - Never infers, assigns, or modifies clinical acuity (P1–P5).
 * - Never triggers emergency bypass or creates clinical assessments.
 * - Urgent keyword detection is a patient warning aid only; acuity remains clinician-assigned.
 */

import { validatePatientInfo } from '../logic/encounterValidator.js';
import { ED_ROLE } from '../types/enums.js';

// Conversational Step IDs
export const CHAT_STEPS = Object.freeze({
  WELCOME: 'welcome',
  REGISTRATION_TARGET: 'registration_target', // self vs other
  FULL_NAME: 'full_name',
  DATE_OF_BIRTH: 'date_of_birth',
  GENDER: 'gender',
  CHIEF_COMPLAINT: 'chief_complaint',
  REVIEW_SUMMARY: 'review_summary',
  CONFIRMED: 'confirmed',
});

// Urgent symptom warning dictionary with categories
export const URGENT_SYMPTOM_PATTERNS = Object.freeze([
  {
    category: 'Severe Chest Pain / Cardiac',
    patterns: [
      /\b(severe|crushing|sharp|heavy|tight)\s+chest\s+pain\b/i,
      /\bchest\s+(pressure|tightness|heaviness)\b/i,
      /\bpain\s+radiating\s+to\s+(left\s+arm|jaw|neck|back)\b/i,
      /\bheart\s+attack\b/i,
    ],
  },
  {
    category: 'Respiratory Distress',
    patterns: [
      /\b(cannot|can't|unable\s+to)\s+breathe\b/i,
      /\bdifficulty\s+breathing\b/i,
      /\bsevere\s+shortness\s+of\s+breath\b/i,
      /\bstruggling\s+to\s+breathe\b/i,
      /\bgasping\s+for\s+(air|breath)\b/i,
      /\bstopped\s+breathing\b/i,
      /\bchoking\b/i,
    ],
  },
  {
    category: 'Severe Bleeding / Hemorrhage',
    patterns: [
      /\bsevere\s+bleeding\b/i,
      /\bheavy\s+bleeding\b/i,
      /\bbleeding\s+profusely\b/i,
      /\buncontrolled\s+bleeding\b/i,
      /\bcoughing\s+up?\s+blood\b/i,
      /\bvomiting\s+blood\b/i,
    ],
  },
  {
    category: 'Stroke-like Symptoms',
    patterns: [
      /\b(facial|face)\s+(droop|drooping)\b/i,
      /\bslurred\s+speech\b/i,
      /\bsudden\s+(weakness|numbness|paralysis)\b/i,
      /\b(cannot|can't)\s+(move|lift)\s+(arm|leg|side)\b/i,
      /\bsudden\s+loss\s+of\s+vision\b/i,
      /\bstroke\b/i,
    ],
  },
  {
    category: 'Loss of Consciousness / Unresponsive',
    patterns: [
      /\bloss\s+of\s+consciousness\b/i,
      /\bunconscious\b/i,
      /\bpassed\s+out\b/i,
      /\bfainted\b/i,
      /\bunresponsive\b/i,
      /\bblacked\s+out\b/i,
      /\bcollapsed\b/i,
      /\bseizure\b/i,
    ],
  },
]);

/**
 * Deterministic detection of predefined urgent warning phrases in text.
 *
 * @param {string} text - User input string
 * @returns {{ isUrgent: boolean, detectedCategories: string[], warningMessage: string | null }}
 */
export function detectUrgentSymptoms(text) {
  if (!text || typeof text !== 'string') {
    return { isUrgent: false, detectedCategories: [], warningMessage: null };
  }

  const cleaned = text.trim();
  const matchedCategories = [];

  for (const group of URGENT_SYMPTOM_PATTERNS) {
    for (const pattern of group.patterns) {
      if (pattern.test(cleaned)) {
        if (!matchedCategories.includes(group.category)) {
          matchedCategories.push(group.category);
        }
        break;
      }
    }
  }

  const isUrgent = matchedCategories.length > 0;
  const warningMessage = isUrgent
    ? 'CRITICAL WARNING: The symptoms described may require immediate medical resuscitation. Please notify the Triage Nurse or nearest Emergency Department staff right now.'
    : null;

  return {
    isUrgent,
    detectedCategories: matchedCategories,
    warningMessage,
  };
}

/**
 * Validates patient full name input.
 *
 * @param {string} name
 * @returns {{ valid: boolean, error?: string, normalized?: string }}
 */
export function validateNameInput(name) {
  if (!name || typeof name !== 'string') {
    return { valid: false, error: 'Please enter the patient’s full name.' };
  }
  const trimmed = name.trim();
  if (trimmed.length < 2) {
    return { valid: false, error: 'Full name must be at least 2 characters.' };
  }
  // Check that name isn't just symbols or numbers
  if (!/[a-zA-Z]/.test(trimmed)) {
    return { valid: false, error: 'Please enter a valid name containing letters.' };
  }
  return { valid: true, normalized: trimmed };
}

/**
 * Validates and normalizes date of birth input.
 * Supports standard YYYY-MM-DD format as well as common user variants (YYYY/MM/DD, DD-MM-YYYY).
 *
 * @param {string} rawDob
 * @returns {{ valid: boolean, error?: string, normalized?: string }}
 */
export function validateDobInput(rawDob) {
  if (!rawDob || typeof rawDob !== 'string') {
    return { valid: false, error: 'Date of birth is required.' };
  }

  const trimmed = rawDob.trim();

  // Standard YYYY-MM-DD pattern
  let isoDate = trimmed;
  if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(trimmed)) {
    const parts = trimmed.split(/[-/.]/);
    const year = parts[0];
    const month = parts[1].padStart(2, '0');
    const day = parts[2].padStart(2, '0');
    isoDate = `${year}-${month}-${day}`;
  } else if (/^\d{1,2}[-/.]\d{1,2}[-/.]\d{4}$/.test(trimmed)) {
    // DD-MM-YYYY format
    const parts = trimmed.split(/[-/.]/);
    const day = parts[0].padStart(2, '0');
    const month = parts[1].padStart(2, '0');
    const year = parts[2];
    isoDate = `${year}-${month}-${day}`;
  }

  const d = new Date(isoDate);
  if (isNaN(d.getTime())) {
    return { valid: false, error: 'Please enter a valid date in YYYY-MM-DD format (e.g. 1990-05-15).' };
  }

  const now = new Date();
  if (d > now) {
    return { valid: false, error: 'Date of birth cannot be in the future.' };
  }

  const minYear = now.getFullYear() - 130;
  if (d.getFullYear() < minYear) {
    return { valid: false, error: `Date of birth cannot be earlier than ${minYear}.` };
  }

  return { valid: true, normalized: isoDate };
}

/**
 * Validates gender selection.
 *
 * @param {string} gender
 * @returns {{ valid: boolean, error?: string, normalized?: string }}
 */
export function validateGenderInput(gender) {
  const allowed = ['male', 'female', 'other', 'prefer_not_to_say'];
  if (!gender || typeof gender !== 'string') {
    return { valid: false, error: 'Please select a gender option.' };
  }
  const lower = gender.toLowerCase().trim();
  if (!allowed.includes(lower)) {
    return { valid: false, error: `Gender must be one of: ${allowed.join(', ')}.` };
  }
  return { valid: true, normalized: lower };
}

/**
 * Validates chief complaint description.
 *
 * @param {string} complaint
 * @returns {{ valid: boolean, error?: string, normalized?: string, isUrgent: boolean, urgentCategories: string[] }}
 */
export function validateComplaintInput(complaint) {
  if (!complaint || typeof complaint !== 'string') {
    return { valid: false, error: 'Chief complaint is required.' };
  }
  const trimmed = complaint.trim();
  if (trimmed.length < 3) {
    return { valid: false, error: 'Please describe the symptoms in at least 3 characters.' };
  }

  const urgentCheck = detectUrgentSymptoms(trimmed);

  return {
    valid: true,
    normalized: trimmed,
    isUrgent: urgentCheck.isUrgent,
    urgentCategories: urgentCheck.detectedCategories,
    warningMessage: urgentCheck.warningMessage,
  };
}

/**
 * Builds the canonical patient registration payload for store.registerEncounter.
 *
 * @param {Object} intakeState - Collected conversational data
 * @returns {{ patientInfo: Object, actorId: string, actorRole: string, actorName: string }}
 */
export function buildRegistrationPayload(intakeState) {
  const { name, dob, gender, chiefComplaint, isUrgent } = intakeState;

  // Format complaint: preserve verbatim complaint, flag urgent symptom prominently if detected
  const formattedComplaint = isUrgent
    ? `[URGENT SYMPTOM REPORTED] ${chiefComplaint}`
    : chiefComplaint;

  const patientInfo = {
    name: name.trim(),
    dob,
    gender,
    chiefComplaint: formattedComplaint,
  };

  const validation = validatePatientInfo(patientInfo);
  if (!validation.valid) {
    const err = new Error(validation.errors.join('; '));
    err.code = 'VALIDATION_FAILED';
    err.errors = validation.errors;
    throw err;
  }

  return {
    patientInfo,
    actorId: 'ai-assistant-1',
    actorRole: ED_ROLE.REGISTRATION_STAFF, // Intake channel operates with registration permissions only
    actorName: 'AI Patient Assistant',
  };
}

/**
 * Initial state factory for conversational intake session.
 */
export function createInitialIntakeState() {
  return {
    step: CHAT_STEPS.WELCOME,
    target: 'self', // 'self' | 'other' (conversational context only)
    name: '',
    dob: '',
    gender: '',
    chiefComplaint: '',
    isUrgent: false,
    urgentCategories: [],
    warningAcknowledged: false,
    history: [], // [{ step, timestamp }] for back-navigation
    isSubmitting: false,
    encounterId: null,
    error: null,
  };
}
