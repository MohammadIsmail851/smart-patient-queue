/**
 * Reassessment task logic — pure, injectable clock.
 *
 * KEY SAFETY INVARIANT:
 * These functions NEVER change a patient's acuity category.
 * They only calculate and report task status (upcoming / due / overdue).
 * Acuity may ONLY change through an explicit, authorised clinician action
 * (see overrideLogic.js and recordReassessment in encounterService).
 */

import { REASSESSMENT_CONFIG } from '../config/reassessment.js';
import { REASSESSMENT_STATUS }  from '../types/enums.js';

/**
 * Calculate the timestamp (ms) at which a reassessment becomes due.
 *
 * @param {number} lastAssessedAt - ms timestamp of last assessment
 * @param {string} acuity         - ACUITY_CATEGORY code
 * @returns {number}              - due timestamp in ms
 */
export const calculateDueAt = (lastAssessedAt, acuity) => {
  const interval =
    REASSESSMENT_CONFIG.intervals[acuity] ??
    REASSESSMENT_CONFIG.intervals.P5;   // safest (longest) fallback
  return lastAssessedAt + interval;
};

/**
 * Derive the current reassessment task status.
 *
 * ⚠️  Returning OVERDUE does NOT change acuity. It is a display-only status.
 *
 * @param {number} dueAt - due timestamp (ms)
 * @param {number} now   - current timestamp (ms), injectable for testing
 * @returns {REASSESSMENT_STATUS}
 */
export const getReassessmentStatus = (dueAt, now) => {
  const remaining = dueAt - now;
  if (remaining > REASSESSMENT_CONFIG.warningWindowMs) return REASSESSMENT_STATUS.UPCOMING;
  if (remaining > 0)                                    return REASSESSMENT_STATUS.DUE;
  return REASSESSMENT_STATUS.OVERDUE;
};

/**
 * Calculate elapsed time since last assessment.
 *
 * @param {number} lastAssessedAt - ms timestamp
 * @param {number} now            - current ms timestamp
 * @returns {{ elapsedMs: number, elapsedLabel: string }}
 */
export const getElapsedSinceAssessment = (lastAssessedAt, now) => {
  const elapsedMs = now - lastAssessedAt;
  const totalMinutes = Math.floor(elapsedMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  const elapsedLabel =
    hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

  return { elapsedMs, elapsedLabel };
};

/**
 * Build a reassessment task data object (pure; not persisted here).
 *
 * @param {string} encounterId
 * @param {string} currentAcuity  - acuity at assessment time (never auto-changed)
 * @param {number} lastAssessedAt - ms timestamp of last assessment
 * @param {string} lastAssessedBy - user ID
 * @param {number} now            - injectable current time (ms)
 * @returns {Object}
 */
export const buildReassessmentTask = (
  encounterId,
  currentAcuity,
  lastAssessedAt,
  lastAssessedBy,
  now,
) => {
  const dueAt  = calculateDueAt(lastAssessedAt, currentAcuity);
  const status = getReassessmentStatus(dueAt, now);

  return {
    encounterId,
    currentAcuity,      // snapshot only — must not be used to auto-change encounter acuity
    lastAssessedAt,
    lastAssessedBy,
    dueAt,
    status,
    createdAt: now,
    // No acuityChangedAt / newAcuity here — that only lives in assessment records
  };
};
