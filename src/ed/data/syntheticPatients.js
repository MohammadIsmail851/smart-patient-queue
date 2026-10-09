/**
 * Synthetic patient data for the ED triage prototype.
 *
 * ⚠️  All data is entirely fabricated for demonstration purposes at Anvesh '26.
 * No real patient information is used or referenced.
 */

export const SYNTHETIC_PATIENTS = Object.freeze([
  {
    name: 'Ravi Shankar',
    dob: '1980-03-14',
    gender: 'male',
    chiefComplaint: 'Chest pain, shortness of breath for 30 minutes',
    contactNumber: '9876543210',
  },
  {
    name: 'Priya Mehta',
    dob: '1995-07-22',
    gender: 'female',
    chiefComplaint: 'High fever (104°F) and persistent headache',
    contactNumber: '9123456780',
  },
  {
    name: 'Arjun Das',
    dob: '2005-11-05',
    gender: 'male',
    chiefComplaint: 'Laceration to right forearm — moderate bleeding',
    contactNumber: '',
  },
  {
    name: 'Sunita Rao',
    dob: '1965-01-30',
    gender: 'female',
    chiefComplaint: 'Mild back pain for 3 days',
    contactNumber: '8765432109',
  },
  {
    name: 'Mohammed Irfan',
    dob: '1972-09-18',
    gender: 'male',
    chiefComplaint: 'Dizziness and vomiting since morning',
    contactNumber: '7654321098',
  },
  {
    name: 'Kavya Nair',
    dob: '1999-04-02',
    gender: 'female',
    chiefComplaint: 'Ankle sprain, swelling',
    contactNumber: '',
  },
  {
    name: 'Suresh Babu',
    dob: '1958-12-11',
    gender: 'male',
    chiefComplaint: 'Difficulty breathing — known COPD patient',
    contactNumber: '6543210987',
  },
  {
    name: 'Deepa Krishnan',
    dob: '1988-06-25',
    gender: 'female',
    chiefComplaint: 'Abdominal pain, nausea',
    contactNumber: '5432109876',
  },
]);

/** Synthetic ED staff accounts for demonstration. */
export const SYNTHETIC_STAFF = Object.freeze([
  { id: 'staff-reg-001',  name: 'Ananya S.',    role: 'ed_registration', email: 'ananya@ed.demo' },
  { id: 'staff-tri-001',  name: 'Dr. Ramesh K.', role: 'ed_triage',       email: 'ramesh@ed.demo' },
  { id: 'staff-emg-001',  name: 'Dr. Leela M.',  role: 'ed_emergency',    email: 'leela@ed.demo'  },
  { id: 'staff-coo-001',  name: 'Vikram P.',     role: 'ed_coordinator',  email: 'vikram@ed.demo' },
  { id: 'staff-sup-001',  name: 'Dr. Shalini T.', role: 'ed_supervisor',  email: 'shalini@ed.demo'},
  { id: 'staff-adm-001',  name: 'Admin User',    role: 'ed_admin',        email: 'admin@ed.demo'  },
  { id: 'staff-aud-001',  name: 'Auditor J.',    role: 'ed_auditor',      email: 'auditor@ed.demo'},
]);
