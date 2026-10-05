import type { DatabaseSync } from 'node:sqlite';
import type { ImageMime, IncomingImage } from '../images/validate';

export interface StoredImageInfo {
  id: number;
  messageId: number;
  name: string;
}

export interface ImageForModel {
  name: string;
  /** Base64, zoals Ollama's /api/chat het in `images` verwacht. */
  base64: string;
}

export interface ImageStore {
  /** Schrijft afbeeldingen bij een (net aangemaakt) bericht weg; de aanroeper zorgt voor de transactie. */
  insert(messageId: number, images: IncomingImage[]): void;
  /** Namen per bericht, voor de berichtenlijst in de UI (zonder de bytes). */
  listForConversation(conversationId: number): StoredImageInfo[];
  /** Bytes van één afbeelding, voor een miniatuur in de UI. */
  get(id: number): { mime: ImageMime; data: Uint8Array } | undefined;
  /** Base64 per bericht voor de modelgeschiedenis. */
  forMessages(messageIds: number[]): Map<number, ImageForModel[]>;
  countFor(messageId: number): number;
}

/** Afbeeldingen bij gebruikersberichten (message_images, migratie v5): apart van messages, zodat de berichtenlijst geen BLOBs meesleept. */
export function createImageStore(db: DatabaseSync): ImageStore {
  const insertStmt = db.prepare('INSERT INTO message_images (message_id, ordinal, name, mime, data) VALUES (?, ?, ?, ?, ?)');
  const listStmt = db.prepare(
    'SELECT i.id, i.message_id AS messageId, i.name FROM message_images i JOIN messages m ON m.id = i.message_id WHERE m.conversation_id = ? ORDER BY i.message_id, i.ordinal',
  );
  const getStmt = db.prepare('SELECT mime, data FROM message_images WHERE id = ?');
  const forMessageStmt = db.prepare('SELECT name, data FROM message_images WHERE message_id = ? ORDER BY ordinal');
  const countStmt = db.prepare('SELECT COUNT(*) AS n FROM message_images WHERE message_id = ?');

  return {
    insert(messageId, images) {
      images.forEach((image, ordinal) => insertStmt.run(messageId, ordinal, image.name, image.mime, image.data));
    },

    listForConversation(conversationId) {
      return listStmt.all(conversationId) as unknown as StoredImageInfo[];
    },

    get(id) {
      const row = getStmt.get(id) as unknown as { mime: ImageMime; data: Uint8Array } | undefined;
      return row ? { mime: row.mime, data: row.data } : undefined;
    },

    forMessages(messageIds) {
      const result = new Map<number, ImageForModel[]>();
      for (const messageId of messageIds) {
        const rows = forMessageStmt.all(messageId) as unknown as Array<{ name: string; data: Uint8Array }>;
        if (rows.length > 0) result.set(messageId, rows.map((row) => ({ name: row.name, base64: Buffer.from(row.data).toString('base64') })));
      }
      return result;
    },

    countFor(messageId) {
      return (countStmt.get(messageId) as unknown as { n: number }).n;
    },
  };
}
