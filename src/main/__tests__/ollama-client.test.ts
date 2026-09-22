import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitNdjsonLines, parseOllamaChunk } from '../ollama-client';

test('splitNdjsonLines geeft complete regels en bewaart het restant', () => {
  const input = '{"a":1}\n{"a":2}\n{"a":3';
  const { lines, remainder } = splitNdjsonLines(input);

  assert.deepEqual(lines, ['{"a":1}', '{"a":2}']);
  assert.equal(remainder, '{"a":3');
});

test('splitNdjsonLines negeert lege regels', () => {
  const input = '{"a":1}\n\n{"a":2}\n';
  const { lines, remainder } = splitNdjsonLines(input);

  assert.deepEqual(lines, ['{"a":1}', '{"a":2}']);
  assert.equal(remainder, '');
});

test('splitNdjsonLines geeft alles als remainder zonder newline', () => {
  const { lines, remainder } = splitNdjsonLines('{"a":1}');

  assert.deepEqual(lines, []);
  assert.equal(remainder, '{"a":1}');
});

test('parseOllamaChunk parst een normale tokenregel', () => {
  const chunk = parseOllamaChunk('{"message":{"role":"assistant","content":"hoi"},"done":false}');

  assert.equal(chunk.message?.content, 'hoi');
  assert.equal(chunk.done, false);
});

test('parseOllamaChunk parst een foutregel', () => {
  const chunk = parseOllamaChunk('{"error":"model not found","done":true}');

  assert.equal(chunk.error, 'model not found');
});
