import type { DatabaseSync } from 'node:sqlite';
import type { MemoryFact } from '../../shared/ipc-types';

const MAX_FACT_CHARS = 500;

export interface FactSelection {
  facts: MemoryFact[];
  omittedCount: number;
}

export interface MemoryStore {
  listFacts(): MemoryFact[];
  addFact(text: string, source: 'user' | 'model'): MemoryFact;
  updateFact(id: number, text: string): MemoryFact;
  deleteFact(id: number): void;
  /** Nieuwste-eerst, afgekapt op feitgrens binnen budgetChars. Gebruikt door chat/system-prompt.ts. */
  selectFactsForPrompt(budgetChars: number): FactSelection;
}

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function assertValidFact(text: string): string {
  const normalized = normalizeText(text);
  if (normalized.length === 0) {
    throw new Error('Feit mag niet leeg zijn.');
  }
  if (normalized.length > MAX_FACT_CHARS) {
    throw new Error(`Feit is te lang (max ${MAX_FACT_CHARS} tekens).`);
  }
  return normalized;
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && /UNIQUE/i.test(error.message);
}

interface FactRow {
  id: number;
  text: string;
  source: string;
  created_at: number;
  updated_at: number;
}

function toFact(row: FactRow): MemoryFact {
  return {
    id: row.id,
    text: row.text,
    source: row.source === 'model' ? 'model' : 'user',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createMemoryStore(db: DatabaseSync): MemoryStore {
  // id DESC als tiebreaker: Date.now() heeft maar milliseconde-resolutie, dus
  // meerdere feiten binnen dezelfde ms (bv. snel na elkaar remember-aanroepen)
  // zouden anders in willekeurige volgorde staan i.p.v. nieuwste eerst.
  const listStmt = db.prepare('SELECT * FROM facts ORDER BY updated_at DESC, id DESC');
  const selectByIdStmt = db.prepare('SELECT * FROM facts WHERE id = ?');
  const selectByTextStmt = db.prepare('SELECT * FROM facts WHERE text = ?');
  // source mag bij een upsert alleen richting 'user' bewegen, nooit terug naar
  // 'model': anders zou een remember-aanroep die toevallig exact hetzelfde
  // (genormaliseerde) feit produceert als een al bestaand user-feit, stil de
  // "door Relay onthouden"-markering laten verdwijnen — juist relevant zodra
  // model-afkomstige feiten extra aandacht verdienen (zie security-review).
  const insertStmt = db.prepare(
    `INSERT INTO facts (text, source, created_at, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(text) DO UPDATE SET
       updated_at = excluded.updated_at,
       source = CASE WHEN excluded.source = 'user' THEN 'user' ELSE facts.source END`,
  );
  const updateStmt = db.prepare('UPDATE facts SET text = ?, updated_at = ? WHERE id = ?');
  const deleteStmt = db.prepare('DELETE FROM facts WHERE id = ?');

  return {
    listFacts(): MemoryFact[] {
      return (listStmt.all() as unknown as FactRow[]).map(toFact);
    },

    addFact(text: string, source: 'user' | 'model'): MemoryFact {
      const normalized = assertValidFact(text);
      const now = Date.now();
      insertStmt.run(normalized, source, now, now);
      const row = selectByTextStmt.get(normalized) as unknown as FactRow;
      return toFact(row);
    },

    updateFact(id: number, text: string): MemoryFact {
      const normalized = assertValidFact(text);
      const existing = selectByIdStmt.get(id) as unknown as FactRow | undefined;
      if (!existing) {
        throw new Error(`Feit met id ${id} bestaat niet.`);
      }
      try {
        updateStmt.run(normalized, Date.now(), id);
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          throw new Error('Dit feit staat al in het geheugen.');
        }
        throw error;
      }
      const row = selectByIdStmt.get(id) as unknown as FactRow;
      return toFact(row);
    },

    deleteFact(id: number): void {
      deleteStmt.run(id);
    },

    selectFactsForPrompt(budgetChars: number): FactSelection {
      const all = (listStmt.all() as unknown as FactRow[]).map(toFact);
      const selected: MemoryFact[] = [];
      let used = 0;

      for (const fact of all) {
        const cost = fact.text.length + 3; // "- " prefix + newline, ruwe schatting
        if (used + cost > budgetChars) break;
        selected.push(fact);
        used += cost;
      }

      return { facts: selected, omittedCount: all.length - selected.length };
    },
  };
}
