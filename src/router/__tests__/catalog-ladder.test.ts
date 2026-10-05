import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRoles, sameModel } from '../catalog';
import { keepCurrentModel, levelOf, nextModelUp } from '../ladder';
import { ALL_INSTALLED, CONFIGURED, allRoles } from './fixtures';
import type { InstalledModel } from '../types';

test('resolveRoles gebruikt de geconfigureerde modellen als ze geïnstalleerd zijn', () => {
  const roles = allRoles();
  assert.equal(roles.fast.model, 'gemma4:12b');
  assert.equal(roles.max.model, 'qwen3.8:27b');
  assert.equal(roles.embedding.model, 'qwen3-embedding:0.6b');
  assert.ok(Object.values(roles).every((r) => !r.fallback));
});

test('resolveRoles valt per rol terug op het grootste geschikte model', () => {
  const installed: InstalledModel[] = [
    { name: 'llama3.1:8b', sizeBytes: 4.9e9, capabilities: ['completion'] },
    { name: 'gemma3:4b', sizeBytes: 3.3e9, capabilities: ['completion', 'vision'] },
    { name: 'qwen2.5:14b', sizeBytes: 9e9, capabilities: ['completion'] },
    { name: 'nomic-embed-text', sizeBytes: 0.3e9, capabilities: ['embedding'] },
    { name: 'embeddinggemma', sizeBytes: 0.6e9, capabilities: ['embedding'] },
  ];
  const roles = resolveRoles(CONFIGURED, installed);
  // fast/vision: liefst een model dat beelden ziet, ook als er grotere zijn.
  assert.deepEqual([roles.fast.model, roles.fast.fallback], ['gemma3:4b', true]);
  assert.equal(roles.reasoning.model, 'qwen2.5:14b');
  // Een vervangend max-model moet groter zijn dan reasoning: dat is er niet.
  assert.deepEqual([roles.max.model, roles.max.fallback], [null, false]);
  // background neemt het (al geladen) fast-model, niet het grootste: classificeren moet snel blijven.
  assert.equal(roles.background.model, 'gemma3:4b');
  // Embedding-modellen tellen nooit als chatmodel, en andersom.
  assert.equal(roles.embedding.model, 'embeddinggemma');
});

test('resolveRoles: een ontbrekend reasoning-model neemt nooit het max-model over', () => {
  const installed = ALL_INSTALLED.filter((m) => m.name !== 'gpt-oss:20b');
  const roles = resolveRoles(CONFIGURED, installed);
  assert.equal(roles.max.model, 'qwen3.8:27b');
  assert.equal(roles.reasoning.model, 'gemma4:12b');
  assert.equal(roles.reasoning.fallback, true);
});

test('resolveRoles: een vervangend max-model moet groter zijn dan reasoning en geen ander rolmodel', () => {
  const installed: InstalledModel[] = [
    ...ALL_INSTALLED.filter((m) => m.name !== 'qwen3.8:27b'),
    { name: 'llama3.3:70b', sizeBytes: 43e9, capabilities: ['completion', 'tools'] },
  ];
  assert.equal(resolveRoles(CONFIGURED, installed).max.model, 'llama3.3:70b');
  assert.equal(resolveRoles(CONFIGURED, ALL_INSTALLED.filter((m) => m.name !== 'qwen3.8:27b')).max.model, null);
});

test('resolveRoles: cloudmodellen zijn nooit een automatische vervanger', () => {
  const installed: InstalledModel[] = [
    { name: 'gemma4:12b', sizeBytes: 7.1e9, capabilities: ['completion', 'vision'] },
    { name: 'gpt-oss:120b-cloud', sizeBytes: 400, capabilities: ['completion'], remote: true },
    { name: 'deepseek-v3.1:671b-cloud', sizeBytes: 900, capabilities: ['completion'], remote: true },
  ];
  const roles = resolveRoles(CONFIGURED, installed);
  assert.ok(Object.values(roles).every((r) => r.model === null || r.model === 'gemma4:12b'));
});

test('resolveRoles: met alleen het max-model geïnstalleerd doet dat model alles', () => {
  const roles = resolveRoles(CONFIGURED, ALL_INSTALLED.filter((m) => m.name === 'qwen3.8:27b'));
  assert.deepEqual([roles.fast.model, roles.reasoning.model, roles.max.model], ['qwen3.8:27b', 'qwen3.8:27b', 'qwen3.8:27b']);
});

test('resolveRoles: zonder geschikt model blijft de rol leeg', () => {
  const roles = resolveRoles(CONFIGURED, [{ name: 'llama3.1:8b', sizeBytes: 4.9e9, capabilities: ['completion'] }]);
  assert.equal(roles.embedding.model, null);
  assert.equal(roles.fast.model, 'llama3.1:8b');
});

test('sameModel negeert een ontbrekende :latest-tag', () => {
  assert.ok(sameModel('llama3', 'llama3:latest'));
  assert.ok(!sameModel('llama3:8b', 'llama3:latest'));
});

test('levelOf plaatst rol-modellen op de ladder', () => {
  const roles = allRoles();
  assert.equal(levelOf('gemma4:12b', roles), 0);
  assert.equal(levelOf('gpt-oss:20b', roles), 1);
  assert.equal(levelOf('qwen3.8:27b', roles), 2);
  assert.equal(levelOf('qwen3.5:9b', roles), -1);
  assert.equal(levelOf('', roles), -1);
});

test('stickiness: alleen wisselen als de nieuwe keuze minstens één niveau hoger is', () => {
  const roles = allRoles();
  assert.equal(keepCurrentModel('gpt-oss:20b', 'fast', roles, false), true);
  assert.equal(keepCurrentModel('gpt-oss:20b', 'reasoning', roles, false), true);
  assert.equal(keepCurrentModel('gemma4:12b', 'reasoning', roles, false), false);
  assert.equal(keepCurrentModel('gpt-oss:20b', 'max', roles, true), false);
});

test('stickiness: geen vasthouden zonder huidig model, buiten de ladder, of aan max dat niet meer mag', () => {
  const roles = allRoles();
  assert.equal(keepCurrentModel('', 'fast', roles, false), false);
  assert.equal(keepCurrentModel('qwen3.5:9b', 'fast', roles, false), false);
  assert.equal(keepCurrentModel('qwen3.8:27b', 'fast', roles, false), false);
  assert.equal(keepCurrentModel('qwen3.8:27b', 'reasoning', roles, true), true);
});

test('escalatie: één stap omhoog, max alleen als dat mag', () => {
  const roles = allRoles();
  const opts = { allowMax: false, needsVision: false };
  assert.deepEqual(nextModelUp('gemma4:12b', roles, ALL_INSTALLED, opts), { role: 'reasoning', model: 'gpt-oss:20b' });
  assert.equal(nextModelUp('gpt-oss:20b', roles, ALL_INSTALLED, opts), null);
  assert.deepEqual(nextModelUp('gpt-oss:20b', roles, ALL_INSTALLED, { ...opts, allowMax: true }), { role: 'max', model: 'qwen3.8:27b' });
  assert.equal(nextModelUp('qwen3.8:27b', roles, ALL_INSTALLED, { ...opts, allowMax: true }), null);
});

test('escalatie: een model buiten de ladder gaat naar het eerste grotere rol-model', () => {
  const installed = [...ALL_INSTALLED, { name: 'llama3.1:8b', sizeBytes: 4.9e9, capabilities: ['completion'] }];
  const roles = resolveRoles(CONFIGURED, installed);
  assert.deepEqual(nextModelUp('llama3.1:8b', roles, installed, { allowMax: false, needsVision: false }), { role: 'fast', model: 'gemma4:12b' });
  assert.deepEqual(nextModelUp('qwen3.5:9b', roles, installed, { allowMax: false, needsVision: false }), { role: 'fast', model: 'gemma4:12b' });
});

test('escalatie: met een afbeelding alleen naar modellen die beelden zien', () => {
  const roles = allRoles();
  assert.equal(nextModelUp('gemma4:12b', roles, ALL_INSTALLED, { allowMax: true, needsVision: true }), null);
});

test('escalatie: zonder max-model is reasoning de top', () => {
  const installed = ALL_INSTALLED.filter((m) => m.name !== 'qwen3.8:27b');
  const roles = resolveRoles(CONFIGURED, installed);
  assert.equal(roles.max.model, null);
  assert.equal(nextModelUp('gpt-oss:20b', roles, installed, { allowMax: true, needsVision: false }), null);
});

test('escalatie: rollen die hetzelfde model delen worden overgeslagen', () => {
  const roles = resolveRoles({ ...CONFIGURED, reasoning: 'gemma4:12b' }, ALL_INSTALLED);
  assert.deepEqual(nextModelUp('gemma4:12b', roles, ALL_INSTALLED, { allowMax: true, needsVision: false }), { role: 'max', model: 'qwen3.8:27b' });
  assert.equal(nextModelUp('gemma4:12b', roles, ALL_INSTALLED, { allowMax: false, needsVision: false }), null);
});

test('supportsVision: een cloudmodel krijgt nooit afbeeldingen, ook niet met vision', async () => {
  const { supportsVision } = await import('../catalog');
  const installed: InstalledModel[] = [{ name: 'qwen3-vl:235b-cloud', sizeBytes: 1, capabilities: ['completion', 'vision'], remote: true }];
  assert.equal(supportsVision(installed, 'qwen3-vl:235b-cloud'), false);
  assert.equal(supportsVision(ALL_INSTALLED, 'gemma4:12b'), true);
});
