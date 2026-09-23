import type { DatabaseSync } from 'node:sqlite';
import type { ChatToolCall, ConversationSummary, ToolDisplay } from '../../shared/ipc-types';

export const MAX_TITLE_CHARS = 120;

export interface ConversationRecord extends ConversationSummary {
  titleIsCustom: boolean;
}

export type MessageRole = 'user' | 'assistant' | 'tool';
/** kind is nodig naast role: in prompt-modus is een tool-resultaat een 'user'-bericht (zie tool-protocol.ts). */
export type MessageKind = 'user' | 'assistant' | 'tool_result' | 'notice';
export type MessageStatus = 'complete' | 'interrupted' | 'error';

export interface StoredMessage {
  id: number;
  conversationId: number;
  role: MessageRole;
  kind: MessageKind;
  content: string;
  toolCalls: ChatToolCall[] | null;
  toolName: string | null;
  display: ToolDisplay | null;
  model: string | null;
  status: MessageStatus;
  createdAt: number;
}

export type NewMessage = Omit<StoredMessage, 'id' | 'conversationId' | 'createdAt'>;

export interface ConversationStore {
  list(): ConversationRecord[];
  get(id: number): ConversationRecord | undefined;
  create(input: { model: string; numCtx: number }): ConversationRecord;
  /** Handmatige titel: wint daarna altijd van automatisch gegenereerde titels. */
  rename(id: number, title: string): ConversationRecord;
  /** Alleen als de gebruiker de titel niet zelf gezet heeft; geeft terug of er iets veranderde. */
  setAutoTitle(id: number, title: string): boolean;
  delete(id: number): void;
  listMessages(conversationId: number): StoredMessage[];
  /** Eén transactie, en bumpt updated_at van het gesprek. */
  appendMessages(conversationId: number, messages: NewMessage[]): void;
}

interface ConversationRow {
  id: number;
  title: string;
  title_is_custom: number;
  model: string;
  num_ctx: number;
  created_at: number;
  updated_at: number;
  document_count: number;
}

interface MessageRow {
  id: number;
  conversation_id: number;
  role: string;
  kind: string;
  content: string;
  tool_calls: string | null;
  tool_name: string | null;
  display: string | null;
  model: string | null;
  status: string;
  created_at: number;
}

function toRecord(row: ConversationRow): ConversationRecord {
  return {
    id: row.id,
    title: row.title,
    titleIsCustom: row.title_is_custom === 1,
    model: row.model,
    numCtx: row.num_ctx,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    documentCount: row.document_count,
  };
}

function parseJson<T>(value: string | null): T | null {
  if (value === null) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function toMessage(row: MessageRow): StoredMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role as MessageRole,
    kind: row.kind as MessageKind,
    content: row.content,
    toolCalls: parseJson<ChatToolCall[]>(row.tool_calls),
    toolName: row.tool_name,
    display: parseJson<ToolDisplay>(row.display),
    model: row.model,
    status: row.status as MessageStatus,
    createdAt: row.created_at,
  };
}

export function normalizeTitle(title: string): string {
  const normalized = title.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) throw new Error('Titel mag niet leeg zijn.');
  return normalized.slice(0, MAX_TITLE_CHARS);
}

export function createConversationStore(db: DatabaseSync): ConversationStore {
  const selectColumns = `
    SELECT c.*, (SELECT COUNT(*) FROM documents d WHERE d.conversation_id = c.id) AS document_count
    FROM conversations c`;
  const listStmt = db.prepare(`${selectColumns} ORDER BY c.updated_at DESC, c.id DESC`);
  const getStmt = db.prepare(`${selectColumns} WHERE c.id = ?`);
  const insertStmt = db.prepare(
    `INSERT INTO conversations (title, model, num_ctx, created_at, updated_at) VALUES ('Nieuw gesprek', ?, ?, ?, ?)`,
  );
  const renameStmt = db.prepare('UPDATE conversations SET title = ?, title_is_custom = 1 WHERE id = ?');
  const autoTitleStmt = db.prepare('UPDATE conversations SET title = ? WHERE id = ? AND title_is_custom = 0');
  const deleteStmt = db.prepare('DELETE FROM conversations WHERE id = ?');
  const touchStmt = db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?');
  const listMessagesStmt = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id');
  const insertMessageStmt = db.prepare(
    `INSERT INTO messages (conversation_id, role, kind, content, tool_calls, tool_name, display, model, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  function requireConversation(id: number): ConversationRecord {
    const row = getStmt.get(id) as unknown as ConversationRow | undefined;
    if (!row) throw new Error('Gesprek bestaat niet (meer).');
    return toRecord(row);
  }

  return {
    list() {
      return (listStmt.all() as unknown as ConversationRow[]).map(toRecord);
    },

    get(id) {
      const row = getStmt.get(id) as unknown as ConversationRow | undefined;
      return row ? toRecord(row) : undefined;
    },

    create({ model, numCtx }) {
      const now = Date.now();
      const result = insertStmt.run(model, numCtx, now, now);
      return requireConversation(Number(result.lastInsertRowid));
    },

    rename(id, title) {
      renameStmt.run(normalizeTitle(title), id);
      return requireConversation(id);
    },

    setAutoTitle(id, title) {
      return Number(autoTitleStmt.run(normalizeTitle(title), id).changes) > 0;
    },

    delete(id) {
      deleteStmt.run(id);
    },

    listMessages(conversationId) {
      return (listMessagesStmt.all(conversationId) as unknown as MessageRow[]).map(toMessage);
    },

    appendMessages(conversationId, messages) {
      if (messages.length === 0) return;
      const now = Date.now();
      db.exec('BEGIN');
      try {
        for (const m of messages) {
          insertMessageStmt.run(
            conversationId,
            m.role,
            m.kind,
            m.content,
            m.toolCalls ? JSON.stringify(m.toolCalls) : null,
            m.toolName,
            m.display ? JSON.stringify(m.display) : null,
            m.model,
            m.status,
            now,
          );
        }
        touchStmt.run(now, conversationId);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
