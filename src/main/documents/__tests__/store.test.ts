import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openRelayDb } from '../../db';
import { createConversationStore } from '../../conversations/store';
import { createDocumentStore, type AddDocumentInput } from '../store';
import { normalize } from '../vector';

function setup() {
  const db = openRelayDb(':memory:');
  const conversations = createConversationStore(db);
  const a = conversations.create({ model: 'm', numCtx: 8192 }).id;
  const b = conversations.create({ model: 'm', numCtx: 8192 }).id;
  return { db, conversations, store: createDocumentStore(db), a, b };
}

function vec(...values: number[]): Float32Array {
  return normalize(new Float32Array(values));
}

function doc(conversationId: number, contentHash: string, overrides: Partial<AddDocumentInput> = {}): AddDocumentInput {
  return {
    conversationId,
    title: `${contentHash}.txt`,
    contentHash,
    charCount: 10,
    embedModel: 'm',
    embedDims: 2,
    chunks: [{ text: `tekst ${contentHash}`, embedding: vec(1, 0) }],
    ...overrides,
  };
}

/** Documenten van vóór Fase 5 hebben conversation_id NULL. */
function makeGlobal(db: DatabaseSync, id: number): void {
  db.prepare('UPDATE documents SET conversation_id = NULL WHERE id = ?').run(id);
}

test('addDocument slaat een document met chunks op, gekoppeld aan het gesprek', () => {
  const { store, a } = setup();
  const added = store.addDocument(doc(a, 'h1', { chunks: [{ text: 'een', embedding: vec(1, 0) }, { text: 'twee', embedding: vec(0, 1) }] }));
  assert.equal(added.chunkCount, 2);
  assert.equal(added.conversationId, a);
  assert.deepEqual(store.listDocuments(a).map((d) => d.id), [added.id]);
});

test('een gesprek ziet alleen zijn eigen documenten plus de globale', () => {
  const { db, store, a, b } = setup();
  const own = store.addDocument(doc(a, 'eigen'));
  const other = store.addDocument(doc(b, 'ander'));
  const legacy = store.addDocument(doc(b, 'oud'));
  makeGlobal(db, legacy.id);

  assert.deepEqual(store.listDocuments(a).map((d) => d.id).sort(), [own.id, legacy.id].sort());
  assert.deepEqual(store.listDocuments(b).map((d) => d.id).sort(), [other.id, legacy.id].sort());
  assert.deepEqual(store.search(vec(1, 0), 'm', 10, a).map((r) => r.documentId).sort(), [own.id, legacy.id].sort());
});

test('hetzelfde bestand mag in twee gesprekken, maar niet twee keer in één gesprek', () => {
  const { store, a, b } = setup();
  store.addDocument(doc(a, 'dup'));
  store.addDocument(doc(b, 'dup'));
  assert.throws(() => store.addDocument(doc(a, 'dup')), /al toegevoegd/);
});

test('een bestand dat al globaal bestaat wordt niet nog eens per gesprek toegevoegd', () => {
  const { db, store, a } = setup();
  makeGlobal(db, store.addDocument(doc(a, 'glob')).id);
  assert.throws(() => store.addDocument(doc(a, 'glob')), /al toegevoegd/);
});

test('addDocument weigert een document zonder chunks', () => {
  const { store, a } = setup();
  assert.throws(() => store.addDocument(doc(a, 'leeg', { chunks: [] })), /geen bruikbare tekst/);
});

test('deleteDocument verwijdert het document en (via cascade) zijn chunks', () => {
  const { store, a } = setup();
  const added = store.addDocument(doc(a, 'weg'));
  store.deleteDocument(added.id);
  assert.equal(store.listDocuments(a).length, 0);
  assert.equal(store.search(vec(1, 0), 'm', 5, a).length, 0);
});

test('een gesprek verwijderen verwijdert zijn documenten, maar niet de globale', () => {
  const { db, conversations, store, a, b } = setup();
  store.addDocument(doc(a, 'van-a'));
  const legacy = store.addDocument(doc(a, 'globaal'));
  makeGlobal(db, legacy.id);

  conversations.delete(a);

  assert.deepEqual(store.listDocuments(b).map((d) => d.id), [legacy.id]);
  const chunkCount = db.prepare('SELECT COUNT(*) AS n FROM document_chunks').get() as { n: number };
  assert.equal(chunkCount.n, 1);
});

test('search geeft de best passende chunks terug, gesorteerd op score', () => {
  const { store, a } = setup();
  store.addDocument(
    doc(a, 'dieren', {
      chunks: [
        { text: 'over katten', embedding: vec(1, 0) },
        { text: 'over honden', embedding: vec(0, 1) },
      ],
    }),
  );
  const results = store.search(vec(1, 0), 'm', 5, a);
  assert.equal(results[0]?.text, 'over katten');
  assert.ok((results[0]?.score ?? 0) > (results[1]?.score ?? 0));
});

test('search en hasDocumentsForModel negeren een ander embedModel', () => {
  const { store, a } = setup();
  assert.equal(store.hasDocumentsForModel('m', a), false);
  store.addDocument(doc(a, 'oud', { embedModel: 'oud-model' }));
  assert.equal(store.search(vec(1, 0), 'nieuw-model', 5, a).length, 0);
  assert.equal(store.hasDocumentsForModel('oud-model', a), true);
  assert.equal(store.hasDocumentsForModel('ander-model', a), false);
});

test('migratie v2 → v3 behoudt bestaande documenten als globaal, doorzoekbaar in elk gesprek', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'relay-mig-')), 'relay.db');
  // Schema zoals Fase 4 het achterliet (user_version 2), met één document.
  const v2 = new DatabaseSync(file);
  v2.exec(`
    CREATE TABLE facts (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'user',
                        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE UNIQUE INDEX facts_text_unique ON facts(text);
    CREATE TABLE documents (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, content_hash TEXT NOT NULL,
                            char_count INTEGER NOT NULL, chunk_count INTEGER NOT NULL, embed_model TEXT NOT NULL,
                            embed_dims INTEGER NOT NULL, created_at INTEGER NOT NULL);
    CREATE UNIQUE INDEX documents_content_hash_unique ON documents(content_hash);
    CREATE TABLE document_chunks (id INTEGER PRIMARY KEY AUTOINCREMENT,
                                  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                                  ordinal INTEGER NOT NULL, text TEXT NOT NULL, embedding BLOB NOT NULL, UNIQUE(document_id, ordinal));
    INSERT INTO documents VALUES (1, 'oud.pdf', 'oude-hash', 10, 1, 'm', 2, 1);
    PRAGMA user_version = 2;
  `);
  v2.prepare('INSERT INTO document_chunks (document_id, ordinal, text, embedding) VALUES (1, 0, ?, ?)').run(
    'oude tekst',
    new Uint8Array(vec(1, 0).buffer),
  );
  v2.close();

  const db = openRelayDb(file);
  const version = db.prepare('PRAGMA user_version').get() as { user_version: number };
  assert.equal(version.user_version, 3);
  const store = createDocumentStore(db);
  const conversation = createConversationStore(db).create({ model: 'm', numCtx: 8192 });
  const docs = store.listDocuments(conversation.id);
  assert.equal(docs.length, 1);
  assert.equal(docs[0]?.conversationId, null);
  assert.equal(store.search(vec(1, 0), 'm', 5, conversation.id)[0]?.text, 'oude tekst');
  db.close();
});
