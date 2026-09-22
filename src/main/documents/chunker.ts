/**
 * Chunking-strategie (zie architect-advies Fase 4): alinea's gretig
 * samenvoegen tot een doellengte, met terugval op zinsgrenzen en daarna op
 * een harde woordgrens voor te lange alinea's, plus overlap tussen chunks
 * zodat retrieval niet hard op een grens knipt. Geen tokenizer in dit project
 * (zie Fase 3's character-budget voor memory) — deze constanten zijn dus in
 * tekens, niet tokens.
 */
export const CHUNK_TARGET_CHARS = 1200;
export const CHUNK_MAX_CHARS = 1500;
export const CHUNK_OVERLAP_CHARS = 200;
export const MIN_CHUNK_CHARS = 200;

const HEADING_PATTERN = /^#{1,6}\s/;
const SENTENCE_SPLIT_PATTERN = /(?<=[.?!])\s+/;

/** Splitst één alinea/zin-groep tot stukken van hooguit maxChars, op zinsgrenzen en zo nodig op woordgrenzen. */
function splitLongPiece(piece: string, maxChars: number): string[] {
  if (piece.length <= maxChars) return [piece];

  const sentences = piece.split(SENTENCE_SPLIT_PATTERN);
  const pieces: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      if (current) {
        pieces.push(current);
        current = '';
      }
      let remaining = sentence;
      while (remaining.length > maxChars) {
        let cut = remaining.lastIndexOf(' ', maxChars);
        if (cut <= 0) cut = maxChars;
        pieces.push(remaining.slice(0, cut).trim());
        remaining = remaining.slice(cut).trim();
      }
      current = remaining;
      continue;
    }

    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length > maxChars) {
      if (current) pieces.push(current);
      current = sentence;
    } else {
      current = candidate;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

/** Laatste overlapChars van text, afgekapt op de eerstvolgende woordgrens zodat overlap niet midden in een woord begint. */
function takeOverlapSuffix(text: string, overlapChars: number): string {
  if (text.length <= overlapChars) return text;
  const slice = text.slice(text.length - overlapChars);
  const spaceIndex = slice.indexOf(' ');
  return spaceIndex === -1 ? slice : slice.slice(spaceIndex + 1);
}

export function chunkText(rawText: string): string[] {
  const normalized = rawText.replace(/\r\n/g, '\n').trim();
  if (normalized.length === 0) return [];

  const paragraphs = normalized
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const pieces: Array<{ text: string; isHeading: boolean }> = [];
  for (const paragraph of paragraphs) {
    const isHeading = HEADING_PATTERN.test(paragraph);
    for (const piece of splitLongPiece(paragraph, CHUNK_MAX_CHARS)) {
      pieces.push({ text: piece, isHeading });
    }
  }

  const chunks: string[] = [];
  let current = '';

  for (const piece of pieces) {
    const wouldExceed = current.length > 0 && current.length + 2 + piece.text.length > CHUNK_TARGET_CHARS;
    const startNewForHeading = piece.isHeading && current.length > 0;

    if (wouldExceed || startNewForHeading) {
      chunks.push(current);
      const overlap = takeOverlapSuffix(current, CHUNK_OVERLAP_CHARS);
      // Overlap alleen toevoegen als dat de piece niet alsnog over CHUNK_MAX_CHARS duwt
      // (een piece kan zelf al bijna CHUNK_MAX_CHARS groot zijn, zie splitLongPiece).
      current = overlap && overlap.length + 1 + piece.text.length <= CHUNK_MAX_CHARS ? `${overlap} ${piece.text}` : piece.text;
    } else {
      current = current ? `${current}\n\n${piece.text}` : piece.text;
    }
  }
  if (current) chunks.push(current);

  // Een te korte laatste chunk heeft weinig retrieval-waarde op zichzelf; voeg 'm samen met de vorige.
  if (chunks.length > 1) {
    const last = chunks[chunks.length - 1] as string;
    if (last.length < MIN_CHUNK_CHARS) {
      chunks.pop();
      // chunks.length > 1 vóór de pop garandeert hier minstens 1 element.
      chunks[chunks.length - 1] = `${chunks[chunks.length - 1] as string}\n\n${last}`;
    }
  }

  return chunks;
}
