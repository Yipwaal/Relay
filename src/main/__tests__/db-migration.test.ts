import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openRelayDb } from '../db';

/** Bouwt een database zoals Fase 5 hem achterliet (user_version 4) door de v5-toevoegingen weer weg te halen. */
function createV4Database(filePath: string): void {
  openRelayDb(filePath).close();
  const db = new DatabaseSync(filePath);
  db.exec('DROP INDEX messages_turn_idx');
  for (const column of ['turn', 'attempt', 'superseded', 'route']) db.exec(`ALTER TABLE messages DROP COLUMN ${column}`);
  for (const column of ['model_mode', 'routed_model']) db.exec(`ALTER TABLE conversations DROP COLUMN ${column}`);
  db.exec('DROP TABLE router_decisions');
  db.exec('DROP TABLE app_settings');
  db.exec('DROP TABLE message_images');
  db.exec('PRAGMA user_version = 4');

  db.exec("INSERT INTO conversations (id, title, model, num_ctx, created_at, updated_at) VALUES (1, 'Oud', 'gemma3:12b', 8192, 0, 0)");
  const insert = db.prepare("INSERT INTO messages (id, conversation_id, role, kind, content, created_at) VALUES (?, 1, ?, ?, ?, 0)");
  insert.run(1, 'user', 'user', 'Vraag 1');
  insert.run(2, 'assistant', 'assistant', 'Antwoord 1');
  insert.run(3, 'tool', 'tool_result', '{}');
  insert.run(4, 'user', 'user', 'Vraag 2');
  insert.run(5, 'assistant', 'assistant', 'Antwoord 2');
  db.close();
}

test('migratie v4 → v5: bestaande gesprekken worden automatisch, berichten krijgen hun beurt', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-migrate-'));
  const filePath = path.join(dir, 'relay.db');
  try {
    createV4Database(filePath);
    const db = openRelayDb(filePath);
    assert.equal((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 5);

    const conversation = db.prepare('SELECT model, model_mode, routed_model FROM conversations WHERE id = 1').get() as Record<string, unknown>;
    // Het oude vaste model blijft bewaard, maar het gesprek staat voortaan op Automatisch.
    assert.deepEqual({ ...conversation }, { model: 'gemma3:12b', model_mode: 'auto', routed_model: null });

    const rows = db.prepare('SELECT id, turn, attempt, superseded FROM messages ORDER BY id').all() as Array<Record<string, unknown>>;
    assert.deepEqual(
      rows.map((r) => [r.id, r.turn, r.attempt, r.superseded]),
      [
        [1, 1, 1, 0],
        [2, 1, 1, 0],
        [3, 1, 1, 0],
        [4, 4, 1, 0],
        [5, 4, 1, 0],
      ],
    );
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
