/**
 * Encounter input validation — pure logic.
 *
 * Validates the minimum data needed to register a synthetic encounter.
 * Only synthetic / demonstration data is used; no real patient data.
 */

import { isValidAcuity } from '../config/acuity.js';

/**
 * Validate the patientInfo object supplied at registration.
 *
 * @param {Object} patientInfo
 * @returns {{ valid: boolean, errors: string[] }}
 */
export const validatePatientInfo = (patientInfo) => {
  const errors = [];

  if (!patientInfo || typeof patientInfo !== 'object') {
    return { valid: false, errors: ['Patient information object is required.'] };
  }

  // Name
  if (!patientInfo.name || patientInfo.name.trim().length < 2) {
    errors.push('Patient name is required (minimum 2 characters).');
  }

  // Date of birth
  if (!patientInfo.dob) {
    errors.push('Date of birth is required.');
  } else {
    const dob = new Date(patientInfo.dob);
    if (isNaN(dob.getTime())) {
      errors.push('Date of birth must be a valid date (YYYY-MM-DD).');
    } else if (dob > new Date()) {
      errors.push('Date of birth cannot be in the future.');
    }
  }

  // Gender
  const validGenders = ['male', 'female', 'other', 'prefer_not_to_say'];
  if (!patientInfo.gender || !validGenders.includes(patientInfo.gender)) {
    errors.push(`Gender must be one of: ${validGenders.join(', ')}.`);
  }

  // Chief complaint (the reason for visiting — required, free text)
  if (!patientInfo.chiefComplaint || patientInfo.chiefComplaint.trim().length < 3) {
    errors.push('Chief complaint is required (minimum 3 characters).');
  }

  // contactNumber is optional (demo)
  if (patientInfo.contactNumber !== undefined && patientInfo.contactNumber !== '') {
    const digits = String(patientInfo.contactNumber).replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) {
      errors.push('Contact number must be between 7 and 15 digits if provided.');
    }
  }

  return { valid: errors.length === 0, errors };
};

/**
 * Validate that an acuity value being set by a clinician is recognised.
 *
 * @param {string} acuity
 * @returns {{ valid: boolean, errors: string[] }}
 */
export const validateAcuityInput = (acuity) => {
  if (!acuity || !isValidAcuity(acuity)) {
    return {
      valid:  false,
      errors: [`Invalid acuity category '${acuity}'. Must be one of: P1, P2, P3, P4, P5.`],
    };
  }
  return { valid: true, errors: [] };
};
