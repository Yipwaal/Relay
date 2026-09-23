import { test, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { createBeforeQuitHandler } from '../quit';
import { isModelLoaded, unloadLoadedModels } from '../ollama-lifecycle';

const BASE = 'http://localhost:11434';
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

type Call = { url: string; body: unknown };

function mockOllama(loaded: string[], log: string[], calls: Call[]): void {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    log.push(`fetch ${url.replace(BASE, '')}${body ? ` ${JSON.stringify(body)}` : ''}`);
    if (url.endsWith('/api/ps')) {
      return new Response(JSON.stringify({ models: loaded.map((name) => ({ name, model: name })) }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
}

function runQuit(timeoutMs = 2000, log: string[] = []): Promise<{ log: string[]; prevented: number }> {
  return new Promise((resolve) => {
    let prevented = 0;
    const handler = createBeforeQuitHandler({
      abortActive: () => log.push('abortActive'),
      ollamaUrl: () => BASE,
      closeDb: () => log.push('closeDb'),
      exit: () => {
        log.push('exit');
        resolve({ log, prevented });
      },
      timeoutMs,
    });
    handler({ preventDefault: () => prevented++ });
    // Een tweede before-quit tijdens het afsluiten mag niets opnieuw starten.
    handler({ preventDefault: () => prevented++ });
  });
}

test('before-quit bevraagt /api/ps en unloadt elk geladen model vóór app.exit()', async () => {
  const log: string[] = [];
  const calls: Call[] = [];
  mockOllama(['gemma4:12b', 'qwen2.5:14b'], log, calls);

  const result = await runQuit(2000, log);

  assert.equal(result.prevented, 2);
  assert.equal(calls[0]?.url, `${BASE}/api/ps`);
  const unloads = calls.filter((c) => c.url.endsWith('/api/generate')).map((c) => c.body);
  assert.deepEqual(unloads, [
    { model: 'gemma4:12b', keep_alive: 0 },
    { model: 'qwen2.5:14b', keep_alive: 0 },
  ]);
  // Volgorde: lopende beurten afbreken, /api/ps, de unloads, dan pas closeDb en exit.
  assert.deepEqual(log, [
    'abortActive',
    'fetch /api/ps',
    'fetch /api/generate {"model":"gemma4:12b","keep_alive":0}',
    'fetch /api/generate {"model":"qwen2.5:14b","keep_alive":0}',
    'closeDb',
    'exit',
  ]);
});

test('before-quit sluit alsnog af als Ollama niet draait', async () => {
  globalThis.fetch = (async () => {
    throw new TypeError('fetch failed');
  }) as typeof fetch;
  const result = await runQuit();
  assert.deepEqual(result.log, ['abortActive', 'closeDb', 'exit']);
});

test('before-quit wacht niet langer dan de timeout op een hangende Ollama', async () => {
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })) as typeof fetch;
  const started = Date.now();
  const result = await runQuit(150);
  assert.deepEqual(result.log, ['abortActive', 'closeDb', 'exit']);
  assert.ok(Date.now() - started < 1500);
});

test('before-quit sluit af ook als de config ongeldig is', async () => {
  const log: string[] = [];
  await new Promise<void>((resolve) => {
    const handler = createBeforeQuitHandler({
      abortActive: () => undefined,
      ollamaUrl: () => {
        throw new Error('Ongeldige config');
      },
      closeDb: () => log.push('closeDb'),
      exit: () => {
        log.push('exit');
        resolve();
      },
    });
    handler({ preventDefault: () => undefined });
  });
  assert.deepEqual(log, ['closeDb', 'exit']);
});

test('unloadLoadedModels slaat het model over dat geladen moet blijven', async () => {
  const calls: Call[] = [];
  mockOllama(['gemma4:12b', 'llama3.1:8b'], [], calls);
  const unloaded = await unloadLoadedModels(BASE, 1000, ['llama3.1:8b']);
  assert.deepEqual(unloaded, ['gemma4:12b']);
});

test('isModelLoaded herkent een geladen model en geeft null als Ollama onbereikbaar is', async () => {
  mockOllama(['gemma4:12b'], [], []);
  assert.equal(await isModelLoaded(BASE, 'gemma4:12b', 1000), true);
  assert.equal(await isModelLoaded(BASE, 'qwen2.5:14b', 1000), false);
  globalThis.fetch = (async () => {
    throw new TypeError('fetch failed');
  }) as typeof fetch;
  assert.equal(await isModelLoaded(BASE, 'gemma4:12b', 1000), null);
});
