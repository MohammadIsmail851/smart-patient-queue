/**
 * Encounter state machine — pure business logic.
 *
 * Defines all valid lifecycle transitions and provides guard functions.
 * No persistence, no I/O — fully testable without mocking.
 */

import { ENCOUNTER_STATUS } from '../types/enums.js';

const S = ENCOUNTER_STATUS;

/**
 * Adjacency map: status → Set of statuses that may follow it.
 *
 * Key design decisions:
 * - CALLED may revert to WAITING (patient no-show / re-queue).
 * - EMERGENCY_PATHWAY may proceed directly to IN_CONSULTATION or COMPLETED.
 * - COMPLETED and CANCELLED are terminal — no further transitions.
 * - Ordinary queue operations (WAITING → CALLED) are blocked for EMERGENCY_PATHWAY encounters
 *   by the isEmergencyPathway flag checked separately by the queue service.
 */
export const VALID_TRANSITIONS = Object.freeze({
  [S.REGISTERED]:        new Set([S.WAITING, S.EMERGENCY_PATHWAY, S.CANCELLED]),
  [S.WAITING]:           new Set([S.CALLED, S.EMERGENCY_PATHWAY, S.CANCELLED]),
  [S.CALLED]:            new Set([S.IN_CONSULTATION, S.WAITING, S.CANCELLED]),
  [S.IN_CONSULTATION]:   new Set([S.COMPLETED, S.CANCELLED]),
  [S.COMPLETED]:         new Set(),  // terminal
  [S.CANCELLED]:         new Set(),  // terminal
  [S.EMERGENCY_PATHWAY]: new Set([S.IN_CONSULTATION, S.COMPLETED, S.CANCELLED]),
});

/**
 * Check whether a state transition is permitted.
 *
 * @param {string} fromStatus - current ENCOUNTER_STATUS value
 * @param {string} toStatus   - target  ENCOUNTER_STATUS value
 * @returns {{ allowed: boolean, reason: string|null }}
 */
export const canTransition = (fromStatus, toStatus) => {
  const allowed = VALID_TRANSITIONS[fromStatus]?.has(toStatus) ?? false;
  return {
    allowed,
    reason: allowed
      ? null
      : `Transition '${fromStatus}' → '${toStatus}' is not permitted.`,
  };
};

/**
 * Assert that a transition is valid; throw a descriptive Error if not.
 * Use inside service functions that must block invalid transitions.
 *
 * @param {string} fromStatus
 * @param {string} toStatus
 * @throws {Error}
 */
export const requireValidTransition = (fromStatus, toStatus) => {
  const { allowed, reason } = canTransition(fromStatus, toStatus);
  if (!allowed) {
    const err = new Error(reason);
    err.code = 'INVALID_TRANSITION';
    err.fromStatus = fromStatus;
    err.toStatus = toStatus;
    throw err;
  }
};

/**
 * Return true if an encounter should appear in the ordinary waiting queue.
 *
 * Rules:
 * 1. Must have status WAITING.
 * 2. Must NOT be on the emergency pathway.
 *
 * @param {string}  status
 * @param {boolean} isEmergencyPathway
 * @returns {boolean}
 */
export const isEligibleForQueue = (status, isEmergencyPathway) =>
  status === S.WAITING && !isEmergencyPathway;

/**
 * Return true if no further transitions are possible from this status.
 *
 * @param {string} status
 * @returns {boolean}
 */
export const isTerminalStatus = (status) =>
  (VALID_TRANSITIONS[status]?.size ?? 0) === 0;

/**
 * Return all statuses that exclude a patient from the ordinary waiting queue.
 * Useful for UI filters and query constraints.
 */
export const NON_QUEUE_STATUSES = Object.freeze([
  S.REGISTERED,
  S.CALLED,
  S.IN_CONSULTATION,
  S.COMPLETED,
  S.CANCELLED,
  S.EMERGENCY_PATHWAY,
]);
