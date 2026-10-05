import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRules } from '../rules';
import { mapClassification } from '../mapping';
import type { ChatRole, Complexity, Task } from '../types';

test('regel: een afbeelding in het bericht gaat naar fast/vision', () => {
  assert.deepEqual(applyRules({ images: 1 }), { role: 'fast', reason: 'afbeelding' });
  assert.deepEqual(applyRules({ images: 3 }), { role: 'fast', reason: 'afbeelding' });
});

test('regel: interne taken gaan naar het background-model', () => {
  assert.deepEqual(applyRules({ images: 0, internalTask: 'titel' }), { role: 'background', reason: 'chattitel' });
  assert.deepEqual(applyRules({ images: 0, internalTask: 'geheugen' }), { role: 'background', reason: 'geheugen samenvatten' });
  assert.deepEqual(applyRules({ images: 0, internalTask: 'zoekvraag' }), { role: 'background', reason: 'zoekvraag herschrijven' });
});

test('regel: embeddings gaan naar het embedding-model', () => {
  assert.deepEqual(applyRules({ images: 0, embedding: true }), { role: 'embedding', reason: 'embeddings' });
});

test('regel: een gewoon tekstbericht valt door naar de classificatie', () => {
  assert.equal(applyRules({ images: 0 }), null);
});

test('regel: interne taken en embeddings gaan vóór de afbeeldingsregel', () => {
  assert.equal(applyRules({ images: 2, internalTask: 'titel' })?.role, 'background');
  assert.equal(applyRules({ images: 2, embedding: true })?.role, 'embedding');
});

// Volledige tabel: [taak, complexiteit, zonder max, met max toegestaan].
const EXPECTED: Array<[Task, Complexity, ChatRole, ChatRole]> = [
  ['chat', 'laag', 'fast', 'fast'],
  ['chat', 'middel', 'fast', 'fast'],
  ['chat', 'hoog', 'reasoning', 'reasoning'],
  ['redeneren', 'laag', 'fast', 'fast'],
  ['redeneren', 'middel', 'reasoning', 'reasoning'],
  ['redeneren', 'hoog', 'reasoning', 'max'],
  ['code', 'laag', 'fast', 'fast'],
  ['code', 'middel', 'reasoning', 'reasoning'],
  ['code', 'hoog', 'reasoning', 'max'],
  ['onderzoek', 'laag', 'fast', 'fast'],
  ['onderzoek', 'middel', 'reasoning', 'reasoning'],
  ['onderzoek', 'hoog', 'reasoning', 'max'],
];

for (const [taak, complexiteit, withoutMax, withMax] of EXPECTED) {
  test(`mapping: ${taak}/${complexiteit} → ${withoutMax} (max toegestaan: ${withMax})`, () => {
    assert.equal(mapClassification({ taak, complexiteit }, false), withoutMax);
    assert.equal(mapClassification({ taak, complexiteit }, true), withMax);
  });
}

test('mapping: max wordt nooit gekozen zonder toestemming, ook niet bij hoog', () => {
  for (const [taak, complexiteit] of EXPECTED) {
    assert.notEqual(mapClassification({ taak, complexiteit }, false), 'max');
  }
});
