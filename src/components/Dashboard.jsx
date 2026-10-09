/**
 * Dashboard.jsx — Premium glassmorphism layout shell.
 *
 * This component owns ONLY the visual layout: sidebar, topbar, stat cards,
 * welcome banner, quick-action cards, and the nav sub-header.
 * All business logic, state, handlers, and modals remain in App.jsx and are
 * received as props. No data is fabricated here — empty states are shown when
 * data arrays are empty.
 *
 * Scope: UI-ONLY. Do not add data-fetching, store access, or business logic.
 */

import React, { useState } from 'react';
import {
  Activity, Users, ShieldAlert, Clock, ClipboardList, History,
  UserPlus, Bot, RefreshCw, Database, Menu, X,
  Stethoscope, Bell, ChevronRight, LayoutDashboard,
} from 'lucide-react';
import { PERSISTENCE_STATUS } from '../ed/db/edPersistence.js';

/* ── helpers ──────────────────────────────────────────────────────────────── */

function StatCard({ icon, label, value, sub, accent }) {
  const accentMap = {
    blue:    { bg: 'var(--color-primary-light)', color: 'var(--color-primary)', border: 'var(--color-primary-border)' },
    red:     { bg: 'rgba(254,242,242,0.80)',     color: '#DC2626',              border: '#FECACA' },
    amber:   { bg: 'rgba(254,243,199,0.80)',     color: '#B45309',              border: '#FCD34D' },
    green:   { bg: 'rgba(240,253,244,0.80)',     color: '#15803D',              border: '#86EFAC' },
  };
  const a = accentMap[accent] || accentMap.blue;

  return (
    <div className="stat-card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div
          className="icon-bubble"
          style={{ background: a.bg, border: `1px solid ${a.border}` }}
        >
          {React.cloneElement(icon, { size: 20, color: a.color })}
        </div>
        <span style={{
          fontSize: '0.72rem', fontWeight: 700, color: a.color,
          background: a.bg, border: `1px solid ${a.border}`,
          padding: '0.15rem 0.55rem', borderRadius: 'var(--radius-pill)',
          textTransform: 'uppercase', letterSpacing: '0.04em',
        }}>Live</span>
      </div>
      <div>
        <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.1 }}>
          {value}
        </div>
        <div style={{ fontSize: '0.825rem', fontWeight: 600, color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
          {label}
        </div>
        {sub && (
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}

function SidebarNavItem({ icon, label, badge, active, onClick }) {
  return (
    <button
      className={`sidebar-nav-item${active ? ' active' : ''}`}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
    >
      {icon}
      <span style={{ flex: 1 }}>{label}</span>
      {badge != null && badge > 0 && (
        <span className="nav-badge">{badge}</span>
      )}
    </button>
  );
}

function PersistenceChip({ status, lastSavedAt }) {
  const map = {
    [PERSISTENCE_STATUS.SAVING]: { text: 'Saving…',      color: '#2878E8' },
    [PERSISTENCE_STATUS.SAVED]:  { text: 'Synced',        color: '#15803D' },
    [PERSISTENCE_STATUS.ERROR]:  { text: 'Save Error',    color: '#DC2626' },
    [PERSISTENCE_STATUS.IDLE]:   { text: 'Storage Active', color: '#5A6B87' },
  };
  const info = map[status] || map[PERSISTENCE_STATUS.IDLE];

  return (
    <div title="Encounters, assessments and events persist in browser localStorage." style={{
      display: 'flex', alignItems: 'center', gap: '0.4rem',
      background: 'var(--glass-bg-strong)', border: '1px solid var(--glass-border)',
      padding: '0.4rem 0.75rem', borderRadius: 'var(--radius-sm)',
      fontSize: '0.75rem', fontWeight: 600, color: info.color,
    }}>
      <Database size={14} color={info.color} />
      {info.text}
    </div>
  );
}

/* ── Main component ───────────────────────────────────────────────────────── */

export default function Dashboard({
  /* navigation */
  activeTab, setActiveTab,
  /* role */
  currentRole, setCurrentRole, roleOptions,
  /* data */
  queue, emergencies, reassessments, unassessed, combinedEvents,
  /* modals */
  onOpenRegister, onOpenAssistant, onResetData,
  /* persistence */
  persistenceState,
  /* children = tab content */
  children,
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const activeEmergencies = emergencies.filter(e => e.emergencyStatus === 'ACTIVE').length;
  const totalPatients = queue.length + emergencies.length + unassessed.length;

  const navItems = [
    {
      key: 'queue',
      label: 'Waiting Queue',
      icon: <Users size={17} />,
      badge: queue.length,
    },
    {
      key: 'intake',
      label: 'Patient Intake',
      icon: <ClipboardList size={17} />,
      badge: unassessed.length,
    },
    {
      key: 'audit',
      label: 'Audit Trail',
      icon: <History size={17} />,
      badge: null,
    },
  ];

  return (
    <div className="app-layout">
      {/* ── Mobile sidebar overlay ── */}
      {sidebarOpen && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15,28,53,0.35)',
            backdropFilter: 'blur(4px)', zIndex: 45,
          }}
          onClick={() => setSidebarOpen(false)}
          aria-label="Close sidebar"
        />
      )}

      {/* ══════════════════════════ SIDEBAR ══════════════════════════════ */}
      <aside className={`app-sidebar${sidebarOpen ? ' open' : ''}`} aria-label="Primary navigation">
        {/* Logo */}
        <div className="app-sidebar-logo">
          <div style={{
            background: 'var(--color-primary-light)',
            border: '1px solid var(--color-primary-border)',
            borderRadius: 10,
            width: 36, height: 36,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Activity size={20} color="var(--color-primary)" />
          </div>
          <div>
            <div style={{ fontSize: '0.875rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.2, letterSpacing: '-0.02em' }}>
              Smart Patient Queue
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
              Emergency Triage
            </div>
          </div>
        </div>

        {/* Nav items */}
        <nav className="app-sidebar-nav" aria-label="Main views">
          <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', padding: '0.25rem 0.9rem 0.5rem', marginTop: '0.25rem' }}>
            Views
          </div>

          {navItems.map(item => (
            <SidebarNavItem
              key={item.key}
              icon={item.icon}
              label={item.label}
              badge={item.badge}
              active={activeTab === item.key}
              onClick={() => { setActiveTab(item.key); setSidebarOpen(false); }}
            />
          ))}

          <div style={{ height: '1px', background: 'var(--glass-border)', margin: '0.75rem 0.5rem' }} />

          <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', padding: '0.25rem 0.9rem 0.5rem' }}>
            Quick Actions
          </div>

          <SidebarNavItem
            icon={<UserPlus size={17} />}
            label="Register Patient"
            onClick={() => { onOpenRegister(); setSidebarOpen(false); }}
          />

          <SidebarNavItem
            icon={<Bot size={17} />}
            label="AI Assistant Intake"
            onClick={() => { onOpenAssistant(); setSidebarOpen(false); }}
          />

          <SidebarNavItem
            icon={<RefreshCw size={17} />}
            label="Reset Demo Data"
            onClick={() => { onResetData(); setSidebarOpen(false); }}
          />
        </nav>

        {/* Sidebar footer */}
        <div className="app-sidebar-footer">
          <div style={{ fontWeight: 700, color: 'var(--text-secondary)', fontSize: '0.75rem', marginBottom: '0.2rem' }}>
            Anvesh '26
          </div>
          <div style={{ lineHeight: 1.4 }}>
            Demonstration prototype only. Not for clinical use.
          </div>
        </div>
      </aside>

      {/* ══════════════════════════ MAIN BODY ════════════════════════════ */}
      <div className="app-body">

        {/* ── TOP BAR ── */}
        <header className="app-topbar">
          {/* Mobile hamburger */}
          <button
            id="sidebar-toggle"
            aria-label="Toggle navigation sidebar"
            onClick={() => setSidebarOpen(o => !o)}
            style={{
              display: 'none', alignItems: 'center', justifyContent: 'center',
              width: 36, height: 36, borderRadius: 'var(--radius-sm)',
              background: 'var(--glass-bg-strong)', border: '1px solid var(--glass-border)',
            }}
            className="mobile-sidebar-btn"
          >
            {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
          </button>

          {/* Page title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <div style={{
              background: 'var(--color-primary-light)',
              border: '1px solid var(--color-primary-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '0.4rem',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <LayoutDashboard size={18} color="var(--color-primary)" />
            </div>
            <div>
              <h1 style={{ fontSize: '1.05rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)', lineHeight: 1 }}>
                Smart Patient Queue &amp; Emergency Triage
              </h1>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                Deterministic Acuity Triage · Clinical Workflow Support
              </p>
            </div>
            <span style={{
              background: 'var(--color-primary-light)', color: 'var(--color-primary)',
              border: '1px solid var(--color-primary-border)',
              borderRadius: 'var(--radius-pill)', fontSize: '0.7rem', fontWeight: 800,
              padding: '0.15rem 0.6rem', letterSpacing: '0.02em',
            }}>
              Anvesh '26
            </span>
          </div>

          {/* Right-side topbar controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {/* Persistence chip */}
            <PersistenceChip
              status={persistenceState.status}
              lastSavedAt={persistenceState.lastSavedAt}
            />

            {/* Emergency alert indicator */}
            {activeEmergencies > 0 && (
              <div className="pulse-emergency" style={{
                display: 'flex', alignItems: 'center', gap: '0.4rem',
                background: 'rgba(254,242,242,0.85)', border: '1px solid #FECACA',
                padding: '0.4rem 0.75rem', borderRadius: 'var(--radius-sm)',
                fontSize: '0.775rem', fontWeight: 700, color: '#DC2626',
              }}>
                <ShieldAlert size={14} />
                {activeEmergencies} Emergency Active
              </div>
            )}

            {/* Role selector */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '0.4rem',
              background: 'var(--glass-bg-strong)', border: '1px solid var(--glass-border)',
              padding: '0.4rem 0.75rem', borderRadius: 'var(--radius-sm)',
            }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Role:</span>
              <select
                id="role-selector"
                value={currentRole}
                onChange={e => setCurrentRole(e.target.value)}
                style={{
                  background: 'transparent', color: 'var(--text-primary)',
                  border: 'none', outline: 'none',
                  fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer',
                }}
              >
                {roleOptions.map(r => (
                  <option key={r} value={r} style={{ background: '#FFFFFF', color: '#0F1C35' }}>{r}</option>
                ))}
              </select>
            </div>

            {/* AI Assistant button */}
            <button
              id="ai-assistant-topbar-btn"
              onClick={onOpenAssistant}
              className="btn-secondary"
              style={{ fontSize: '0.82rem' }}
            >
              <Bot size={15} /> AI Intake
            </button>

            {/* Register patient button */}
            <button
              id="register-patient-topbar-btn"
              onClick={onOpenRegister}
              className="btn-primary"
              style={{ fontSize: '0.82rem' }}
            >
              <UserPlus size={15} /> Register Patient
            </button>

            {/* Reset demo */}
            <button
              id="reset-demo-btn"
              onClick={onResetData}
              title="Reset to fresh synthetic demonstration data"
              style={{
                background: 'var(--glass-bg-strong)', border: '1px solid var(--glass-border)',
                color: 'var(--text-secondary)', padding: '0.4rem 0.7rem',
                borderRadius: 'var(--radius-sm)', fontSize: '0.75rem', fontWeight: 500,
              }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.borderColor = 'var(--glass-border-hover)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--glass-border)'; }}
            >
              Reset Demo
            </button>
          </div>
        </header>

        {/* ── NAV TABS (horizontal sub-nav) ── */}
        <nav className="app-nav-tabs" aria-label="Dashboard views">
          {navItems.map(item => (
            <button
              key={item.key}
              id={`nav-tab-${item.key}`}
              className={`nav-tab${activeTab === item.key ? ' active' : ''}`}
              onClick={() => setActiveTab(item.key)}
            >
              {item.icon}
              {item.label}
              {item.badge != null && item.badge > 0 && (
                <span style={{
                  background: activeTab === item.key ? 'var(--color-primary)' : 'var(--text-muted)',
                  color: '#fff', fontSize: '0.7rem', fontWeight: 700,
                  padding: '0.05rem 0.45rem', borderRadius: 'var(--radius-pill)',
                  minWidth: 18, textAlign: 'center',
                }}>
                  {item.badge}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* ── MAIN CONTENT ── */}
        <main className="app-main-content" id="main-content" aria-label="Dashboard content">

          {/* Welcome banner (only on queue tab) */}
          {activeTab === 'queue' && (
            <div className="welcome-banner fade-in-up">
              <div>
                <p style={{ fontSize: '0.8rem', fontWeight: 600, opacity: 0.75, marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Emergency Operations Dashboard
                </p>
                <h2 style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.15 }}>
                  Good {getGreeting()}, Active Clinician
                </h2>
                <p style={{ fontSize: '0.875rem', opacity: 0.80, marginTop: '0.4rem' }}>
                  {totalPatients > 0
                    ? `${totalPatients} patient encounter${totalPatients > 1 ? 's' : ''} active across all pathways`
                    : 'No active patient encounters — register a new patient to begin'}
                </p>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', zIndex: 1, flexShrink: 0 }}>
                <button
                  onClick={onOpenRegister}
                  style={{
                    background: 'rgba(255,255,255,0.18)', backdropFilter: 'blur(8px)',
                    border: '1px solid rgba(255,255,255,0.30)', color: '#fff',
                    padding: '0.6rem 1.2rem', borderRadius: 'var(--radius-sm)',
                    fontWeight: 700, fontSize: '0.875rem',
                    display: 'flex', alignItems: 'center', gap: '0.45rem',
                    transition: 'background 0.15s ease',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.28)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.18)'}
                >
                  <UserPlus size={16} /> Register Patient
                </button>
                <button
                  onClick={onOpenAssistant}
                  style={{
                    background: 'rgba(255,255,255,0.12)', backdropFilter: 'blur(8px)',
                    border: '1px solid rgba(255,255,255,0.22)', color: '#fff',
                    padding: '0.6rem 1.2rem', borderRadius: 'var(--radius-sm)',
                    fontWeight: 600, fontSize: '0.875rem',
                    display: 'flex', alignItems: 'center', gap: '0.45rem',
                    transition: 'background 0.15s ease',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.22)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
                >
                  <Bot size={16} /> AI Intake
                </button>
              </div>
            </div>
          )}

          {/* Summary stat cards (only on queue tab) */}
          {activeTab === 'queue' && (
            <div className="stats-grid fade-in-up">
              <StatCard
                icon={<Users />}
                label="Total Active Encounters"
                value={totalPatients}
                sub="Across all pathways"
                accent="blue"
              />
              <StatCard
                icon={<Clock />}
                label="Waiting in Queue"
                value={queue.length}
                sub={queue.length > 0 ? 'Prioritized P1 → P5' : 'Queue clear'}
                accent="amber"
              />
              <StatCard
                icon={<ShieldAlert />}
                label="Emergency Bypass"
                value={activeEmergencies}
                sub={activeEmergencies > 0 ? 'Requires immediate attention' : 'No active emergencies'}
                accent="red"
              />
              <StatCard
                icon={<ClipboardList />}
                label="Pending Intake Triage"
                value={unassessed.length}
                sub={unassessed.length > 0 ? 'Awaiting clinician acuity' : 'All patients assessed'}
                accent="green"
              />
            </div>
          )}

          {/* Tab content (rendered by App.jsx) */}
          {children}
        </main>

        {/* ── FOOTER ── */}
        <footer style={{
          padding: '0.85rem 2rem',
          background: 'var(--topbar-bg)',
          backdropFilter: 'var(--glass-blur)',
          borderTop: '1px solid var(--glass-border)',
          fontSize: '0.75rem', color: 'var(--text-secondary)',
          textAlign: 'center',
        }}>
          ⚠️ <strong>Demonstration Only (Anvesh '26)</strong>: Synthetic data only. Not for clinical use. Authorization uses client-side role selection.
        </footer>
      </div>

      {/* Mobile sidebar toggle button — rendered via CSS display */}
      <style>{`
        @media (max-width: 860px) {
          .mobile-sidebar-btn { display: flex !important; }
        }
      `}</style>
    </div>
  );
}

/* ── Utility ──────────────────────────────────────────────────────────────── */
function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}
