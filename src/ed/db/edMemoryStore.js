/**
 * EdMemoryStore — in-memory implementation of all ED data operations.
 *
 * Used by:
 *  1. Automated tests (Phase B) — avoids needing a live Firestore instance.
 *  2. The Simulator (Phase F) — isolated data that never touches real encounters.
 *
 * Design: all business rules (state transitions, permission checks, queue ordering,
 * reassessment logic, override validation) are delegated to the pure logic modules.
 * This store only manages persistence (in-memory) and wires the logic together.
 *
 * ⚠️  Not for use with real patient data. Synthetic / demonstration only.
 */

import { validatePatientInfo, validateAcuityInput } from '../logic/encounterValidator.js';
import { requirePermission }                         from '../logic/permissionLogic.js';
import { requireValidTransition, isEligibleForQueue, isTerminalStatus } from '../logic/stateMachine.js';
import { buildSortedQueue, getQueuePosition, explainQueuePosition }     from '../logic/queueLogic.js';
import { buildReassessmentTask, getReassessmentStatus, calculateDueAt } from '../logic/reassessmentLogic.js';
import { validateOverride, buildOverrideRecord }                         from '../logic/overrideLogic.js';

import {
  ED_OPERATION, ENCOUNTER_STATUS, EMERGENCY_STATUS,
  REASSESSMENT_STATUS, TIMELINE_EVENT_TYPE, AUDIT_EVENT_TYPE,
} from '../types/enums.js';

let _idCounter = 0;
const newId = (prefix) => `${prefix}-${String(++_idCounter).padStart(6, '0')}`;
const resetIdCounter = () => { _idCounter = 0; };

// ─────────────────────────────────────────────────────────────────────────────

export class EdMemoryStore {
  constructor() {
    this._reset();
  }

  /** Full reset — deletes all data in this store instance. */
  _reset() {
    this.encounters      = new Map();   // id → encounter object
    this.assessments     = [];          // all assessment records (ordered)
    this.emergencyEvents = new Map();   // id → emergency event
    this.reassessmentTasks = new Map(); // encounterId → current task
    this.timelineEvents  = [];          // all timeline events (ordered)
    this.auditLogs       = [];          // append-only
    this._idSeed         = 0;
  }

  _newId(prefix) {
    return `${prefix}-${String(++this._idSeed).padStart(6, '0')}`;
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  _addTimeline(event) {
    this.timelineEvents.push(Object.freeze({ ...event, id: this._newId('EVT') }));
  }

  _addAudit(event) {
    this.auditLogs.push(Object.freeze({ ...event, id: this._newId('AUD') }));
  }

  _getEncounterOrThrow(id) {
    const enc = this.encounters.get(id);
    if (!enc) throw Object.assign(new Error(`Encounter '${id}' not found.`), { code: 'NOT_FOUND' });
    return enc;
  }

  // ── Encounter registration ──────────────────────────────────────────────────

  /**
   * Register a new synthetic patient encounter.
   *
   * @param {Object} params
   * @param {Object} params.patientInfo  - validated patient data
   * @param {string} params.actorId      - user performing the action
   * @param {string} params.actorRole    - ED_ROLE
   * @param {string} params.actorName    - display name
   * @param {number} [params.now]        - injectable timestamp (ms) for tests
   * @returns {Object} created encounter
   */
  registerEncounter({ patientInfo, actorId, actorRole, actorName, now = Date.now() }) {
    requirePermission(actorRole, ED_OPERATION.REGISTER_ENCOUNTER);

    const validation = validatePatientInfo(patientInfo);
    if (!validation.valid) {
      const err = new Error(`Invalid encounter data: ${validation.errors.join('; ')}`);
      err.code   = 'VALIDATION_FAILED';
      err.errors = validation.errors;
      throw err;
    }

    const id = this._newId('ENC');
    const encounter = {
      id,
      patientInfo:        { ...patientInfo },
      status:             ENCOUNTER_STATUS.REGISTERED,
      acuity:             null,   // Set only by authorised clinician via recordAssessment()
      isEmergencyPathway: false,
      registeredAt:       now,
      registeredBy:       actorId,
      registeredByName:   actorName,
      lastAssessedAt:     null,
      lastAssessedBy:     null,
      updatedAt:          now,
    };

    this.encounters.set(id, encounter);

    this._addTimeline({
      encounterId: id,
      type:        TIMELINE_EVENT_TYPE.REGISTERED,
      actorId,
      actorName,
      timestamp:   now,
      data:        { patientName: patientInfo.name },
    });

    return { ...encounter, encounter: { ...encounter } };
  }

  // ── Clinician assessment ────────────────────────────────────────────────────

  /**
   * Record a clinician-entered acuity assessment for an encounter.
   *
   * Business rules:
   * - Only authorised roles may record assessments.
   * - Acuity is set by the clinician, never inferred.
   * - Previous assessments are preserved (history).
   * - First assessment transitions encounter REGISTERED → WAITING (enters queue).
   * - Subsequent assessments update acuity and reset reassessment task.
   *
   * @param {Object} params
   * @returns {{ encounter: Object, assessment: Object }}
   */
  recordAssessment({ encounterId, acuity, notes, actorId, actorRole, actorName, now = Date.now() }) {
    requirePermission(actorRole, ED_OPERATION.RECORD_ASSESSMENT);

    const acuityValidation = validateAcuityInput(acuity);
    if (!acuityValidation.valid) {
      const err = new Error(acuityValidation.errors.join('; '));
      err.code   = 'VALIDATION_FAILED';
      err.errors = acuityValidation.errors;
      throw err;
    }

    const enc = this._getEncounterOrThrow(encounterId);

    if (isTerminalStatus(enc.status)) {
      throw Object.assign(
        new Error(`Cannot assess an encounter with terminal status '${enc.status}'.`),
        { code: 'INVALID_STATE' }
      );
    }

    if (enc.status === ENCOUNTER_STATUS.EMERGENCY_PATHWAY) {
      throw Object.assign(
        new Error('Encounter is on emergency pathway. Use emergencyService for assessments.'),
        { code: 'INVALID_STATE' }
      );
    }

    const previousAcuity = enc.acuity;
    const isFirstAssessment = enc.status === ENCOUNTER_STATUS.REGISTERED;

    // Persist assessment record (history — never overwrites previous)
    const assessment = {
      id:          this._newId('ASS'),
      encounterId,
      acuity,
      previousAcuity,
      notes:       notes ?? '',
      assessedAt:  now,
      assessedBy:  actorId,
      assessedByName: actorName,
    };
    this.assessments.push(Object.freeze(assessment));

    // Update encounter
    const updated = {
      ...enc,
      acuity,
      lastAssessedAt: now,
      lastAssessedBy: actorId,
      updatedAt:      now,
    };

    // If first assessment: transition to WAITING (enters queue)
    if (isFirstAssessment) {
      requireValidTransition(enc.status, ENCOUNTER_STATUS.WAITING);
      updated.status = ENCOUNTER_STATUS.WAITING;
      updated.enteredQueueAt = now;
    }

    this.encounters.set(encounterId, updated);

    // Build/replace reassessment task
    const task = buildReassessmentTask(encounterId, acuity, now, actorId, now);
    this.reassessmentTasks.set(encounterId, { ...task, id: this._newId('RST') });

    // Timeline
    this._addTimeline({
      encounterId,
      type:      TIMELINE_EVENT_TYPE.ASSESSMENT_RECORDED,
      actorId,
      actorName,
      timestamp: now,
      data:      { acuity, previousAcuity, notes },
    });

    if (isFirstAssessment) {
      this._addTimeline({
        encounterId,
        type:      TIMELINE_EVENT_TYPE.ENTERED_QUEUE,
        actorId,
        actorName,
        timestamp: now,
        data:      { acuity },
      });
    }

    return { encounter: { ...updated }, assessment };
  }

  // ── Status transitions ──────────────────────────────────────────────────────

  /**
   * Transition an encounter to a new status.
   *
   * @param {Object} params
   * @param {string} params.encounterId
   * @param {string} params.toStatus       - ENCOUNTER_STATUS value
   * @param {string} params.actorId
   * @param {string} params.actorRole
   * @param {string} params.actorName
   * @param {number} [params.now]
   * @returns {Object} updated encounter
   */
  transitionEncounter({ encounterId, toStatus, actorId, actorRole, actorName, now = Date.now() }) {
    // Permission check — map status to operation
    const operationMap = {
      [ENCOUNTER_STATUS.CALLED]:          ED_OPERATION.CALL_PATIENT,
      [ENCOUNTER_STATUS.IN_CONSULTATION]: ED_OPERATION.START_CONSULTATION,
      [ENCOUNTER_STATUS.COMPLETED]:       ED_OPERATION.COMPLETE_ENCOUNTER,
      [ENCOUNTER_STATUS.CANCELLED]:       ED_OPERATION.CANCEL_ENCOUNTER,
      [ENCOUNTER_STATUS.WAITING]:         ED_OPERATION.CALL_PATIENT, // re-queue
    };
    const requiredOp = operationMap[toStatus];
    if (requiredOp) requirePermission(actorRole, requiredOp);

    const enc = this._getEncounterOrThrow(encounterId);
    requireValidTransition(enc.status, toStatus);

    const updated = { ...enc, status: toStatus, updatedAt: now };
    this.encounters.set(encounterId, updated);

    // Map status → timeline event type
    const timelineMap = {
      [ENCOUNTER_STATUS.CALLED]:          TIMELINE_EVENT_TYPE.CALLED,
      [ENCOUNTER_STATUS.IN_CONSULTATION]: TIMELINE_EVENT_TYPE.CONSULTATION_STARTED,
      [ENCOUNTER_STATUS.COMPLETED]:       TIMELINE_EVENT_TYPE.COMPLETED,
      [ENCOUNTER_STATUS.CANCELLED]:       TIMELINE_EVENT_TYPE.CANCELLED,
      [ENCOUNTER_STATUS.WAITING]:         TIMELINE_EVENT_TYPE.ENTERED_QUEUE,
    };
    const evtType = timelineMap[toStatus];
    if (evtType) {
      this._addTimeline({ encounterId, type: evtType, actorId, actorName, timestamp: now, data: {} });
    }

    if (toStatus === ENCOUNTER_STATUS.CANCELLED) {
      this._addAudit({
        type:      AUDIT_EVENT_TYPE.ENCOUNTER_CANCELLED,
        encounterId,
        actorId,
        actorRole,
        actorName,
        timestamp: now,
      });
    }

    return { ...updated };
  }

  // ── Emergency pathway ───────────────────────────────────────────────────────

  /**
   * Activate the emergency pathway for an encounter.
   *
   * - Bypasses ordinary queue entirely.
   * - Records who activated it, when, and a mandatory reason.
   * - Prevents duplicate active emergencies for the same encounter.
   *
   * @param {Object} params
   * @param {string} params.encounterId
   * @param {string} params.reason       - mandatory non-empty string
   * @param {string} params.actorId
   * @param {string} params.actorRole
   * @param {string} params.actorName
   * @param {number} [params.now]
   * @returns {Object} emergency event
   */
  activateEmergency({ encounterId, reason, actorId, actorRole, actorName, now = Date.now() }) {
    requirePermission(actorRole, ED_OPERATION.ACTIVATE_EMERGENCY);

    if (!reason || reason.trim().length < 3) {
      throw Object.assign(
        new Error('Emergency activation requires a reason (minimum 3 characters).'),
        { code: 'VALIDATION_FAILED' }
      );
    }

    const enc = this._getEncounterOrThrow(encounterId);

    if (isTerminalStatus(enc.status)) {
      throw Object.assign(
        new Error(`Cannot activate emergency for an encounter with terminal status '${enc.status}'.`),
        { code: 'INVALID_STATE' }
      );
    }

    // Prevent duplicate active emergency
    const hasActive = [...this.emergencyEvents.values()].some(
      (e) => e.encounterId === encounterId && e.emergencyStatus === EMERGENCY_STATUS.ACTIVE
    );
    if (hasActive) {
      throw Object.assign(
        new Error('An active emergency already exists for this encounter.'),
        { code: 'DUPLICATE_EMERGENCY' }
      );
    }

    // Transition encounter to EMERGENCY_PATHWAY
    requireValidTransition(enc.status, ENCOUNTER_STATUS.EMERGENCY_PATHWAY);
    const updatedEnc = {
      ...enc,
      status:             ENCOUNTER_STATUS.EMERGENCY_PATHWAY,
      isEmergencyPathway: true,
      updatedAt:          now,
    };
    this.encounters.set(encounterId, updatedEnc);

    // Create emergency event
    const emergencyId = this._newId('EMG');
    const emergencyEvent = Object.freeze({
      id:             emergencyId,
      encounterId,
      emergencyStatus: EMERGENCY_STATUS.ACTIVE,
      reason:         reason.trim(),
      activatedAt:    now,
      activatedBy:    actorId,
      activatedByName: actorName,
      acknowledgedAt:  null,
      acknowledgedBy:  null,
      resolvedAt:      null,
      resolvedBy:      null,
    });
    this.emergencyEvents.set(emergencyId, emergencyEvent);

    // Timeline + audit
    this._addTimeline({
      encounterId,
      type:      TIMELINE_EVENT_TYPE.EMERGENCY_ACTIVATED,
      actorId,
      actorName,
      timestamp: now,
      data:      { emergencyId, reason },
    });
    this._addAudit({
      type:        AUDIT_EVENT_TYPE.EMERGENCY_ACTIVATED,
      encounterId,
      emergencyId,
      actorId,
      actorRole,
      actorName,
      reason:      reason.trim(),
      timestamp:   now,
    });

    return { ...emergencyEvent, encounter: { ...updatedEnc } };
  }

  /**
   * Acknowledge an active emergency event.
   *
   * @param {Object} params
   * @returns {Object} updated emergency event
   */
  acknowledgeEmergency({ emergencyId, actorId, actorRole, actorName, now = Date.now() }) {
    requirePermission(actorRole, ED_OPERATION.ACKNOWLEDGE_EMERGENCY);

    const evt = this.emergencyEvents.get(emergencyId);
    if (!evt) {
      throw Object.assign(
        new Error(`Emergency event '${emergencyId}' not found.`),
        { code: 'NOT_FOUND' }
      );
    }
    if (evt.emergencyStatus !== EMERGENCY_STATUS.ACTIVE) {
      throw Object.assign(
        new Error(`Emergency '${emergencyId}' is not active (status: ${evt.emergencyStatus}).`),
        { code: 'INVALID_STATE' }
      );
    }

    const updated = Object.freeze({
      ...evt,
      emergencyStatus: EMERGENCY_STATUS.ACKNOWLEDGED,
      acknowledgedAt:  now,
      acknowledgedBy:  actorId,
      acknowledgedByName: actorName,
    });
    this.emergencyEvents.set(emergencyId, updated);

    this._addTimeline({
      encounterId: evt.encounterId,
      type:        TIMELINE_EVENT_TYPE.EMERGENCY_ACKNOWLEDGED,
      actorId,
      actorName,
      timestamp:   now,
      data:        { emergencyId },
    });
    this._addAudit({
      type:        AUDIT_EVENT_TYPE.EMERGENCY_ACKNOWLEDGED,
      encounterId: evt.encounterId,
      emergencyId,
      actorId,
      actorRole,
      actorName,
      timestamp:   now,
    });

    return { ...updated };
  }

  // ── Reassessment ────────────────────────────────────────────────────────────

  /**
   * Record a clinician reassessment.
   *
   * SAFETY: acuity is changed ONLY if the clinician explicitly provides newAcuity.
   * An overdue reassessment task NEVER causes an automatic acuity change.
   *
   * @param {Object} params
   * @param {string} params.encounterId
   * @param {string|null} params.newAcuity  - null = retain current; string = explicit change
   * @param {string} params.notes
   * @param {string} params.actorId
   * @param {string} params.actorRole
   * @param {string} params.actorName
   * @param {number} [params.now]
   * @returns {{ encounter: Object, assessment: Object, task: Object }}
   */
  recordReassessment({ encounterId, newAcuity, notes, actorId, actorRole, actorName, now = Date.now() }) {
    requirePermission(actorRole, ED_OPERATION.RECORD_REASSESSMENT);

    const enc = this._getEncounterOrThrow(encounterId);

    if (!enc.acuity) {
      throw Object.assign(
        new Error('No prior assessment found for this encounter. Record an initial assessment first.'),
        { code: 'INVALID_STATE' }
      );
    }

    if (isTerminalStatus(enc.status)) {
      throw Object.assign(
        new Error(`Cannot reassess an encounter with terminal status '${enc.status}'.`),
        { code: 'INVALID_STATE' }
      );
    }

    // Determine acuity to apply
    let acuityToApply = enc.acuity; // default: retain
    if (newAcuity !== null && newAcuity !== undefined) {
      const acuityValidation = validateAcuityInput(newAcuity);
      if (!acuityValidation.valid) {
        const err = new Error(acuityValidation.errors.join('; '));
        err.code   = 'VALIDATION_FAILED';
        err.errors = acuityValidation.errors;
        throw err;
      }
      acuityToApply = newAcuity;
    }

    const previousAcuity = enc.acuity;
    const acuityChanged  = acuityToApply !== previousAcuity;

    // Assessment record
    const assessment = {
      id:             this._newId('ASS'),
      encounterId,
      acuity:         acuityToApply,
      previousAcuity,
      acuityChanged,
      isReassessment: true,
      notes:          notes ?? '',
      assessedAt:     now,
      assessedBy:     actorId,
      assessedByName: actorName,
    };
    this.assessments.push(Object.freeze(assessment));

    // Update encounter
    const updated = {
      ...enc,
      acuity:         acuityToApply,
      lastAssessedAt: now,
      lastAssessedBy: actorId,
      updatedAt:      now,
    };
    this.encounters.set(encounterId, updated);

    // Close old task, create new one
    const newTask = buildReassessmentTask(encounterId, acuityToApply, now, actorId, now);
    const taskObj = { ...newTask, id: this._newId('RST') };
    this.reassessmentTasks.set(encounterId, taskObj);

    // Timeline
    this._addTimeline({
      encounterId,
      type:      TIMELINE_EVENT_TYPE.REASSESSMENT_COMPLETED,
      actorId,
      actorName,
      timestamp: now,
      data:      { previousAcuity, newAcuity: acuityToApply, acuityChanged, notes },
    });

    return { encounter: { ...updated }, assessment, task: taskObj };
  }

  // ── Override ────────────────────────────────────────────────────────────────

  /**
   * Perform an authorised override with a mandatory reason.
   *
   * @param {Object} params
   * @param {string} params.encounterId
   * @param {string} params.operation
   * @param {*}      params.previousState
   * @param {*}      params.newState
   * @param {string} params.reason
   * @param {string} params.actorId
   * @param {string} params.actorRole
   * @param {string} params.actorName
   * @param {Function} params.applyFn   - function(encounter) → updatedEncounter
   * @param {number} [params.now]
   * @returns {{ overrideRecord: Object, encounter: Object }}
   */
  performOverride({
    encounterId, operation, previousState, newState,
    reason, actorId, actorRole, actorName, applyFn, now = Date.now()
  }) {
    requirePermission(actorRole, ED_OPERATION.PERFORM_OVERRIDE);

    // validateOverride throws if invalid
    const overrideRecord = buildOverrideRecord({
      encounterId, actorId, actorRole, actorName,
      operation, previousState, newState, reason, timestamp: now,
    });

    const enc = this._getEncounterOrThrow(encounterId);

    // Apply the override transformation
    const updatedEnc = typeof applyFn === 'function'
      ? { ...applyFn(enc), updatedAt: now }
      : enc;
    this.encounters.set(encounterId, updatedEnc);

    // Append-only audit record
    this._addAudit({
      ...overrideRecord,
      type: AUDIT_EVENT_TYPE.OVERRIDE_PERFORMED,
    });

    this._addTimeline({
      encounterId,
      type:      TIMELINE_EVENT_TYPE.OVERRIDE_PERFORMED,
      actorId,
      actorName,
      timestamp: now,
      data:      { operation, previousState, newState, reason },
    });

    return { overrideRecord, encounter: { ...updatedEnc } };
  }

  // ── Queue queries ───────────────────────────────────────────────────────────

  /**
   * Return the current ordinary waiting queue (sorted, with positions & explanations).
   * Emergency-pathway patients are NOT included.
   *
   * @param {number} [now] - injectable for reassessment status calculation
   * @returns {Array<Object>}
   */
  getQueue(now = Date.now()) {
    const allEncounters = [...this.encounters.values()];
    const sorted = buildSortedQueue(allEncounters);

    return sorted.map((enc, idx) => {
      const position = idx + 1;
      const task = this.reassessmentTasks.get(enc.id);
      const dueAt = task?.dueAt ?? null;
      const reassessmentStatus = dueAt
        ? getReassessmentStatus(dueAt, now)
        : null;

      return {
        ...enc,
        enteredQueueAt:     enc.enteredQueueAt ?? enc.lastAssessedAt ?? enc.registeredAt,
        queuePosition:      position,
        queueExplanation:   explainQueuePosition(enc, sorted),
        reassessmentStatus,
        reassessmentDueAt:  dueAt,
      };
    });
  }

  /**
   * Return the sorted queue — alias for getQueue for compatibility with UI components.
   *
   * @param {number} [now]
   * @returns {Array<Object>}
   */
  getSortedQueue(now = Date.now()) {
    return this.getQueue(now);
  }

  /**
   * Return all encounters on the emergency pathway with their events.
   * These are displayed separately from the ordinary queue.
   */
  getActiveEmergencies() {
    const emergencyEncounters = [...this.encounters.values()].filter(
      (e) => e.status === ENCOUNTER_STATUS.EMERGENCY_PATHWAY
    );

    return emergencyEncounters.map((enc) => {
      const events = [...this.emergencyEvents.values()].filter(
        (evt) => evt.encounterId === enc.id
      );
      return { ...enc, emergencyEvents: events };
    });
  }

  /**
   * Return all emergency events for emergency pathway views.
   *
   * @returns {Array<Object>}
   */
  getEmergencyList() {
    return [...this.emergencyEvents.values()];
  }

  // ── Read helpers ────────────────────────────────────────────────────────────

  getEncounter(id) {
    const enc = this.encounters.get(id);
    return enc ? { ...enc } : null;
  }

  getAllEncounters() {
    return [...this.encounters.values()].map((e) => ({ ...e }));
  }

  getAssessments(encounterId) {
    return this.assessments
      .filter((a) => a.encounterId === encounterId)
      .map((a) => ({ ...a }));
  }

  getTimeline(encounterId) {
    return this.timelineEvents
      .filter((e) => e.encounterId === encounterId)
      .map((e) => ({ ...e }));
  }

  getAuditLogs() {
    return this.auditLogs.map((l) => ({ ...l }));
  }

  /**
   * Return all registered encounters that have not yet received an initial acuity assessment.
   * These represent intake patients awaiting clinician triage.
   *
   * @returns {Array<Object>}
   */
  getUnassessedEncounters() {
    return [...this.encounters.values()]
      .filter((e) => e.status === ENCOUNTER_STATUS.REGISTERED && !e.acuity && !e.isEmergencyPathway)
      .sort((a, b) => new Date(a.registeredAt).getTime() - new Date(b.registeredAt).getTime())
      .map((e) => ({ ...e }));
  }

  /**
   * Return all timeline events recorded across all encounters.
   *
   * @returns {Array<Object>}
   */
  getAllTimelineEvents() {
    return [...this.timelineEvents].map((e) => ({ ...e }));
  }

  /**
   * Return all system audit logs.
   *
   * @returns {Array<Object>}
   */
  getAllAuditLogs() {
    return [...this.auditLogs].map((l) => ({ ...l }));
  }

  getReassessmentTask(encounterId) {
    const task = this.reassessmentTasks.get(encounterId);
    return task ? { ...task } : null;
  }

  /**
   * Update reassessment task statuses based on current time.
   * Used by watchlist display. NEVER changes encounter acuity.
   *
   * @param {number} now
   * @returns {Array<Object>} tasks with updated status
   */
  getWatchlist(now = Date.now()) {
    return [...this.reassessmentTasks.values()]
      .filter((task) => {
        const enc = this.encounters.get(task.encounterId);
        return enc && !isTerminalStatus(enc.status);
      })
      .map((task) => ({
        ...task,
        acuity: task.currentAcuity,
        status: getReassessmentStatus(task.dueAt, now),
      }))
      .sort((a, b) => a.dueAt - b.dueAt);
  }

  /**
   * Return pending reassessments — alias for getWatchlist for compatibility with UI components.
   *
   * @param {number} [now]
   * @returns {Array<Object>}
   */
  getPendingReassessments(now = Date.now()) {
    return this.getWatchlist(now);
  }
}

/** Shared singleton instance used by services in the application. */
export const edStore = new EdMemoryStore();
