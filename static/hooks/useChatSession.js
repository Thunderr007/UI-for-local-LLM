/**
 * Immutable chat session store — IndexedDB persistence, no DOM.
 * @typedef {'user'|'assistant'|'system'} MessageRole
 * @typedef {{index:number,title:string,url:string,domain?:string}} WebSource
 * @typedef {{id:string,role:MessageRole,content:string,timestamp:number,thinking?:string,stats?:Record<string,unknown>,attachments?:{images?:string[],docName?:string},modelName?:string,sources?:WebSource[]}} Message
 * @typedef {{id:string,title:string,messages:Message[],createdAt:number,updatedAt:number}} ChatSession
 * @typedef {{sessions:ChatSession[],activeSessionId:string|null}} SessionState
 */

import { initChatDb, loadChatState, saveChatState } from "../storage/chatDb.js";

const MAX_SESSIONS = 80;
const PERSIST_DEBOUNCE_MS = 250;

function uid() {
  return crypto.randomUUID();
}

function cloneSession(s) {
  return {
    ...s,
    messages: s.messages.map((m) => ({ ...m })),
  };
}

function cloneState(state) {
  return {
    activeSessionId: state.activeSessionId,
    sessions: state.sessions.map(cloneSession),
  };
}

function titleFromMessages(messages) {
  const first = messages.find((m) => m.role === "user" && m.content.trim());
  if (!first) return "New chat";
  const t = first.content.trim().replace(/\s+/g, " ");
  return t.length > 42 ? `${t.slice(0, 42)}…` : t;
}

/**
 * @param {Message[]} messages
 * @param {number} idx
 * @param {string} newContent
 * @returns {Message[]}
 */
export function branchAtMessage(messages, idx, newContent) {
  if (idx < 0 || idx >= messages.length) return messages.map((m) => ({ ...m }));
  if (messages[idx].role !== "user") return messages.map((m) => ({ ...m }));

  const head = messages.slice(0, idx).map((m) => ({ ...m }));
  const edited = {
    id: uid(),
    role: "user",
    content: newContent.trim(),
    timestamp: Date.now(),
  };
  return [...head, edited];
}

/** @param {Message[]} messages */
export function toApiPayload(messages) {
  return messages.map(({ role, content }) => ({ role, content }));
}

export async function createSessionStore() {
  await initChatDb();
  /** @type {SessionState} */
  let state = await loadChatState();
  /** @type {Set<(s: SessionState)=>void>} */
  const listeners = new Set();
  /** @type {ReturnType<typeof setTimeout> | null} */
  let persistTimer = null;
  let ready = true;

  function emit() {
    const snap = getState();
    listeners.forEach((fn) => fn(snap));
  }

  function schedulePersist() {
    if (!ready) return;
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      const snapshot = cloneState(state);
      saveChatState({
        activeSessionId: snapshot.activeSessionId,
        sessions: snapshot.sessions.slice(0, MAX_SESSIONS),
      }).catch(() => {
        /* IndexedDB write failed — in-memory state remains */
      });
    }, PERSIST_DEBOUNCE_MS);
  }

  async function flush() {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    const snapshot = cloneState(state);
    await saveChatState({
      activeSessionId: snapshot.activeSessionId,
      sessions: snapshot.sessions.slice(0, MAX_SESSIONS),
    });
  }

  function commit(next) {
    state = {
      activeSessionId: next.activeSessionId,
      sessions: next.sessions.slice(0, MAX_SESSIONS),
    };
    schedulePersist();
    emit();
  }

  function getState() {
    return cloneState(state);
  }

  function getActiveSession() {
    if (!state.activeSessionId) return null;
    const s = state.sessions.find((x) => x.id === state.activeSessionId);
    return s ? cloneSession(s) : null;
  }

  function setActive(id) {
    if (!state.sessions.some((s) => s.id === id)) return null;
    commit({ ...state, activeSessionId: id });
    return getActiveSession();
  }

  function createSession() {
    const now = Date.now();
    const session = {
      id: uid(),
      title: "New chat",
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    commit({
      sessions: [session, ...state.sessions].slice(0, MAX_SESSIONS),
      activeSessionId: session.id,
    });
    return cloneSession(session);
  }

  function deleteSession(id) {
    const sessions = state.sessions.filter((s) => s.id !== id);
    let activeSessionId = state.activeSessionId;
    if (activeSessionId === id) {
      activeSessionId = sessions[0]?.id ?? null;
    }
    commit({ sessions, activeSessionId });
    return activeSessionId ? cloneSession(sessions.find((s) => s.id === activeSessionId)) : null;
  }

  function renameSession(id, title) {
    const trimmed = title.trim();
    if (!trimmed) return null;
    const sessions = state.sessions.map((s) =>
      s.id === id ? { ...s, title: trimmed, updatedAt: Date.now() } : s
    );
    commit({ ...state, sessions });
    return cloneSession(sessions.find((s) => s.id === id));
  }

  /**
   * @param {string} sessionId
   * @param {Omit<Message,'id'|'timestamp'> & {id?:string}} msg
   */
  function appendMessage(sessionId, msg) {
    const sessions = state.sessions.map((s) => {
      if (s.id !== sessionId) return s;
      const message = {
        id: msg.id || uid(),
        role: msg.role,
        content: msg.content,
        timestamp: Date.now(),
        ...(msg.role === "assistant"
          ? { thinking: typeof msg.thinking === "string" ? msg.thinking : "" }
          : msg.thinking
            ? { thinking: msg.thinking }
            : {}),
        ...(msg.stats ? { stats: msg.stats } : {}),
        ...(msg.attachments ? { attachments: msg.attachments } : {}),
        ...(msg.modelName ? { modelName: msg.modelName } : {}),
        ...(msg.sources ? { sources: msg.sources } : {}),
      };
      const messages = [...s.messages, message];
      return {
        ...s,
        messages,
        title: s.title === "New chat" ? titleFromMessages(messages) : s.title,
        updatedAt: Date.now(),
      };
    });
    commit({ ...state, sessions });
    return getActiveSession();
  }

  /**
   * @param {string} sessionId
   * @param {Message[]} messages
   */
  function replaceMessages(sessionId, messages) {
    const sessions = state.sessions.map((s) => {
      if (s.id !== sessionId) return s;
      const cloned = messages.map((m) => ({ ...m }));
      return {
        ...s,
        messages: cloned,
        title: titleFromMessages(cloned),
        updatedAt: Date.now(),
      };
    });
    commit({ ...state, sessions });
    return getActiveSession();
  }

  /**
   * @param {string} sessionId
   * @param {string} messageId
   * @param {string} newContent
   */
  function editUserMessage(sessionId, messageId, newContent) {
    const session = state.sessions.find((s) => s.id === sessionId);
    if (!session) return null;
    const idx = session.messages.findIndex((m) => m.id === messageId);
    if (idx === -1) return null;
    const branched = branchAtMessage(session.messages, idx, newContent);
    return replaceMessages(sessionId, branched);
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function ensureActive() {
    if (state.activeSessionId && state.sessions.some((s) => s.id === state.activeSessionId)) {
      return getActiveSession();
    }
    if (state.sessions.length) {
      commit({ ...state, activeSessionId: state.sessions[0].id });
      return getActiveSession();
    }
    return createSession();
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("beforeunload", () => {
    flush();
  });

  return {
    getState,
    getActiveSession,
    setActive,
    createSession,
    deleteSession,
    renameSession,
    appendMessage,
    replaceMessages,
    editUserMessage,
    subscribe,
    ensureActive,
    flush,
    toApiPayload,
  };
}
