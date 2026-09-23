import { test, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { fetchOllama, isConnectionError, OLLAMA_UNREACHABLE_MESSAGE } from '../ollama-errors';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function refused(): TypeError {
  const error = new TypeError('fetch failed');
  (error as TypeError & { cause: unknown }).cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:11434'), { code: 'ECONNREFUSED' });
  return error;
}

test('isConnectionError herkent een weigerende server', () => {
  assert.equal(isConnectionError(refused()), true);
  assert.equal(isConnectionError(new TypeError('fetch failed')), true);
});

test('isConnectionError laat HTTP- en abortfouten met rust', () => {
  assert.equal(isConnectionError(new Error('Ollama request mislukt: 404 Not Found')), false);
  assert.equal(isConnectionError(new DOMException('aborted', 'AbortError')), false);
  assert.equal(isConnectionError('fetch failed'), false);
});

test('fetchOllama vertaalt een verbindingsfout naar een begrijpelijke melding', async () => {
  globalThis.fetch = (async () => {
    throw refused();
  }) as typeof fetch;
  await assert.rejects(fetchOllama('http://localhost:11434/api/chat', {}), { message: OLLAMA_UNREACHABLE_MESSAGE });
});

test('fetchOllama geeft een abort ongewijzigd door (de stop-knop en prompt-modus rekenen daarop)', async () => {
  globalThis.fetch = (async () => {
    throw new DOMException('aborted', 'AbortError');
  }) as typeof fetch;
  await assert.rejects(fetchOllama('http://localhost:11434/api/chat', {}), { name: 'AbortError' });
});
