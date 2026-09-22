import * as path from 'node:path';
import { PDFParse } from 'pdf-parse';
import * as mammoth from 'mammoth';

/**
 * Extractor per bestandsextensie (architect-advies Fase 4): begonnen met
 * txt/md, later uitgebreid met pdf/docx op expliciet verzoek van de
 * gebruiker. Nieuw formaat toevoegen is één regel in EXTRACTORS.
 */
export type SupportedExtension = '.txt' | '.md' | '.markdown' | '.pdf' | '.docx';

export const SUPPORTED_EXTENSIONS: readonly SupportedExtension[] = ['.txt', '.md', '.markdown', '.pdf', '.docx'];

function stripBom(text: string): string {
  return text.length > 0 && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function extractPlainText(buffer: Buffer): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new Error('Bestand is geen geldige UTF-8-tekst.');
  }
  return stripBom(text);
}

async function extractPdf(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.pages.map((page) => page.text).join('\n\n');
  } finally {
    await parser.destroy();
  }
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

const EXTRACTORS: Record<SupportedExtension, (buffer: Buffer) => Promise<string> | string> = {
  '.txt': extractPlainText,
  '.md': extractPlainText,
  '.markdown': extractPlainText,
  '.pdf': extractPdf,
  '.docx': extractDocx,
};

export function isSupportedExtension(ext: string): ext is SupportedExtension {
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(ext.toLowerCase());
}

export async function extractText(filePath: string, buffer: Buffer): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  if (!isSupportedExtension(ext)) {
    throw new Error(
      `Bestandstype "${ext || '(geen extensie)'}" wordt niet ondersteund (alleen .txt, .md, .markdown, .pdf, .docx).`,
    );
  }

  const extractor = EXTRACTORS[ext];
  const text = await extractor(buffer);
  return text.trim();
}
