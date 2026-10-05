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

/**
 * v3 (Fase 5): gesprekken + berichten, en documenten per gesprek. Eén
 * transactie inclusief user_version (die is transactioneel), zodat een
 * afgebroken migratie niets half achterlaat. Geen table-rebuild nodig:
 * ADD COLUMN met REFERENCES mag zolang de default NULL is. Bestaande
 * documenten krijgen conversation_id NULL en blijven in elk gesprek
 * doorzoekbaar; de gedeeltelijke unieke index vangt dubbele globale
 * documenten af (SQLite ziet NULLs in een gewone unieke index als verschillend).
 */
function migrateToV3(db: DatabaseSync): void {
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE conversations (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        title           TEXT    NOT NULL,
        title_is_custom INTEGER NOT NULL DEFAULT 0,
        model           TEXT    NOT NULL,
        num_ctx         INTEGER NOT NULL,
        created_at      INTEGER NOT NULL,
        updated_at      INTEGER NOT NULL
      )
    `);
    db.exec(`
      CREATE TABLE messages (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role            TEXT    NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
        kind            TEXT    NOT NULL CHECK (kind IN ('user', 'assistant', 'tool_result', 'notice')),
        content         TEXT    NOT NULL,
        tool_calls      TEXT,
        tool_name       TEXT,
        display         TEXT,
        model           TEXT,
        status          TEXT    NOT NULL DEFAULT 'complete' CHECK (status IN ('complete', 'interrupted', 'error')),
        created_at      INTEGER NOT NULL
      )
    `);
    db.exec('CREATE INDEX messages_conversation_idx ON messages(conversation_id, id)');
    db.exec('ALTER TABLE documents ADD COLUMN conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE');
    db.exec('DROP INDEX IF EXISTS documents_content_hash_unique');
    db.exec('CREATE UNIQUE INDEX documents_conversation_hash_unique ON documents(conversation_id, content_hash)');
    db.exec('CREATE UNIQUE INDEX documents_global_hash_unique ON documents(content_hash) WHERE conversation_id IS NULL');
    db.exec('PRAGMA user_version = 3');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/**
 * v5 (Fase 6, modelrouter — architect-advies):
 * - conversations: model_mode ('auto' standaard, of 'fixed' = `model`) en
 *   routed_model (laatst gerouteerde model, voor stickiness; los van `model`
 *   zodat een eerder vast gekozen model bewaard blijft).
 * - messages: turn (id van het gebruikersbericht dat de beurt startte),
 *   attempt (1, 2, … bij escalatie/"Probeer slimmer"), superseded (vervangen
 *   poging: niet meer naar het model, wel gedimd zichtbaar) en route (reden
 *   voor het label onder het antwoord).
 * - router_decisions: log van elke routerkeuze; blijft bestaan als een
 *   gesprek verdwijnt (SET NULL), want die is er juist om achteraf te kijken.
 * - app_settings: instellingen uit het instellingenscherm (ontbrekende rij =
 *   standaard uit config.json, dus geen seed-rijen).
 * - message_images: afbeeldingen bij een bericht, apart van messages zodat
 *   het vaak gelezen berichtenoverzicht geen BLOBs meesleept.
 */
function migrateToV5(db: DatabaseSync): void {
  db.exec('BEGIN');
  try {
    db.exec("ALTER TABLE conversations ADD COLUMN model_mode TEXT NOT NULL DEFAULT 'auto' CHECK (model_mode IN ('auto', 'fixed'))");
    db.exec('ALTER TABLE conversations ADD COLUMN routed_model TEXT');
    db.exec('ALTER TABLE messages ADD COLUMN turn INTEGER');
    db.exec('ALTER TABLE messages ADD COLUMN attempt INTEGER NOT NULL DEFAULT 1');
    db.exec('ALTER TABLE messages ADD COLUMN superseded INTEGER NOT NULL DEFAULT 0');
    db.exec('ALTER TABLE messages ADD COLUMN route TEXT');
    db.exec(`
      UPDATE messages SET turn = (
        SELECT MAX(u.id) FROM messages u
        WHERE u.conversation_id = messages.conversation_id AND u.kind = 'user' AND u.id <= messages.id
      )
    `);
    db.exec('CREATE INDEX messages_turn_idx ON messages(turn, attempt)');
    db.exec(`
      CREATE TABLE router_decisions (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
        message_id      INTEGER REFERENCES messages(id) ON DELETE SET NULL,
        attempt         INTEGER NOT NULL,
        model           TEXT    NOT NULL,
        role            TEXT,
        source          TEXT    NOT NULL,
        reason          TEXT    NOT NULL,
        task            TEXT,
        complexity      TEXT,
        classify_ms     INTEGER,
        load_ms         INTEGER,
        created_at      INTEGER NOT NULL,
        UNIQUE (message_id, attempt)
      )
    `);
    db.exec('CREATE INDEX router_decisions_conversation_idx ON router_decisions(conversation_id)');
    db.exec('CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID');
    db.exec(`
      CREATE TABLE message_images (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        ordinal    INTEGER NOT NULL,
        name       TEXT    NOT NULL,
        mime       TEXT    NOT NULL,
        data       BLOB    NOT NULL,
        UNIQUE (message_id, ordinal)
      )
    `);
    db.exec('PRAGMA user_version = 5');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
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

  if (version < 3) {
    migrateToV3(db);
  }

  if (version < 4) {
    // Fase 5d: max. antwoordlengte en temperature per gesprek. NULL = standaard uit config.json.
    db.exec('BEGIN');
    try {
      db.exec('ALTER TABLE conversations ADD COLUMN num_predict INTEGER');
      db.exec('ALTER TABLE conversations ADD COLUMN temperature REAL');
      db.exec('PRAGMA user_version = 4');
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  if (version < 5) {
    migrateToV5(db);
  }

  return db;
}
