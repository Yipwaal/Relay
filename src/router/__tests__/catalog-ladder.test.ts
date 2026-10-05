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
  assert.equal(roles.max.model, 'qwen2.5:14b');
  assert.equal(roles.background.model, 'qwen2.5:14b');
  // Embedding-modellen tellen nooit als chatmodel, en andersom.
  assert.equal(roles.embedding.model, 'embeddinggemma');
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

test('escalatie: rollen die door een fallback hetzelfde model delen worden overgeslagen', () => {
  const installed = ALL_INSTALLED.filter((m) => m.name !== 'qwen3.8:27b');
  const roles = resolveRoles(CONFIGURED, installed);
  assert.equal(roles.max.model, 'gpt-oss:20b');
  assert.equal(nextModelUp('gpt-oss:20b', roles, installed, { allowMax: true, needsVision: false }), null);
});
