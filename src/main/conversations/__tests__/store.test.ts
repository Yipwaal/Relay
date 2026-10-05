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
  route: null,
});

test('create geeft een nieuw gesprek met model en context uit de invoer', () => {
  const { store } = setup();
  const c = store.create({ modelMode: 'auto', model: 'gemma4:12b', options: { numCtx: 8192, numPredict: 1024, temperature: 0.7 } });
  assert.equal(c.title, 'Nieuw gesprek');
  assert.equal(c.model, 'gemma4:12b');
  assert.equal(c.numCtx, 8192);
  assert.equal(c.titleIsCustom, false);
  assert.equal(c.documentCount, 0);
});

test('list sorteert op laatst bijgewerkt, nieuwste eerst', async () => {
  const { store } = setup();
  const a = store.create({ modelMode: 'auto', model: 'm', options: { numCtx: 1, numPredict: 1024, temperature: 0.7 } });
  const b = store.create({ modelMode: 'auto', model: 'm', options: { numCtx: 1, numPredict: 1024, temperature: 0.7 } });
  await new Promise((r) => setTimeout(r, 5));
  store.appendMessages(a.id, null, [user('hoi')]);
  assert.deepEqual(store.list().map((c) => c.id), [a.id, b.id]);
});

test('appendMessages bewaart volgorde, JSON-velden en status', () => {
  const { store } = setup();
  const c = store.create({ modelMode: 'auto', model: 'm', options: { numCtx: 1, numPredict: 1024, temperature: 0.7 } });
  store.appendMessages(c.id, null, [
    user('vraag'),
    { role: 'assistant', kind: 'assistant', content: '', toolCalls: [{ name: 'web_search', args: { query: 'q' } }], toolName: null, display: null, model: 'm', status: 'complete', route: 'code' },
    {
      role: 'tool',
      kind: 'tool_result',
      content: '{"results":[]}',
      toolCalls: null,
      toolName: 'web_search',
      display: { tool: 'web_search', query: 'q', label: 'l', summary: '0 resultaten', ok: true, preview: '{}', items: [], durationMs: 12 },
      model: null,
      status: 'complete',
      route: null,
    },
  ]);
  const rows = store.listMessages(c.id);
  assert.deepEqual(rows.map((r) => r.kind), ['user', 'assistant', 'tool_result']);
  assert.deepEqual(rows[1]?.toolCalls, [{ name: 'web_search', args: { query: 'q' } }]);
  assert.equal(rows[2]?.display?.durationMs, 12);
});

test('een handmatige titel wint van een automatische', () => {
  const { store } = setup();
  const c = store.create({ modelMode: 'auto', model: 'm', options: { numCtx: 1, numPredict: 1024, temperature: 0.7 } });
  assert.equal(store.setAutoTitle(c.id, 'Automatisch'), true);
  store.rename(c.id, '  Mijn   titel ');
  assert.equal(store.setAutoTitle(c.id, 'Later automatisch'), false);
  assert.equal(store.get(c.id)?.title, 'Mijn titel');
});

test('rename weigert een lege titel', () => {
  const { store } = setup();
  const c = store.create({ modelMode: 'auto', model: 'm', options: { numCtx: 1, numPredict: 1024, temperature: 0.7 } });
  assert.throws(() => store.rename(c.id, '   '), /leeg/);
});

test('delete verwijdert het gesprek en (via cascade) zijn berichten', () => {
  const { db, store } = setup();
  const c = store.create({ modelMode: 'auto', model: 'm', options: { numCtx: 1, numPredict: 1024, temperature: 0.7 } });
  store.appendMessages(c.id, null, [user('weg')]);
  store.delete(c.id);
  assert.equal(store.get(c.id), undefined);
  const count = db.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number };
  assert.equal(count.n, 0);
});

test('appendMessages naar een verwijderd gesprek faalt zonder half weg te schrijven', () => {
  const { db, store } = setup();
  const c = store.create({ modelMode: 'auto', model: 'm', options: { numCtx: 1, numPredict: 1024, temperature: 0.7 } });
  store.delete(c.id);
  assert.throws(() => store.appendMessages(c.id, null, [user('a'), user('b')]));
  const count = db.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number };
  assert.equal(count.n, 0);
});

test('setModel en setOptions bewaren per gesprek; oude gesprekken vallen terug op de standaard', async () => {
  const { db, store } = setup();
  const c = store.create({ modelMode: 'auto', model: 'm', options: { numCtx: 8192, numPredict: 1024, temperature: 0.7 } });
  store.setModelMode(c.id, 'fixed', 'qwen2.5:14b');
  const updated = store.setOptions(c.id, { numCtx: 16384, numPredict: -1, temperature: 0.2 });
  assert.equal(updated.model, 'qwen2.5:14b');
  assert.deepEqual([updated.numCtx, updated.numPredict, updated.temperature], [16384, -1, 0.2]);

  // Een gesprek van vóór v4 heeft NULL voor de nieuwe kolommen.
  db.prepare('UPDATE conversations SET num_predict = NULL, temperature = NULL WHERE id = ?').run(c.id);
  const { resolveOptions } = await import('../store');
  assert.deepEqual(resolveOptions(store.get(c.id)!, { numCtx: 1, numPredict: 512, temperature: 1 }), { numCtx: 16384, numPredict: 512, temperature: 1 });
});

test('modelmodus: vast model bewaren, terug naar automatisch laat de keuze staan, gerouteerd model apart', () => {
  const { store } = setup();
  const c = store.create({ modelMode: 'auto', model: '', options: { numCtx: 8192, numPredict: 1024, temperature: 0.7 } });
  assert.equal(c.modelMode, 'auto');
  assert.equal(c.routedModel, null);
  store.setRoutedModel(c.id, 'gpt-oss:20b');
  const fixed = store.setModelMode(c.id, 'fixed', 'qwen3.5:9b');
  assert.deepEqual([fixed.modelMode, fixed.model, fixed.routedModel], ['fixed', 'qwen3.5:9b', 'gpt-oss:20b']);
  const auto = store.setModelMode(c.id, 'auto');
  assert.deepEqual([auto.modelMode, auto.model], ['auto', 'qwen3.5:9b']);
  assert.throws(() => store.setModelMode(c.id, 'fixed'), /Kies een model/);
});

test('beurten en pogingen: een nieuwe poging markeert de vorige pas als vervangen bij zijn eerste batch', () => {
  const { store } = setup();
  const c = store.create({ modelMode: 'auto', model: '', options: { numCtx: 8192, numPredict: 1024, temperature: 0.7 } });
  const turn = store.appendUserMessage(c.id, 'Vraag');
  assert.deepEqual(store.latestTurn(c.id), { turn, text: 'Vraag' });
  const answer = (content: string): NewMessage => ({ ...user(content), role: 'assistant', kind: 'assistant', model: 'm', route: 'chat' });

  store.appendMessages(c.id, { turn, attempt: 1 }, [answer('Poging 1')]);
  store.appendMessages(c.id, { turn, attempt: 2 }, [answer('Poging 2')], { supersedeOlderAttempts: true });

  const rows = store.listMessages(c.id);
  assert.deepEqual(
    rows.map((r) => [r.content, r.turn, r.attempt, r.superseded]),
    [
      ['Vraag', turn, 1, false],
      ['Poging 1', turn, 1, true],
      ['Poging 2', turn, 2, false],
    ],
  );
});
