/**
 * Tests: State Machine — encounter lifecycle transitions.
 * Acceptance criteria: 8, 14
 */

import { describe, it, expect } from 'vitest';
import {
  canTransition,
  requireValidTransition,
  isEligibleForQueue,
  isTerminalStatus,
  VALID_TRANSITIONS,
} from '../../src/ed/logic/stateMachine.js';
import { ENCOUNTER_STATUS } from '../../src/ed/types/enums.js';

const S = ENCOUNTER_STATUS;

describe('State Machine — valid transitions', () => {
  it('REGISTERED → WAITING is allowed (first assessment)', () => {
    const result = canTransition(S.REGISTERED, S.WAITING);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeNull();
  });

  it('REGISTERED → EMERGENCY_PATHWAY is allowed', () => {
    expect(canTransition(S.REGISTERED, S.EMERGENCY_PATHWAY).allowed).toBe(true);
  });

  it('REGISTERED → CANCELLED is allowed', () => {
    expect(canTransition(S.REGISTERED, S.CANCELLED).allowed).toBe(true);
  });

  it('WAITING → CALLED is allowed', () => {
    expect(canTransition(S.WAITING, S.CALLED).allowed).toBe(true);
  });

  it('CALLED → IN_CONSULTATION is allowed', () => {
    expect(canTransition(S.CALLED, S.IN_CONSULTATION).allowed).toBe(true);
  });

  it('CALLED → WAITING is allowed (re-queue after no-show)', () => {
    expect(canTransition(S.CALLED, S.WAITING).allowed).toBe(true);
  });

  it('IN_CONSULTATION → COMPLETED is allowed', () => {
    expect(canTransition(S.IN_CONSULTATION, S.COMPLETED).allowed).toBe(true);
  });

  it('EMERGENCY_PATHWAY → IN_CONSULTATION is allowed', () => {
    expect(canTransition(S.EMERGENCY_PATHWAY, S.IN_CONSULTATION).allowed).toBe(true);
  });
});

describe('State Machine — invalid transitions (AC #14)', () => {
  it('REGISTERED → IN_CONSULTATION is NOT allowed', () => {
    const result = canTransition(S.REGISTERED, S.IN_CONSULTATION);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/not permitted/i);
  });

  it('WAITING → COMPLETED is NOT allowed (must pass through CALLED and IN_CONSULTATION)', () => {
    expect(canTransition(S.WAITING, S.COMPLETED).allowed).toBe(false);
  });

  it('COMPLETED → anything is NOT allowed (terminal)', () => {
    Object.values(S).forEach((target) => {
      expect(canTransition(S.COMPLETED, target).allowed).toBe(false);
    });
  });

  it('CANCELLED → anything is NOT allowed (terminal)', () => {
    Object.values(S).forEach((target) => {
      expect(canTransition(S.CANCELLED, target).allowed).toBe(false);
    });
  });

  it('IN_CONSULTATION → WAITING is NOT allowed', () => {
    expect(canTransition(S.IN_CONSULTATION, S.WAITING).allowed).toBe(false);
  });

  it('requireValidTransition throws an Error with code INVALID_TRANSITION', () => {
    expect(() => requireValidTransition(S.COMPLETED, S.WAITING))
      .toThrow(expect.objectContaining({ code: 'INVALID_TRANSITION' }));
  });

  it('requireValidTransition does NOT throw for valid transition', () => {
    expect(() => requireValidTransition(S.WAITING, S.CALLED)).not.toThrow();
  });
});

describe('State Machine — queue eligibility (AC #8)', () => {
  it('WAITING + not-emergency = eligible for queue', () => {
    expect(isEligibleForQueue(S.WAITING, false)).toBe(true);
  });

  it('WAITING + isEmergencyPathway = NOT eligible for ordinary queue', () => {
    expect(isEligibleForQueue(S.WAITING, true)).toBe(false);
  });

  it('REGISTERED is NOT eligible for queue', () => {
    expect(isEligibleForQueue(S.REGISTERED, false)).toBe(false);
  });

  it('CALLED is NOT eligible for queue', () => {
    expect(isEligibleForQueue(S.CALLED, false)).toBe(false);
  });

  it('IN_CONSULTATION is NOT eligible for queue', () => {
    expect(isEligibleForQueue(S.IN_CONSULTATION, false)).toBe(false);
  });

  it('COMPLETED is NOT eligible for queue (terminal)', () => {
    expect(isEligibleForQueue(S.COMPLETED, false)).toBe(false);
  });

  it('CANCELLED is NOT eligible for queue (terminal)', () => {
    expect(isEligibleForQueue(S.CANCELLED, false)).toBe(false);
  });

  it('EMERGENCY_PATHWAY is NOT eligible for ordinary queue', () => {
    expect(isEligibleForQueue(S.EMERGENCY_PATHWAY, true)).toBe(false);
  });
});

describe('State Machine — terminal status detection', () => {
  it('COMPLETED is terminal', () => {
    expect(isTerminalStatus(S.COMPLETED)).toBe(true);
  });

  it('CANCELLED is terminal', () => {
    expect(isTerminalStatus(S.CANCELLED)).toBe(true);
  });

  it('WAITING is not terminal', () => {
    expect(isTerminalStatus(S.WAITING)).toBe(false);
  });

  it('REGISTERED is not terminal', () => {
    expect(isTerminalStatus(S.REGISTERED)).toBe(false);
  });
});
