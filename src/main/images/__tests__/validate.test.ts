import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectImageMime, MAX_IMAGE_BYTES, MAX_IMAGES_PER_MESSAGE, validateImages } from '../validate';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]);

test('detectImageMime herkent PNG en JPEG aan de eerste bytes, niet aan de naam', () => {
  assert.equal(detectImageMime(PNG), 'image/png');
  assert.equal(detectImageMime(JPEG), 'image/jpeg');
  assert.equal(detectImageMime(new TextEncoder().encode('<svg onload=alert(1)>')), null);
  assert.equal(detectImageMime(new Uint8Array([0x89, 0x50])), null);
});

test('validateImages geeft schone namen en het herkende type terug', () => {
  const [image] = validateImages([{ name: 'C:\\Users\\x\\scherm"<b>.png', data: PNG }]);
  assert.deepEqual({ name: image?.name, mime: image?.mime }, { name: 'schermb.png', mime: 'image/png' });
  assert.equal(validateImages([{ name: '', data: JPEG }])[0]?.name, 'afbeelding-1');
  assert.deepEqual(validateImages(undefined), []);
});

test('validateImages weigert te veel, te grote, lege en vermomde bestanden', () => {
  assert.throws(() => validateImages(Array.from({ length: MAX_IMAGES_PER_MESSAGE + 1 }, () => ({ name: 'a.png', data: PNG }))), /Maximaal/);
  const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
  big.set(PNG);
  assert.throws(() => validateImages([{ name: 'groot.png', data: big }]), /te groot/);
  assert.throws(() => validateImages([{ name: 'leeg.png', data: new Uint8Array() }]), /leeg/);
  assert.throws(() => validateImages([{ name: 'virus.png', data: new TextEncoder().encode('MZ...') }]), /geen PNG/);
  assert.throws(() => validateImages([{ name: 'x.png', data: 'iVBORw0KGgo=' }]), /Ongeldige afbeelding/);
  assert.throws(() => validateImages('niet-een-lijst'), /Ongeldige afbeeldingen/);
});
