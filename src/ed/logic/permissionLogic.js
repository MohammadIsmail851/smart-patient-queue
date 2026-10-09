/**
 * Permission enforcement — pure logic.
 *
 * Uses the central ROLE_PERMISSIONS table.
 * All sensitive service functions MUST call requirePermission() before acting.
 * UI hiding of buttons is secondary only; enforcement lives here.
 */

import { ROLE_PERMISSIONS } from '../config/permissions.js';

/**
 * Return true if the given role is allowed to perform the given operation.
 *
 * @param {string} role      - ED_ROLE value
 * @param {string} operation - ED_OPERATION value
 * @returns {boolean}
 */
export const hasPermission = (role, operation) =>
  ROLE_PERMISSIONS[role]?.has(operation) ?? false;

/**
 * Assert that a role is allowed to perform an operation.
 * Throws a structured Error with code PERMISSION_DENIED if not.
 *
 * @param {string} role
 * @param {string} operation
 * @throws {Error} code='PERMISSION_DENIED'
 */
export const requirePermission = (role, operation) => {
  if (!hasPermission(role, operation)) {
    const err = new Error(
      `Permission denied: role '${role}' cannot perform '${operation}'.`
    );
    err.code      = 'PERMISSION_DENIED';
    err.role      = role;
    err.operation = operation;
    throw err;
  }
};

/**
 * Return the list of operations allowed for a role.
 * Useful for UI capability checks and audit display.
 *
 * @param {string} role
 * @returns {string[]}
 */
export const getAllowedOperations = (role) =>
  [...(ROLE_PERMISSIONS[role] ?? new Set())];
