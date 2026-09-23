import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';

// renderer/format.ts is een classic script (geen exports, zie index.html) —
// laad het gecompileerde bestand in een eigen vm-context en haal de
// top-level functies daar op.
interface FormatModule {
  countLabel(n: number, singular: string, plural: string): string;
  dateGroupLabel(ts: number, now: number): string;
  sidebarTimeLabel(ts: number, now: number): string;
  startedLabel(ts: number, now: number): string;
  formatSeconds(ms: number): string;
  formatBytes(bytes: number): string;
  titleFromText(text: string): string;
  groupByDate<T extends { updatedAt: number }>(items: T[], now: number): Array<{ label: string; items: T[] }>;
}

function loadFormat(): FormatModule {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'renderer', 'format.js'), 'utf-8');
  const context = vm.createContext({});
  vm.runInContext(source, context);
  return context as unknown as FormatModule;
}

const f = loadFormat();
// Woensdag 23 september 2026, 14:00 lokale tijd.
const NOW = new Date(2026, 8, 23, 14, 0).getTime();
const at = (day: number, hour: number, minute = 0, month = 8, year = 2026): number => new Date(year, month, day, hour, minute).getTime();

test('dateGroupLabel groepeert op kalenderdag, niet op 24-uursblokken', () => {
  assert.equal(f.dateGroupLabel(at(23, 0, 5), NOW), 'Vandaag');
  assert.equal(f.dateGroupLabel(at(22, 23, 59), NOW), 'Gisteren');
  assert.equal(f.dateGroupLabel(at(17, 9), NOW), 'Afgelopen 7 dagen');
  assert.equal(f.dateGroupLabel(at(16, 9), NOW), 'Eerder');
});

test('sidebarTimeLabel volgt het design: tijd, dag + tijd, dag, datum', () => {
  assert.equal(f.sidebarTimeLabel(at(23, 9, 12), NOW), '09:12');
  assert.equal(f.sidebarTimeLabel(at(22, 21, 5), NOW), 'di 21:05');
  assert.equal(f.sidebarTimeLabel(at(19, 14, 30), NOW), 'za');
  assert.equal(f.sidebarTimeLabel(at(2, 10), NOW), '2 sep');
});

test('startedLabel voor de header', () => {
  assert.equal(f.startedLabel(NOW - 5_000, NOW), 'zojuist');
  assert.equal(f.startedLabel(at(23, 9, 12), NOW), 'vandaag 09:12');
  assert.equal(f.startedLabel(at(22, 21, 5), NOW), 'gisteren 21:05');
  assert.equal(f.startedLabel(at(19, 14, 30), NOW), 'zaterdag 14:30');
  assert.equal(f.startedLabel(at(2, 10), NOW), '2 september');
  assert.equal(f.startedLabel(at(2, 10, 0, 8, 2025), NOW), '2 september 2025');
});

test('countLabel gebruikt woorden tot tien en enkelvoud bij één', () => {
  assert.equal(f.countLabel(1, 'bericht', 'berichten'), 'één bericht');
  assert.equal(f.countLabel(3, 'bericht', 'berichten'), 'drie berichten');
  assert.equal(f.countLabel(12, 'bericht', 'berichten'), '12 berichten');
});

test('formatSeconds en formatBytes gebruiken een Nederlandse komma', () => {
  assert.equal(f.formatSeconds(420), '0,4 s');
  assert.equal(f.formatBytes(1_200_000), '1,2 MB');
  assert.equal(f.formatBytes(312_000), '312 kB');
});

test('titleFromText kapt af op een woordgrens', () => {
  assert.equal(f.titleFromText('Korte vraag?'), 'Korte vraag?');
  assert.equal(f.titleFromText('Wat is de opzegtermijn als ik als huurder wil stoppen?'), 'Wat is de opzegtermijn als ik als…');
  assert.equal(f.titleFromText('   \n  '), 'Nieuw gesprek');
});

test('groupByDate sorteert nieuwste eerst en laat lege groepen weg', () => {
  const groups = f.groupByDate(
    [
      { id: 1, updatedAt: at(2, 10) },
      { id: 2, updatedAt: at(23, 9) },
      { id: 3, updatedAt: at(23, 11) },
    ],
    NOW,
  );
  // JSON-roundtrip: arrays uit de vm-context hebben een ander Array-prototype.
  assert.deepEqual(
    JSON.parse(JSON.stringify(groups.map((g) => [g.label, g.items.map((i) => i.id)]))),
    [
      ['Vandaag', [3, 2]],
      ['Eerder', [1]],
    ],
  );
});
