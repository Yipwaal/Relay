import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryDb } from '../db';
import { createMemoryStore } from '../store';

function freshStore() {
  return createMemoryStore(openMemoryDb(':memory:'));
}

test('addFact slaat op en listFacts geeft het terug', () => {
  const store = freshStore();
  const fact = store.addFact('Werkt aan een app genaamd Relay', 'user');

  assert.equal(fact.text, 'Werkt aan een app genaamd Relay');
  assert.equal(fact.source, 'user');
  assert.ok(fact.id > 0);

  const facts = store.listFacts();
  assert.equal(facts.length, 1);
  assert.equal(facts[0]?.id, fact.id);
});

test('addFact normaliseert witruimte', () => {
  const store = freshStore();
  const fact = store.addFact('  Houdt   van   koffie  ', 'user');

  assert.equal(fact.text, 'Houdt van koffie');
});

test('addFact weigert een leeg feit', () => {
  const store = freshStore();
  assert.throws(() => store.addFact('   ', 'user'), /leeg/);
});

test('addFact weigert een te lang feit', () => {
  const store = freshStore();
  assert.throws(() => store.addFact('a'.repeat(501), 'user'), /te lang/);
});

test('addFact met identieke tekst dedupliceert via upsert i.p.v. een tweede rij', () => {
  const store = freshStore();
  store.addFact('Woont in Utrecht', 'model');
  store.addFact('Woont in Utrecht', 'model');

  const facts = store.listFacts();
  assert.equal(facts.length, 1);
  assert.equal(facts[0]?.source, 'model');
});

test('addFact: source "user" wint altijd bij een upsert-conflict, nooit overschreven door "model"', () => {
  const store = freshStore();
  store.addFact('Woont in Utrecht', 'user');
  store.addFact('Woont in Utrecht', 'model');

  const facts = store.listFacts();
  assert.equal(facts.length, 1);
  assert.equal(facts[0]?.source, 'user', 'een remember-aanroep mag een handmatig feit niet naar "model" ombuigen');
});

test('addFact: een user-aanroep mag een bestaand model-feit wél naar "user" ombuigen', () => {
  const store = freshStore();
  store.addFact('Woont in Utrecht', 'model');
  store.addFact('Woont in Utrecht', 'user');

  const facts = store.listFacts();
  assert.equal(facts.length, 1);
  assert.equal(facts[0]?.source, 'user');
});

test('updateFact wijzigt de tekst van een bestaand feit', () => {
  const store = freshStore();
  const fact = store.addFact('Oude tekst', 'user');
  const updated = store.updateFact(fact.id, 'Nieuwe tekst');

  assert.equal(updated.text, 'Nieuwe tekst');
  assert.equal(store.listFacts().length, 1);
});

test('updateFact op een niet-bestaand id faalt duidelijk', () => {
  const store = freshStore();
  assert.throws(() => store.updateFact(999, 'iets'), /bestaat niet/);
});

test('updateFact naar een reeds bestaande tekst geeft een vriendelijke foutmelding', () => {
  const store = freshStore();
  store.addFact('Feit A', 'user');
  const factB = store.addFact('Feit B', 'user');

  assert.throws(() => store.updateFact(factB.id, 'Feit A'), /staat al in het geheugen/);
});

test('deleteFact verwijdert het feit', () => {
  const store = freshStore();
  const fact = store.addFact('Wordt verwijderd', 'user');
  store.deleteFact(fact.id);

  assert.equal(store.listFacts().length, 0);
});

test('selectFactsForPrompt geeft nieuwste eerst en respecteert het budget', () => {
  const store = freshStore();
  store.addFact('Eerste feit', 'user');
  store.addFact('Tweede feit', 'user');
  store.addFact('Derde feit', 'user');

  // Budget dat precies het nieuwste feit toelaat ("- Derde feit" = 12 tekens + marge).
  const selection = store.selectFactsForPrompt(15);

  assert.equal(selection.facts.length, 1);
  assert.equal(selection.facts[0]?.text, 'Derde feit');
  assert.equal(selection.omittedCount, 2);
});

test('selectFactsForPrompt geeft alles terug als het budget ruim genoeg is', () => {
  const store = freshStore();
  store.addFact('Feit een', 'user');
  store.addFact('Feit twee', 'user');

  const selection = store.selectFactsForPrompt(4000);

  assert.equal(selection.facts.length, 2);
  assert.equal(selection.omittedCount, 0);
});
