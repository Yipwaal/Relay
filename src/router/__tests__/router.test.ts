import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escalate, routeEmbedding, routeInternal, routeMessage, NoModelError, type RouteMessageInput, type RouterContext } from '../router';
import { resolveRoles } from '../catalog';
import type { ClassifyResult } from '../classifier';
import type { Classification } from '../types';
import { ALL_INSTALLED, CONFIGURED, allRoles } from './fixtures';

function ctxWith(result: ClassifyResult | Classification): RouterContext & { calls: string[] } {
  const calls: string[] = [];
  const classifyResult: ClassifyResult = 'taak' in result ? { classification: result, ms: 120 } : result;
  return {
    calls,
    roles: allRoles(),
    installed: ALL_INSTALLED,
    async classify(text) {
      calls.push(text);
      return classifyResult;
    },
  };
}

const base: RouteMessageInput = { text: 'Hoi!', images: 0, mode: 'auto', currentModel: '', allowMax: false };

test('auto: de classificatie bepaalt het model en de reden', async () => {
  const decision = await routeMessage({ ...base, text: 'Schrijf een parser' }, ctxWith({ taak: 'code', complexiteit: 'middel' }));
  assert.deepEqual(
    { model: decision.model, role: decision.role, source: decision.source, reason: decision.reason, classifyMs: decision.classifyMs },
    { model: 'gpt-oss:20b', role: 'reasoning', source: 'classifier', reason: 'code', classifyMs: 120 },
  );
});

test('auto: chat/laag → fast', async () => {
  const decision = await routeMessage(base, ctxWith({ taak: 'chat', complexiteit: 'laag' }));
  assert.equal(decision.model, 'gemma4:12b');
  assert.equal(decision.reason, 'chat');
});

test('ontbrekend reasoning-model: een zware vraag komt zonder toestemming nooit bij het max-model', async () => {
  const installed = ALL_INSTALLED.filter((m) => m.name !== 'gpt-oss:20b');
  const ctx = { ...ctxWith({ taak: 'code', complexiteit: 'hoog' }), installed, roles: resolveRoles(CONFIGURED, installed) };
  assert.notEqual((await routeMessage(base, ctx)).model, 'qwen3.8:27b');
  assert.equal((await routeMessage({ ...base, allowMax: true }, ctx)).model, 'qwen3.8:27b');
});

test('geen max-model geïnstalleerd: max toegestaan valt terug op reasoning', async () => {
  const installed = ALL_INSTALLED.filter((m) => m.name !== 'qwen3.8:27b');
  const ctx = { ...ctxWith({ taak: 'onderzoek', complexiteit: 'hoog' }), installed, roles: resolveRoles(CONFIGURED, installed) };
  assert.equal((await routeMessage({ ...base, allowMax: true }, ctx)).model, 'gpt-oss:20b');
});

test('auto: max alleen als de gebruiker het toestaat', async () => {
  const hard = { taak: 'redeneren', complexiteit: 'hoog' } as const;
  assert.equal((await routeMessage(base, ctxWith(hard))).model, 'gpt-oss:20b');
  assert.equal((await routeMessage({ ...base, allowMax: true }, ctxWith(hard))).model, 'qwen3.8:27b');
});

test('auto: timeout of fout bij classificeren → fast, met de reden erbij', async () => {
  const slow = await routeMessage(base, ctxWith({ classification: null, ms: 3000, error: 'classificatie duurde langer dan 3000 ms' }));
  assert.deepEqual([slow.model, slow.source, slow.reason], ['gemma4:12b', 'fallback', 'classificatie te traag']);
  const broken = await routeMessage(base, ctxWith({ classification: null, ms: 40, error: 'ongeldige classificatie' }));
  assert.equal(broken.reason, 'classificatie mislukt');
});

test('afbeelding → fast/vision, zonder classificatie', async () => {
  const ctx = ctxWith({ taak: 'code', complexiteit: 'hoog' });
  const decision = await routeMessage({ ...base, images: 1 }, ctx);
  assert.deepEqual([decision.model, decision.source, decision.reason], ['gemma4:12b', 'rule', 'afbeelding']);
  assert.equal(ctx.calls.length, 0);
});

test('afbeelding: een hoger model dat zelf beelden ziet blijft, maar max alleen zolang max mag', async () => {
  const installed = ALL_INSTALLED.map((m) => (m.name === 'qwen3.8:27b' ? { ...m, capabilities: ['completion', 'vision'] } : m));
  const ctx = { ...ctxWith({ taak: 'chat', complexiteit: 'laag' }), installed, roles: resolveRoles(CONFIGURED, installed) };
  const kept = await routeMessage({ ...base, images: 1, currentModel: 'qwen3.8:27b', allowMax: true }, ctx);
  assert.deepEqual([kept.model, kept.source], ['qwen3.8:27b', 'sticky']);
  const notAllowed = await routeMessage({ ...base, images: 1, currentModel: 'qwen3.8:27b', allowMax: false }, ctx);
  assert.deepEqual([notAllowed.model, notAllowed.source], ['gemma4:12b', 'rule']);
});

test('afbeelding zonder beeldmodel: de reden zegt het', async () => {
  const installed = ALL_INSTALLED.map((m) => ({ ...m, capabilities: (m.capabilities ?? []).filter((c) => c !== 'vision') }));
  const ctx = { ...ctxWith({ taak: 'chat', complexiteit: 'laag' }), installed, roles: resolveRoles(CONFIGURED, installed) };
  assert.equal((await routeMessage({ ...base, images: 1 }, ctx)).reason, 'afbeelding (geen beeldmodel geïnstalleerd)');
});

test('stickiness: na een code-vraag blijft een eenvoudige vervolgvraag op hetzelfde model', async () => {
  const decision = await routeMessage({ ...base, currentModel: 'gpt-oss:20b' }, ctxWith({ taak: 'chat', complexiteit: 'laag' }));
  assert.deepEqual([decision.model, decision.source, decision.reason], ['gpt-oss:20b', 'sticky', 'chat · aangehouden']);
});

test('stickiness: blijft de keuze hetzelfde model, dan is het gewoon de routerkeuze (geen "aangehouden")', async () => {
  const decision = await routeMessage({ ...base, currentModel: 'gemma4:12b' }, ctxWith({ taak: 'chat', complexiteit: 'laag' }));
  assert.deepEqual([decision.model, decision.source, decision.reason], ['gemma4:12b', 'classifier', 'chat']);
  const slow = await routeMessage({ ...base, currentModel: 'gemma4:12b' }, ctxWith({ classification: null, ms: 3000, error: 'duurde langer dan 3000 ms' }));
  assert.deepEqual([slow.model, slow.source, slow.reason], ['gemma4:12b', 'fallback', 'classificatie te traag']);
});

test('stickiness: omhoog wisselen mag wel', async () => {
  const decision = await routeMessage({ ...base, currentModel: 'gemma4:12b' }, ctxWith({ taak: 'code', complexiteit: 'hoog' }));
  assert.equal(decision.model, 'gpt-oss:20b');
});

test('stickiness geldt ook voor een mislukte classificatie (geen onnodige herlaadtijd)', async () => {
  const decision = await routeMessage({ ...base, currentModel: 'gpt-oss:20b' }, ctxWith({ classification: null, ms: 3000, error: 'duurde langer dan 3000 ms' }));
  assert.equal(decision.model, 'gpt-oss:20b');
});

test('vast model: geen classificatie, gewoon dat model', async () => {
  const ctx = ctxWith({ taak: 'code', complexiteit: 'hoog' });
  const decision = await routeMessage({ ...base, mode: 'fixed', currentModel: 'qwen3.5:9b' }, ctx);
  assert.deepEqual([decision.model, decision.source, decision.reason], ['qwen3.5:9b', 'fixed', 'vast gekozen']);
  assert.equal(ctx.calls.length, 0);
});

test('vast model dat geen beelden ziet: de afbeelding gaat toch naar het beeldmodel', async () => {
  const decision = await routeMessage({ ...base, mode: 'fixed', currentModel: 'gpt-oss:20b', images: 1 }, ctxWith({ taak: 'chat', complexiteit: 'laag' }));
  assert.equal(decision.model, 'gemma4:12b');
  assert.match(decision.reason, /vast model ziet geen beelden/);
});

test('interne taken en embeddings', () => {
  const roles = allRoles();
  assert.deepEqual(routeInternal('titel', roles), { model: 'qwen3.5:9b', role: 'background', source: 'rule', reason: 'chattitel' });
  assert.equal(routeEmbedding(roles).model, 'qwen3-embedding:0.6b');
  const noEmbedding = resolveRoles(CONFIGURED, ALL_INSTALLED.filter((m) => !m.name.includes('embedding')));
  assert.throws(() => routeEmbedding(noEmbedding), /ollama pull qwen3-embedding:0\.6b/);
});

test('zonder enig chatmodel een duidelijke fout', async () => {
  const ctx = { ...ctxWith({ taak: 'chat', complexiteit: 'laag' }), roles: resolveRoles(CONFIGURED, []), installed: [] };
  await assert.rejects(routeMessage(base, ctx), NoModelError);
});

test('escalate geeft het volgende model omhoog met de opgegeven reden', () => {
  const ctx = { roles: allRoles(), installed: ALL_INSTALLED };
  assert.deepEqual(escalate('gemma4:12b', ctx, { allowMax: false, images: 0, reason: 'probeer slimmer' }), {
    model: 'gpt-oss:20b',
    role: 'reasoning',
    source: 'escalation',
    reason: 'probeer slimmer',
  });
  assert.equal(escalate('gpt-oss:20b', ctx, { allowMax: false, images: 0, reason: 'x' }), null);
});
