import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ingestDocument } from '../ingest';
import type { DocumentStore, AddDocumentInput, DocumentRecord } from '../store';
import type { Embedder } from '../../ollama-embed';

function fakeEmbedder(dims = 4): { embedder: Embedder; calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    embedder: {
      async embed(texts: string[]): Promise<Float32Array[]> {
        calls.push(texts);
        return texts.map(() => new Float32Array(dims).fill(1));
      },
    },
  };
}

function fakeStore(): { store: DocumentStore; added: AddDocumentInput[] } {
  const added: AddDocumentInput[] = [];
  const store: DocumentStore = {
    listDocuments: () => [],
    addDocument: (input: AddDocumentInput): DocumentRecord => {
      added.push(input);
      return {
        id: 1,
        title: input.title,
        contentHash: input.contentHash,
        charCount: input.charCount,
        chunkCount: input.chunks.length,
        embedModel: input.embedModel,
        embedDims: input.embedDims,
        createdAt: Date.now(),
      };
    },
    deleteDocument: () => {},
    search: () => [],
    hasDocumentsForModel: () => true,
  };
  return { store, added };
}

test('ingestDocument extraheert, chunkt, embedt en slaat op', async () => {
  const { store, added } = fakeStore();
  const { embedder } = fakeEmbedder();

  const record = await ingestDocument(store, embedder, 'test-embed', {
    filePath: 'notitie.txt',
    buffer: Buffer.from('Dit is een test-document met wat inhoud.', 'utf-8'),
    title: 'notitie.txt',
  });

  assert.equal(record.title, 'notitie.txt');
  assert.equal(added.length, 1);
  assert.equal(added[0]?.embedModel, 'test-embed');
  assert.equal(added[0]?.chunks.length, 1);
  assert.equal(added[0]?.chunks[0]?.text, 'Dit is een test-document met wat inhoud.');
});

test('ingestDocument rapporteert voortgang per batch', async () => {
  const { store } = fakeStore();
  const { embedder } = fakeEmbedder();

  // Genoeg tekst voor meerdere chunks (elk ruim boven MIN_CHUNK_CHARS, gescheiden door lege regels).
  const paragraphs = Array.from({ length: 20 }, (_, i) => `Alinea nummer ${i}. `.repeat(30));
  const buffer = Buffer.from(paragraphs.join('\n\n'), 'utf-8');

  const progressUpdates: Array<{ done: number; total: number }> = [];
  await ingestDocument(store, embedder, 'm', { filePath: 'groot.txt', buffer, title: 'groot.txt' }, (p) =>
    progressUpdates.push(p),
  );

  assert.ok(progressUpdates.length > 0);
  const last = progressUpdates[progressUpdates.length - 1];
  assert.equal(last?.done, last?.total);
});

test('ingestDocument gooit een fout voor een document dat te groot is na extractie', async () => {
  const { store } = fakeStore();
  const { embedder } = fakeEmbedder();

  const hugeText = 'a'.repeat(1_000_001);
  await assert.rejects(
    () => ingestDocument(store, embedder, 'm', { filePath: 'enorm.txt', buffer: Buffer.from(hugeText), title: 'enorm.txt' }),
    /te groot na extractie/,
  );
});

test('ingestDocument gooit een fout voor een document zonder bruikbare tekst', async () => {
  const { store } = fakeStore();
  const { embedder } = fakeEmbedder();

  await assert.rejects(
    () => ingestDocument(store, embedder, 'm', { filePath: 'leeg.txt', buffer: Buffer.from('   \n\n  '), title: 'leeg.txt' }),
    /geen bruikbare tekst/,
  );
});

test('ingestDocument berekent content_hash consistent op basis van de bytes', async () => {
  const { store, added } = fakeStore();
  const { embedder } = fakeEmbedder();

  const buffer = Buffer.from('Zelfde inhoud', 'utf-8');
  await ingestDocument(store, embedder, 'm', { filePath: 'a.txt', buffer, title: 'a.txt' });
  await ingestDocument(store, embedder, 'm', { filePath: 'b.txt', buffer: Buffer.from(buffer), title: 'b.txt' });

  assert.equal(added[0]?.contentHash, added[1]?.contentHash);
});
