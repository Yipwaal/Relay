import { DatabaseSync } from 'node:sqlite';

/**
 * Gebruikt Node's ingebouwde node:sqlite in plaats van better-sqlite3: dat
 * laatste is een native addon die tegen Electron's ABI herbouwd moet worden
 * (@electron/rebuild), wat in een sandbox/CI-omgeving niet betrouwbaar werkt.
 * node:sqlite heeft geen rebuild-stap nodig en is beschikbaar in de Node-
 * versie die deze Electron-versie bundelt (nog experimenteel, zie README).
 *
 * Eén database (relay.db) voor zowel memory (Fase 3) als documenten
 * (Fase 4), met PRAGMA user_version als simpel migratiemechanisme: elke
 * versie past alleen de stappen toe die nog ontbreken, dus een bestaande
 * database van een eerdere fase blijft intact.
 */
function getUserVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  return row.user_version;
}

export function openRelayDb(filePath: string): DatabaseSync {
  const db = new DatabaseSync(filePath);
  db.exec('PRAGMA foreign_keys = ON');

  const version = getUserVersion(db);

  if (version < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS facts (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        text       TEXT    NOT NULL,
        source     TEXT    NOT NULL DEFAULT 'user',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS facts_text_unique ON facts(text)');
    db.exec('PRAGMA user_version = 1');
  }

  if (version < 2) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        title        TEXT    NOT NULL,
        content_hash TEXT    NOT NULL,
        char_count   INTEGER NOT NULL,
        chunk_count  INTEGER NOT NULL,
        embed_model  TEXT    NOT NULL,
        embed_dims   INTEGER NOT NULL,
        created_at   INTEGER NOT NULL
      )
    `);
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS documents_content_hash_unique ON documents(content_hash)');
    db.exec(`
      CREATE TABLE IF NOT EXISTS document_chunks (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        ordinal     INTEGER NOT NULL,
        text        TEXT    NOT NULL,
        embedding   BLOB    NOT NULL,
        UNIQUE(document_id, ordinal)
      )
    `);
    db.exec('PRAGMA user_version = 2');
  }

  return db;
}
