import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openRelayDb } from '../../db';
import { createConversationStore, type NewMessage } from '../store';

function setup() {
  const db = openRelayDb(':memory:');
  return { db, store: createConversationStore(db) };
}

const user = (content: string): NewMessage => ({
  role: 'user',
  kind: 'user',
  content,
  toolCalls: null,
  toolName: null,
  display: null,
  model: null,
  status: 'complete',
});

test('create geeft een nieuw gesprek met model en context uit de invoer', () => {
  const { store } = setup();
  const c = store.create({ model: 'gemma4:12b', numCtx: 8192 });
  assert.equal(c.title, 'Nieuw gesprek');
  assert.equal(c.model, 'gemma4:12b');
  assert.equal(c.numCtx, 8192);
  assert.equal(c.titleIsCustom, false);
  assert.equal(c.documentCount, 0);
});

test('list sorteert op laatst bijgewerkt, nieuwste eerst', async () => {
  const { store } = setup();
  const a = store.create({ model: 'm', numCtx: 1 });
  const b = store.create({ model: 'm', numCtx: 1 });
  await new Promise((r) => setTimeout(r, 5));
  store.appendMessages(a.id, [user('hoi')]);
  assert.deepEqual(store.list().map((c) => c.id), [a.id, b.id]);
});

test('appendMessages bewaart volgorde, JSON-velden en status', () => {
  const { store } = setup();
  const c = store.create({ model: 'm', numCtx: 1 });
  store.appendMessages(c.id, [
    user('vraag'),
    { role: 'assistant', kind: 'assistant', content: '', toolCalls: [{ name: 'web_search', args: { query: 'q' } }], toolName: null, display: null, model: 'm', status: 'complete' },
    {
      role: 'tool',
      kind: 'tool_result',
      content: '{"results":[]}',
      toolCalls: null,
      toolName: 'web_search',
      display: { tool: 'web_search', query: 'q', label: 'l', summary: '0 resultaten', ok: true, preview: '{}', items: [], durationMs: 12 },
      model: null,
      status: 'complete',
    },
  ]);
  const rows = store.listMessages(c.id);
  assert.deepEqual(rows.map((r) => r.kind), ['user', 'assistant', 'tool_result']);
  assert.deepEqual(rows[1]?.toolCalls, [{ name: 'web_search', args: { query: 'q' } }]);
  assert.equal(rows[2]?.display?.durationMs, 12);
});

test('een handmatige titel wint van een automatische', () => {
  const { store } = setup();
  const c = store.create({ model: 'm', numCtx: 1 });
  assert.equal(store.setAutoTitle(c.id, 'Automatisch'), true);
  store.rename(c.id, '  Mijn   titel ');
  assert.equal(store.setAutoTitle(c.id, 'Later automatisch'), false);
  assert.equal(store.get(c.id)?.title, 'Mijn titel');
});

test('rename weigert een lege titel', () => {
  const { store } = setup();
  const c = store.create({ model: 'm', numCtx: 1 });
  assert.throws(() => store.rename(c.id, '   '), /leeg/);
});

test('delete verwijdert het gesprek en (via cascade) zijn berichten', () => {
  const { db, store } = setup();
  const c = store.create({ model: 'm', numCtx: 1 });
  store.appendMessages(c.id, [user('weg')]);
  store.delete(c.id);
  assert.equal(store.get(c.id), undefined);
  const count = db.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number };
  assert.equal(count.n, 0);
});

test('appendMessages naar een verwijderd gesprek faalt zonder half weg te schrijven', () => {
  const { db, store } = setup();
  const c = store.create({ model: 'm', numCtx: 1 });
  store.delete(c.id);
  assert.throws(() => store.appendMessages(c.id, [user('a'), user('b')]));
  const count = db.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number };
  assert.equal(count.n, 0);
});
