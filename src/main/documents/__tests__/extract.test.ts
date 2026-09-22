import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { extractText, isSupportedExtension } from '../extract';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

test('isSupportedExtension herkent de ondersteunde extensies (case-insensitive)', () => {
  assert.equal(isSupportedExtension('.txt'), true);
  assert.equal(isSupportedExtension('.MD'), true);
  assert.equal(isSupportedExtension('.pdf'), true);
  assert.equal(isSupportedExtension('.docx'), true);
  assert.equal(isSupportedExtension('.exe'), false);
});

test('extractText leest platte tekst', async () => {
  const text = await extractText('notitie.txt', Buffer.from('Hallo wereld', 'utf-8'));
  assert.equal(text, 'Hallo wereld');
});

test('extractText strip een UTF-8 BOM', async () => {
  const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Tekst na BOM', 'utf-8')]);
  const text = await extractText('notitie.txt', withBom);
  assert.equal(text, 'Tekst na BOM');
});

test('extractText geeft een duidelijke fout bij ongeldige UTF-8', async () => {
  const invalidUtf8 = Buffer.from([0xff, 0xfe, 0x00, 0x01]);
  await assert.rejects(() => extractText('kapot.txt', invalidUtf8), /geldige UTF-8/);
});

test('extractText weigert een niet-ondersteunde extensie', async () => {
  await assert.rejects(() => extractText('bestand.exe', Buffer.from('x')), /niet ondersteund/);
});

test('extractText haalt tekst uit een PDF', async () => {
  const fs = await import('node:fs/promises');
  const buffer = await fs.readFile(path.join(FIXTURES_DIR, 'sample.pdf'));
  const text = await extractText('sample.pdf', buffer);

  assert.match(text, /Hallo uit een test-PDF/);
});

test('extractText haalt tekst uit een DOCX', async () => {
  const fs = await import('node:fs/promises');
  const buffer = await fs.readFile(path.join(FIXTURES_DIR, 'sample.docx'));
  const text = await extractText('sample.docx', buffer);

  assert.match(text, /Hallo uit een test-Word-document/);
});
