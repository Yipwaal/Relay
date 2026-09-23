import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { estimateKvBytesPerToken, listChatModels } from '../models';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('estimateKvBytesPerToken: lagen × KV-heads × (key + value) × 2 bytes', () => {
  const info = {
    'general.architecture': 'llama',
    'llama.block_count': 32,
    'llama.attention.head_count_kv': 8,
    'llama.attention.head_count': 32,
    'llama.embedding_length': 4096,
  };
  // head_dim = 4096 / 32 = 128 → 32 × 8 × 256 × 2 = 131072 bytes per token (0,125 MiB).
  assert.equal(estimateKvBytesPerToken(info), 131072);
});

test('estimateKvBytesPerToken gebruikt expliciete key/value-lengtes en per-laag KV-heads', () => {
  const info = {
    'general.architecture': 'gemma3',
    'gemma3.block_count': 2,
    'gemma3.attention.head_count_kv': [4, 2],
    'gemma3.attention.key_length': 256,
    'gemma3.attention.value_length': 256,
  };
  assert.equal(estimateKvBytesPerToken(info), (4 + 2) * 512 * 2);
});

test('estimateKvBytesPerToken geeft null bij onvolledige info', () => {
  assert.equal(estimateKvBytesPerToken({}), null);
  assert.equal(estimateKvBytesPerToken({ 'general.architecture': 'x', 'x.block_count': 4 }), null);
});

test('listChatModels laat embedding-modellen weg en sorteert op naam', async () => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/api/tags')) {
      return new Response(
        JSON.stringify({
          models: [
            { name: 'qwen2.5:14b', size: 9e9, details: { family: 'qwen2', parameter_size: '14.8B', quantization_level: 'Q4_K_M' } },
            { name: 'embeddinggemma:latest', size: 6e8, details: { family: 'gemma3', parameter_size: '307M' } },
            { name: 'gemma4:12b', size: 7e9, details: { family: 'gemma4', parameter_size: '12B', quantization_level: 'Q4_K_M' } },
          ],
        }),
        { status: 200 },
      );
    }
    const model = JSON.parse(String(init?.body)).model as string;
    const capabilities = model.startsWith('embedding') ? ['embedding'] : ['completion'];
    return new Response(JSON.stringify({ capabilities, model_info: {} }), { status: 200 });
  }) as typeof fetch;

  const models = await listChatModels('http://localhost:11434');
  assert.deepEqual(
    models.map((m) => [m.name, m.parameterSize]),
    [
      ['gemma4:12b', '12B'],
      ['qwen2.5:14b', '14.8B'],
    ],
  );
});
