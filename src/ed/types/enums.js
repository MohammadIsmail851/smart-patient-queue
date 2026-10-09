/**
 * ED Triage Module — Enum Constants
 *
 * ⚠️  DEMONSTRATION ONLY for Anvesh '26.
 * This is a workflow-support prototype. It does not diagnose patients,
 * calculate clinical acuity autonomously, or substitute for hospital protocols.
 */

// ── Acuity categories ────────────────────────────────────────────────────────
// Values must be entered by an authorised clinician. Never inferred by the system.
export const ACUITY_CATEGORY = Object.freeze({
  P1: 'P1',
  P2: 'P2',
  P3: 'P3',
  P4: 'P4',
  P5: 'P5',
});

// ── Encounter lifecycle ───────────────────────────────────────────────────────
export const ENCOUNTER_STATUS = Object.freeze({
  REGISTERED:        'registered',        // Registered; awaiting clinician assessment
  WAITING:           'waiting',           // In ordinary queue after first assessment
  CALLED:            'called',            // Called to consultation room
  IN_CONSULTATION:   'in_consultation',   // Currently with clinician
  COMPLETED:         'completed',         // Encounter concluded (terminal)
  CANCELLED:         'cancelled',         // Encounter cancelled  (terminal)
  EMERGENCY_PATHWAY: 'emergency_pathway', // Bypasses ordinary queue (separate pathway)
});

// ── Emergency pathway ─────────────────────────────────────────────────────────
export const EMERGENCY_STATUS = Object.freeze({
  ACTIVE:       'active',
  ACKNOWLEDGED: 'acknowledged',
  RESOLVED:     'resolved',
});

// ── Reassessment task ─────────────────────────────────────────────────────────
export const REASSESSMENT_STATUS = Object.freeze({
  UPCOMING:  'upcoming',   // Not yet due
  DUE:       'due',        // Within warning window
  OVERDUE:   'overdue',    // Past deadline — task only; acuity NOT auto-changed
  COMPLETED: 'completed',  // Clinician recorded reassessment
});

// ── ED staff roles ────────────────────────────────────────────────────────────
export const ED_ROLE = Object.freeze({
  REGISTRATION_STAFF: 'ed_registration',
  TRIAGE_CLINICIAN:   'ed_triage',
  EMERGENCY_CLINICIAN:'ed_emergency',
  FLOW_COORDINATOR:   'ed_coordinator',
  SUPERVISOR:         'ed_supervisor',
  ADMINISTRATOR:      'ed_admin',
  AUDITOR:            'ed_auditor',
});

// ── Authorised operations ─────────────────────────────────────────────────────
export const ED_OPERATION = Object.freeze({
  REGISTER_ENCOUNTER:    'register_encounter',
  RECORD_ASSESSMENT:     'record_assessment',
  ACTIVATE_EMERGENCY:    'activate_emergency',
  ACKNOWLEDGE_EMERGENCY: 'acknowledge_emergency',
  RESOLVE_EMERGENCY:     'resolve_emergency',
  CALL_PATIENT:          'call_patient',
  START_CONSULTATION:    'start_consultation',
  COMPLETE_ENCOUNTER:    'complete_encounter',
  CANCEL_ENCOUNTER:      'cancel_encounter',
  RECORD_REASSESSMENT:   'record_reassessment',
  PERFORM_OVERRIDE:      'perform_override',
  MANAGE_ROLES:          'manage_roles',
  VIEW_AUDIT_LOG:        'view_audit_log',
  VIEW_QUEUE:            'view_queue',
  RUN_SIMULATOR:         'run_simulator',
  RESET_SIMULATOR:       'reset_simulator',
});

// ── Audit event types ─────────────────────────────────────────────────────────
export const AUDIT_EVENT_TYPE = Object.freeze({
  OVERRIDE_PERFORMED:    'override_performed',
  PERMISSION_DENIED:     'permission_denied',
  ROLE_CHANGED:          'role_changed',
  EMERGENCY_ACTIVATED:   'emergency_activated',
  EMERGENCY_ACKNOWLEDGED:'emergency_acknowledged',
  EMERGENCY_RESOLVED:    'emergency_resolved',
  ENCOUNTER_CANCELLED:   'encounter_cancelled',
  ASSESSMENT_RECORDED:   'assessment_recorded',
  SIMULATOR_RESET:       'simulator_reset',
});

// ── Timeline event types ──────────────────────────────────────────────────────
export const TIMELINE_EVENT_TYPE = Object.freeze({
  REGISTERED:              'registered',
  ASSESSMENT_RECORDED:     'assessment_recorded',
  ENTERED_QUEUE:           'entered_queue',
  QUEUE_POSITION_CHANGED:  'queue_position_changed',
  REASSESSMENT_DUE:        'reassessment_due',
  REASSESSMENT_OVERDUE:    'reassessment_overdue',
  REASSESSMENT_COMPLETED:  'reassessment_completed',
  EMERGENCY_ACTIVATED:     'emergency_activated',
  EMERGENCY_ACKNOWLEDGED:  'emergency_acknowledged',
  EMERGENCY_RESOLVED:      'emergency_resolved',
  CALLED:                  'called',
  CONSULTATION_STARTED:    'consultation_started',
  COMPLETED:               'completed',
  CANCELLED:               'cancelled',
  OVERRIDE_PERFORMED:      'override_performed',
});
