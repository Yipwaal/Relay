import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runAgentTurn, type AgentContext } from '../agent-loop';
import type { ToolDefinition } from '../../tools';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function line(content: string): string {
  return JSON.stringify({ message: { role: 'assistant', content }, done: false }) + '\n';
}

/** Streamt `pieces` met een korte pauze ertussen en breekt af zoals echte fetch doet als init.signal afgaat. */
function mockStreamingFetch(responses: string[][]): { calls: () => number } {
  let call = 0;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const pieces = responses[call++] ?? [];
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        init?.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
        for (const piece of pieces) {
          if (init?.signal?.aborted) return;
          controller.enqueue(encoder.encode(piece));
          await new Promise((r) => setTimeout(r, 20));
        }
        if (!init?.signal?.aborted) {
          controller.enqueue(encoder.encode(JSON.stringify({ done: true }) + '\n'));
          controller.close();
        }
      },
    });
    return new Response(body, { status: 200 });
  }) as typeof fetch;
  return { calls: () => call };
}

function ctx(toolMode: 'native' | 'prompt', tools: Map<string, ToolDefinition>, signal: AbortSignal): AgentContext {
  return { ollamaUrl: 'http://localhost:11434', model: 'test-model', toolMode, tools, numCtx: 8192, signal };
}

test('stop in prompt-modus na het begin van een tool-blok laat geen protocoltekst zien', async () => {
  mockStreamingFetch([[line('Ik zoek het '), line('even op.\n```relay_tool'), line('_call\n{"tool":"remember"'), line(',"args":{}}\n```')]]);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 30);
  let shown = '';

  const appended = await runAgentTurn(ctx('prompt', new Map(), controller.signal), [{ role: 'user', content: 'x' }], {
    onToken: (token) => {
      shown += token;
    },
    onToolCall: () => assert.fail('er mag geen tool-aanroep starten'),
    onToolResult: () => undefined,
  });

  assert.equal(shown, 'Ik zoek het even op.');
  assert.deepEqual(appended, [{ role: 'assistant', content: 'Ik zoek het even op.' }]);
});

test('stop tijdens een trage tool breekt de tool af en start geen nieuwe modelbeurt', async () => {
  const fetchMock = mockStreamingFetch([
    [JSON.stringify({ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'web_search', arguments: { query: 'q' } } }] }, done: false }) + '\n'],
    [line('mag niet gebeuren')],
  ]);
  const controller = new AbortController();
  const tools = new Map<string, ToolDefinition>();
  tools.set('web_search', {
    name: 'web_search',
    description: 'x',
    parameters: {},
    execute: () => new Promise(() => undefined),
  });
  const results: Array<{ ok: boolean; summary: string }> = [];

  const appended = await runAgentTurn(ctx('native', tools, controller.signal), [{ role: 'user', content: 'x' }], {
    onToken: () => undefined,
    onToolCall: () => setTimeout(() => controller.abort(), 10),
    onToolResult: (info) => results.push({ ok: info.ok, summary: info.summary }),
  });

  assert.equal(fetchMock.calls(), 1);
  assert.deepEqual(results, [{ ok: false, summary: 'Mislukt: Afgebroken' }]);
  // Het assistant-bericht met de aanroep én het (mislukte) resultaat staan in de geschiedenis, zodat die consistent blijft.
  assert.equal(appended.length, 2);
  assert.equal(appended[1]?.role, 'tool');
});

test('een al afgebroken signaal start niets', async () => {
  const fetchMock = mockStreamingFetch([[line('x')]]);
  const controller = new AbortController();
  controller.abort();
  const appended = await runAgentTurn(ctx('native', new Map(), controller.signal), [{ role: 'user', content: 'x' }], {
    onToken: () => undefined,
    onToolCall: () => undefined,
    onToolResult: () => undefined,
  });
  assert.equal(fetchMock.calls(), 0);
  assert.deepEqual(appended, []);
});
