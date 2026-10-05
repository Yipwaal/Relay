import type { DatabaseSync } from 'node:sqlite';
import type { RouteDecision } from '../../router/types';

export interface RouterDecisionRecord {
  id: number;
  conversationId: number | null;
  messageId: number | null;
  attempt: number;
  model: string;
  role: string | null;
  source: string;
  reason: string;
  task: string | null;
  complexity: string | null;
  classifyMs: number | null;
  loadMs: number | null;
  createdAt: number;
}

export interface RouterDecisionStore {
  /**
   * Logt één routerkeuze voor een beurt. attempt = vorige poging van die beurt
   * + 1 — vooral geteld in dít log, want een poging die meteen faalt laat
   * geen berichten achter.
   */
  record(conversationId: number, messageId: number, decision: RouteDecision): { id: number; attempt: number };
  /** Laadtijd (Ollama's load_duration) achteraf invullen. */
  setLoadMs(id: number, loadMs: number): void;
  /** De laatste keuze voor een beurt: welk model gaf het huidige antwoord. */
  latestFor(messageId: number): RouterDecisionRecord | undefined;
  list(options: { conversationId?: number; limit: number }): RouterDecisionRecord[];
}

interface DecisionRow {
  id: number;
  conversation_id: number | null;
  message_id: number | null;
  attempt: number;
  model: string;
  role: string | null;
  source: string;
  reason: string;
  task: string | null;
  complexity: string | null;
  classify_ms: number | null;
  load_ms: number | null;
  created_at: number;
}

function toRecord(row: DecisionRow): RouterDecisionRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    attempt: row.attempt,
    model: row.model,
    role: row.role,
    source: row.source,
    reason: row.reason,
    task: row.task,
    complexity: row.complexity,
    classifyMs: row.classify_ms,
    loadMs: row.load_ms,
    createdAt: row.created_at,
  };
}

export function createRouterDecisionStore(db: DatabaseSync): RouterDecisionStore {
  // Ook naar messages kijken: wordt het log ooit opgeschoond, dan mag een
  // nieuwe poging nooit het nummer van een opgeslagen poging hergebruiken.
  const nextAttemptStmt = db.prepare(`
    SELECT COALESCE(MAX(attempt), 0) + 1 AS next FROM (
      SELECT MAX(attempt) AS attempt FROM router_decisions WHERE message_id = ?
      UNION ALL
      SELECT MAX(attempt) FROM messages WHERE turn = ? AND kind != 'user'
    )`);
  const insertStmt = db.prepare(
    `INSERT INTO router_decisions (conversation_id, message_id, attempt, model, role, source, reason, task, complexity, classify_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const setLoadStmt = db.prepare('UPDATE router_decisions SET load_ms = ? WHERE id = ?');
  const latestStmt = db.prepare('SELECT * FROM router_decisions WHERE message_id = ? ORDER BY attempt DESC LIMIT 1');
  const listAllStmt = db.prepare('SELECT * FROM router_decisions ORDER BY id DESC LIMIT ?');
  const listConversationStmt = db.prepare('SELECT * FROM router_decisions WHERE conversation_id = ? ORDER BY id DESC LIMIT ?');

  return {
    record(conversationId, messageId, decision) {
      const { next } = nextAttemptStmt.get(messageId, messageId) as unknown as { next: number };
      const result = insertStmt.run(
        conversationId,
        messageId,
        next,
        decision.model,
        decision.role,
        decision.source,
        decision.reason,
        decision.classification?.taak ?? null,
        decision.classification?.complexiteit ?? null,
        decision.classifyMs ?? null,
        Date.now(),
      );
      return { id: Number(result.lastInsertRowid), attempt: next };
    },

    setLoadMs(id, loadMs) {
      setLoadStmt.run(Math.round(loadMs), id);
    },

    latestFor(messageId) {
      const row = latestStmt.get(messageId) as unknown as DecisionRow | undefined;
      return row ? toRecord(row) : undefined;
    },

    list({ conversationId, limit }) {
      const rows = conversationId === undefined ? listAllStmt.all(limit) : listConversationStmt.all(conversationId, limit);
      return (rows as unknown as DecisionRow[]).map(toRecord);
    },
  };
}
