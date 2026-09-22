import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blobToFloats, dot, floatsToBlob, normalize, topK } from '../vector';

test('floatsToBlob en blobToFloats zijn elkaars inverse', () => {
  const original = new Float32Array([0.1, -0.2, 0.3, 0.4]);
  const blob = floatsToBlob(original);
  const restored = blobToFloats(blob);

  assert.equal(restored.length, original.length);
  for (let i = 0; i < original.length; i++) {
    assert.ok(Math.abs((restored[i] ?? 0) - (original[i] ?? 0)) < 1e-6);
  }
});

test('blobToFloats werkt ook met een niet-uitgelijnde subarray-view', () => {
  const original = new Float32Array([1, 2, 3]);
  const raw = floatsToBlob(original);
  // Simuleer wat node:sqlite kan teruggeven: een Uint8Array-view met offset > 0.
  const padded = new Uint8Array(raw.byteLength + 1);
  padded.set(raw, 1);
  const view = padded.subarray(1);

  const restored = blobToFloats(view);
  assert.deepEqual(Array.from(restored), Array.from(original));
});

test('normalize geeft een eenheidsvector', () => {
  const vector = new Float32Array([3, 4]);
  const result = normalize(vector);
  const length = Math.sqrt((result[0] ?? 0) * (result[0] ?? 0) + (result[1] ?? 0) * (result[1] ?? 0));

  assert.ok(Math.abs(length - 1) < 1e-6);
});

test('normalize geeft de vector ongewijzigd terug bij een nulvector', () => {
  const vector = new Float32Array([0, 0, 0]);
  const result = normalize(vector);

  assert.deepEqual(Array.from(result), [0, 0, 0]);
});

test('dot van identieke genormaliseerde vectoren is ~1', () => {
  const vector = normalize(new Float32Array([1, 2, 3]));
  assert.ok(Math.abs(dot(vector, vector) - 1) < 1e-6);
});

test('dot van orthogonale vectoren is 0', () => {
  const a = new Float32Array([1, 0]);
  const b = new Float32Array([0, 1]);
  assert.equal(dot(a, b), 0);
});

test('topK geeft de k hoogst scorende indices, aflopend gesorteerd', () => {
  const query = new Float32Array([1, 0]);
  const candidates = [
    new Float32Array([0, 1]), // orthogonaal -> score 0
    new Float32Array([1, 0]), // identiek -> score 1
    new Float32Array([0.7, 0.7]), // score ~0.7
  ];

  const result = topK(query, candidates, 2);

  assert.equal(result.length, 2);
  assert.equal(result[0]?.index, 1);
  assert.equal(result[1]?.index, 2);
  assert.ok((result[0]?.score ?? 0) > (result[1]?.score ?? 0));
});
