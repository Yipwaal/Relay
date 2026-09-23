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
  /** null: toegevoegd vóór Fase 5 en doorzoekbaar in elk gesprek. */
  conversationId: number | null;
}

export interface DocumentChunkInput {
  text: string;
  embedding: Float32Array;
}

export interface AddDocumentInput {
  conversationId: number;
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

/**
 * Alles is per gesprek: een gesprek ziet zijn eigen documenten plus de
 * globale (conversation_id NULL) van vóór Fase 5.
 */
export interface DocumentStore {
  listDocuments(conversationId: number): DocumentRecord[];
  getDocument(id: number): DocumentRecord | undefined;
  addDocument(input: AddDocumentInput): DocumentRecord;
  deleteDocument(id: number): void;
  search(queryVector: Float32Array, embedModel: string, k: number, conversationId: number): SearchResultChunk[];
  hasDocumentsForModel(embedModel: string, conversationId: number): boolean;
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
  conversation_id: number | null;
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
    conversationId: row.conversation_id,
  };
}

export function createDocumentStore(db: DatabaseSync): DocumentStore {
  const VISIBLE_IN = '(conversation_id = ? OR conversation_id IS NULL)';
  const listStmt = db.prepare(`SELECT * FROM documents WHERE ${VISIBLE_IN} ORDER BY created_at, id`);
  const getStmt = db.prepare('SELECT * FROM documents WHERE id = ?');
  const selectVisibleByHashStmt = db.prepare(`SELECT * FROM documents WHERE content_hash = ? AND ${VISIBLE_IN}`);
  const insertDocStmt = db.prepare(
    `INSERT INTO documents (title, content_hash, char_count, chunk_count, embed_model, embed_dims, created_at, conversation_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertChunkStmt = db.prepare('INSERT INTO document_chunks (document_id, ordinal, text, embedding) VALUES (?, ?, ?, ?)');
  const deleteDocStmt = db.prepare('DELETE FROM documents WHERE id = ?');
  const chunksForModelStmt = db.prepare(
    `SELECT document_chunks.text AS text, document_chunks.embedding AS embedding,
            documents.id AS document_id, documents.title AS document_title
     FROM document_chunks
     JOIN documents ON documents.id = document_chunks.document_id
     WHERE documents.embed_model = ? AND (documents.conversation_id = ? OR documents.conversation_id IS NULL)`,
  );
  const countForModelStmt = db.prepare(`SELECT COUNT(*) AS n FROM documents WHERE embed_model = ? AND ${VISIBLE_IN}`);

  return {
    listDocuments(conversationId: number): DocumentRecord[] {
      return (listStmt.all(conversationId) as unknown as DocumentRow[]).map(toDocumentRecord);
    },

    getDocument(id: number): DocumentRecord | undefined {
      const row = getStmt.get(id) as unknown as DocumentRow | undefined;
      return row ? toDocumentRecord(row) : undefined;
    },

    addDocument(input: AddDocumentInput): DocumentRecord {
      const existing = selectVisibleByHashStmt.get(input.contentHash, input.conversationId) as unknown as DocumentRow | undefined;
      if (existing) {
        throw new Error(`Dit document ("${existing.title}") is al toegevoegd.`);
      }
      if (input.chunks.length === 0) {
        throw new Error('Document bevat geen bruikbare tekst na extractie.');
      }

      const now = Date.now();
      db.exec('BEGIN');
      try {
        const inserted = insertDocStmt.run(
          input.title,
          input.contentHash,
          input.charCount,
          input.chunks.length,
          input.embedModel,
          input.embedDims,
          now,
          input.conversationId,
        );
        const row = getStmt.get(Number(inserted.lastInsertRowid)) as unknown as DocumentRow;

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

    search(queryVector: Float32Array, embedModel: string, k: number, conversationId: number): SearchResultChunk[] {
      const rows = chunksForModelStmt.all(embedModel, conversationId) as unknown as ChunkRow[];
      if (rows.length === 0) return [];

      const normalizedQuery = normalize(queryVector);
      const vectors = rows.map((row) => blobToFloats(row.embedding));
      const ranked = topK(normalizedQuery, vectors, k);

      return ranked.map(({ index, score }) => {
        const row = rows[index] as ChunkRow;
        return { documentId: row.document_id, documentTitle: row.document_title, text: row.text, score };
      });
    },

    hasDocumentsForModel(embedModel: string, conversationId: number): boolean {
      const row = countForModelStmt.get(embedModel, conversationId) as unknown as { n: number };
      return row.n > 0;
    },
  };
}
