/**
 * Tests: Permission checks.
 * Acceptance criteria: 4 (unauthorized cannot change acuity)
 */

import { describe, it, expect } from 'vitest';
import { hasPermission, requirePermission, getAllowedOperations } from '../../src/ed/logic/permissionLogic.js';
import { ED_ROLE, ED_OPERATION } from '../../src/ed/types/enums.js';

describe('Permission — hasPermission()', () => {
  describe('REGISTRATION_STAFF', () => {
    it('can register encounters', () => {
      expect(hasPermission(ED_ROLE.REGISTRATION_STAFF, ED_OPERATION.REGISTER_ENCOUNTER)).toBe(true);
    });
    it('can view queue', () => {
      expect(hasPermission(ED_ROLE.REGISTRATION_STAFF, ED_OPERATION.VIEW_QUEUE)).toBe(true);
    });
    it('CANNOT record assessments (AC #4)', () => {
      expect(hasPermission(ED_ROLE.REGISTRATION_STAFF, ED_OPERATION.RECORD_ASSESSMENT)).toBe(false);
    });
    it('CANNOT activate emergency', () => {
      expect(hasPermission(ED_ROLE.REGISTRATION_STAFF, ED_OPERATION.ACTIVATE_EMERGENCY)).toBe(false);
    });
    it('CANNOT perform overrides', () => {
      expect(hasPermission(ED_ROLE.REGISTRATION_STAFF, ED_OPERATION.PERFORM_OVERRIDE)).toBe(false);
    });
    it('CANNOT manage roles', () => {
      expect(hasPermission(ED_ROLE.REGISTRATION_STAFF, ED_OPERATION.MANAGE_ROLES)).toBe(false);
    });
    it('CANNOT view audit log', () => {
      expect(hasPermission(ED_ROLE.REGISTRATION_STAFF, ED_OPERATION.VIEW_AUDIT_LOG)).toBe(false);
    });
  });

  describe('TRIAGE_CLINICIAN', () => {
    it('can record assessments', () => {
      expect(hasPermission(ED_ROLE.TRIAGE_CLINICIAN, ED_OPERATION.RECORD_ASSESSMENT)).toBe(true);
    });
    it('can record reassessments', () => {
      expect(hasPermission(ED_ROLE.TRIAGE_CLINICIAN, ED_OPERATION.RECORD_REASSESSMENT)).toBe(true);
    });
    it('CANNOT activate emergency', () => {
      expect(hasPermission(ED_ROLE.TRIAGE_CLINICIAN, ED_OPERATION.ACTIVATE_EMERGENCY)).toBe(false);
    });
    it('CANNOT perform overrides', () => {
      expect(hasPermission(ED_ROLE.TRIAGE_CLINICIAN, ED_OPERATION.PERFORM_OVERRIDE)).toBe(false);
    });
  });

  describe('EMERGENCY_CLINICIAN', () => {
    it('can activate emergency', () => {
      expect(hasPermission(ED_ROLE.EMERGENCY_CLINICIAN, ED_OPERATION.ACTIVATE_EMERGENCY)).toBe(true);
    });
    it('can acknowledge emergency', () => {
      expect(hasPermission(ED_ROLE.EMERGENCY_CLINICIAN, ED_OPERATION.ACKNOWLEDGE_EMERGENCY)).toBe(true);
    });
    it('CANNOT perform overrides', () => {
      expect(hasPermission(ED_ROLE.EMERGENCY_CLINICIAN, ED_OPERATION.PERFORM_OVERRIDE)).toBe(false);
    });
    it('CANNOT manage roles', () => {
      expect(hasPermission(ED_ROLE.EMERGENCY_CLINICIAN, ED_OPERATION.MANAGE_ROLES)).toBe(false);
    });
  });

  describe('FLOW_COORDINATOR', () => {
    it('can perform overrides', () => {
      expect(hasPermission(ED_ROLE.FLOW_COORDINATOR, ED_OPERATION.PERFORM_OVERRIDE)).toBe(true);
    });
    it('can run simulator', () => {
      expect(hasPermission(ED_ROLE.FLOW_COORDINATOR, ED_OPERATION.RUN_SIMULATOR)).toBe(true);
    });
    it('CANNOT manage roles', () => {
      expect(hasPermission(ED_ROLE.FLOW_COORDINATOR, ED_OPERATION.MANAGE_ROLES)).toBe(false);
    });
    it('CANNOT view audit log', () => {
      expect(hasPermission(ED_ROLE.FLOW_COORDINATOR, ED_OPERATION.VIEW_AUDIT_LOG)).toBe(false);
    });
  });

  describe('SUPERVISOR', () => {
    it('can perform overrides', () => {
      expect(hasPermission(ED_ROLE.SUPERVISOR, ED_OPERATION.PERFORM_OVERRIDE)).toBe(true);
    });
    it('can view audit log', () => {
      expect(hasPermission(ED_ROLE.SUPERVISOR, ED_OPERATION.VIEW_AUDIT_LOG)).toBe(true);
    });
    it('CANNOT manage roles', () => {
      expect(hasPermission(ED_ROLE.SUPERVISOR, ED_OPERATION.MANAGE_ROLES)).toBe(false);
    });
  });

  describe('ADMINISTRATOR', () => {
    it('can do everything', () => {
      Object.values(ED_OPERATION).forEach((op) => {
        expect(hasPermission(ED_ROLE.ADMINISTRATOR, op)).toBe(true);
      });
    });
  });

  describe('AUDITOR', () => {
    it('can view audit log', () => {
      expect(hasPermission(ED_ROLE.AUDITOR, ED_OPERATION.VIEW_AUDIT_LOG)).toBe(true);
    });
    it('CANNOT register encounters', () => {
      expect(hasPermission(ED_ROLE.AUDITOR, ED_OPERATION.REGISTER_ENCOUNTER)).toBe(false);
    });
    it('CANNOT record assessments (AC #4)', () => {
      expect(hasPermission(ED_ROLE.AUDITOR, ED_OPERATION.RECORD_ASSESSMENT)).toBe(false);
    });
  });

  describe('Unknown role', () => {
    it('returns false for any operation', () => {
      expect(hasPermission('unknown_role', ED_OPERATION.VIEW_QUEUE)).toBe(false);
    });
  });
});

describe('Permission — requirePermission()', () => {
  it('does not throw when role has permission', () => {
    expect(() =>
      requirePermission(ED_ROLE.TRIAGE_CLINICIAN, ED_OPERATION.RECORD_ASSESSMENT)
    ).not.toThrow();
  });

  it('throws Error with code PERMISSION_DENIED when denied', () => {
    expect(() =>
      requirePermission(ED_ROLE.REGISTRATION_STAFF, ED_OPERATION.RECORD_ASSESSMENT)
    ).toThrow(expect.objectContaining({
      code:      'PERMISSION_DENIED',
      role:      ED_ROLE.REGISTRATION_STAFF,
      operation: ED_OPERATION.RECORD_ASSESSMENT,
    }));
  });

  it('thrown error message names the role and operation', () => {
    try {
      requirePermission(ED_ROLE.AUDITOR, ED_OPERATION.ACTIVATE_EMERGENCY);
    } catch (e) {
      expect(e.message).toMatch(/ed_auditor/);
      expect(e.message).toMatch(/activate_emergency/);
    }
  });
});

describe('Permission — getAllowedOperations()', () => {
  it('returns an array of operations for a valid role', () => {
    const ops = getAllowedOperations(ED_ROLE.TRIAGE_CLINICIAN);
    expect(Array.isArray(ops)).toBe(true);
    expect(ops).toContain(ED_OPERATION.RECORD_ASSESSMENT);
    expect(ops).not.toContain(ED_OPERATION.MANAGE_ROLES);
  });

  it('returns empty array for unknown role', () => {
    expect(getAllowedOperations('not_a_role')).toEqual([]);
  });
});
