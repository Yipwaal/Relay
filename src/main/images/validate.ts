/**
 * Afbeeldingen bij een bericht komen uit de renderer (plakken, slepen of
 * kiezen) en zijn dus onbetrouwbaar: het type wordt aan de eerste bytes
 * herkend, niet aan de naam of een door de renderer opgegeven mime-type, en
 * aantal, grootte en afmetingen zijn begrensd vóórdat er iets in de database
 * of naar Ollama gaat. Er wordt in main niets gedecodeerd: de afmetingen
 * komen uit de header (PNG: IHDR, JPEG: het eerste SOF-segment).
 */
export type ImageMime = 'image/png' | 'image/jpeg';

export interface IncomingImage {
  name: string;
  mime: ImageMime;
  data: Uint8Array;
}

export const MAX_IMAGES_PER_MESSAGE = 4;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_MESSAGE_IMAGE_BYTES = 20 * 1024 * 1024;
/** Een klein bestand kan enorme afmetingen opgeven; de decoder van Ollama zou daar gigabytes voor reserveren. */
export const MAX_IMAGE_SIDE_PX = 8192;
export const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_IMAGE_NAME_CHARS = 120;

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte);
}

/** PNG en JPEG: die kan elk Ollama-beeldmodel lezen. */
export function detectImageMime(bytes: Uint8Array): ImageMime | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  return null;
}

function u16(bytes: Uint8Array, at: number): number {
  return ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);
}

function u32(bytes: Uint8Array, at: number): number {
  return u16(bytes, at) * 0x10000 + u16(bytes, at + 2);
}

// SOF0–SOF15 behalve DHT (C4), JPG (C8) en DAC (CC).
const JPEG_SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/** Breedte × hoogte uit de header, of null als die niet (geldig) te vinden is. */
export function readImageSize(bytes: Uint8Array, mime: ImageMime): { width: number; height: number } | null {
  if (mime === 'image/png') {
    // Handtekening (8) + lengte (4) + "IHDR" (4) + breedte (4) + hoogte (4).
    if (bytes.length < 24 || String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') return null;
    return { width: u32(bytes, 16), height: u32(bytes, 20) };
  }
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1] ?? 0;
    if (marker === 0xff) {
      at++;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // einde of beelddata vóór een SOF
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (at + 9 > bytes.length) return null;
      return { width: u16(bytes, at + 7), height: u16(bytes, at + 5) };
    }
    const length = u16(bytes, at + 2);
    if (length < 2) return null;
    at += 2 + length;
  }
  return null;
}

/**
 * Alleen een basename zonder stuur-, opmaak- en scheidingstekens (ook
 * bidi/zero-width); dient als label in de UI. In de prompt komt de naam niet.
 */
function cleanName(value: unknown, index: number): string {
  const raw = typeof value === 'string' ? value.slice(-512) : '';
  const base =
    raw
      .replace(/\\/g, '/')
      .split('/')
      .pop()
      ?.replace(/[\p{C}\p{Zl}\p{Zp}<>"`[\]]/gu, '')
      .replace(/\s+/g, ' ')
      .trim() ?? '';
  return (base || `afbeelding-${index + 1}`).slice(0, MAX_IMAGE_NAME_CHARS);
}

function validateOne(item: unknown, index: number): IncomingImage {
  const v = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
  const name = cleanName(v.name, index);
  if (!(v.data instanceof Uint8Array)) throw new Error('Ongeldige afbeelding.');
  if (v.data.byteLength === 0) throw new Error(`"${name}" is leeg.`);
  if (v.data.byteLength > MAX_IMAGE_BYTES) throw new Error(`"${name}" is te groot (max ${MAX_IMAGE_BYTES / (1024 * 1024)} MB).`);
  // Exacte kopie: controle en opslag werken op dezelfde bytes, en een groter onderliggend buffer blijft niet hangen.
  const data = v.data.slice();
  const mime = detectImageMime(data);
  if (!mime) throw new Error(`"${name}" is geen PNG- of JPEG-afbeelding.`);
  const size = readImageSize(data, mime);
  if (!size || size.width === 0 || size.height === 0) throw new Error(`"${name}" lijkt beschadigd (afmetingen onleesbaar).`);
  if (size.width > MAX_IMAGE_SIDE_PX || size.height > MAX_IMAGE_SIDE_PX || size.width * size.height > MAX_IMAGE_PIXELS) {
    throw new Error(`"${name}" is te groot (${size.width} × ${size.height} pixels; max ${MAX_IMAGE_SIDE_PX} per zijde).`);
  }
  return { name, mime, data };
}

/** Gooit een Nederlandse foutmelding als iets niet klopt; geeft anders de gecontroleerde afbeeldingen terug. */
export function validateImages(value: unknown): IncomingImage[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('Ongeldige afbeeldingen.');
  if (value.length > MAX_IMAGES_PER_MESSAGE) throw new Error(`Maximaal ${MAX_IMAGES_PER_MESSAGE} afbeeldingen per bericht.`);
  // Array.from i.p.v. map: gaten in een (sparse) array worden undefined en dus geweigerd, niet overgeslagen.
  const images = Array.from(value as unknown[], validateOne);
  const total = images.reduce((sum, image) => sum + image.data.byteLength, 0);
  if (total > MAX_MESSAGE_IMAGE_BYTES) throw new Error(`Samen te groot (max ${MAX_MESSAGE_IMAGE_BYTES / (1024 * 1024)} MB aan afbeeldingen per bericht).`);
  return images;
}
