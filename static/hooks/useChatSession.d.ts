export type MessageRole = "user" | "assistant" | "system";

export interface WebSource {
  index: number;
  title: string;
  url: string;
  domain?: string;
}

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  sources?: WebSource[];
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export interface SessionState {
  sessions: ChatSession[];
  activeSessionId: string | null;
}

export function branchAtMessage(
  messages: Message[],
  idx: number,
  newContent: string
): Message[];

export function toApiPayload(messages: Message[]): { role: string; content: string }[];

export function createSessionStore(): Promise<{
  getState(): SessionState;
  getActiveSession(): ChatSession | null;
  setActive(id: string): ChatSession | null;
  createSession(): ChatSession;
  deleteSession(id: string): ChatSession | null;
  renameSession(id: string, title: string): ChatSession | null;
  appendMessage(
    sessionId: string,
    msg: { id?: string; role: MessageRole; content: string; sources?: WebSource[] }
  ): ChatSession | null;
  replaceMessages(sessionId: string, messages: Message[]): ChatSession | null;
  editUserMessage(
    sessionId: string,
    messageId: string,
    newContent: string
  ): ChatSession | null;
  subscribe(fn: (s: SessionState) => void): () => void;
  ensureActive(): ChatSession;
  toApiPayload(messages: Message[]): { role: string; content: string }[];
  flush(): Promise<void>;
}>;
