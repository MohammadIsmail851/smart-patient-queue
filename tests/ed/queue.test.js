/**
 * Tests: Queue ordering logic.
 * Acceptance criteria: 5, 6, 7, 8
 */

import { describe, it, expect } from 'vitest';
import {
  compareQueueEntries,
  buildSortedQueue,
  getQueuePosition,
  explainQueuePosition,
} from '../../src/ed/logic/queueLogic.js';
import { ENCOUNTER_STATUS } from '../../src/ed/types/enums.js';

// Helpers to build minimal encounter objects
const enc = (id, acuity, registeredAt, status = ENCOUNTER_STATUS.WAITING, isEmergencyPathway = false) => ({
  id, acuity, registeredAt, status, isEmergencyPathway,
});

const T = (offsetMinutes) => new Date(1_700_000_000_000 + offsetMinutes * 60_000).toISOString();

describe('Queue ordering — acuity priority (AC #5)', () => {
  it('P1 sorts before P2', () => {
    const a = enc('A', 'P1', T(0));
    const b = enc('B', 'P2', T(0));
    expect(compareQueueEntries(a, b)).toBeLessThan(0);
  });

  it('P2 sorts before P3', () => {
    expect(compareQueueEntries(enc('A','P2',T(0)), enc('B','P3',T(0)))).toBeLessThan(0);
  });

  it('P4 sorts before P5', () => {
    expect(compareQueueEntries(enc('A','P4',T(0)), enc('B','P5',T(0)))).toBeLessThan(0);
  });

  it('P5 sorts after P1', () => {
    expect(compareQueueEntries(enc('A','P5',T(0)), enc('B','P1',T(0)))).toBeGreaterThan(0);
  });

  it('buildSortedQueue orders P1, P2, P3, P4, P5 correctly with simultaneous registration', () => {
    const encounters = [
      enc('5','P5',T(0)),
      enc('3','P3',T(0)),
      enc('1','P1',T(0)),
      enc('4','P4',T(0)),
      enc('2','P2',T(0)),
    ];
    const sorted = buildSortedQueue(encounters);
    expect(sorted.map(e => e.acuity)).toEqual(['P1','P2','P3','P4','P5']);
  });
});

describe('Queue ordering — FIFO tiebreak (AC #6)', () => {
  it('among P3 patients, the earlier-registered patient comes first', () => {
    const earlier = enc('early','P3', T(0));
    const later   = enc('late', 'P3', T(5));
    expect(compareQueueEntries(earlier, later)).toBeLessThan(0);
  });

  it('among P3 patients, later-registered patient comes second', () => {
    const earlier = enc('E','P3', T(0));
    const later   = enc('L','P3', T(10));
    const sorted = buildSortedQueue([later, earlier]);
    expect(sorted[0].id).toBe('E');
    expect(sorted[1].id).toBe('L');
  });

  it('FIFO does not override acuity — a later P1 beats an earlier P2', () => {
    const early_p2 = enc('early_p2','P2', T(0));
    const late_p1  = enc('late_p1', 'P1', T(100));
    const sorted = buildSortedQueue([early_p2, late_p1]);
    expect(sorted[0].id).toBe('late_p1');
  });
});

describe('Queue eligibility filtering (AC #8)', () => {
  it('excludes REGISTERED encounters from queue', () => {
    const encounters = [
      enc('W','P2',T(0),  ENCOUNTER_STATUS.WAITING),
      enc('R','P1',T(0),  ENCOUNTER_STATUS.REGISTERED),
    ];
    const sorted = buildSortedQueue(encounters);
    expect(sorted).toHaveLength(1);
    expect(sorted[0].id).toBe('W');
  });

  it('excludes COMPLETED encounters from queue', () => {
    const encounters = [
      enc('W','P3',T(0), ENCOUNTER_STATUS.WAITING),
      enc('C','P1',T(0), ENCOUNTER_STATUS.COMPLETED),
    ];
    const sorted = buildSortedQueue(encounters);
    expect(sorted.every(e => e.id !== 'C')).toBe(true);
  });

  it('excludes CANCELLED encounters from queue', () => {
    const encounters = [
      enc('W','P3',T(0), ENCOUNTER_STATUS.WAITING),
      enc('X','P1',T(0), ENCOUNTER_STATUS.CANCELLED),
    ];
    expect(buildSortedQueue(encounters).map(e=>e.id)).not.toContain('X');
  });

  it('excludes CALLED encounters from queue', () => {
    const encounters = [
      enc('W','P3',T(0), ENCOUNTER_STATUS.WAITING),
      enc('CL','P1',T(0), ENCOUNTER_STATUS.CALLED),
    ];
    expect(buildSortedQueue(encounters).map(e=>e.id)).not.toContain('CL');
  });
});

describe('Emergency bypass — independent of ordinary queue (AC #7)', () => {
  it('emergency-pathway encounter is excluded from ordinary queue even with P1 acuity', () => {
    const emergencyEnc = enc('EMG','P1',T(0), ENCOUNTER_STATUS.EMERGENCY_PATHWAY, true);
    const waitingEnc   = enc('W',  'P5',T(0), ENCOUNTER_STATUS.WAITING, false);
    const sorted = buildSortedQueue([emergencyEnc, waitingEnc]);
    expect(sorted).toHaveLength(1);
    expect(sorted[0].id).toBe('W');
  });

  it('multiple emergency encounters are all excluded from ordinary queue', () => {
    const encounters = [
      enc('E1','P1',T(0), ENCOUNTER_STATUS.EMERGENCY_PATHWAY, true),
      enc('E2','P2',T(0), ENCOUNTER_STATUS.EMERGENCY_PATHWAY, true),
      enc('W', 'P4',T(0), ENCOUNTER_STATUS.WAITING, false),
    ];
    const sorted = buildSortedQueue(encounters);
    expect(sorted).toHaveLength(1);
    expect(sorted[0].id).toBe('W');
  });

  it('an empty ordinary queue is returned when all active encounters are on emergency pathway', () => {
    const encounters = [
      enc('E','P1',T(0), ENCOUNTER_STATUS.EMERGENCY_PATHWAY, true),
    ];
    expect(buildSortedQueue(encounters)).toHaveLength(0);
  });
});

describe('Queue positions and explanations', () => {
  it('getQueuePosition returns 1 for first in queue', () => {
    const q = [enc('A','P1',T(0)), enc('B','P2',T(0))];
    expect(getQueuePosition('A', q)).toBe(1);
  });

  it('getQueuePosition returns 2 for second in queue', () => {
    const q = [enc('A','P1',T(0)), enc('B','P2',T(0))];
    expect(getQueuePosition('B', q)).toBe(2);
  });

  it('getQueuePosition returns null for encounter not in queue', () => {
    const q = [enc('A','P1',T(0))];
    expect(getQueuePosition('MISSING', q)).toBeNull();
  });

  it('explainQueuePosition includes acuity label and "next to be called" for position 1', () => {
    const entries = [enc('A','P1',T(0)), enc('B','P3',T(0))];
    const explanation = explainQueuePosition(entries[0], entries);
    expect(explanation).toMatch(/position 1/i);
    expect(explanation).toMatch(/next/i);
    expect(explanation).toMatch(/P1/);
  });

  it('explainQueuePosition mentions higher-priority patients ahead', () => {
    const sorted = [enc('A','P1',T(0)), enc('B','P3',T(0))];
    const explanation = explainQueuePosition(sorted[1], sorted);
    expect(explanation).toMatch(/higher-priority/i);
  });
});
