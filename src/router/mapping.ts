import type { ChatRole, Classification, Complexity, Task } from './types';

/**
 * Taak × complexiteit → rol. De opdracht legt drie gevallen vast (chat/laag →
 * fast; redeneren/code/onderzoek met middel of hoog → reasoning; hoog → max
 * als dat mag). De rest is zo ingevuld:
 * - laag is altijd fast: een eenvoudige vraag rechtvaardigt geen laadtijd;
 * - chat/middel blijft fast (gewoon gesprek);
 * - chat/hoog gaat naar reasoning (een moeilijke "gewone" vraag is in feite
 *   redeneren), maar nooit naar max: max is voor zwaar denk-, code- of
 *   onderzoekswerk.
 */
const TABLE: Record<Task, Record<Complexity, ChatRole>> = {
  chat: { laag: 'fast', middel: 'fast', hoog: 'reasoning' },
  redeneren: { laag: 'fast', middel: 'reasoning', hoog: 'reasoning' },
  code: { laag: 'fast', middel: 'reasoning', hoog: 'reasoning' },
  onderzoek: { laag: 'fast', middel: 'reasoning', hoog: 'reasoning' },
};

export function mapClassification(c: Classification, allowMax: boolean): ChatRole {
  if (allowMax && c.complexiteit === 'hoog' && c.taak !== 'chat') return 'max';
  return TABLE[c.taak][c.complexiteit];
}
