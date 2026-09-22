import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAgentTurn, type AgentContext, type AgentEvents } from '../agent-loop';
import type { ToolDefinition } from '../../tools';

function ndjson(...objects: unknown[]): string {
  return objects.map((o) => JSON.stringify(o)).join('\n') + '\n';
}

function mockFetchSequence(bodies: string[]): () => void {
  const original = globalThis.fetch;
  let call = 0;

  globalThis.fetch = (async () => {
    const body = bodies[call++] ?? bodies[bodies.length - 1];
    return {
      ok: true,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(body));
          controller.close();
        },
      }),
    } as unknown as Response;
  }) as typeof fetch;

  return () => {
    globalThis.fetch = original;
  };
}

function nativeToolCallBody(name: string, args: Record<string, unknown>): string {
  return ndjson(
    { message: { role: 'assistant', content: '', tool_calls: [{ function: { name, arguments: args } }] }, done: false },
    { done: true },
  );
}

function finalAnswerBody(text: string): string {
  return ndjson({ message: { role: 'assistant', content: text }, done: false }, { done: true });
}

function baseCtx(tools: Map<string, ToolDefinition>): AgentContext {
  return { ollamaUrl: 'http://localhost:11434', model: 'test-model', toolMode: 'native', tools, numCtx: 8192 };
}

function collectingEvents(): { events: AgentEvents; toolResults: Array<{ summary: string; ok: boolean }>; toolCalls: string[] } {
  const toolResults: Array<{ summary: string; ok: boolean }> = [];
  const toolCalls: string[] = [];
  return {
    events: {
      onToken: () => {},
      onToolCall: (label) => toolCalls.push(label),
      onToolResult: (summary, ok) => toolResults.push({ summary, ok }),
    },
    toolResults,
    toolCalls,
  };
}

test('runAgentTurn weigert remember nadat web_search deze beurt al gebruikt is', async () => {
  const restore = mockFetchSequence([
    nativeToolCallBody('web_search', { query: 'test' }),
    nativeToolCallBody('remember', { fact: 'gevoelige info uit webpagina' }),
    finalAnswerBody('Klaar.'),
  ]);

  try {
    let rememberExecuted = false;
    const tools = new Map<string, ToolDefinition>();
    tools.set('web_search', {
      name: 'web_search',
      description: 'x',
      parameters: {},
      async execute() {
        return { results: [{ title: 't', url: 'u', snippet: 's' }] };
      },
    });
    tools.set('remember', {
      name: 'remember',
      description: 'x',
      parameters: {},
      async execute() {
        rememberExecuted = true;
        return { stored: true, id: 1, text: 'x' };
      },
    });

    const { events, toolResults } = collectingEvents();
    const appended = await runAgentTurn(baseCtx(tools), [{ role: 'user', content: 'zoek en onthoud iets' }], events);

    assert.equal(rememberExecuted, false, 'remember.execute() had nooit aangeroepen mogen worden');

    const rememberResult = toolResults.find((r) => !r.ok && r.summary.startsWith('Geweigerd:'));
    assert.ok(rememberResult, 'er hoort een geweigerd-resultaat te zijn voor de remember-aanroep');

    const lastMessage = appended[appended.length - 1];
    assert.equal(lastMessage?.role, 'assistant');
    assert.equal(lastMessage?.content, 'Klaar.');
  } finally {
    restore();
  }
});

test('runAgentTurn staat remember toe als er geen web-tool in deze beurt gebruikt is', async () => {
  const restore = mockFetchSequence([nativeToolCallBody('remember', { fact: 'Houdt van koffie' }), finalAnswerBody('Onthouden!')]);

  try {
    let rememberExecuted = false;
    const tools = new Map<string, ToolDefinition>();
    tools.set('remember', {
      name: 'remember',
      description: 'x',
      parameters: {},
      async execute() {
        rememberExecuted = true;
        return { stored: true, id: 1, text: 'Houdt van koffie' };
      },
    });

    const { events, toolResults } = collectingEvents();
    await runAgentTurn(baseCtx(tools), [{ role: 'user', content: 'ik houd van koffie' }], events);

    assert.equal(rememberExecuted, true);
    assert.ok(toolResults.some((r) => r.ok && r.summary === 'Feit opgeslagen'));
  } finally {
    restore();
  }
});
