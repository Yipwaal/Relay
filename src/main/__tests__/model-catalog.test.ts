import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createModelCatalog } from '../model-catalog';
import type { RoleModels } from '../../router/types';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const GB = 1024 ** 3;

/** Nep-Ollama: /api/tags met de opgegeven modellen, /api/show met hun capabilities. */
function mockOllama(models: Array<{ name: string; size: number; capabilities: string[] }>): { tagsCalls: () => number } {
  let tagsCalls = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/api/tags')) {
      tagsCalls++;
      return new Response(JSON.stringify({ models: models.map((m) => ({ name: m.name, size: m.size, details: {} })) }));
    }
    const { model } = JSON.parse(String(init?.body)) as { model: string };
    return new Response(JSON.stringify({ capabilities: models.find((m) => m.name === model)?.capabilities ?? [] }));
  }) as typeof fetch;
  return { tagsCalls: () => tagsCalls };
}

// Unieke namen per test: models.ts cachet /api/show per modelnaam.
const configured: RoleModels = {
  fast: 'cat-gemma:12b',
  reasoning: 'cat-gptoss:20b',
  max: 'cat-qwen:27b',
  background: 'cat-qwen:9b',
  embedding: 'cat-embed:0.6b',
};

test('catalogus: geïnstalleerde rollen direct, ontbrekende krijgen een vervanger', async () => {
  mockOllama([
    { name: 'cat-gemma:12b', size: 8 * GB, capabilities: ['completion', 'vision', 'tools'] },
    { name: 'cat-gptoss:20b', size: 13 * GB, capabilities: ['completion', 'tools'] },
    { name: 'cat-embed-old:latest', size: 0.3 * GB, capabilities: ['embedding'] },
  ]);
  const catalog = createModelCatalog(() => ({ ollamaUrl: 'http://ollama.test', models: configured }));
  const { roles, models } = await catalog.refresh();

  assert.equal(roles.fast.model, 'cat-gemma:12b');
  assert.equal(roles.fast.fallback, false);
  // Geen model groter dan reasoning: max blijft leeg (en wordt nooit het reasoning-model).
  assert.equal(roles.max.model, null);
  assert.equal(roles.background.model, 'cat-gemma:12b');
  assert.equal(roles.embedding.model, 'cat-embed-old:latest');
  assert.equal(models.length, 3);
});

test('current() hergebruikt een verse stand en vraagt /api/tags niet opnieuw', async () => {
  const ollama = mockOllama([{ name: 'cat2-gemma:12b', size: 8 * GB, capabilities: ['completion', 'vision'] }]);
  const catalog = createModelCatalog(() => ({ ollamaUrl: 'http://ollama.test', models: { ...configured, fast: 'cat2-gemma:12b' } }));
  await catalog.current();
  await catalog.current();
  assert.equal(ollama.tagsCalls(), 1);
  await catalog.refresh();
  assert.equal(ollama.tagsCalls(), 2);
});

test('refresh() gooit als Ollama niet bereikbaar is', async () => {
  globalThis.fetch = (async () => {
    throw new TypeError('fetch failed');
  }) as typeof fetch;
  const catalog = createModelCatalog(() => ({ ollamaUrl: 'http://ollama.test', models: configured }));
  await assert.rejects(catalog.refresh());
});
