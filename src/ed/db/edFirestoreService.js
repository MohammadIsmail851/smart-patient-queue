/**
 * EdFirestoreService — live Firestore implementation of ED operations.
 *
 * Enforces all pure business rules before writing to Firestore:
 * - Permission checks (permissionLogic.js)
 * - State machine transition guards (stateMachine.js)
 * - Override validation (overrideLogic.js)
 * - Reassessment task scheduling (reassessmentLogic.js)
 * - Input validation (encounterValidator.js)
 *
 * ⚠️  Synthetic / Demonstration data only for Anvesh '26.
 */

import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc,
  query, where, orderBy, onSnapshot, serverTimestamp, writeBatch
} from 'firebase/firestore';
import { db } from '../../firebase';

import { validatePatientInfo, validateAcuityInput } from '../logic/encounterValidator.js';
import { requirePermission }                         from '../logic/permissionLogic.js';
import { requireValidTransition, isEligibleForQueue, isTerminalStatus } from '../logic/stateMachine.js';
import { buildSortedQueue, getQueuePosition, explainQueuePosition }     from '../logic/queueLogic.js';
import { buildReassessmentTask, getReassessmentStatus, calculateDueAt } from '../logic/reassessmentLogic.js';
import { validateOverride, buildOverrideRecord }                         from '../logic/overrideLogic.js';

import {
  ED_OPERATION, ENCOUNTER_STATUS, EMERGENCY_STATUS,
  REASSESSMENT_STATUS, TIMELINE_EVENT_TYPE, AUDIT_EVENT_TYPE
} from '../types/enums.js';

export class EdFirestoreService {
  constructor(firestoreInstance = db) {
    this.db = firestoreInstance;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _col(name) {
    return collection(this.db, name);
  }

  _doc(colName, id) {
    return doc(this.db, colName, id);
  }

  async _addTimeline(encounterId, event) {
    const ref = doc(this._col('ed_timeline'));
    await setDoc(ref, {
      id: ref.id,
      encounterId,
      ...event,
      createdAt: serverTimestamp(),
      clientTimestamp: Date.now()
    });
  }

  async _addAudit(event) {
    const ref = doc(this._col('ed_audit_logs'));
    await setDoc(ref, {
      id: ref.id,
      ...event,
      createdAt: serverTimestamp(),
      clientTimestamp: Date.now()
    });
  }

  // ── Encounter Registration ────────────────────────────────────────────────

  async registerEncounter({ patientInfo, actorId, actorRole, actorName, now = Date.now() }) {
    requirePermission(actorRole, ED_OPERATION.REGISTER_ENCOUNTER);

    const validation = validatePatientInfo(patientInfo);
    if (!validation.valid) {
      const err = new Error(`Invalid encounter data: ${validation.errors.join('; ')}`);
      err.code = 'VALIDATION_FAILED';
      err.errors = validation.errors;
      throw err;
    }

    const encRef = doc(this._col('ed_encounters'));
    const encounter = {
      id: encRef.id,
      patientInfo: { ...patientInfo },
      status: ENCOUNTER_STATUS.REGISTERED,
      acuity: null,
      isEmergencyPathway: false,
      registeredAt: now,
      registeredBy: actorId,
      registeredByName: actorName,
      lastAssessedAt: null,
      lastAssessedBy: null,
      updatedAt: now,
    };

    await setDoc(encRef, encounter);

    await this._addTimeline(encRef.id, {
      type: TIMELINE_EVENT_TYPE.REGISTERED,
      actorId,
      actorName,
      timestamp: now,
      data: { patientName: patientInfo.name }
    });

    return { ...encounter, encounter: { ...encounter } };
  }

  // ── Clinician Assessment ──────────────────────────────────────────────────

  async recordAssessment({ encounterId, acuity, notes = '', actorId, actorRole, actorName, now = Date.now() }) {
    requirePermission(actorRole, ED_OPERATION.RECORD_ASSESSMENT);

    const acuityValidation = validateAcuityInput(acuity);
    if (!acuityValidation.valid) {
      const err = new Error(acuityValidation.errors.join('; '));
      err.code = 'VALIDATION_FAILED';
      err.errors = acuityValidation.errors;
      throw err;
    }

    const encSnap = await getDoc(this._doc('ed_encounters', encounterId));
    if (!encSnap.exists()) {
      throw Object.assign(new Error(`Encounter '${encounterId}' not found.`), { code: 'NOT_FOUND' });
    }
    const enc = encSnap.data();

    const previousAcuity = enc.acuity;
    const isFirstAssessment = enc.status === ENCOUNTER_STATUS.REGISTERED;

    let targetStatus = enc.status;
    if (isFirstAssessment) {
      targetStatus = ENCOUNTER_STATUS.WAITING;
      requireValidTransition(enc.status, targetStatus);
    }

    // Create assessment record
    const asmtRef = doc(this._col('ed_assessments'));
    const assessment = {
      id: asmtRef.id,
      encounterId,
      acuity,
      previousAcuity,
      notes: notes.trim(),
      assessedAt: now,
      assessedBy: actorId,
      assessedByName: actorName,
      assessedByRole: actorRole,
      isOverride: false,
    };
    await setDoc(asmtRef, assessment);

    // Update encounter
    const updatedEnc = {
      ...enc,
      acuity,
      status: targetStatus,
      lastAssessedAt: now,
      lastAssessedBy: actorId,
      updatedAt: now,
    };
    await updateDoc(this._doc('ed_encounters', encounterId), {
      acuity,
      status: targetStatus,
      lastAssessedAt: now,
      lastAssessedBy: actorId,
      updatedAt: now,
    });

    // Schedule reassessment task
    const task = buildReassessmentTask(encounterId, acuity, now);
    await setDoc(this._doc('ed_reassessment_tasks', encounterId), task);

    // Timeline entries
    await this._addTimeline(encounterId, {
      type: TIMELINE_EVENT_TYPE.ASSESSMENT_RECORDED,
      actorId,
      actorName,
      timestamp: now,
      data: { acuity, previousAcuity, notes }
    });

    if (isFirstAssessment) {
      await this._addTimeline(encounterId, {
        type: TIMELINE_EVENT_TYPE.ENTERED_QUEUE,
        actorId,
        actorName,
        timestamp: now,
        data: { acuity }
      });
    }

    return { encounter: updatedEnc, assessment };
  }

  // ── Status Transitions ────────────────────────────────────────────────────

  async transitionEncounter({ encounterId, toStatus, actorId, actorRole, actorName, now = Date.now() }) {
    const operationMap = {
      [ENCOUNTER_STATUS.CALLED]:          ED_OPERATION.CALL_PATIENT,
      [ENCOUNTER_STATUS.IN_CONSULTATION]: ED_OPERATION.START_CONSULTATION,
      [ENCOUNTER_STATUS.COMPLETED]:       ED_OPERATION.COMPLETE_ENCOUNTER,
      [ENCOUNTER_STATUS.CANCELLED]:       ED_OPERATION.CANCEL_ENCOUNTER,
      [ENCOUNTER_STATUS.WAITING]:         ED_OPERATION.CALL_PATIENT,
    };
    const requiredOp = operationMap[toStatus];
    if (requiredOp) requirePermission(actorRole, requiredOp);

    const encSnap = await getDoc(this._doc('ed_encounters', encounterId));
    if (!encSnap.exists()) {
      throw Object.assign(new Error(`Encounter '${encounterId}' not found.`), { code: 'NOT_FOUND' });
    }
    const enc = encSnap.data();

    requireValidTransition(enc.status, toStatus);

    await updateDoc(this._doc('ed_encounters', encounterId), {
      status: toStatus,
      updatedAt: now,
    });

    const timelineMap = {
      [ENCOUNTER_STATUS.CALLED]:          TIMELINE_EVENT_TYPE.CALLED,
      [ENCOUNTER_STATUS.IN_CONSULTATION]: TIMELINE_EVENT_TYPE.CONSULTATION_STARTED,
      [ENCOUNTER_STATUS.COMPLETED]:       TIMELINE_EVENT_TYPE.COMPLETED,
      [ENCOUNTER_STATUS.CANCELLED]:       TIMELINE_EVENT_TYPE.CANCELLED,
      [ENCOUNTER_STATUS.WAITING]:         TIMELINE_EVENT_TYPE.ENTERED_QUEUE,
    };
    const evtType = timelineMap[toStatus];
    if (evtType) {
      await this._addTimeline(encounterId, {
        type: evtType,
        actorId,
        actorName,
        timestamp: now,
        data: {}
      });
    }

    if (toStatus === ENCOUNTER_STATUS.CANCELLED) {
      await this._addAudit({
        type: AUDIT_EVENT_TYPE.ENCOUNTER_CANCELLED,
        encounterId,
        actorId,
        actorRole,
        actorName,
        timestamp: now,
      });
    }

    return { ...enc, status: toStatus, updatedAt: now };
  }

  // ── Emergency Pathway ─────────────────────────────────────────────────────

  async activateEmergency({ encounterId, reason, actorId, actorRole, actorName, now = Date.now() }) {
    requirePermission(actorRole, ED_OPERATION.ACTIVATE_EMERGENCY);

    if (!reason || reason.trim().length < 3) {
      throw Object.assign(new Error('Emergency activation requires a reason (minimum 3 characters).'), { code: 'VALIDATION_FAILED' });
    }

    const encSnap = await getDoc(this._doc('ed_encounters', encounterId));
    if (!encSnap.exists()) {
      throw Object.assign(new Error(`Encounter '${encounterId}' not found.`), { code: 'NOT_FOUND' });
    }
    const enc = encSnap.data();

    if (isTerminalStatus(enc.status)) {
      throw Object.assign(new Error(`Cannot activate emergency for an encounter with terminal status '${enc.status}'.`), { code: 'INVALID_STATE' });
    }

    requireValidTransition(enc.status, ENCOUNTER_STATUS.EMERGENCY_PATHWAY);

    const emgRef = doc(this._col('ed_emergency_events'));
    const emergencyEvent = {
      id: emgRef.id,
      encounterId,
      emergencyStatus: EMERGENCY_STATUS.ACTIVE,
      reason: reason.trim(),
      activatedAt: now,
      activatedBy: actorId,
      activatedByName: actorName,
      acknowledgedAt: null,
      acknowledgedBy: null,
      resolvedAt: null,
      resolvedBy: null,
    };
    await setDoc(emgRef, emergencyEvent);

    const updatedEnc = {
      ...enc,
      status: ENCOUNTER_STATUS.EMERGENCY_PATHWAY,
      isEmergencyPathway: true,
      updatedAt: now,
    };
    await updateDoc(this._doc('ed_encounters', encounterId), {
      status: ENCOUNTER_STATUS.EMERGENCY_PATHWAY,
      isEmergencyPathway: true,
      updatedAt: now,
    });

    await this._addTimeline(encounterId, {
      type: TIMELINE_EVENT_TYPE.EMERGENCY_ACTIVATED,
      actorId,
      actorName,
      timestamp: now,
      data: { emergencyId: emgRef.id, reason }
    });

    await this._addAudit({
      type: AUDIT_EVENT_TYPE.EMERGENCY_ACTIVATED,
      encounterId,
      emergencyId: emgRef.id,
      actorId,
      actorRole,
      actorName,
      reason: reason.trim(),
      timestamp: now,
    });

    return { ...emergencyEvent, encounter: updatedEnc };
  }

  // ── Overrides ─────────────────────────────────────────────────────────────

  async performOverride({ encounterId, overrideType, previousState, newState, reason, actorId, actorRole, actorName, now = Date.now() }) {
    requirePermission(actorRole, ED_OPERATION.PERFORM_OVERRIDE);

    const overrideRecord = buildOverrideRecord({
      encounterId,
      overrideType,
      previousState,
      newState,
      reason,
      actorId,
      actorRole,
      actorName,
      timestamp: now,
    });

    const encSnap = await getDoc(this._doc('ed_encounters', encounterId));
    if (!encSnap.exists()) {
      throw Object.assign(new Error(`Encounter '${encounterId}' not found.`), { code: 'NOT_FOUND' });
    }
    const enc = encSnap.data();

    // If override changed acuity, update encounter
    if (newState.acuity && newState.acuity !== enc.acuity) {
      await updateDoc(this._doc('ed_encounters', encounterId), {
        acuity: newState.acuity,
        updatedAt: now,
      });

      // Reset reassessment task
      const task = buildReassessmentTask(encounterId, newState.acuity, now);
      await setDoc(this._doc('ed_reassessment_tasks', encounterId), task);
    }

    await this._addTimeline(encounterId, {
      type: TIMELINE_EVENT_TYPE.OVERRIDE_PERFORMED,
      actorId,
      actorName,
      timestamp: now,
      data: { overrideType, reason: reason.trim(), previousState, newState }
    });

    await this._addAudit({
      type: AUDIT_EVENT_TYPE.OVERRIDE_PERFORMED,
      encounterId,
      actorId,
      actorRole,
      actorName,
      overrideType,
      reason: reason.trim(),
      previousState,
      newState,
      timestamp: now,
    });

    return overrideRecord;
  }
}

export const edFirestoreService = new EdFirestoreService();
