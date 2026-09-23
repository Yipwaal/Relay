// Pure helpers zonder DOM of window.relay — ook los testbaar (zie main/__tests__/renderer-format.test.ts).

const NUMBER_WORDS = ['nul', 'één', 'twee', 'drie', 'vier', 'vijf', 'zes', 'zeven', 'acht', 'negen', 'tien'];
const WEEKDAYS = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
const WEEKDAYS_SHORT = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
const MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
const MONTHS_SHORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

type DateGroupLabel = 'Vandaag' | 'Gisteren' | 'Afgelopen 7 dagen' | 'Eerder';
const DATE_GROUP_ORDER: readonly DateGroupLabel[] = ['Vandaag', 'Gisteren', 'Afgelopen 7 dagen', 'Eerder'];

function numberWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

/** "één bericht", "drie berichten", "12 documenten". */
function countLabel(n: number, singular: string, plural: string): string {
  return `${numberWord(n)} ${n === 1 ? singular : plural}`;
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Aantal kalenderdagen tussen ts en now (0 = vandaag), DST-bestendig via afronden. */
function daysAgo(ts: number, now: number): number {
  return Math.round((startOfDay(now) - startOfDay(ts)) / 86_400_000);
}

function dateGroupLabel(ts: number, now: number): DateGroupLabel {
  const days = daysAgo(ts, now);
  if (days <= 0) return 'Vandaag';
  if (days === 1) return 'Gisteren';
  if (days < 7) return 'Afgelopen 7 dagen';
  return 'Eerder';
}

function clockTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Korte tijdsaanduiding in de sidebar: "09:12", "di 21:05", "za", "2 sep". */
function sidebarTimeLabel(ts: number, now: number): string {
  const d = new Date(ts);
  const days = daysAgo(ts, now);
  if (days <= 0) return clockTime(ts);
  if (days === 1) return `${WEEKDAYS_SHORT[d.getDay()]} ${clockTime(ts)}`;
  if (days < 7) return WEEKDAYS_SHORT[d.getDay()] ?? '';
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

/** Starttijd in de header: "zojuist", "vandaag 09:12", "gisteren 21:05", "zaterdag 14:30", "2 september". */
function startedLabel(ts: number, now: number): string {
  const d = new Date(ts);
  const days = daysAgo(ts, now);
  if (days <= 0) return now - ts < 60_000 ? 'zojuist' : `vandaag ${clockTime(ts)}`;
  if (days === 1) return `gisteren ${clockTime(ts)}`;
  if (days < 7) return `${WEEKDAYS[d.getDay()]} ${clockTime(ts)}`;
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${sameYear ? '' : ` ${d.getFullYear()}`}`;
}

/** "0,4 s" — één decimaal, Nederlandse komma. */
function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1).replace('.', ',')} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1).replace('.', ',')} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} kB`;
}

/** Eerste regel van het eerste bericht als voorlopige titel, afgekapt op ~40 tekens. */
function titleFromText(text: string): string {
  const firstLine = text.trim().split('\n')[0]?.trim() ?? '';
  if (firstLine.length <= 40) return firstLine || 'Nieuw gesprek';
  const cut = firstLine.slice(0, 38);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Groepeert op datumlabel in vaste volgorde, nieuwste eerst binnen elke groep; lege groepen vallen weg. */
function groupByDate<T extends { updatedAt: number }>(items: T[], now: number): Array<{ label: DateGroupLabel; items: T[] }> {
  const sorted = [...items].sort((a, b) => b.updatedAt - a.updatedAt);
  return DATE_GROUP_ORDER.map((label) => ({
    label,
    items: sorted.filter((item) => dateGroupLabel(item.updatedAt, now) === label),
  })).filter((group) => group.items.length > 0);
}
