import * as crypto from 'node:crypto';
import { extractText } from './extract';
import { chunkText } from './chunker';
import type { DocumentStore, DocumentRecord } from './store';
import type { Embedder } from '../ollama-embed';
import { withTimeout } from '../timeout';

const EMBED_BATCH_SIZE = 16;
// Ruime bovengrens voor persoonlijk gebruik (~830 chunks van CHUNK_TARGET_CHARS) —
// voorkomt dat één document honderden embedding-aanroepen en een trage,
// onvoorspelbare ingest-tijd veroorzaakt.
const MAX_EXTRACTED_CHARS = 1_000_000;
// Compressieformaten (pdf/docx) kunnen tijdens het uitpakken/parsen lang blijven hangen
// vóórdat MAX_EXTRACTED_CHARS hierboven kan afdwingen (decompressie-bom-risico, zie
// README). Deze timeout begrenst hoe lang dat het main process mag blokkeren.
const EXTRACT_TIMEOUT_MS = 30_000;

export interface IngestInput {
  conversationId: number;
  filePath: string;
  buffer: Buffer;
  title: string;
}

export interface IngestProgress {
  done: number;
  total: number;
}

/**
 * Volledige pipeline extract -> chunk -> embed (in batches, met
 * voortgangs-callback) -> store. Geen Electron-afhankelijkheid: alleen
 * ipc/documents-handler.ts kent app/dialog, dit is pure orkestratie.
 */
export async function ingestDocument(
  store: DocumentStore,
  embedder: Embedder,
  embedModel: string,
  input: IngestInput,
  onProgress?: (progress: IngestProgress) => void,
): Promise<DocumentRecord> {
  const text = await withTimeout(extractText(input.filePath, input.buffer), EXTRACT_TIMEOUT_MS, 'Tekst-extractie');
  if (text.length > MAX_EXTRACTED_CHARS) {
    throw new Error(
      `Document is te groot na extractie (${text.length} tekens, max ${MAX_EXTRACTED_CHARS}). Splits het document in kleinere delen.`,
    );
  }

  const chunks = chunkText(text);

  if (chunks.length === 0) {
    throw new Error('Document bevat geen bruikbare tekst na extractie.');
  }

  const contentHash = crypto.createHash('sha256').update(input.buffer).digest('hex');
  const embeddings: Float32Array[] = [];

  for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
    const batchEmbeddings = await embedder.embed(batch);
    embeddings.push(...batchEmbeddings);
    onProgress?.({ done: Math.min(i + batch.length, chunks.length), total: chunks.length });
  }

  const embedDims = embeddings[0]?.length ?? 0;

  return store.addDocument({
    conversationId: input.conversationId,
    title: input.title,
    contentHash,
    charCount: text.length,
    embedModel,
    embedDims,
    chunks: chunks.map((chunkedText, index) => ({
      text: chunkedText,
      embedding: embeddings[index] as Float32Array,
    })),
  });
}
