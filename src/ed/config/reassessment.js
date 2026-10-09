/**
 * Reassessment timing configuration.
 *
 * ⚠️  DEMONSTRATION ONLY — Anvesh '26 prototype.
 * Intervals are deliberately short so evaluators can observe overdue tasks without waiting.
 * These are NOT clinical time targets and must not be used as clinical guidance.
 *
 * Intervals are configurable. Tests inject their own clock values — no real-time waiting needed.
 */

export const REASSESSMENT_CONFIG = Object.freeze({
  // Reassessment intervals per acuity code (milliseconds).
  // Deliberately short for live demo.
  intervals: Object.freeze({
    P1:  5  * 60 * 1000,   //  5 minutes
    P2: 10  * 60 * 1000,   // 10 minutes
    P3: 15  * 60 * 1000,   // 15 minutes
    P4: 30  * 60 * 1000,   // 30 minutes
    P5: 60  * 60 * 1000,   // 60 minutes
  }),

  // Show "DUE" status this many ms before the actual deadline.
  warningWindowMs: 2 * 60 * 1000,   // 2 minutes

  DISCLAIMER:
    'Reassessment intervals are configurable demonstration values only. ' +
    'They do not represent clinical time targets and must not be used as clinical guidance. ' +
    'An overdue task NEVER automatically changes a patient\'s clinical acuity category. ' +
    'Any acuity change must be explicitly recorded by an authorised clinician.',
});
