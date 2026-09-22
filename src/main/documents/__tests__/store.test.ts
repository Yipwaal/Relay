import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openRelayDb } from '../../db';
import { createDocumentStore } from '../store';
import { normalize } from '../vector';

function freshStore() {
  return createDocumentStore(openRelayDb(':memory:'));
}

function vec(...values: number[]): Float32Array {
  return normalize(new Float32Array(values));
}

test('addDocument slaat een document met chunks op en listDocuments geeft het terug', () => {
  const store = freshStore();
  const doc = store.addDocument({
    title: 'notities.md',
    contentHash: 'hash-1',
    charCount: 42,
    embedModel: 'test-embed',
    embedDims: 2,
    chunks: [
      { text: 'eerste chunk', embedding: vec(1, 0) },
      { text: 'tweede chunk', embedding: vec(0, 1) },
    ],
  });

  assert.equal(doc.title, 'notities.md');
  assert.equal(doc.chunkCount, 2);

  const docs = store.listDocuments();
  assert.equal(docs.length, 1);
  assert.equal(docs[0]?.id, doc.id);
});

test('addDocument weigert hetzelfde content_hash tweemaal', () => {
  const store = freshStore();
  store.addDocument({
    title: 'a.txt',
    contentHash: 'dup',
    charCount: 10,
    embedModel: 'm',
    embedDims: 2,
    chunks: [{ text: 'x', embedding: vec(1, 0) }],
  });

  assert.throws(() => {
    store.addDocument({
      title: 'a-nogmaals.txt',
      contentHash: 'dup',
      charCount: 10,
      embedModel: 'm',
      embedDims: 2,
      chunks: [{ text: 'x', embedding: vec(1, 0) }],
    });
  }, /al toegevoegd/);

  assert.equal(store.listDocuments().length, 1);
});

test('addDocument weigert een document zonder chunks', () => {
  const store = freshStore();
  assert.throws(
    () => store.addDocument({ title: 'leeg.txt', contentHash: 'h', charCount: 0, embedModel: 'm', embedDims: 2, chunks: [] }),
    /geen bruikbare tekst/,
  );
});

test('deleteDocument verwijdert het document en (via cascade) zijn chunks', () => {
  const store = freshStore();
  const doc = store.addDocument({
    title: 'weg.txt',
    contentHash: 'h2',
    charCount: 5,
    embedModel: 'm',
    embedDims: 2,
    chunks: [{ text: 'x', embedding: vec(1, 0) }],
  });

  store.deleteDocument(doc.id);

  assert.equal(store.listDocuments().length, 0);
  assert.equal(store.search(vec(1, 0), 'm', 5).length, 0);
});

test('search geeft de best passende chunks terug, gesorteerd op score', () => {
  const store = freshStore();
  store.addDocument({
    title: 'doc.txt',
    contentHash: 'h3',
    charCount: 20,
    embedModel: 'm',
    embedDims: 2,
    chunks: [
      { text: 'over katten', embedding: vec(1, 0) },
      { text: 'over honden', embedding: vec(0, 1) },
    ],
  });

  const results = store.search(vec(1, 0), 'm', 5);

  assert.equal(results.length, 2);
  assert.equal(results[0]?.text, 'over katten');
  assert.ok((results[0]?.score ?? 0) > (results[1]?.score ?? 0));
});

test('search negeert chunks van een ander embedModel', () => {
  const store = freshStore();
  store.addDocument({
    title: 'oud.txt',
    contentHash: 'h4',
    charCount: 5,
    embedModel: 'oud-model',
    embedDims: 2,
    chunks: [{ text: 'x', embedding: vec(1, 0) }],
  });

  assert.equal(store.search(vec(1, 0), 'nieuw-model', 5).length, 0);
});

test('hasDocumentsForModel klopt per model', () => {
  const store = freshStore();
  assert.equal(store.hasDocumentsForModel('m'), false);

  store.addDocument({
    title: 'x.txt',
    contentHash: 'h5',
    charCount: 5,
    embedModel: 'm',
    embedDims: 2,
    chunks: [{ text: 'x', embedding: vec(1, 0) }],
  });

  assert.equal(store.hasDocumentsForModel('m'), true);
  assert.equal(store.hasDocumentsForModel('ander-model'), false);
});
