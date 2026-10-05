import type { DatabaseSync } from 'node:sqlite';
import type { ChatOptions, ChatToolCall, ModelMode, ToolDisplay } from '../../shared/ipc-types';

export const MAX_TITLE_CHARS = 120;

export interface ConversationRecord {
  id: number;
  title: string;
  titleIsCustom: boolean;
  /** 'auto': de router kiest per bericht; 'fixed': altijd `model`. */
  modelMode: ModelMode;
  /** Het vast gekozen model (blijft bewaard als je terug naar Automatisch gaat); '' als er nooit een gekozen is. */
  model: string;
  /** Het laatst gerouteerde model in automatische modus (stickiness); null als er nog niet gerouteerd is. */
  routedModel: string | null;
  numCtx: number;
  /** null: nog nooit ingesteld (gesprek van vóór Fase 5d) — gebruik de standaard uit config.json. */
  numPredict: number | null;
  temperature: number | null;
  createdAt: number;
  updatedAt: number;
  documentCount: number;
}

/** Vult ontbrekende instellingen aan met de standaard uit config.json. */
export function resolveOptions(record: ConversationRecord, defaults: ChatOptions): ChatOptions {
  return {
    numCtx: record.numCtx,
    numPredict: record.numPredict ?? defaults.numPredict,
    temperature: record.temperature ?? defaults.temperature,
  };
}

export type MessageRole = 'user' | 'assistant' | 'tool';
/** kind is nodig naast role: in prompt-modus is een tool-resultaat een 'user'-bericht (zie tool-protocol.ts). */
export type MessageKind = 'user' | 'assistant' | 'tool_result' | 'notice';
export type MessageStatus = 'complete' | 'interrupted' | 'error';

/** Welke beurt (id van het gebruikersbericht) en welke poging daarbinnen. */
export interface TurnRef {
  turn: number;
  attempt: number;
}

export interface StoredMessage {
  id: number;
  conversationId: number;
  turn: number | null;
  attempt: number;
  /** Vervangen door een latere poging: niet meer naar het model, wel (gedimd) zichtbaar. */
  superseded: boolean;
  /** Routerreden bij een assistant-bericht, voor het label "model · reden". */
  route: string | null;
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

export type NewMessage = Omit<StoredMessage, 'id' | 'conversationId' | 'createdAt' | 'turn' | 'attempt' | 'superseded'>;

export interface ConversationStore {
  list(): ConversationRecord[];
  get(id: number): ConversationRecord | undefined;
  create(input: { modelMode: ModelMode; model: string; options: ChatOptions }): ConversationRecord;
  /** 'fixed' vereist een model; 'auto' laat het eerder gekozen model staan. */
  setModelMode(id: number, mode: ModelMode, model?: string): ConversationRecord;
  setRoutedModel(id: number, model: string): void;
  setOptions(id: number, options: ChatOptions): ConversationRecord;
  /** Handmatige titel: wint daarna altijd van automatisch gegenereerde titels. */
  rename(id: number, title: string): ConversationRecord;
  /** Alleen als de gebruiker de titel niet zelf gezet heeft; geeft terug of er iets veranderde. */
  setAutoTitle(id: number, title: string): boolean;
  delete(id: number): void;
  listMessages(conversationId: number): StoredMessage[];
  /** Nieuwe beurt: het gebruikersbericht is zijn eigen turn. Geeft dat id terug. */
  appendUserMessage(conversationId: number, text: string): number;
  /** Het laatste gebruikersbericht (de enige beurt die opnieuw geprobeerd kan worden). */
  latestTurn(conversationId: number): { turn: number; text: string } | undefined;
  /**
   * Eén transactie, en bumpt updated_at van het gesprek. Met
   * supersedeOlderAttempts worden eerdere pogingen van dezelfde beurt in
   * díe transactie als vervangen gemarkeerd — pas zodra de nieuwe poging
   * echt iets oplevert, zodat een mislukte retry het oude antwoord laat staan.
   */
  appendMessages(conversationId: number, ref: TurnRef | null, messages: NewMessage[], opts?: { supersedeOlderAttempts?: boolean }): void;
}

interface ConversationRow {
  id: number;
  title: string;
  title_is_custom: number;
  model_mode: string;
  model: string;
  routed_model: string | null;
  num_ctx: number;
  num_predict: number | null;
  temperature: number | null;
  created_at: number;
  updated_at: number;
  document_count: number;
}

interface MessageRow {
  id: number;
  conversation_id: number;
  turn: number | null;
  attempt: number;
  superseded: number;
  route: string | null;
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
    modelMode: row.model_mode === 'fixed' ? 'fixed' : 'auto',
    model: row.model,
    routedModel: row.routed_model,
    numCtx: row.num_ctx,
    numPredict: row.num_predict,
    temperature: row.temperature,
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
    turn: row.turn,
    attempt: row.attempt,
    superseded: row.superseded === 1,
    route: row.route,
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
    `INSERT INTO conversations (title, model_mode, model, num_ctx, num_predict, temperature, created_at, updated_at)
     VALUES ('Nieuw gesprek', ?, ?, ?, ?, ?, ?, ?)`,
  );
  const setFixedStmt = db.prepare("UPDATE conversations SET model_mode = 'fixed', model = ? WHERE id = ?");
  const setAutoStmt = db.prepare("UPDATE conversations SET model_mode = 'auto' WHERE id = ?");
  const setRoutedStmt = db.prepare('UPDATE conversations SET routed_model = ? WHERE id = ?');
  const setOptionsStmt = db.prepare('UPDATE conversations SET num_ctx = ?, num_predict = ?, temperature = ? WHERE id = ?');
  const renameStmt = db.prepare('UPDATE conversations SET title = ?, title_is_custom = 1 WHERE id = ?');
  const autoTitleStmt = db.prepare('UPDATE conversations SET title = ? WHERE id = ? AND title_is_custom = 0');
  const deleteStmt = db.prepare('DELETE FROM conversations WHERE id = ?');
  const touchStmt = db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?');
  const listMessagesStmt = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id');
  const insertMessageStmt = db.prepare(
    `INSERT INTO messages (conversation_id, turn, attempt, role, kind, content, tool_calls, tool_name, display, model, status, route, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertUserStmt = db.prepare(
    `INSERT INTO messages (conversation_id, attempt, role, kind, content, status, created_at) VALUES (?, 1, 'user', 'user', ?, 'complete', ?)`,
  );
  const setOwnTurnStmt = db.prepare('UPDATE messages SET turn = id WHERE id = ?');
  const latestTurnStmt = db.prepare("SELECT id, content FROM messages WHERE conversation_id = ? AND kind = 'user' ORDER BY id DESC LIMIT 1");
  const supersedeStmt = db.prepare("UPDATE messages SET superseded = 1 WHERE turn = ? AND attempt < ? AND kind != 'user'");

  function inTransaction(work: () => void): void {
    db.exec('BEGIN');
    try {
      work();
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

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

    create({ modelMode, model, options }) {
      const now = Date.now();
      const result = insertStmt.run(modelMode, model, options.numCtx, options.numPredict, options.temperature, now, now);
      return requireConversation(Number(result.lastInsertRowid));
    },

    setModelMode(id, mode, model) {
      if (mode === 'fixed') {
        if (!model) throw new Error('Kies een model.');
        setFixedStmt.run(model, id);
      } else {
        setAutoStmt.run(id);
      }
      return requireConversation(id);
    },

    setRoutedModel(id, model) {
      setRoutedStmt.run(model, id);
    },

    setOptions(id, options) {
      setOptionsStmt.run(options.numCtx, options.numPredict, options.temperature, id);
      return requireConversation(id);
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

    appendUserMessage(conversationId, text) {
      const now = Date.now();
      let id = 0;
      inTransaction(() => {
        id = Number(insertUserStmt.run(conversationId, text, now).lastInsertRowid);
        setOwnTurnStmt.run(id);
        touchStmt.run(now, conversationId);
      });
      return id;
    },

    latestTurn(conversationId) {
      const row = latestTurnStmt.get(conversationId) as unknown as { id: number; content: string } | undefined;
      return row ? { turn: row.id, text: row.content } : undefined;
    },

    appendMessages(conversationId, ref, messages, opts) {
      if (messages.length === 0) return;
      const now = Date.now();
      inTransaction(() => {
        if (ref && opts?.supersedeOlderAttempts) supersedeStmt.run(ref.turn, ref.attempt);
        for (const m of messages) {
          insertMessageStmt.run(
            conversationId,
            ref?.turn ?? null,
            ref?.attempt ?? 1,
            m.role,
            m.kind,
            m.content,
            m.toolCalls ? JSON.stringify(m.toolCalls) : null,
            m.toolName,
            m.display ? JSON.stringify(m.display) : null,
            m.model,
            m.status,
            m.route,
            now,
          );
        }
        touchStmt.run(now, conversationId);
      });
    },
  };
}
