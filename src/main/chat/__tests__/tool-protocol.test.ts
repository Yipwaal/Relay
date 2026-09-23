import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildToolResultMessage,
  buildToolSystemAppendix,
  stripPartialToolCall,
  normalizeNativeToolCalls,
  tryExtractPromptToolCall,
} from '../tool-protocol';

test('normalizeNativeToolCalls zet Ollama-vorm om naar ToolCall', () => {
  const calls = normalizeNativeToolCalls([
    { function: { name: 'web_search', arguments: { query: 'test' } } },
  ]);

  assert.deepEqual(calls, [{ name: 'web_search', args: { query: 'test' } }]);
});

test('normalizeNativeToolCalls valt terug op lege args als arguments ontbreekt', () => {
  const calls = normalizeNativeToolCalls([{ function: { name: 'web_search', arguments: undefined as never } }]);

  assert.deepEqual(calls, [{ name: 'web_search', args: {} }]);
});

test('tryExtractPromptToolCall geeft none zonder codeblok', () => {
  const result = tryExtractPromptToolCall('Gewoon een antwoord zonder tool-aanroep.');
  assert.equal(result.type, 'none');
});

test('tryExtractPromptToolCall parst een compleet, geldig blok', () => {
  const buffer = '```relay_tool_call\n{"tool": "web_search", "args": {"query": "hoofdstad nederland"}}\n```';
  const result = tryExtractPromptToolCall(buffer);

  assert.equal(result.type, 'call');
  if (result.type === 'call') {
    assert.deepEqual(result.call, { name: 'web_search', args: { query: 'hoofdstad nederland' } });
    assert.equal(result.prefixText, '');
  }
});

test('tryExtractPromptToolCall bewaart tekst vóór het blok als prefixText', () => {
  const buffer = 'Even zoeken.\n```relay_tool_call\n{"tool": "web_search", "args": {"query": "x"}}\n```';
  const result = tryExtractPromptToolCall(buffer);

  assert.equal(result.type, 'call');
  if (result.type === 'call') {
    assert.equal(result.prefixText, 'Even zoeken.\n');
  }
});

test('tryExtractPromptToolCall geeft malformed bij ongeldige JSON', () => {
  const buffer = '```relay_tool_call\nniet-json\n```';
  const result = tryExtractPromptToolCall(buffer);

  assert.equal(result.type, 'malformed');
});

test('tryExtractPromptToolCall geeft malformed bij ontbrekende velden', () => {
  const buffer = '```relay_tool_call\n{"tool": "web_search"}\n```';
  const result = tryExtractPromptToolCall(buffer);

  assert.equal(result.type, 'malformed');
});

test('buildToolSystemAppendix geeft lege string zonder tools', () => {
  assert.equal(buildToolSystemAppendix('native', []), '');
});

test('buildToolSystemAppendix bevat geen protocol-instructies in native modus', () => {
  const appendix = buildToolSystemAppendix('native', [{ name: 'web_search', description: 'Zoek op het web.' }]);

  assert.match(appendix, /web_search/);
  assert.doesNotMatch(appendix, /relay_tool_call/);
});

test('buildToolSystemAppendix bevat het protocol-blok in prompt-modus', () => {
  const appendix = buildToolSystemAppendix('prompt', [{ name: 'web_search', description: 'Zoek op het web.' }]);

  assert.match(appendix, /relay_tool_call/);
});

test('buildToolResultMessage geeft role tool met toolName in native modus', () => {
  const message = buildToolResultMessage('native', { name: 'web_search', args: {} }, '{"results":[]}');

  assert.deepEqual(message, { role: 'tool', content: '{"results":[]}', toolName: 'web_search' });
});

test('buildToolResultMessage wrapt het resultaat als user-bericht in prompt-modus', () => {
  const message = buildToolResultMessage('prompt', { name: 'web_search', args: {} }, '{"results":[]}');

  assert.equal(message.role, 'user');
  assert.match(message.content, /<relay-tool-result name="web_search">/);
  assert.match(message.content, /<\/relay-tool-result>/);
});

test('stripPartialToolCall knipt een (half) tool-blok van het eind af', () => {
  assert.equal(stripPartialToolCall('Even kijken.\n```relay_tool_call\n{"tool":'), 'Even kijken.');
  assert.equal(stripPartialToolCall('Even kijken.\n```relay_tool'), 'Even kijken.');
  assert.equal(stripPartialToolCall('Even kijken.\n``'), 'Even kijken.');
  assert.equal(stripPartialToolCall('Gewoon antwoord.'), 'Gewoon antwoord.');
});
