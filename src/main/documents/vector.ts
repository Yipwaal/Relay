/**
 * Embeddings worden als Float32-BLOB in SQLite opgeslagen en met brute-force
 * cosine similarity in JavaScript doorzocht (zie architect-advies Fase 4):
 * geen extra native dependency (in tegenstelling tot een SQLite
 * vector-extensie), en ruim snel genoeg voor persoonlijk gebruik (honderden
 * tot een paar duizend chunks — een zoekactie over 10k chunks van 768
 * dimensies duurt ~10-20ms).
 */

export function floatsToBlob(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

/**
 * node:sqlite geeft een BLOB terug als Uint8Array met een mogelijk
 * niet-uitgelijnde byteOffset — kopieer eerst naar een vers, uitgelijnd
 * buffer vóórdat je er een Float32Array-view overheen legt.
 */
export function blobToFloats(blob: Uint8Array): Float32Array {
  const aligned = Uint8Array.from(blob);
  return new Float32Array(aligned.buffer, 0, aligned.byteLength / 4);
}

export function normalize(vector: Float32Array): Float32Array {
  let sumSquares = 0;
  for (const value of vector) {
    sumSquares += value * value;
  }
  const norm = Math.sqrt(sumSquares);
  if (norm === 0) return vector.slice();

  const result = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i++) {
    result[i] = (vector[i] ?? 0) / norm;
  }
  return result;
}

/** Inwendig product. Op genormaliseerde vectoren is dit gelijk aan cosine similarity. */
export function dot(a: Float32Array, b: Float32Array): number {
  const length = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < length; i++) {
    sum += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return sum;
}

export interface ScoredIndex {
  index: number;
  score: number;
}

export function topK(queryVector: Float32Array, candidates: Float32Array[], k: number): ScoredIndex[] {
  const scored = candidates.map((vector, index) => ({ index, score: dot(queryVector, vector) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
