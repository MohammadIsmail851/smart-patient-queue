/**
 * Acuity category configuration.
 *
 * ⚠️  DEMONSTRATION ONLY — Anvesh '26 prototype.
 * These categories and ordering are configured for demonstration purposes.
 * They do not represent any validated clinical triage protocol (e.g. MTS, ESI, CTAS).
 * All acuity values must be entered explicitly by an authorised clinician.
 * The system never infers, calculates, or automatically changes acuity.
 */

export const ACUITY_DISCLAIMER =
  'Category definitions are for demonstration purposes only and do not represent ' +
  'any clinical triage protocol. All categories must be entered or explicitly ' +
  'changed by an authorised clinician.';

export const ACUITY_CONFIG = Object.freeze({
  P1: {
    code:        'P1',
    label:       'Immediate',
    description: 'Life-threatening — requires immediate attention (demo label only)',
    color:       '#DC2626',   // red-600
    bgColor:     '#FEE2E2',   // red-100
    borderColor: '#FCA5A5',   // red-300
    order:       1,           // 1 = highest priority in queue
  },
  P2: {
    code:        'P2',
    label:       'Emergent',
    description: 'High-risk — clinician assessment required urgently (demo label only)',
    color:       '#EA580C',   // orange-600
    bgColor:     '#FFEDD5',   // orange-100
    borderColor: '#FDBA74',   // orange-300
    order:       2,
  },
  P3: {
    code:        'P3',
    label:       'Urgent',
    description: 'Moderate-risk — prompt assessment needed (demo label only)',
    color:       '#CA8A04',   // yellow-600
    bgColor:     '#FEF9C3',   // yellow-100
    borderColor: '#FDE047',   // yellow-300
    order:       3,
  },
  P4: {
    code:        'P4',
    label:       'Less Urgent',
    description: 'Low-risk — can wait for routine assessment (demo label only)',
    color:       '#16A34A',   // green-600
    bgColor:     '#DCFCE7',   // green-100
    borderColor: '#86EFAC',   // green-300
    order:       4,
  },
  P5: {
    code:        'P5',
    label:       'Non-Urgent',
    description: 'Minimal risk (demo label only)',
    color:       '#0D9488',   // teal-600
    bgColor:     '#CCFBF1',   // teal-100
    borderColor: '#5EEAD4',   // teal-300
    order:       5,           // lowest priority
  },
});

/** Sorted array for selects / display (P1 first). */
export const ACUITY_OPTIONS = Object.values(ACUITY_CONFIG)
  .sort((a, b) => a.order - b.order);

/**
 * Compare two acuity codes by configured priority order.
 * Returns negative if a has HIGHER priority than b.
 *
 * @param {string} codeA
 * @param {string} codeB
 * @returns {number}
 */
export const compareAcuity = (codeA, codeB) => {
  const orderA = ACUITY_CONFIG[codeA]?.order ?? 999;
  const orderB = ACUITY_CONFIG[codeB]?.order ?? 999;
  return orderA - orderB;
};

/** Return true if the code is a valid configured acuity category. */
export const isValidAcuity = (code) => Object.prototype.hasOwnProperty.call(ACUITY_CONFIG, code);
