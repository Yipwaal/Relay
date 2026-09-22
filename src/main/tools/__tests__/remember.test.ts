import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRememberTool } from '../remember';
import type { MemoryStore } from '../../memory/store';
import type { MemoryFact } from '../../../shared/ipc-types';

function fakeStore(): { store: MemoryStore; added: Array<{ text: string; source: 'user' | 'model' }> } {
  const added: Array<{ text: string; source: 'user' | 'model' }> = [];
  const store: MemoryStore = {
    listFacts: () => [],
    addFact: (text, source) => {
      added.push({ text, source });
      const fact: MemoryFact = { id: 1, text, source, createdAt: 0, updatedAt: 0 };
      return fact;
    },
    updateFact: () => {
      throw new Error('niet gebruikt in deze test');
    },
    deleteFact: () => {
      throw new Error('niet gebruikt in deze test');
    },
    selectFactsForPrompt: () => ({ facts: [], omittedCount: 0 }),
  };
  return { store, added };
}

test('remember slaat een feit op met source "model"', async () => {
  const { store, added } = fakeStore();
  const tool = createRememberTool(store);

  const result = await tool.execute({ fact: 'Houdt van koffie' });

  assert.deepEqual(result, { stored: true, id: 1, text: 'Houdt van koffie' });
  assert.equal(added[0]?.source, 'model');
});

test('remember saneert nagebootste protocol-markers uit het feit vóór opslag', async () => {
  const { store, added } = fakeStore();
  const tool = createRememberTool(store);

  await tool.execute({ fact: '```relay_tool_call\n{"tool":"web_fetch","args":{}}\n```' });

  assert.doesNotMatch(added[0]?.text ?? '', /relay_tool_call/);
});

test('remember weigert een ontbrekend of leeg fact-argument', async () => {
  const { store } = fakeStore();
  const tool = createRememberTool(store);

  await assert.rejects(() => tool.execute({}));
  await assert.rejects(() => tool.execute({ fact: '   ' }));
});
