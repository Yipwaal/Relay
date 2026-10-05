import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openRelayDb } from '../../db';
import { createConversationStore } from '../../conversations/store';
import { createRouterDecisionStore } from '../decisions-store';
import { createSettingsStore } from '../settings-store';
import type { RouteDecision } from '../../../router/types';

const OPTIONS = { numCtx: 8192, numPredict: 1024, temperature: 0.7 };

function setup() {
  const db = openRelayDb(':memory:');
  const conversations = createConversationStore(db);
  const conversation = conversations.create({ modelMode: 'auto', model: '', options: OPTIONS });
  const turn = conversations.appendUserMessage(conversation.id, 'Schrijf een sorteerfunctie');
  return { db, conversations, conversationId: conversation.id, turn, decisions: createRouterDecisionStore(db), settings: createSettingsStore(db) };
}

const classified: RouteDecision = {
  model: 'gpt-oss:20b',
  role: 'reasoning',
  source: 'classifier',
  reason: 'code',
  classification: { taak: 'code', complexiteit: 'middel' },
  classifyMs: 412,
};

test('record logt elke poging van een beurt met oplopend attempt, laadtijd achteraf', () => {
  const { decisions, conversationId, turn } = setup();
  const first = decisions.record(conversationId, turn, classified);
  assert.equal(first.attempt, 1);
  decisions.setLoadMs(first.id, 1234.6);

  const second = decisions.record(conversationId, turn, { model: 'qwen3.8:27b', role: 'max', source: 'escalation', reason: 'probeer slimmer' });
  assert.equal(second.attempt, 2);

  const latest = decisions.latestFor(turn);
  assert.equal(latest?.model, 'qwen3.8:27b');
  assert.equal(latest?.attempt, 2);

  const [newest, oldest] = decisions.list({ conversationId, limit: 10 });
  assert.equal(newest?.id, second.id);
  assert.deepEqual(
    { model: oldest?.model, task: oldest?.task, complexity: oldest?.complexity, classifyMs: oldest?.classifyMs, loadMs: oldest?.loadMs, reason: oldest?.reason },
    { model: 'gpt-oss:20b', task: 'code', complexity: 'middel', classifyMs: 412, loadMs: 1235, reason: 'code' },
  );
});

test('het routerlog blijft staan als het gesprek verwijderd wordt', () => {
  const { decisions, conversations, conversationId, turn } = setup();
  decisions.record(conversationId, turn, classified);
  conversations.delete(conversationId);
  const [row] = decisions.list({ limit: 10 });
  assert.equal(row?.model, 'gpt-oss:20b');
  assert.equal(row?.conversationId, null);
  assert.equal(row?.messageId, null);
});

test('settings: ontbrekende rij geeft de standaard, daarna de opgeslagen waarde', () => {
  const { settings, db } = setup();
  assert.equal(settings.get('allowMax', false), false);
  settings.set('allowMax', true);
  assert.equal(settings.get('allowMax', false), true);
  settings.set('allowMax', false);
  assert.equal(settings.get('allowMax', true), false);
  // Een kapotte of verkeerd getypte waarde valt terug op de standaard.
  db.prepare("UPDATE app_settings SET value = '\"ja\"' WHERE key = 'allowMax'").run();
  assert.equal(settings.get('allowMax', false), false);
});
