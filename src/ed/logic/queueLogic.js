/**
 * Queue ordering logic — pure, deterministic, side-effect-free.
 *
 * Rules (in priority order):
 * 1. Emergency-pathway patients are EXCLUDED from the ordinary queue entirely.
 * 2. Among eligible patients (status=WAITING, not emergency):
 *    a. Lower acuity order number → higher priority  (P1 before P5)
 *    b. Among equal acuity: earlier registeredAt → higher priority (FIFO)
 * 3. Queue position is 1-based.
 * 4. All ordering is computed server-side; frontends may display but not trust their own sort.
 */

import { ACUITY_CONFIG } from '../config/acuity.js';
import { isEligibleForQueue } from './stateMachine.js';

/**
 * Comparator for queue entries.
 * Each entry must have: { acuity: string, registeredAt: number|string }
 *
 * @param {Object} a
 * @param {Object} b
 * @returns {number}
 */
export const compareQueueEntries = (a, b) => {
  const orderA = ACUITY_CONFIG[a.acuity]?.order ?? 999;
  const orderB = ACUITY_CONFIG[b.acuity]?.order ?? 999;

  if (orderA !== orderB) return orderA - orderB;

  // Same acuity → FIFO by registration time
  const timeA = new Date(a.registeredAt).getTime();
  const timeB = new Date(b.registeredAt).getTime();
  return timeA - timeB;
};

/**
 * Filter encounters to only those eligible for the ordinary queue,
 * then sort them deterministically.
 *
 * @param {Array<Object>} encounters - raw list of encounter objects
 * @returns {Array<Object>} new sorted array (input not mutated)
 */
export const buildSortedQueue = (encounters) => {
  const eligible = encounters.filter(
    (e) => isEligibleForQueue(e.status, e.isEmergencyPathway)
  );
  return [...eligible].sort(compareQueueEntries);
};

/**
 * Return the 1-based position of an encounter in a pre-sorted queue.
 * Returns null if the encounter is not found.
 *
 * @param {string}       encounterId
 * @param {Array<Object>} sortedQueue
 * @returns {number|null}
 */
export const getQueuePosition = (encounterId, sortedQueue) => {
  const idx = sortedQueue.findIndex((e) => e.id === encounterId);
  return idx === -1 ? null : idx + 1;
};

/**
 * Generate a human-readable, factual explanation of why a patient is at their
 * current queue position. Explanation is based on actual system data only.
 *
 * @param {Object}        entry        - the entry to explain
 * @param {Array<Object>} sortedQueue  - full sorted queue (including entry)
 * @returns {string}
 */
export const explainQueuePosition = (entry, sortedQueue) => {
  const position = getQueuePosition(entry.id, sortedQueue);

  if (position === null) {
    return 'Patient is not currently in the ordinary waiting queue.';
  }

  const acuityCfg = ACUITY_CONFIG[entry.acuity];
  const acuityLabel = acuityCfg
    ? `${acuityCfg.label} (${entry.acuity})`
    : entry.acuity ?? 'Unknown';

  if (position === 1) {
    return `Position 1 — next to be called. Clinician-assigned category: ${acuityLabel}.`;
  }

  const ahead = sortedQueue.slice(0, position - 1);
  const parts = [`Position ${position}. Clinician-assigned category: ${acuityLabel}.`];

  const higherPriorityAhead = ahead.filter(
    (e) => (ACUITY_CONFIG[e.acuity]?.order ?? 999) < (ACUITY_CONFIG[entry.acuity]?.order ?? 999)
  );
  const samePriorityAhead = ahead.filter((e) => e.acuity === entry.acuity);

  if (higherPriorityAhead.length > 0) {
    parts.push(
      `${higherPriorityAhead.length} patient(s) with a higher-priority clinician-assigned category waiting ahead.`
    );
  }
  if (samePriorityAhead.length > 0) {
    parts.push(
      `${samePriorityAhead.length} patient(s) with the same category registered earlier (FIFO order).`
    );
  }

  return parts.join(' ');
};
