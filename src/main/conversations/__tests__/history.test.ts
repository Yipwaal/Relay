import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toConversationMessages, toModelHistory } from '../history';
import type { StoredMessage } from '../store';
import type { ToolDisplay } from '../../../shared/ipc-types';

let nextId = 1;
function row(partial: Partial<StoredMessage> & Pick<StoredMessage, 'role' | 'kind' | 'content'>): StoredMessage {
  return {
    id: nextId++,
    conversationId: 1,
    toolCalls: null,
    toolName: null,
    display: null,
    model: null,
    status: 'complete',
    createdAt: 0,
    ...partial,
  };
}

const display: ToolDisplay = {
  tool: 'search_documents',
  query: 'opzegtermijn',
  label: 'Doorzoekt documenten: "opzegtermijn"',
  summary: '1 fragment',
  ok: true,
  preview: '{"results":[]}',
  items: [{ src: 'huur.pdf', text: 'één maand' }],
  durationMs: 400,
};

const nativeTurn: StoredMessage[] = [
  row({ role: 'user', kind: 'user', content: 'Wat is de opzegtermijn?' }),
  row({ role: 'assistant', kind: 'assistant', content: '', toolCalls: [{ name: 'search_documents', args: { query: 'opzegtermijn' } }], model: 'm' }),
  row({ role: 'tool', kind: 'tool_result', content: '{"results":[]}', toolName: 'search_documents', display }),
  row({ role: 'assistant', kind: 'assistant', content: 'Eén maand.', model: 'm' }),
  row({ role: 'assistant', kind: 'notice', content: 'Ollama lijkt niet te draaien', status: 'error' }),
];

test('toModelHistory herbouwt een native beurt 1-op-1 en laat meldingen weg', () => {
  assert.deepEqual(toModelHistory(nativeTurn, 'native'), [
    { role: 'user', content: 'Wat is de opzegtermijn?' },
    { role: 'assistant', content: '', toolCalls: [{ name: 'search_documents', args: { query: 'opzegtermijn' } }] },
    { role: 'tool', content: '{"results":[]}', toolName: 'search_documents' },
    { role: 'assistant', content: 'Eén maand.' },
  ]);
});

test('toModelHistory zet native tool-berichten om als het huidige model prompt-modus gebruikt', () => {
  const history = toModelHistory(nativeTurn, 'prompt');
  assert.deepEqual(history[1], { role: 'assistant', content: '' });
  assert.equal(history[2]?.role, 'user');
  assert.match(history[2]?.content ?? '', /<relay-tool-result name="search_documents">/);
});

test('toModelHistory laat native tool_calls weg als het resultaat ontbreekt', () => {
  const dangling = [
    row({ role: 'user', kind: 'user', content: 'x' }),
    row({ role: 'assistant', kind: 'assistant', content: 'even kijken', toolCalls: [{ name: 'web_search', args: {} }] }),
  ];
  assert.deepEqual(toModelHistory(dangling, 'native')[1], { role: 'assistant', content: 'even kijken' });
});

test('toModelHistory houdt prompt-modus tool-resultaten als user-bericht', () => {
  const promptRows = [
    row({ role: 'assistant', kind: 'assistant', content: '```relay_tool_call\n{"tool":"remember","args":{}}\n```' }),
    row({ role: 'user', kind: 'tool_result', content: '<relay-tool-result name="remember">{}</relay-tool-result>', toolName: 'remember', display }),
  ];
  assert.deepEqual(toModelHistory(promptRows, 'native')[1], { role: 'user', content: '<relay-tool-result name="remember">{}</relay-tool-result>' });
});

test('toConversationMessages toont bubbels zonder protocoltekst, kaarten en meldingen', () => {
  const rows = [
    ...nativeTurn,
    row({ role: 'assistant', kind: 'assistant', content: 'Ik zoek het op.\n```relay_tool_call\n{"tool":"x","args":{}}\n```', model: 'm' }),
    row({ role: 'assistant', kind: 'assistant', content: 'Half antwoord', model: 'm', status: 'interrupted' }),
  ];
  assert.deepEqual(toConversationMessages(rows), [
    { kind: 'user', text: 'Wat is de opzegtermijn?' },
    { kind: 'tool', display },
    { kind: 'assistant', text: 'Eén maand.', model: 'm', interrupted: false },
    { kind: 'notice', text: 'Ollama lijkt niet te draaien' },
    { kind: 'assistant', text: 'Ik zoek het op.', model: 'm', interrupted: false },
    { kind: 'assistant', text: 'Half antwoord', model: 'm', interrupted: true },
  ]);
});
