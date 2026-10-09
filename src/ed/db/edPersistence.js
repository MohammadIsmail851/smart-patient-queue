/**
 * Local Persistence Adapter for Smart Patient Queue prototype.
 *
 * Architecture & Security Note:
 * - In a production hospital system, persistence is backed by a secure backend
 *   with OAuth2/OIDC authenticated sessions, HIPAA-compliant audit trails,
 *   and server-side RBAC.
 * - For this demonstration prototype, unauthenticated writes to cloud Firestore
 *   would require weakening Firestore security rules (e.g. `allow read, write: if true`),
 *   which is strictly prohibited.
 * - Therefore, this adapter provides robust local browser persistence (localStorage)
 *   with schema validation, data serialization, and graceful error handling.
 * - It guarantees that encounters, assessments, emergency events, and timeline logs
 *   survive browser refresh without duplicating records or requiring insecure cloud writes.
 */

export const STORAGE_KEY = 'ed_smart_queue_prototype_v1';

export const PERSISTENCE_STATUS = Object.freeze({
  IDLE: 'idle',
  SAVING: 'saving',
  SAVED: 'saved',
  ERROR: 'error',
  LOADED: 'loaded',
});

/**
 * Serialize an EdMemoryStore instance into a JSON-compatible object.
 *
 * @param {import('./edMemoryStore.js').EdMemoryStore} store
 * @returns {Object}
 */
export function serializeStore(store) {
  return {
    version: 1,
    savedAt: Date.now(),
    idSeed: store._idSeed || 0,
    encounters: Array.from(store.encounters.entries()),
    assessments: store.assessments || [],
    emergencyEvents: Array.from(store.emergencyEvents.entries()),
    reassessmentTasks: Array.from(store.reassessmentTasks.entries()),
    timelineEvents: store.timelineEvents || [],
    auditLogs: store.auditLogs || [],
  };
}

/**
 * Hydrate an EdMemoryStore instance from a serialized object.
 *
 * @param {import('./edMemoryStore.js').EdMemoryStore} store
 * @param {Object} data
 */
export function deserializeStore(store, data) {
  if (!data || data.version !== 1) {
    throw new Error('Invalid or incompatible storage schema version');
  }

  store.encounters = new Map(data.encounters || []);
  store.assessments = (data.assessments || []).map(a => Object.freeze({ ...a }));
  store.emergencyEvents = new Map(data.emergencyEvents || []);
  store.reassessmentTasks = new Map(data.reassessmentTasks || []);
  store.timelineEvents = (data.timelineEvents || []).map(e => Object.freeze({ ...e }));
  store.auditLogs = (data.auditLogs || []).map(l => Object.freeze({ ...l }));
  store._idSeed = typeof data.idSeed === 'number' ? data.idSeed : store.encounters.size;
}

/**
 * Save store state to localStorage.
 *
 * @param {import('./edMemoryStore.js').EdMemoryStore} store
 * @param {Storage} [storage] - Injectable storage for testing
 * @returns {{ success: boolean, error?: string }}
 */
export function saveStoreToStorage(store, storage = typeof window !== 'undefined' ? window.localStorage : null) {
  if (!storage) {
    return { success: false, error: 'Storage API unavailable in this environment' };
  }

  try {
    const payload = serializeStore(store);
    storage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return { success: true };
  } catch (err) {
    console.error('Failed to save ED store state to storage:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Load store state from localStorage.
 *
 * @param {import('./edMemoryStore.js').EdMemoryStore} store
 * @param {Storage} [storage] - Injectable storage for testing
 * @returns {{ success: boolean, loaded: boolean, error?: string }}
 */
export function loadStoreFromStorage(store, storage = typeof window !== 'undefined' ? window.localStorage : null) {
  if (!storage) {
    return { success: false, loaded: false, error: 'Storage API unavailable' };
  }

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      return { success: true, loaded: false };
    }

    const parsed = JSON.parse(raw);
    deserializeStore(store, parsed);
    return { success: true, loaded: true };
  } catch (err) {
    console.error('Failed to load ED store state from storage:', err);
    return { success: false, loaded: false, error: err.message };
  }
}

/**
 * Clear stored state.
 *
 * @param {Storage} [storage]
 */
export function clearStoreStorage(storage = typeof window !== 'undefined' ? window.localStorage : null) {
  if (storage) {
    storage.removeItem(STORAGE_KEY);
  }
}
