/**
 * IndexedDB persistence for chat sessions.
 * Migrates legacy localStorage (`llm_chat_sessions_v1`) on first open.
 */

const DB_NAME = "llm_chat_db";
const DB_VERSION = 1;
const LEGACY_STORAGE_KEY = "llm_chat_sessions_v1";
const MIGRATED_FLAG = "llm_chat_idb_migrated_v2";

/** @typedef {import('../hooks/useChatSession.js').ChatSession} ChatSession */
/** @typedef {import('../hooks/useChatSession.js').SessionState} SessionState */

/** @type {IDBDatabase | null} */
let db = null;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = (event) => {
      const database = /** @type {IDBOpenDBRequest} */ (event.target).result;
      if (!database.objectStoreNames.contains("sessions")) {
        const store = database.createObjectStore("sessions", { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }
      if (!database.objectStoreNames.contains("meta")) {
        database.createObjectStore("meta", { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function tx(storeNames, mode) {
  if (!db) throw new Error("chatDb not initialized");
  return db.transaction(storeNames, mode);
}

/** @returns {Promise<SessionState>} */
function loadLegacyLocalStorage() {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return Promise.resolve({ sessions: [], activeSessionId: null });
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.sessions)) {
      return Promise.resolve({ sessions: [], activeSessionId: null });
    }
    return Promise.resolve({
      sessions: parsed.sessions,
      activeSessionId: parsed.activeSessionId ?? null,
    });
  } catch {
    return Promise.resolve({ sessions: [], activeSessionId: null });
  }
}

/** @param {SessionState} state */
function writeState(state) {
  const transaction = tx(["sessions", "meta"], "readwrite");
  const sessionStore = transaction.objectStore("sessions");
  const metaStore = transaction.objectStore("meta");

  return new Promise((resolve, reject) => {
    const getAllReq = sessionStore.getAll();
    getAllReq.onsuccess = () => {
      const existing = /** @type {ChatSession[]} */ (getAllReq.result);
      const incomingIds = new Set(state.sessions.map((s) => s.id));
      for (const session of existing) {
        if (!incomingIds.has(session.id)) {
          sessionStore.delete(session.id);
        }
      }
      for (const session of state.sessions) {
        sessionStore.put(session);
      }
      metaStore.put({ key: "activeSessionId", value: state.activeSessionId });
    };
    getAllReq.onerror = () => reject(getAllReq.error);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/** @returns {Promise<SessionState>} */
function readState() {
  const transaction = tx(["sessions", "meta"], "readonly");
  const sessionStore = transaction.objectStore("sessions");
  const metaStore = transaction.objectStore("meta");

  return new Promise((resolve, reject) => {
    /** @type {ChatSession[]} */
    let sessions = [];
    /** @type {string | null} */
    let activeSessionId = null;
    let pending = 2;

    const done = () => {
      pending -= 1;
      if (pending === 0) resolve({ sessions, activeSessionId });
    };

    const sessionsReq = sessionStore.getAll();
    sessionsReq.onsuccess = () => {
      sessions = /** @type {ChatSession[]} */ (sessionsReq.result);
      done();
    };
    sessionsReq.onerror = () => reject(sessionsReq.error);

    const metaReq = metaStore.get("activeSessionId");
    metaReq.onsuccess = () => {
      activeSessionId = metaReq.result?.value ?? null;
      done();
    };
    metaReq.onerror = () => reject(metaReq.error);

    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function initChatDb() {
  if (db) return db;
  db = await openDatabase();

  const migrated = localStorage.getItem(MIGRATED_FLAG);
  const current = await readState();

  if (!migrated && current.sessions.length === 0) {
    const legacy = await loadLegacyLocalStorage();
    if (legacy.sessions.length > 0) {
      await writeState(legacy);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
    localStorage.setItem(MIGRATED_FLAG, "1");
  }

  return db;
}

/** @param {SessionState} state */
export async function saveChatState(state) {
  await initChatDb();
  await writeState(state);
}

/** @returns {Promise<SessionState>} */
export async function loadChatState() {
  await initChatDb();
  return readState();
}

export function isChatDbReady() {
  return db !== null;
}
