import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkText, CHUNK_MAX_CHARS, MIN_CHUNK_CHARS } from '../chunker';

test('chunkText geeft een lege lijst voor lege/whitespace-tekst', () => {
  assert.deepEqual(chunkText(''), []);
  assert.deepEqual(chunkText('   \n\n  '), []);
});

test('chunkText geeft één chunk voor korte tekst', () => {
  const chunks = chunkText('Dit is een korte alinea.');
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0], 'Dit is een korte alinea.');
});

test('chunkText houdt elke chunk binnen CHUNK_MAX_CHARS', () => {
  const paragraph = 'Dit is een zin. '.repeat(200); // ruim > CHUNK_MAX_CHARS
  const chunks = chunkText(paragraph);

  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= CHUNK_MAX_CHARS, `chunk van ${chunk.length} tekens overschrijdt CHUNK_MAX_CHARS`);
  }
});

test('chunkText splitst een enkel te lang woord/zin hard op een woordgrens', () => {
  const longSentence = `${'a'.repeat(2000)} b`;
  const chunks = chunkText(longSentence);

  for (const chunk of chunks) {
    assert.ok(chunk.length <= CHUNK_MAX_CHARS);
  }
});

test('chunkText voegt overlap toe tussen opeenvolgende chunks', () => {
  const paragraphs = Array.from({ length: 10 }, (_, i) => `Alinea nummer ${i}. `.repeat(20)).join('\n\n');
  const chunks = chunkText(paragraphs);

  assert.ok(chunks.length > 1);
  // De overlap-suffix van chunk N zou (een deel van) chunk N+1 moeten openen.
  const firstChunkTail = (chunks[0] as string).slice(-50);
  const secondChunkHead = (chunks[1] as string).slice(0, 250);
  assert.ok(secondChunkHead.includes(firstChunkTail.split(' ').slice(-5).join(' ')));
});

test('chunkText begint bij voorkeur een nieuwe chunk op een markdown-kop', () => {
  const text = `${'Inleidende tekst. '.repeat(30)}\n\n## Een kop\n\n${'Meer tekst. '.repeat(30)}`;
  const chunks = chunkText(text);

  const headingChunkIndex = chunks.findIndex((c) => c.includes('## Een kop'));
  assert.ok(headingChunkIndex >= 0);
  // De kop staat aan het begin van zijn chunk (op de overlap-prefix na), niet ergens middenin verstopt na lange inleidende tekst.
  const headingChunk = chunks[headingChunkIndex] as string;
  assert.ok(headingChunk.indexOf('## Een kop') < 260);
});

test('chunkText voegt een te korte laatste chunk samen met de vorige', () => {
  const text = `${'Een lange eerste alinea. '.repeat(60)}\n\nKort.`;
  const chunks = chunkText(text);

  const last = chunks[chunks.length - 1] as string;
  assert.ok(last.length >= MIN_CHUNK_CHARS || chunks.length === 1);
  assert.ok(last.includes('Kort.'));
});
