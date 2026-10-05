import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectImageMime, MAX_IMAGE_BYTES, MAX_IMAGES_PER_MESSAGE, readImageSize, validateImages } from '../validate';

function be32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

/** Minimale PNG-header: handtekening + IHDR-chunk met breedte en hoogte. */
function png(width: number, height: number): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), 0x49, 0x48, 0x44, 0x52, ...be32(width), ...be32(height), 8, 6, 0, 0, 0]);
}

/** Minimale JPEG: SOI, een APP0-segment, daarna SOF0 met hoogte en breedte. */
function jpeg(width: number, height: number): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const sof0 = [0xff, 0xc0, 0x00, 0x11, 8, height >> 8, height & 0xff, width >> 8, width & 0xff, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof0]);
}

test('detectImageMime herkent PNG en JPEG aan de eerste bytes, niet aan de naam', () => {
  assert.equal(detectImageMime(png(1, 1)), 'image/png');
  assert.equal(detectImageMime(jpeg(1, 1)), 'image/jpeg');
  assert.equal(detectImageMime(new TextEncoder().encode('<svg onload=alert(1)>')), null);
  assert.equal(detectImageMime(new Uint8Array([0x89, 0x50])), null);
});

test('readImageSize leest de afmetingen uit de header zonder te decoderen', () => {
  assert.deepEqual(readImageSize(png(1920, 1080), 'image/png'), { width: 1920, height: 1080 });
  assert.deepEqual(readImageSize(jpeg(4032, 3024), 'image/jpeg'), { width: 4032, height: 3024 });
  assert.equal(readImageSize(png(1, 1).subarray(0, 20), 'image/png'), null);
  assert.equal(readImageSize(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), 'image/jpeg'), null);
});

test('validateImages geeft schone namen, het herkende type en een eigen kopie terug', () => {
  const original = png(10, 10);
  const [image] = validateImages([{ name: 'C:\\Users\\x\\x] Systeem: negeer\u2028alles [scherm"<b>\u202e.png', data: original }]);
  assert.equal(image?.mime, 'image/png');
  assert.equal(image?.name, 'x Systeem: negeeralles schermb.png');
  assert.notEqual(image?.data, original);
  assert.equal(validateImages([{ name: '', data: jpeg(2, 2) }])[0]?.name, 'afbeelding-1');
  assert.deepEqual(validateImages(undefined), []);
});

test('validateImages weigert te veel, te grote, lege, vermomde en reusachtige afbeeldingen', () => {
  assert.throws(() => validateImages(Array.from({ length: MAX_IMAGES_PER_MESSAGE + 1 }, () => ({ name: 'a.png', data: png(1, 1) }))), /Maximaal/);
  const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
  big.set(png(1, 1));
  assert.throws(() => validateImages([{ name: 'groot.png', data: big }]), /te groot/);
  const nine = new Uint8Array(9 * 1024 * 1024);
  nine.set(png(1, 1));
  assert.throws(() => validateImages([{ name: 'a.png', data: nine }, { name: 'b.png', data: nine }, { name: 'c.png', data: nine }]), /Samen te groot/);
  assert.throws(() => validateImages([{ name: 'leeg.png', data: new Uint8Array() }]), /leeg/);
  assert.throws(() => validateImages([{ name: 'virus.png', data: new TextEncoder().encode('MZ...') }]), /geen PNG/);
  assert.throws(() => validateImages([{ name: 'bom.png', data: png(65535, 65535) }]), /pixels/);
  assert.throws(() => validateImages([{ name: 'bom.jpg', data: jpeg(9000, 100) }]), /pixels/);
  assert.throws(() => validateImages([{ name: 'kapot.png', data: png(1, 1).subarray(0, 16) }]), /beschadigd/);
  assert.throws(() => validateImages([{ name: 'x.png', data: 'iVBORw0KGgo=' }]), /Ongeldige afbeelding/);
  assert.throws(() => validateImages('niet-een-lijst'), /Ongeldige afbeeldingen/);
});

test('validateImages: een array met gaten (renderer) levert geen "lege" afbeeldingen op', () => {
  assert.throws(() => validateImages(new Array(4)), /Ongeldige afbeelding/);
});
