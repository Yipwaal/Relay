import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOllamaEmbedder } from '../ollama-embed';

function withMockedFetch(handler: (url: string, init: RequestInit) => { status: number; body: unknown }, fn: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const { status, body } = handler(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 404 ? 'Not Found' : 'Error',
      json: async () => body,
    } as unknown as Response;
  }) as typeof fetch;

  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

test('embed geeft lege lijst terug zonder een aanroep te doen', async () => {
  const embedder = createOllamaEmbedder('http://localhost:11434', 'test-model');
  const result = await embedder.embed([]);
  assert.deepEqual(result, []);
});

test('embed geeft Float32Arrays terug op basis van Ollama-embeddings', async () => {
  await withMockedFetch(
    () => ({ status: 200, body: { embeddings: [[0.1, 0.2], [0.3, 0.4]] } }),
    async () => {
      const embedder = createOllamaEmbedder('http://localhost:11434', 'test-model');
      const result = await embedder.embed(['a', 'b']);

      assert.equal(result.length, 2);
      assert.ok(result[0] instanceof Float32Array);
      assert.ok(Math.abs((result[0]?.[0] ?? 0) - 0.1) < 1e-6);
    },
  );
});

test('embed geeft een duidelijke foutmelding als het model niet gevonden is', async () => {
  await withMockedFetch(
    () => ({ status: 404, body: { error: "model 'embeddinggemma' not found" } }),
    async () => {
      const embedder = createOllamaEmbedder('http://localhost:11434', 'embeddinggemma');
      await assert.rejects(() => embedder.embed(['x']), /ollama pull embeddinggemma/);
    },
  );
});

test('embed gooit een fout bij een onverwacht antwoordformaat', async () => {
  await withMockedFetch(
    () => ({ status: 200, body: { onverwacht: true } }),
    async () => {
      const embedder = createOllamaEmbedder('http://localhost:11434', 'test-model');
      await assert.rejects(() => embedder.embed(['x']), /onverwacht antwoordformaat/);
    },
  );
});
