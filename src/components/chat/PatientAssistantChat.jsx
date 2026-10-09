import React, { useState, useEffect, useRef } from 'react';
import {
  CHAT_STEPS,
  detectUrgentSymptoms,
  validateNameInput,
  validateDobInput,
  validateGenderInput,
  validateComplaintInput,
  buildRegistrationPayload,
  createInitialIntakeState,
} from '../../ed/chat/chatIntakeEngine.js';
import {
  Bot, User, Send, ArrowLeft, RotateCcw, X,
  CheckCircle2, AlertTriangle, ShieldAlert, Clock,
  ChevronRight, Sparkles, AlertCircle
} from 'lucide-react';

export default function PatientAssistantChat({ isOpen, onClose, store, onRegistrationSuccess }) {
  const [intake, setIntake] = useState(createInitialIntakeState);
  const [inputText, setInputText] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [messages, setMessages] = useState([]);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Initialize or reset messages when opening
  useEffect(() => {
    if (isOpen) {
      resetChat();
    }
  }, [isOpen]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, intake.step]);

  // Focus input on step change
  useEffect(() => {
    if (
      intake.step === CHAT_STEPS.FULL_NAME ||
      intake.step === CHAT_STEPS.DATE_OF_BIRTH ||
      intake.step === CHAT_STEPS.CHIEF_COMPLAINT
    ) {
      inputRef.current?.focus();
    }
  }, [intake.step]);

  const resetChat = () => {
    const initialState = createInitialIntakeState();
    setIntake(initialState);
    setInputText('');
    setFieldError('');
    setMessages([
      {
        id: 'msg-1',
        sender: 'assistant',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        text: '👋 Hello! I am your AI Patient Assistant for Emergency Intake.',
      },
      {
        id: 'msg-2',
        sender: 'assistant',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        text: 'I can help register your arrival so the clinical team can triage you. ⚠️ Disclaimer: This is an intake-support assistant, not a clinical diagnosis system. Acuity is assigned strictly by human clinicians upon physical assessment.',
      },
      {
        id: 'msg-3',
        sender: 'assistant',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        text: 'Are you registering for yourself or on behalf of someone else?',
      },
    ]);
  };

  if (!isOpen) return null;

  // Add assistant response to message stream
  const addAssistantMessage = (text, options = {}) => {
    setMessages(prev => [
      ...prev,
      {
        id: `msg-${Date.now()}-${Math.random()}`,
        sender: 'assistant',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        text,
        ...options,
      },
    ]);
  };

  // Add patient message to stream
  const addPatientMessage = (text) => {
    setMessages(prev => [
      ...prev,
      {
        id: `msg-${Date.now()}-${Math.random()}`,
        sender: 'patient',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        text,
      },
    ]);
  };

  // Step 1 -> Step 2: Handle Self vs. Other
  const handleSelectTarget = (targetType) => {
    const label = targetType === 'self' ? 'Registering for myself' : 'Registering for someone else';
    addPatientMessage(label);

    setIntake(prev => ({
      ...prev,
      target: targetType,
      step: CHAT_STEPS.FULL_NAME,
      history: [...prev.history, prev.step],
    }));

    setTimeout(() => {
      addAssistantMessage(
        targetType === 'self'
          ? 'Great. What is your full legal name?'
          : 'Understood. What is the patient’s full legal name?'
      );
    }, 200);
  };

  // Step 2 -> Step 3: Handle Name
  const handleNameSubmit = (e) => {
    e?.preventDefault();
    const result = validateNameInput(inputText);
    if (!result.valid) {
      setFieldError(result.error);
      return;
    }
    setFieldError('');
    addPatientMessage(result.normalized);

    setIntake(prev => ({
      ...prev,
      name: result.normalized,
      step: CHAT_STEPS.DATE_OF_BIRTH,
      history: [...prev.history, prev.step],
    }));
    setInputText('');

    setTimeout(() => {
      addAssistantMessage(
        `Thank you, ${result.normalized}. What is the date of birth? (Please format as YYYY-MM-DD, e.g. 1990-05-15)`
      );
    }, 200);
  };

  // Step 3 -> Step 4: Handle Date of Birth
  const handleDobSubmit = (e) => {
    e?.preventDefault();
    const result = validateDobInput(inputText);
    if (!result.valid) {
      setFieldError(result.error);
      return;
    }
    setFieldError('');
    addPatientMessage(result.normalized);

    setIntake(prev => ({
      ...prev,
      dob: result.normalized,
      step: CHAT_STEPS.GENDER,
      history: [...prev.history, prev.step],
    }));
    setInputText('');

    setTimeout(() => {
      addAssistantMessage('Please select the legal or recorded gender:');
    }, 200);
  };

  // Step 4 -> Step 5: Handle Gender Selection
  const handleSelectGender = (genderVal) => {
    const labels = {
      female: 'Female',
      male: 'Male',
      other: 'Other',
      prefer_not_to_say: 'Prefer not to say',
    };
    addPatientMessage(labels[genderVal] || genderVal);

    setIntake(prev => ({
      ...prev,
      gender: genderVal,
      step: CHAT_STEPS.CHIEF_COMPLAINT,
      history: [...prev.history, prev.step],
    }));

    setTimeout(() => {
      addAssistantMessage(
        'Please describe the main symptoms or reason for visiting the Emergency Department today in your own words:'
      );
    }, 200);
  };

  // Step 5 -> Step 6: Handle Chief Complaint & Urgent Screening
  const handleComplaintSubmit = (e) => {
    e?.preventDefault();
    const result = validateComplaintInput(inputText);
    if (!result.valid) {
      setFieldError(result.error);
      return;
    }
    setFieldError('');
    addPatientMessage(result.normalized);

    const isUrgent = result.isUrgent;
    const urgentCategories = result.urgentCategories;

    setIntake(prev => ({
      ...prev,
      chiefComplaint: result.normalized,
      isUrgent,
      urgentCategories,
      step: CHAT_STEPS.REVIEW_SUMMARY,
      history: [...prev.history, prev.step],
    }));
    setInputText('');

    setTimeout(() => {
      if (isUrgent) {
        addAssistantMessage(
          `🚨 URGENT SYMPTOMS DETECTED (${urgentCategories.join(', ')}):\n` +
          `Your described presentation includes critical warning signs. Please notify the Triage Nurse or nearest staff immediately!\n` +
          `We will proceed to register your intake record so clinicians can see it promptly.`,
          { isUrgentAlert: true }
        );
      }
      addAssistantMessage(
        'Please review your registration summary below and confirm when ready:'
      );
    }, 200);
  };

  // Handle Back Navigation
  const handleGoBack = () => {
    if (intake.history.length === 0 || intake.step === CHAT_STEPS.CONFIRMED) return;
    const prevHistory = [...intake.history];
    const prevStep = prevHistory.pop();

    setFieldError('');
    setIntake(prev => ({
      ...prev,
      step: prevStep,
      history: prevHistory,
    }));

    addAssistantMessage(`Went back to edit ${prevStep.replace('_', ' ')}.`);
  };

  // Final Confirmation & Submission to Store
  const handleConfirmRegistration = () => {
    if (intake.isSubmitting) return;

    setIntake(prev => ({ ...prev, isSubmitting: true, error: null }));

    try {
      const payload = buildRegistrationPayload(intake);
      const enc = store.registerEncounter(payload);

      setIntake(prev => ({
        ...prev,
        step: CHAT_STEPS.CONFIRMED,
        encounterId: enc.id,
        isSubmitting: false,
      }));

      addAssistantMessage(
        `✅ Registration Successful! Your Encounter ID is ${enc.id}.\n\n` +
        `Your record is now active in the Patient Intake queue. Please have a seat in the waiting area. A triage clinician will call you shortly for vital signs and physical triage assessment.`
      );

      // Trigger store refresh & persistence
      if (typeof onRegistrationSuccess === 'function') {
        onRegistrationSuccess(enc);
      }
    } catch (err) {
      setIntake(prev => ({
        ...prev,
        isSubmitting: false,
        error: err.message || 'Failed to register encounter.',
      }));
      setFieldError(`Registration error: ${err.message}`);
    }
  };

  // Calculate Progress Percent
  const getProgress = () => {
    switch (intake.step) {
      case CHAT_STEPS.WELCOME: return 10;
      case CHAT_STEPS.FULL_NAME: return 25;
      case CHAT_STEPS.DATE_OF_BIRTH: return 50;
      case CHAT_STEPS.GENDER: return 70;
      case CHAT_STEPS.CHIEF_COMPLAINT: return 85;
      case CHAT_STEPS.REVIEW_SUMMARY: return 95;
      case CHAT_STEPS.CONFIRMED: return 100;
      default: return 0;
    }
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(16, 24, 40, 0.55)',
      backdropFilter: 'blur(5px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 100,
      padding: '1rem',
    }}>
      <div style={{
        background: '#FFFFFF',
        width: '100%',
        maxWidth: '560px',
        height: '90vh',
        maxHeight: '740px',
        borderRadius: '16px',
        boxShadow: 'var(--shadow-modal)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        border: '1px solid var(--border-subtle)',
      }}>
        {/* WhatsApp-Style Header */}
        <div style={{
          background: '#FFFFFF',
          borderBottom: '1px solid var(--border-subtle)',
          padding: '0.85rem 1.25rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: 'var(--color-blue-subtle)',
              border: '1px solid var(--color-blue-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--color-primary-blue)',
            }}>
              <Bot size={22} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  AI Patient Assistant
                </h3>
                <span style={{
                  background: 'var(--color-success-bg)',
                  color: 'var(--color-success)',
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  padding: '0.1rem 0.4rem',
                  borderRadius: 4,
                  border: '1px solid var(--color-success-border)',
                }}>
                  ONLINE
                </span>
              </div>
              <p style={{ fontSize: '0.725rem', color: 'var(--text-secondary)' }}>
                Guided Emergency Intake • WhatsApp Mode Prototype
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {intake.history.length > 0 && intake.step !== CHAT_STEPS.CONFIRMED && (
              <button
                onClick={handleGoBack}
                title="Go back to previous question"
                style={{
                  padding: '0.4rem 0.6rem',
                  borderRadius: 6,
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  fontSize: '0.75rem',
                  fontWeight: 500,
                }}
              >
                <ArrowLeft size={13} /> Back
              </button>
            )}

            <button
              onClick={resetChat}
              title="Restart registration from beginning"
              style={{
                padding: '0.4rem',
                borderRadius: 6,
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-secondary)',
              }}
            >
              <RotateCcw size={15} />
            </button>

            <button
              onClick={onClose}
              title="Close assistant"
              style={{
                padding: '0.4rem',
                borderRadius: 6,
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-secondary)',
              }}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Top Progress Bar */}
        <div style={{ width: '100%', height: 4, background: 'var(--bg-primary)' }}>
          <div style={{
            height: '100%',
            width: `${getProgress()}%`,
            background: 'var(--color-primary-blue)',
            transition: 'width 0.3s ease',
          }} />
        </div>

        {/* Urgent Warning Sticky Banner if symptoms detected */}
        {intake.isUrgent && (
          <div style={{
            background: 'var(--color-danger-bg)',
            borderBottom: '1px solid var(--color-danger-border)',
            padding: '0.6rem 1.25rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            fontSize: '0.775rem',
            color: 'var(--color-danger)',
            fontWeight: 600,
          }}>
            <ShieldAlert size={18} style={{ flexShrink: 0 }} />
            <span>
              URGENT SYMPTOM ADVISORY: Potential critical signs reported ({intake.urgentCategories.join(', ')}). Please alert the triage nurse directly!
            </span>
          </div>
        )}

        {/* Message Stream */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '1.25rem',
          background: 'var(--bg-primary)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.85rem',
        }}>
          {messages.map((m) => {
            const isPatient = m.sender === 'patient';
            return (
              <div
                key={m.id}
                style={{
                  display: 'flex',
                  justifyContent: isPatient ? 'flex-end' : 'flex-start',
                }}
              >
                <div style={{
                  maxWidth: '82%',
                  background: isPatient ? 'var(--color-primary-blue)' : m.isUrgentAlert ? 'var(--color-danger-bg)' : '#FFFFFF',
                  color: isPatient ? '#FFFFFF' : m.isUrgentAlert ? 'var(--color-danger)' : 'var(--text-primary)',
                  border: isPatient ? 'none' : `1px solid ${m.isUrgentAlert ? 'var(--color-danger-border)' : 'var(--border-subtle)'}`,
                  borderRadius: isPatient ? '14px 14px 2px 14px' : '14px 14px 14px 2px',
                  padding: '0.75rem 1rem',
                  boxShadow: 'var(--shadow-sm)',
                  fontSize: '0.875rem',
                  lineHeight: 1.45,
                  whiteSpace: 'pre-wrap',
                }}>
                  {m.text}
                  <div style={{
                    fontSize: '0.65rem',
                    color: isPatient ? 'rgba(255, 255, 255, 0.75)' : 'var(--text-muted)',
                    textAlign: 'right',
                    marginTop: '0.25rem',
                  }}>
                    {m.time}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Step-Specific Interactive Action Card at bottom of stream */}
          {intake.step === CHAT_STEPS.WELCOME && (
            <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
              <button
                onClick={() => handleSelectTarget('self')}
                style={{
                  background: 'var(--color-primary-blue)',
                  color: '#FFFFFF',
                  padding: '0.55rem 1.1rem',
                  borderRadius: 20,
                  fontSize: '0.825rem',
                  fontWeight: 600,
                  boxShadow: 'var(--shadow-sm)',
                }}
              >
                🙋 Register for Myself
              </button>
              <button
                onClick={() => handleSelectTarget('other')}
                style={{
                  background: '#FFFFFF',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-subtle)',
                  padding: '0.55rem 1.1rem',
                  borderRadius: 20,
                  fontSize: '0.825rem',
                  fontWeight: 600,
                  boxShadow: 'var(--shadow-sm)',
                }}
              >
                👥 Register for Someone Else
              </button>
            </div>
          )}

          {intake.step === CHAT_STEPS.GENDER && (
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
              {['female', 'male', 'other', 'prefer_not_to_say'].map((g) => (
                <button
                  key={g}
                  onClick={() => handleSelectGender(g)}
                  style={{
                    background: '#FFFFFF',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-medium)',
                    padding: '0.45rem 1rem',
                    borderRadius: 20,
                    fontSize: '0.825rem',
                    fontWeight: 600,
                    textTransform: 'capitalize',
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--color-primary-blue)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-medium)'}
                >
                  {g.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
          )}

          {intake.step === CHAT_STEPS.REVIEW_SUMMARY && (
            <div style={{
              background: '#FFFFFF',
              border: '1px solid var(--border-subtle)',
              borderRadius: 12,
              padding: '1.1rem',
              boxShadow: 'var(--shadow-sm)',
              marginTop: '0.5rem',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <h4 style={{ fontSize: '0.925rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  📋 Registration Intake Summary
                </h4>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Review before submitting</span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Patient Name:</span>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{intake.name}</div>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Date of Birth:</span>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{intake.dob}</div>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Gender:</span>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', textTransform: 'capitalize' }}>
                    {intake.gender.replace(/_/g, ' ')}
                  </div>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Target:</span>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', textTransform: 'capitalize' }}>
                    {intake.target}
                  </div>
                </div>
              </div>

              <div style={{ marginTop: '0.75rem', fontSize: '0.8rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Chief Complaint:</span>
                <div style={{
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  background: 'var(--bg-primary)',
                  padding: '0.5rem',
                  borderRadius: 6,
                  marginTop: '0.2rem',
                }}>
                  {intake.chiefComplaint}
                </div>
              </div>

              {intake.error && (
                <div style={{
                  color: 'var(--color-danger)',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  marginTop: '0.6rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                }}>
                  <AlertCircle size={14} /> {intake.error}
                </div>
              )}

              <div style={{ display: 'flex', gap: '0.65rem', marginTop: '1rem', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={handleGoBack}
                  disabled={intake.isSubmitting}
                  style={{
                    padding: '0.5rem 1rem',
                    borderRadius: 8,
                    background: '#FFFFFF',
                    border: '1px solid var(--border-medium)',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                  }}
                >
                  Edit Answers
                </button>
                <button
                  type="button"
                  onClick={handleConfirmRegistration}
                  disabled={intake.isSubmitting}
                  style={{
                    padding: '0.5rem 1.25rem',
                    borderRadius: 8,
                    background: intake.isSubmitting ? 'var(--text-muted)' : 'var(--color-primary-blue)',
                    color: '#FFFFFF',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    boxShadow: 'var(--shadow-sm)',
                    cursor: intake.isSubmitting ? 'not-allowed' : 'pointer',
                  }}
                >
                  {intake.isSubmitting ? 'Registering...' : 'Confirm & Register'}
                </button>
              </div>
            </div>
          )}

          {intake.step === CHAT_STEPS.CONFIRMED && (
            <div style={{
              background: '#FFFFFF',
              border: '1px solid var(--color-success-border)',
              borderRadius: 12,
              padding: '1.25rem',
              boxShadow: 'var(--shadow-sm)',
              textAlign: 'center',
              marginTop: '0.5rem',
            }}>
              <CheckCircle2 size={36} color="#15803D" style={{ margin: '0 auto 0.5rem' }} />
              <h4 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Intake Encounter Generated
              </h4>
              <div style={{
                fontSize: '1.2rem',
                fontWeight: 800,
                color: 'var(--color-primary-blue)',
                fontFamily: 'var(--font-mono)',
                margin: '0.4rem 0',
              }}>
                {intake.encounterId}
              </div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.4rem 0 1rem' }}>
                Your record is now queued in <strong>Patient Intake</strong>. Acuity has NOT yet been assigned; clinical evaluation will take place in person.
              </p>
              <button
                onClick={onClose}
                style={{
                  padding: '0.5rem 1.25rem',
                  borderRadius: 8,
                  background: 'var(--color-primary-blue)',
                  color: '#FFFFFF',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                }}
              >
                Close & View Dashboard
              </button>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Bottom Input Box for Free-Text Steps */}
        {(intake.step === CHAT_STEPS.FULL_NAME ||
          intake.step === CHAT_STEPS.DATE_OF_BIRTH ||
          intake.step === CHAT_STEPS.CHIEF_COMPLAINT) && (
          <div style={{
            background: '#FFFFFF',
            borderTop: '1px solid var(--border-subtle)',
            padding: '0.85rem 1.25rem',
          }}>
            {fieldError && (
              <div style={{
                color: 'var(--color-danger)',
                fontSize: '0.75rem',
                fontWeight: 600,
                marginBottom: '0.45rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
              }}>
                <AlertCircle size={14} /> {fieldError}
              </div>
            )}

            <form
              onSubmit={(e) => {
                if (intake.step === CHAT_STEPS.FULL_NAME) handleNameSubmit(e);
                else if (intake.step === CHAT_STEPS.DATE_OF_BIRTH) handleDobSubmit(e);
                else if (intake.step === CHAT_STEPS.CHIEF_COMPLAINT) handleComplaintSubmit(e);
              }}
              style={{ display: 'flex', gap: '0.65rem' }}
            >
              <input
                ref={inputRef}
                value={inputText}
                onChange={e => {
                  setInputText(e.target.value);
                  if (fieldError) setFieldError('');
                }}
                placeholder={
                  intake.step === CHAT_STEPS.FULL_NAME
                    ? 'Type patient’s full name...'
                    : intake.step === CHAT_STEPS.DATE_OF_BIRTH
                    ? 'YYYY-MM-DD (e.g. 1990-05-15)...'
                    : 'Describe chief complaint / symptoms...'
                }
                style={{
                  flex: 1,
                  padding: '0.65rem 0.85rem',
                  borderRadius: 8,
                  border: `1px solid ${fieldError ? 'var(--color-danger)' : 'var(--border-medium)'}`,
                  fontSize: '0.85rem',
                  outline: 'none',
                }}
              />
              <button
                type="submit"
                style={{
                  background: 'var(--color-primary-blue)',
                  color: '#FFFFFF',
                  padding: '0.65rem 1rem',
                  borderRadius: 8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 600,
                }}
              >
                <Send size={16} />
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
