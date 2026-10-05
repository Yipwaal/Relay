/**
 * Afbeeldingen bij een bericht komen uit de renderer (plakken, slepen of
 * kiezen) en zijn dus onbetrouwbaar: het type wordt aan de eerste bytes
 * herkend, niet aan de naam of een door de renderer opgegeven mime-type, en
 * aantal en grootte zijn begrensd vóórdat er iets in de database of naar
 * Ollama gaat.
 */
export type ImageMime = 'image/png' | 'image/jpeg';

export interface IncomingImage {
  name: string;
  mime: ImageMime;
  data: Uint8Array;
}

export const MAX_IMAGES_PER_MESSAGE = 4;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
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

/** Alleen een basename zonder stuurtekens; dient als label ("[afbeelding: …]") en titel. */
function cleanName(value: unknown, index: number): string {
  const raw = typeof value === 'string' ? value : '';
  const base = raw.replace(/\\/g, '/').split('/').pop()?.replace(/[\u0000-\u001f\u007f<>"]/g, '').trim() ?? '';
  return (base || `afbeelding-${index + 1}`).slice(0, MAX_IMAGE_NAME_CHARS);
}

/** Gooit een Nederlandse foutmelding als iets niet klopt; geeft anders de gecontroleerde afbeeldingen terug. */
export function validateImages(value: unknown): IncomingImage[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('Ongeldige afbeeldingen.');
  if (value.length > MAX_IMAGES_PER_MESSAGE) throw new Error(`Maximaal ${MAX_IMAGES_PER_MESSAGE} afbeeldingen per bericht.`);
  return value.map((item: unknown, index): IncomingImage => {
    const v = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
    const name = cleanName(v.name, index);
    if (!(v.data instanceof Uint8Array)) throw new Error('Ongeldige afbeelding.');
    if (v.data.byteLength === 0) throw new Error(`"${name}" is leeg.`);
    if (v.data.byteLength > MAX_IMAGE_BYTES) throw new Error(`"${name}" is te groot (max ${MAX_IMAGE_BYTES / (1024 * 1024)} MB).`);
    const mime = detectImageMime(v.data);
    if (!mime) throw new Error(`"${name}" is geen PNG- of JPEG-afbeelding.`);
    return { name, mime, data: v.data };
  });
}
