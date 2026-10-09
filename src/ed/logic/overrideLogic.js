/**
 * Override validation — pure logic.
 *
 * An override is any authorised modification that bypasses normal workflow rules
 * (e.g. changing acuity outside a normal assessment, reordering the queue).
 *
 * Every override MUST:
 * - Have a non-empty reason (minimum 5 characters).
 * - Record the acting user, their role, the operation, the previous state, and the new state.
 * - Be preserved in the audit log (append-only — no deletions).
 */

/**
 * Validate the fields of an override request.
 *
 * @param {Object} params
 * @param {string} params.reason        - mandatory non-empty string
 * @param {string} params.actorRole     - ED_ROLE value
 * @param {string} params.operation     - ED_OPERATION value
 * @param {*}      params.previousState - state before override (any serialisable value)
 * @param {*}      params.newState      - state after  override (any serialisable value)
 * @returns {{ valid: boolean, errors: string[] }}
 */
export const validateOverride = ({ reason, actorRole, operation, previousState, newState }) => {
  const errors = [];

  if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
    errors.push('Override reason is required and must not be empty.');
  } else if (reason.trim().length < 5) {
    errors.push('Override reason must be at least 5 characters.');
  }

  if (!actorRole) errors.push('Acting user role is required for an override.');
  if (!operation) errors.push('Override operation must be specified.');

  if (previousState === undefined || previousState === null) {
    errors.push('Previous state must be recorded for every override.');
  }
  if (newState === undefined || newState === null) {
    errors.push('New state must be recorded for every override.');
  }

  return { valid: errors.length === 0, errors };
};

/**
 * Build an immutable override record (pure; not persisted here).
 * Throws if validation fails, ensuring no partial records are ever created.
 *
 * @param {Object} params
 * @param {string} params.encounterId
 * @param {string} params.actorId
 * @param {string} params.actorRole
 * @param {string} params.actorName
 * @param {string} params.operation
 * @param {*}      params.previousState
 * @param {*}      params.newState
 * @param {string} params.reason
 * @param {number} [params.timestamp]   - ms timestamp; defaults to Date.now()
 * @returns {Object}
 * @throws {Error} if validation fails
 */
export const buildOverrideRecord = ({
  encounterId,
  actorId,
  actorRole,
  actorName,
  operation,
  previousState,
  newState,
  reason,
  timestamp,
}) => {
  const { valid, errors } = validateOverride({
    reason, actorRole, operation, previousState, newState,
  });
  if (!valid) {
    const err = new Error(`Invalid override: ${errors.join('; ')}`);
    err.code   = 'OVERRIDE_VALIDATION_FAILED';
    err.errors = errors;
    throw err;
  }

  return Object.freeze({
    encounterId,
    actorId,
    actorRole,
    actorName,
    operation,
    previousState,
    newState,
    reason:    reason.trim(),
    timestamp: timestamp ?? Date.now(),
    // Audit records are append-only through normal operations.
    // No editedAt, no deletedAt.
  });
};
