import type { DatabaseSync } from 'node:sqlite';
import { blobToFloats, floatsToBlob, normalize, topK } from './vector';

/**
 * Interne representatie zonder 'outdated'-vlag: de store kent het huidig
 * geconfigureerde embedModel niet (dat zit in config.json). ipc/documents-handler.ts
 * rekent dat uit bij het naar de renderer sturen (zie shared/ipc-types.ts's DocumentInfo).
 */
export interface DocumentRecord {
  id: number;
  title: string;
  contentHash: string;
  charCount: number;
  chunkCount: number;
  embedModel: string;
  embedDims: number;
  createdAt: number;
}

export interface DocumentChunkInput {
  text: string;
  embedding: Float32Array;
}

export interface AddDocumentInput {
  title: string;
  contentHash: string;
  charCount: number;
  embedModel: string;
  embedDims: number;
  chunks: DocumentChunkInput[];
}

export interface SearchResultChunk {
  documentId: number;
  documentTitle: string;
  text: string;
  score: number;
}

export interface DocumentStore {
  listDocuments(): DocumentRecord[];
  addDocument(input: AddDocumentInput): DocumentRecord;
  deleteDocument(id: number): void;
  search(queryVector: Float32Array, embedModel: string, k: number): SearchResultChunk[];
  hasDocumentsForModel(embedModel: string): boolean;
}

interface DocumentRow {
  id: number;
  title: string;
  content_hash: string;
  char_count: number;
  chunk_count: number;
  embed_model: string;
  embed_dims: number;
  created_at: number;
}

interface ChunkRow {
  text: string;
  embedding: Uint8Array;
  document_id: number;
  document_title: string;
}

function toDocumentRecord(row: DocumentRow): DocumentRecord {
  return {
    id: row.id,
    title: row.title,
    contentHash: row.content_hash,
    charCount: row.char_count,
    chunkCount: row.chunk_count,
    embedModel: row.embed_model,
    embedDims: row.embed_dims,
    createdAt: row.created_at,
  };
}

export function createDocumentStore(db: DatabaseSync): DocumentStore {
  const listStmt = db.prepare('SELECT * FROM documents ORDER BY created_at DESC, id DESC');
  const selectByHashStmt = db.prepare('SELECT * FROM documents WHERE content_hash = ?');
  const insertDocStmt = db.prepare(
    `INSERT INTO documents (title, content_hash, char_count, chunk_count, embed_model, embed_dims, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertChunkStmt = db.prepare('INSERT INTO document_chunks (document_id, ordinal, text, embedding) VALUES (?, ?, ?, ?)');
  const deleteDocStmt = db.prepare('DELETE FROM documents WHERE id = ?');
  const chunksForModelStmt = db.prepare(
    `SELECT document_chunks.text AS text, document_chunks.embedding AS embedding,
            documents.id AS document_id, documents.title AS document_title
     FROM document_chunks
     JOIN documents ON documents.id = document_chunks.document_id
     WHERE documents.embed_model = ?`,
  );
  const countForModelStmt = db.prepare('SELECT COUNT(*) AS n FROM documents WHERE embed_model = ?');

  return {
    listDocuments(): DocumentRecord[] {
      return (listStmt.all() as unknown as DocumentRow[]).map(toDocumentRecord);
    },

    addDocument(input: AddDocumentInput): DocumentRecord {
      const existing = selectByHashStmt.get(input.contentHash) as unknown as DocumentRow | undefined;
      if (existing) {
        throw new Error(`Dit document ("${existing.title}") is al toegevoegd.`);
      }
      if (input.chunks.length === 0) {
        throw new Error('Document bevat geen bruikbare tekst na extractie.');
      }

      const now = Date.now();
      db.exec('BEGIN');
      try {
        insertDocStmt.run(input.title, input.contentHash, input.charCount, input.chunks.length, input.embedModel, input.embedDims, now);
        const row = selectByHashStmt.get(input.contentHash) as unknown as DocumentRow;

        input.chunks.forEach((chunk, ordinal) => {
          const blob = floatsToBlob(normalize(chunk.embedding));
          insertChunkStmt.run(row.id, ordinal, chunk.text, blob);
        });

        db.exec('COMMIT');
        return toDocumentRecord(row);
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },

    deleteDocument(id: number): void {
      deleteDocStmt.run(id);
    },

    search(queryVector: Float32Array, embedModel: string, k: number): SearchResultChunk[] {
      const rows = chunksForModelStmt.all(embedModel) as unknown as ChunkRow[];
      if (rows.length === 0) return [];

      const normalizedQuery = normalize(queryVector);
      const vectors = rows.map((row) => blobToFloats(row.embedding));
      const ranked = topK(normalizedQuery, vectors, k);

      return ranked.map(({ index, score }) => {
        const row = rows[index] as ChunkRow;
        return { documentId: row.document_id, documentTitle: row.document_title, text: row.text, score };
      });
    },

    hasDocumentsForModel(embedModel: string): boolean {
      const row = countForModelStmt.get(embedModel) as unknown as { n: number };
      return row.n > 0;
    },
  };
}
