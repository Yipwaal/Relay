import { DatabaseSync } from 'node:sqlite';

/**
 * Gebruikt Node's ingebouwde node:sqlite in plaats van better-sqlite3: dat
 * laatste is een native addon die tegen Electron's ABI herbouwd moet worden
 * (@electron/rebuild), wat in een sandbox/CI-omgeving niet betrouwbaar werkt.
 * node:sqlite heeft geen rebuild-stap nodig en is beschikbaar in de Node-
 * versie die deze Electron-versie bundelt (nog experimenteel, zie README).
 */
export function openMemoryDb(filePath: string): DatabaseSync {
  const db = new DatabaseSync(filePath);

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

  return db;
}
