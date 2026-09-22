import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt } from '../system-prompt';

const noFacts = { facts: [], omittedCount: 0 };

test('buildSystemPrompt geeft alleen de basisprompt zonder feiten en zonder tools', () => {
  const prompt = buildSystemPrompt({ base: 'Je bent Relay.', facts: noFacts, toolMode: 'native', tools: [] });

  assert.equal(prompt, 'Je bent Relay.');
});

test('buildSystemPrompt voegt een afgebakend memory-blok toe', () => {
  const facts = {
    facts: [{ id: 1, text: 'Houdt van koffie', source: 'user' as const, createdAt: 1, updatedAt: 1 }],
    omittedCount: 0,
  };
  const prompt = buildSystemPrompt({ base: 'Je bent Relay.', facts, toolMode: 'native', tools: [] });

  assert.match(prompt, /<relay-memory>/);
  assert.match(prompt, /- Houdt van koffie/);
  assert.match(prompt, /<\/relay-memory>/);
  assert.doesNotMatch(prompt, /oudere feiten weggelaten/);
});

test('buildSystemPrompt vermeldt weggelaten feiten', () => {
  const facts = {
    facts: [{ id: 1, text: 'Recent feit', source: 'user' as const, createdAt: 2, updatedAt: 2 }],
    omittedCount: 3,
  };
  const prompt = buildSystemPrompt({ base: 'Je bent Relay.', facts, toolMode: 'native', tools: [] });

  assert.match(prompt, /3 oudere feiten weggelaten/);
});

test('buildSystemPrompt zet memory vóór de tool-appendix', () => {
  const facts = {
    facts: [{ id: 1, text: 'Een feit', source: 'user' as const, createdAt: 1, updatedAt: 1 }],
    omittedCount: 0,
  };
  const prompt = buildSystemPrompt({
    base: 'Je bent Relay.',
    facts,
    toolMode: 'native',
    tools: [{ name: 'remember', description: 'Onthoud een feit.' }],
  });

  const memoryIndex = prompt.indexOf('<relay-memory>');
  const toolsIndex = prompt.indexOf('remember');
  assert.ok(memoryIndex > -1);
  assert.ok(toolsIndex > memoryIndex);
});

test('buildSystemPrompt laat het memory-blok weg zonder feiten, ook met tools', () => {
  const prompt = buildSystemPrompt({
    base: 'Je bent Relay.',
    facts: noFacts,
    toolMode: 'prompt',
    tools: [{ name: 'remember', description: 'Onthoud een feit.' }],
  });

  assert.doesNotMatch(prompt, /<relay-memory>/);
  assert.match(prompt, /remember/);
});
