import React, { useState, useEffect } from 'react';
import { EdMemoryStore } from './ed/db/edMemoryStore.js';
import {
  ED_ROLE, ED_OPERATION, ACUITY_CATEGORY,
  ENCOUNTER_STATUS, EMERGENCY_STATUS, TIMELINE_EVENT_TYPE, AUDIT_EVENT_TYPE
} from './ed/types/enums.js';
import { SYNTHETIC_PATIENTS } from './ed/data/syntheticPatients.js';
import { ACUITY_CONFIG } from './ed/config/acuity.js';
import { hasPermission } from './ed/logic/permissionLogic.js';
import {
  saveStoreToStorage,
  loadStoreFromStorage,
  clearStoreStorage,
  PERSISTENCE_STATUS
} from './ed/db/edPersistence.js';
import {
  ShieldAlert, Activity, UserPlus, AlertCircle, Clock,
  CheckCircle2, Users, RefreshCw, FileText, ChevronRight,
  ClipboardList, History, Database, AlertTriangle, Stethoscope, Bot
} from 'lucide-react';
import PatientAssistantChat from './components/chat/PatientAssistantChat.jsx';

export default function App() {
  // Persistence state
  const [persistenceState, setPersistenceState] = useState({
    status: PERSISTENCE_STATUS.IDLE,
    lastSavedAt: null,
    error: null,
  });

  // Store instance with persistence restoration & initial seeding
  const [store] = useState(() => {
    const s = new EdMemoryStore();
    // Try restoring state from localStorage first
    const loadResult = loadStoreFromStorage(s);

    if (!loadResult.loaded) {
      // First-time load: seed synthetic demonstration encounters
      // First 4 patients get initial clinician acuity so live queue and watchlist are populated
      // Remaining 4 patients stay registered but unassessed for the Patient Intake View
      const initialAcuities = ['P2', 'P3', 'P4', 'P5'];
      SYNTHETIC_PATIENTS.forEach((p, idx) => {
        const enc = s.registerEncounter({
          patientInfo: {
            name: p.name,
            dob: p.dob,
            gender: p.gender,
            chiefComplaint: p.chiefComplaint,
          },
          actorId: 'reg-staff-1',
          actorRole: ED_ROLE.REGISTRATION_STAFF,
          actorName: 'Triage Clerk',
          now: Date.now() - (idx * 15 * 60 * 1000), // staggered arrival
        });

        // Assess first 4 patients
        const initAcuity = p.initialAcuity || (idx < 4 ? initialAcuities[idx] : null);
        if (initAcuity) {
          s.recordAssessment({
            encounterId: enc.id,
            acuity: initAcuity,
            notes: p.notes || 'Initial assessment recorded.',
            actorId: 'triage-nurse-1',
            actorRole: ED_ROLE.TRIAGE_CLINICIAN,
            actorName: 'Nurse Patel',
            now: Date.now() - (idx * 10 * 60 * 1000),
          });
        }
      });
      // Save initial state to storage
      saveStoreToStorage(s);
    }
    return s;
  });

  // Active view tab: 'queue' | 'intake' | 'audit'
  const [activeTab, setActiveTab] = useState('queue');

  // Application state
  const [currentRole, setCurrentRole] = useState(ED_ROLE.TRIAGE_CLINICIAN);
  const [queue, setQueue] = useState([]);
  const [emergencies, setEmergencies] = useState([]);
  const [reassessments, setReassessments] = useState([]);
  const [unassessed, setUnassessed] = useState([]);
  const [timelineEvents, setTimelineEvents] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [selectedEncounterFilter, setSelectedEncounterFilter] = useState('all');
  const [tick, setTick] = useState(0);

  // New patient registration modal state
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [showAssistantModal, setShowAssistantModal] = useState(false);
  const [patientName, setPatientName] = useState('');
  const [gender, setGender] = useState('female');
  const [dob, setDob] = useState('1990-01-01');
  const [chiefComplaint, setChiefComplaint] = useState('');

  // Clinician assessment modal state
  const [assessingEnc, setAssessingEnc] = useState(null);
  const [selectedAcuity, setSelectedAcuity] = useState('P3');
  const [clinicalNotes, setClinicalNotes] = useState('');

  // Save changes to persistent storage with status feedback
  const persistChanges = () => {
    setPersistenceState(prev => ({ ...prev, status: PERSISTENCE_STATUS.SAVING }));
    const result = saveStoreToStorage(store);
    if (result.success) {
      setPersistenceState({
        status: PERSISTENCE_STATUS.SAVED,
        lastSavedAt: Date.now(),
        error: null,
      });
    } else {
      setPersistenceState({
        status: PERSISTENCE_STATUS.ERROR,
        lastSavedAt: null,
        error: result.error || 'Failed to save to local persistence',
      });
    }
  };

  // Refresh views from store
  const refresh = () => {
    try {
      const q = typeof store.getQueue === 'function' ? store.getQueue() : store.getSortedQueue();
      const emg = typeof store.getEmergencyList === 'function' ? store.getEmergencyList() : store.getActiveEmergencies();
      const rst = typeof store.getPendingReassessments === 'function' ? store.getPendingReassessments() : store.getWatchlist();
      const unass = typeof store.getUnassessedEncounters === 'function' ? store.getUnassessedEncounters() : [];
      const tl = typeof store.getAllTimelineEvents === 'function' ? store.getAllTimelineEvents() : [];
      const aud = typeof store.getAllAuditLogs === 'function' ? store.getAllAuditLogs() : [];

      setQueue(q || []);
      setEmergencies(emg || []);
      setReassessments(rst || []);
      setUnassessed(unass || []);
      setTimelineEvents(tl || []);
      setAuditLogs(aud || []);
      setTick(t => t + 1);
    } catch (err) {
      console.error('Error refreshing ED store views:', err);
    }
  };

  // Periodic polling for timer updates
  useEffect(() => {
    refresh();
    persistChanges();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, []);

  // Handle new patient registration
  const handleRegister = (e) => {
    e.preventDefault();
    try {
      store.registerEncounter({
        patientInfo: { name: patientName, gender, dob, chiefComplaint },
        actorId: 'usr-1',
        actorRole: currentRole,
        actorName: 'Active User',
      });
      setShowRegisterModal(false);
      setPatientName('');
      setChiefComplaint('');
      refresh();
      persistChanges();
    } catch (err) {
      alert(`Registration failed: ${err.message}`);
    }
  };

  // Handle clinician assessment (moves unassessed into WAITING queue or updates reassessment)
  const handleAssessment = (e) => {
    e.preventDefault();
    if (!assessingEnc) return;
    try {
      store.recordAssessment({
        encounterId: assessingEnc.id,
        acuity: selectedAcuity,
        notes: clinicalNotes,
        actorId: 'usr-1',
        actorRole: currentRole,
        actorName: 'Active User',
      });
      setAssessingEnc(null);
      setClinicalNotes('');
      refresh();
      persistChanges();
    } catch (err) {
      alert(`Assessment failed: ${err.message}`);
    }
  };

  // Handle emergency bypass trigger
  const handleEmergencyTrigger = (encounterId) => {
    const reason = prompt('Enter clinical justification for Emergency Bypass activation:');
    if (!reason) return;
    try {
      store.activateEmergency({
        encounterId,
        reason,
        actorId: 'usr-1',
        actorRole: currentRole,
        actorName: 'Active User',
      });
      refresh();
      persistChanges();
    } catch (err) {
      alert(`Emergency activation failed: ${err.message}`);
    }
  };

  // Reset to initial clean demo data
  const handleResetData = () => {
    if (confirm('Reset prototype storage and restore original synthetic demo encounters?')) {
      clearStoreStorage();
      window.location.reload();
    }
  };

  // Check if active user role is authorized to perform clinical triage
  const canPerformAssessment = hasPermission(currentRole, ED_OPERATION.RECORD_ASSESSMENT);

  // Combined timeline & audit stream sorted chronologically (newest first)
  const combinedEvents = [
    ...timelineEvents.map(evt => ({ ...evt, streamCategory: 'timeline' })),
    ...auditLogs.map(aud => ({ ...aud, streamCategory: 'audit' })),
  ]
    .filter(evt => {
      if (selectedEncounterFilter === 'all') return true;
      return evt.encounterId === selectedEncounterFilter;
    })
    .sort((a, b) => b.timestamp - a.timestamp);

  // Unique encounter IDs for filter dropdown
  const allEncounterIds = Array.from(new Set([
    ...queue.map(q => q.id),
    ...unassessed.map(u => u.id),
    ...emergencies.map(e => e.encounterId),
  ]));

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
      {/* Top Application Header */}
      <header
        className="app-header-container"
        style={{
          background: 'var(--bg-card)',
          borderBottom: '1px solid var(--border-subtle)',
          padding: '0.9rem 2rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          boxShadow: 'var(--shadow-sm)',
          position: 'sticky',
          top: 0,
          zIndex: 30,
        }}
      >
        {/* Brand & Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
          <div style={{
            background: 'var(--color-blue-subtle)',
            padding: '0.5rem',
            borderRadius: 10,
            border: '1px solid var(--color-blue-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <Activity size={24} color="#2563EB" />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <h1 style={{ fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.025em', color: 'var(--text-primary)' }}>
                Smart Patient Queue & Emergency Triage
              </h1>
              <span style={{
                background: 'var(--color-blue-subtle)',
                color: 'var(--color-primary-blue)',
                border: '1px solid var(--color-blue-border)',
                borderRadius: 6,
                fontSize: '0.75rem',
                fontWeight: 700,
                padding: '0.15rem 0.5rem',
              }}>
                Anvesh '26
              </span>
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>
              Deterministic Acuity Triage • Clinical Workflow Support System
            </p>
          </div>
        </div>

        {/* Persistence Status & Header Actions */}
        <div className="app-header-actions" style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
          {/* Persistence status indicator */}
          <div
            title="Encounters, assessments, and events persist in browser local storage across refreshes."
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              background: 'var(--bg-card-subtle)',
              border: `1px solid ${persistenceState.status === PERSISTENCE_STATUS.ERROR ? 'var(--color-danger)' : 'var(--border-subtle)'}`,
              padding: '0.4rem 0.75rem',
              borderRadius: 8,
              fontSize: '0.75rem',
              fontWeight: 500,
              color: persistenceState.status === PERSISTENCE_STATUS.ERROR ? 'var(--color-danger)' : 'var(--text-secondary)',
            }}
          >
            <Database size={14} color={persistenceState.status === PERSISTENCE_STATUS.ERROR ? '#DC2626' : '#2563EB'} />
            <span>
              {persistenceState.status === PERSISTENCE_STATUS.SAVING && 'Saving...'}
              {persistenceState.status === PERSISTENCE_STATUS.SAVED && 'Storage: Synced'}
              {persistenceState.status === PERSISTENCE_STATUS.ERROR && 'Save Error'}
              {persistenceState.status === PERSISTENCE_STATUS.IDLE && 'Storage: Active'}
            </span>
          </div>

          {/* Role Selector with Security Disclaimer */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            background: 'var(--bg-card-subtle)',
            padding: '0.35rem 0.75rem',
            borderRadius: 8,
            border: '1px solid var(--border-subtle)',
          }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Active Role:</span>
            <select
              value={currentRole}
              onChange={(e) => setCurrentRole(e.target.value)}
              style={{
                background: 'transparent',
                color: 'var(--text-primary)',
                border: 'none',
                outline: 'none',
                fontSize: '0.825rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {Object.values(ED_ROLE).map(r => (
                <option key={r} value={r} style={{ background: '#FFFFFF', color: '#182230' }}>{r}</option>
              ))}
            </select>
          </div>

          {/* AI Patient Assistant Intake Button */}
          <button
            onClick={() => setShowAssistantModal(true)}
            style={{
              background: 'var(--color-blue-subtle)',
              border: '1px solid var(--color-blue-border)',
              color: 'var(--color-primary-blue)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              padding: '0.5rem 0.95rem',
              borderRadius: 8,
              fontSize: '0.85rem',
              fontWeight: 600,
              boxShadow: 'var(--shadow-sm)',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = '#DBEAFE';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'var(--color-blue-subtle)';
            }}
          >
            <Bot size={16} /> AI Assistant Intake
          </button>

          {/* Register Patient Button */}
          <button
            onClick={() => setShowRegisterModal(true)}
            style={{
              background: 'var(--color-primary-blue)',
              color: '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              padding: '0.5rem 1rem',
              borderRadius: 8,
              fontSize: '0.85rem',
              fontWeight: 600,
              boxShadow: '0 1px 3px rgba(37, 99, 235, 0.2)',
              transition: 'background 0.15s ease',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--color-blue-hover)'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--color-primary-blue)'}
          >
            <UserPlus size={16} /> Register Patient
          </button>

          {/* Reset Demo Data Button */}
          <button
            onClick={handleResetData}
            title="Reset to fresh synthetic demonstration data"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)',
              padding: '0.5rem 0.75rem',
              borderRadius: 8,
              fontSize: '0.75rem',
              fontWeight: 500,
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'var(--bg-card-subtle)';
              e.currentTarget.style.color = 'var(--text-primary)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'var(--bg-card)';
              e.currentTarget.style.color = 'var(--text-secondary)';
            }}
          >
            Reset Demo
          </button>
        </div>
      </header>

      {/* Navigation Sub-Header Tabs */}
      <nav
        className="app-nav-tabs"
        style={{
          background: 'var(--bg-card)',
          borderBottom: '1px solid var(--border-subtle)',
          padding: '0.5rem 2rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
        }}
      >
        <button
          className={`nav-tab ${activeTab === 'queue' ? 'active' : ''}`}
          onClick={() => setActiveTab('queue')}
        >
          <Users size={16} /> Prioritized Waiting Queue ({queue.length})
        </button>

        <button
          className={`nav-tab ${activeTab === 'intake' ? 'active' : ''}`}
          onClick={() => setActiveTab('intake')}
        >
          <ClipboardList size={16} /> Patient Intake ({unassessed.length} Unassessed)
        </button>

        <button
          className={`nav-tab ${activeTab === 'audit' ? 'active' : ''}`}
          onClick={() => setActiveTab('audit')}
        >
          <History size={16} /> Audit Trail & Patient Timeline ({combinedEvents.length})
        </button>
      </nav>

      {/* Main Content Area */}
      <main className="app-main-content" style={{ flex: 1, padding: '1.5rem 2rem', maxWidth: '1440px', width: '100%', margin: '0 auto' }}>
        {/* TAB 1: Live Waiting Queue & Emergency Pathway */}
        {activeTab === 'queue' && (
          <div className="dashboard-grid">
            {/* Left Column: Prioritized Waiting Queue */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Users size={20} color="#2563EB" />
                  <h2 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Prioritized Waiting Queue ({queue.length})
                  </h2>
                </div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                  Deterministic Ordering: P1→P5 priority, FIFO tie-breaker
                </span>
              </div>

              <div className="light-card" style={{ padding: '1.25rem', minHeight: '440px' }}>
                {queue.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '4rem 2rem', color: 'var(--text-secondary)' }}>
                    <div style={{
                      width: 48,
                      height: 48,
                      borderRadius: '50%',
                      background: 'var(--color-blue-subtle)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      margin: '0 auto 1rem',
                    }}>
                      <Users size={24} color="#2563EB" />
                    </div>
                    <p style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                      No patients currently waiting in queue.
                    </p>
                    <p style={{ fontSize: '0.85rem', marginTop: '0.35rem', color: 'var(--text-secondary)' }}>
                      Assess registered patients in the <strong>Patient Intake</strong> tab to enter them into the waiting queue.
                    </p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {queue.map((item, index) => {
                      const acuityStyle = `badge-${item.acuity?.toLowerCase() || 'p5'}`;
                      const waitMinutes = Math.max(0, Math.floor((Date.now() - (item.enteredQueueAt || Date.now())) / 60000));

                      return (
                        <div
                          key={item.id}
                          style={{
                            background: 'var(--bg-card)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: 10,
                            padding: '1.1rem',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            transition: 'all 0.15s ease',
                            boxShadow: 'var(--shadow-sm)',
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.borderColor = 'var(--border-medium)';
                            e.currentTarget.style.background = 'var(--bg-card-hover)';
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.borderColor = 'var(--border-subtle)';
                            e.currentTarget.style.background = 'var(--bg-card)';
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                            <div style={{
                              width: 36,
                              height: 36,
                              borderRadius: '50%',
                              background: 'var(--color-blue-subtle)',
                              border: '1px solid var(--color-blue-border)',
                              color: 'var(--color-primary-blue)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontFamily: 'var(--font-mono)',
                              fontWeight: 700,
                              fontSize: '0.875rem',
                              flexShrink: 0,
                            }}>
                              #{index + 1}
                            </div>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                                <span style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>
                                  {item.patientInfo?.name}
                                </span>
                                <span className={acuityStyle} style={{
                                  padding: '0.2rem 0.6rem',
                                  borderRadius: 6,
                                  fontSize: '0.75rem',
                                  fontWeight: 700,
                                  letterSpacing: '0.01em',
                                }}>
                                  {item.acuity} — {ACUITY_CONFIG[item.acuity]?.label}
                                </span>
                              </div>
                              <p style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                                Chief Complaint: <strong style={{ color: 'var(--text-primary)' }}>{item.patientInfo?.chiefComplaint}</strong>
                              </p>
                              {item.queueExplanation && (
                                <p style={{ fontSize: '0.75rem', color: 'var(--color-primary-blue)', marginTop: '0.2rem', fontWeight: 500 }}>
                                  ℹ️ {item.queueExplanation}
                                </p>
                              )}
                            </div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexShrink: 0 }}>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.3rem',
                                fontSize: '0.825rem',
                                fontWeight: 600,
                                color: 'var(--text-primary)',
                                justifyContent: 'flex-end',
                              }}>
                                <Clock size={14} color="#667085" /> Wait: {waitMinutes}m
                              </div>
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                Status: <strong style={{ color: 'var(--text-primary)' }}>{item.status}</strong>
                              </span>
                            </div>

                            {/* Emergency Bypass Action */}
                            <button
                              onClick={() => handleEmergencyTrigger(item.id)}
                              title="Trigger Immediate Emergency Bypass"
                              style={{
                                background: 'var(--color-danger-bg)',
                                color: 'var(--color-danger)',
                                border: '1px solid var(--color-danger-border)',
                                borderRadius: 6,
                                padding: '0.45rem 0.85rem',
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.4rem',
                                transition: 'all 0.15s ease',
                              }}
                              onMouseEnter={e => {
                                e.currentTarget.style.background = '#FEE2E2';
                                e.currentTarget.style.borderColor = '#F87171';
                              }}
                              onMouseLeave={e => {
                                e.currentTarget.style.background = 'var(--color-danger-bg)';
                                e.currentTarget.style.borderColor = 'var(--color-danger-border)';
                              }}
                            >
                              <ShieldAlert size={15} /> Emergency
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Emergency Bypass & Reassessment Watchlist */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {/* Emergency Pathway Panel */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <ShieldAlert size={20} color="#DC2626" />
                  <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--color-danger)' }}>
                    Emergency Bypass ({emergencies.filter(e => e.emergencyStatus === EMERGENCY_STATUS.ACTIVE).length})
                  </h2>
                </div>

                <div
                  className="light-card"
                  style={{
                    padding: '1.25rem',
                    border: '1px solid var(--color-danger-border)',
                    background: '#FFFFFF',
                  }}
                >
                  {emergencies.filter(e => e.emergencyStatus === EMERGENCY_STATUS.ACTIVE).length === 0 ? (
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textAlign: 'center', padding: '1.5rem' }}>
                      No active emergency bypass activations.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                      {emergencies.filter(e => e.emergencyStatus === EMERGENCY_STATUS.ACTIVE).map(emg => (
                        <div
                          key={emg.id}
                          className="pulse-emergency"
                          style={{
                            background: 'var(--color-danger-bg)',
                            border: '1px solid var(--color-danger-border)',
                            padding: '0.9rem',
                            borderRadius: 8,
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontWeight: 700, color: 'var(--color-danger)', fontSize: '0.875rem' }}>
                              🚨 Bypassing Ordinary Queue
                            </span>
                            <span style={{ fontSize: '0.75rem', color: '#991B1B', fontWeight: 500 }}>
                              {new Date(emg.activatedAt).toLocaleTimeString()}
                            </span>
                          </div>
                          <p style={{ fontSize: '0.825rem', marginTop: '0.35rem', color: '#7F1D1D' }}>
                            Clinical Reason: <strong>{emg.reason}</strong>
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Reassessment Watchlist Panel */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <Clock size={20} color="#B45309" />
                  <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--color-warning)' }}>
                    Reassessment Watchlist ({reassessments.length})
                  </h2>
                </div>

                <div
                  className="light-card"
                  style={{
                    padding: '1.25rem',
                    border: '1px solid var(--color-warning-border)',
                    background: '#FFFFFF',
                  }}
                >
                  {reassessments.length === 0 ? (
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textAlign: 'center', padding: '1.5rem' }}>
                      No active patients with pending reassessment tasks.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                      {reassessments.map(t => {
                        const isOverdue = t.status === 'OVERDUE';
                        return (
                          <div
                            key={t.encounterId}
                            style={{
                              background: isOverdue ? 'var(--color-danger-bg)' : 'var(--color-warning-bg)',
                              border: `1px solid ${isOverdue ? 'var(--color-danger-border)' : 'var(--color-warning-border)'}`,
                              padding: '0.85rem 1rem',
                              borderRadius: 8,
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                            }}
                          >
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                                  {t.encounterId}
                                </span>
                                <span style={{
                                  fontSize: '0.7rem',
                                  fontWeight: 800,
                                  color: isOverdue ? 'var(--color-danger)' : 'var(--color-warning)',
                                  textTransform: 'uppercase',
                                }}>
                                  {t.status}
                                </span>
                              </div>
                              <span style={{ fontSize: '0.775rem', color: 'var(--text-secondary)', marginTop: '0.15rem', display: 'inline-block' }}>
                                Current Acuity: <strong style={{ color: 'var(--text-primary)' }}>{t.acuity}</strong>
                              </span>
                            </div>

                            <button
                              onClick={() => {
                                const enc = store.getEncounter(t.encounterId);
                                if (enc) {
                                  setAssessingEnc(enc);
                                  setSelectedAcuity(enc.acuity || 'P3');
                                }
                              }}
                              style={{
                                background: 'var(--color-primary-blue)',
                                color: '#FFFFFF',
                                fontSize: '0.775rem',
                                fontWeight: 600,
                                padding: '0.4rem 0.85rem',
                                borderRadius: 6,
                                transition: 'background 0.15s ease',
                              }}
                              onMouseEnter={e => e.currentTarget.style.background = 'var(--color-blue-hover)'}
                              onMouseLeave={e => e.currentTarget.style.background = 'var(--color-primary-blue)'}
                            >
                              Reassess
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: Patient Intake (Unassessed Registered Encounters) */}
        {activeTab === 'intake' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '1100px', margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <ClipboardList size={22} color="#2563EB" />
                  Patient Intake: Unassessed Registrations ({unassessed.length})
                </h2>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                  Registered encounters awaiting formal clinician triage. Patients enter the prioritized queue ONLY after acuity assignment.
                </p>
              </div>

              {!canPerformAssessment && (
                <div style={{
                  background: 'var(--color-warning-bg)',
                  border: '1px solid var(--color-warning-border)',
                  padding: '0.45rem 0.85rem',
                  borderRadius: 6,
                  fontSize: '0.775rem',
                  color: 'var(--color-warning)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  fontWeight: 500,
                }}>
                  <AlertTriangle size={15} />
                  Switch active role to <strong>ed_triage</strong> or <strong>ed_emergency</strong> to record clinical assessments.
                </div>
              )}
            </div>

            <div className="light-card" style={{ padding: '1.25rem' }}>
              {unassessed.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3.5rem', color: 'var(--text-secondary)' }}>
                  <CheckCircle2 size={36} color="#15803D" style={{ margin: '0 auto 0.75rem' }} />
                  <p style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '1.05rem' }}>
                    No unassessed patients waiting in intake.
                  </p>
                  <p style={{ fontSize: '0.85rem', marginTop: '0.25rem' }}>
                    All registered patients have received a clinician triage category.
                  </p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                  {unassessed.map((enc) => {
                    const arrivalTime = new Date(enc.registeredAt).toLocaleTimeString();
                    return (
                      <div
                        key={enc.id}
                        style={{
                          background: 'var(--bg-card)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 10,
                          padding: '1.15rem',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          boxShadow: 'var(--shadow-sm)',
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                            <span style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--text-primary)' }}>
                              {enc.patientInfo?.name}
                            </span>
                            <span style={{
                              background: 'var(--bg-card-subtle)',
                              color: 'var(--text-secondary)',
                              fontSize: '0.75rem',
                              padding: '0.15rem 0.5rem',
                              borderRadius: 4,
                              fontFamily: 'var(--font-mono)',
                              border: '1px solid var(--border-subtle)',
                            }}>
                              {enc.id}
                            </span>
                            <span style={{
                              background: 'var(--color-warning-bg)',
                              color: 'var(--color-warning)',
                              border: '1px solid var(--color-warning-border)',
                              fontSize: '0.725rem',
                              fontWeight: 700,
                              padding: '0.15rem 0.5rem',
                              borderRadius: 4,
                            }}>
                              Awaiting Clinician Triage
                            </span>
                          </div>

                          <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.4rem', fontSize: '0.825rem', color: 'var(--text-secondary)' }}>
                            <span>DOB: <strong style={{ color: 'var(--text-primary)' }}>{enc.patientInfo?.dob}</strong></span>
                            <span>Gender: <strong style={{ color: 'var(--text-primary)' }}>{enc.patientInfo?.gender}</strong></span>
                            <span>Arrival: <strong style={{ color: 'var(--text-primary)' }}>{arrivalTime}</strong></span>
                            <span>Clerk: <strong style={{ color: 'var(--text-primary)' }}>{enc.registeredByName || enc.registeredBy}</strong></span>
                          </div>

                          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.4rem' }}>
                            Chief Complaint: <strong style={{ color: 'var(--text-primary)' }}>{enc.patientInfo?.chiefComplaint}</strong>
                          </p>
                        </div>

                        <div>
                          <button
                            disabled={!canPerformAssessment}
                            onClick={() => {
                              setAssessingEnc(enc);
                              setSelectedAcuity('P3');
                            }}
                            style={{
                              background: canPerformAssessment ? 'var(--color-primary-blue)' : '#E4E7EC',
                              color: canPerformAssessment ? '#FFFFFF' : '#98A2B3',
                              cursor: canPerformAssessment ? 'pointer' : 'not-allowed',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.5rem',
                              padding: '0.55rem 1.1rem',
                              borderRadius: 8,
                              fontSize: '0.85rem',
                              fontWeight: 600,
                              boxShadow: canPerformAssessment ? '0 1px 3px rgba(37, 99, 235, 0.2)' : 'none',
                              transition: 'all 0.15s ease',
                            }}
                            onMouseEnter={e => {
                              if (canPerformAssessment) e.currentTarget.style.background = 'var(--color-blue-hover)';
                            }}
                            onMouseLeave={e => {
                              if (canPerformAssessment) e.currentTarget.style.background = 'var(--color-primary-blue)';
                            }}
                          >
                            <Stethoscope size={16} /> Triage & Assign Acuity
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: Audit Log & Patient Timeline Viewer */}
        {activeTab === 'audit' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '1100px', margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <History size={22} color="#2563EB" />
                  Audit Trail & Encounter Timeline ({combinedEvents.length} Events)
                </h2>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                  Read-only chronological audit log of all clinical assessments, queue admissions, overrides, and emergency events.
                </p>
              </div>

              {/* Encounter selector filter */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Filter Patient:</span>
                <select
                  value={selectedEncounterFilter}
                  onChange={(e) => setSelectedEncounterFilter(e.target.value)}
                  style={{
                    background: 'var(--bg-card)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-subtle)',
                    padding: '0.45rem 0.85rem',
                    borderRadius: 6,
                    fontSize: '0.825rem',
                    outline: 'none',
                    fontWeight: 500,
                  }}
                >
                  <option value="all">All System Encounters</option>
                  {allEncounterIds.map(id => (
                    <option key={id} value={id}>{id}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="light-card" style={{ padding: '1.25rem', maxHeight: '680px', overflowY: 'auto' }}>
              {combinedEvents.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3.5rem', color: 'var(--text-secondary)' }}>
                  No historical timeline events recorded for this selection.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {combinedEvents.map((evt, idx) => {
                    const isAudit = evt.streamCategory === 'audit';
                    const timeString = new Date(evt.timestamp).toLocaleTimeString();
                    const dateString = new Date(evt.timestamp).toLocaleDateString();

                    return (
                      <div
                        key={evt.id || `evt-${idx}`}
                        style={{
                          background: 'var(--bg-card)',
                          borderLeft: `4px solid ${isAudit ? 'var(--color-warning)' : 'var(--color-primary-blue)'}`,
                          borderTop: '1px solid var(--border-subtle)',
                          borderRight: '1px solid var(--border-subtle)',
                          borderBottom: '1px solid var(--border-subtle)',
                          borderRadius: 8,
                          padding: '1rem',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'flex-start',
                          boxShadow: 'var(--shadow-sm)',
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                            <span style={{
                              background: isAudit ? 'var(--color-warning-bg)' : 'var(--color-blue-subtle)',
                              color: isAudit ? 'var(--color-warning)' : 'var(--color-primary-blue)',
                              border: `1px solid ${isAudit ? 'var(--color-warning-border)' : 'var(--color-blue-border)'}`,
                              fontSize: '0.725rem',
                              fontWeight: 700,
                              padding: '0.15rem 0.5rem',
                              borderRadius: 4,
                              fontFamily: 'var(--font-mono)',
                            }}>
                              {evt.type}
                            </span>
                            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                              Encounter: {evt.encounterId}
                            </span>
                            <span style={{ fontSize: '0.775rem', color: 'var(--text-secondary)' }}>
                              by <strong>{evt.actorName || evt.actorId}</strong> ({evt.actorRole || 'system'})
                            </span>
                          </div>

                          {/* Event Details */}
                          <div style={{ marginTop: '0.45rem', fontSize: '0.825rem', color: 'var(--text-secondary)' }}>
                            {evt.reason && (
                              <p>Justification: <strong style={{ color: 'var(--text-primary)' }}>{evt.reason}</strong></p>
                            )}
                            {evt.data?.acuity && (
                              <p>Assigned Category: <strong style={{ color: 'var(--text-primary)' }}>{evt.data.acuity}</strong> {evt.data.previousAcuity ? `(Previous: ${evt.data.previousAcuity})` : ''}</p>
                            )}
                            {evt.data?.notes && (
                              <p>Clinical Notes: <em style={{ color: 'var(--text-primary)' }}>"{evt.data.notes}"</em></p>
                            )}
                            {evt.data?.patientName && (
                              <p>Patient Name: <strong style={{ color: 'var(--text-primary)' }}>{evt.data.patientName}</strong></p>
                            )}
                            {evt.previousState && evt.newState && (
                              <p>State Transition: {JSON.stringify(evt.previousState)} ➔ {JSON.stringify(evt.newState)}</p>
                            )}
                          </div>
                        </div>

                        <div style={{ textAlign: 'right', fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', fontWeight: 500 }}>
                          <div>{timeString}</div>
                          <div>{dateString}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Register Patient Modal Dialog */}
      {showRegisterModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(16, 24, 40, 0.45)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 50,
          padding: '1rem',
        }}>
          <div className="light-card" style={{ width: '100%', maxWidth: 480, padding: '1.75rem', boxShadow: 'var(--shadow-modal)' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--text-primary)' }}>
              Register New Patient Intake Encounter
            </h3>
            <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ fontSize: '0.825rem', fontWeight: 600, color: 'var(--text-primary)' }}>Full Name</label>
                <input
                  required
                  value={patientName}
                  onChange={e => setPatientName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.65rem 0.75rem',
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-medium)',
                    borderRadius: 6,
                    color: 'var(--text-primary)',
                    marginTop: '0.35rem',
                  }}
                  placeholder="e.g. Anand Varma"
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ fontSize: '0.825rem', fontWeight: 600, color: 'var(--text-primary)' }}>Gender</label>
                  <select
                    value={gender}
                    onChange={e => setGender(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.65rem 0.75rem',
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border-medium)',
                      borderRadius: 6,
                      color: 'var(--text-primary)',
                      marginTop: '0.35rem',
                    }}
                  >
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '0.825rem', fontWeight: 600, color: 'var(--text-primary)' }}>Date of Birth</label>
                  <input
                    type="date"
                    required
                    value={dob}
                    onChange={e => setDob(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.65rem 0.75rem',
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border-medium)',
                      borderRadius: 6,
                      color: 'var(--text-primary)',
                      marginTop: '0.35rem',
                    }}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.825rem', fontWeight: 600, color: 'var(--text-primary)' }}>Chief Complaint</label>
                <textarea
                  required
                  rows={3}
                  value={chiefComplaint}
                  onChange={e => setChiefComplaint(e.target.value)}
                  placeholder="Clinical presentation description..."
                  style={{
                    width: '100%',
                    padding: '0.65rem 0.75rem',
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-medium)',
                    borderRadius: 6,
                    color: 'var(--text-primary)',
                    marginTop: '0.35rem',
                    resize: 'vertical',
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setShowRegisterModal(false)}
                  style={{
                    padding: '0.55rem 1.1rem',
                    borderRadius: 6,
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-medium)',
                    color: 'var(--text-primary)',
                    fontWeight: 600,
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{
                    padding: '0.55rem 1.25rem',
                    borderRadius: 6,
                    background: 'var(--color-primary-blue)',
                    color: '#FFFFFF',
                    fontWeight: 600,
                    boxShadow: '0 1px 3px rgba(37, 99, 235, 0.2)',
                  }}
                >
                  Register Encounter
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Record Clinician Assessment Modal Dialog */}
      {assessingEnc && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(16, 24, 40, 0.45)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 50,
          padding: '1rem',
        }}>
          <div className="light-card" style={{ width: '100%', maxWidth: 480, padding: '1.75rem', boxShadow: 'var(--shadow-modal)' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.4rem', color: 'var(--text-primary)' }}>
              Record Clinician Triage Assessment
            </h3>
            <p style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', marginBottom: '1.1rem' }}>
              Patient: <strong style={{ color: 'var(--text-primary)' }}>{assessingEnc.patientInfo?.name}</strong> ({assessingEnc.id})
            </p>

            <form onSubmit={handleAssessment} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ fontSize: '0.825rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Acuity Category (Clinician Assigned Only — Never Inferred)
                </label>
                <select
                  value={selectedAcuity}
                  onChange={e => setSelectedAcuity(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.65rem 0.75rem',
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-medium)',
                    borderRadius: 6,
                    color: 'var(--text-primary)',
                    marginTop: '0.35rem',
                    fontWeight: 500,
                  }}
                >
                  {Object.entries(ACUITY_CONFIG).map(([key, cfg]) => (
                    <option key={key} value={key} style={{ background: '#FFFFFF', color: '#182230' }}>
                      {key} — {cfg.label} (Priority {cfg.priority})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: '0.825rem', fontWeight: 600, color: 'var(--text-primary)' }}>Clinical Assessment Notes</label>
                <textarea
                  rows={3}
                  value={clinicalNotes}
                  onChange={e => setClinicalNotes(e.target.value)}
                  placeholder="Clinical observations, vital signs, or rationale..."
                  style={{
                    width: '100%',
                    padding: '0.65rem 0.75rem',
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-medium)',
                    borderRadius: 6,
                    color: 'var(--text-primary)',
                    marginTop: '0.35rem',
                    resize: 'vertical',
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setAssessingEnc(null)}
                  style={{
                    padding: '0.55rem 1.1rem',
                    borderRadius: 6,
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-medium)',
                    color: 'var(--text-primary)',
                    fontWeight: 600,
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{
                    padding: '0.55rem 1.25rem',
                    borderRadius: 6,
                    background: 'var(--color-primary-blue)',
                    color: '#FFFFFF',
                    fontWeight: 600,
                    boxShadow: '0 1px 3px rgba(37, 99, 235, 0.2)',
                  }}
                >
                  Confirm Assessment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* AI Patient Assistant Conversational Modal */}
      <PatientAssistantChat
        isOpen={showAssistantModal}
        onClose={() => setShowAssistantModal(false)}
        store={store}
        onRegistrationSuccess={(encounter) => {
          refresh();
          persistChanges();
        }}
      />

      {/* Floating AI Patient Assistant Trigger (WhatsApp-Style) */}
      <button
        onClick={() => setShowAssistantModal(true)}
        title="Open AI Patient Assistant for conversational intake"
        style={{
          position: 'fixed',
          bottom: '1.75rem',
          right: '1.75rem',
          background: 'var(--color-primary-blue)',
          color: '#FFFFFF',
          borderRadius: '28px',
          padding: '0.75rem 1.25rem',
          boxShadow: 'var(--shadow-md)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.6rem',
          fontSize: '0.875rem',
          fontWeight: 700,
          zIndex: 40,
          transition: 'all 0.2s ease',
          border: '1px solid rgba(255, 255, 255, 0.25)',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.transform = 'translateY(-2px)';
          e.currentTarget.style.background = 'var(--color-blue-hover)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.background = 'var(--color-primary-blue)';
        }}
      >
        <Bot size={20} /> AI Intake Assistant
      </button>

      {/* Safety Notice & Regulatory Footer */}
      <footer style={{
        padding: '0.9rem 2rem',
        background: 'var(--bg-card)',
        borderTop: '1px solid var(--border-subtle)',
        fontSize: '0.775rem',
        color: 'var(--text-secondary)',
        textAlign: 'center',
        marginTop: 'auto',
      }}>
        ⚠️ <strong>Demonstration Only (Anvesh '26)</strong>: This is a workflow-support prototype using synthetic demonstration data. It does not provide autonomous diagnosis, predict acuity, or replace clinician judgement. Authorization in prototype uses client role selection and must be backed by verified OIDC tokens prior to clinical deployment.
      </footer>
    </div>
  );
}
