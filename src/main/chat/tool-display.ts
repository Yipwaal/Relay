import type { ToolPreviewItem } from '../../shared/ipc-types';
import { sanitizeExternalContent } from '../tools/sanitize';
import type { ToolCall } from './tool-protocol';

const MAX_ITEM_CHARS = 600;
const MAX_ITEMS = 8;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function clip(text: string): string {
  const clean = sanitizeExternalContent(text).replace(/\s+/g, ' ').trim();
  return clean.length > MAX_ITEM_CHARS ? `${clean.slice(0, MAX_ITEM_CHARS).trimEnd()}…` : clean;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Het belangrijkste argument van een aanroep, voor de kaarttitel. */
export function callQuery(call: ToolCall): string {
  const key = call.name === 'web_fetch' ? 'url' : call.name === 'remember' ? 'fact' : 'query';
  return clip(str(call.args[key]));
}

export function describeCall(call: ToolCall): string {
  const query = callQuery(call);
  if (call.name === 'web_search') return `Zoekt naar: "${query}"`;
  if (call.name === 'web_fetch') return `Haalt op: ${query}`;
  if (call.name === 'remember') return `Onthoudt: "${query}"`;
  if (call.name === 'search_documents') return `Doorzoekt documenten: "${query}"`;
  return `Roept tool aan: ${call.name}`;
}

export function describeResult(call: ToolCall, ok: boolean, result: unknown): string {
  const record = asRecord(result);

  if (!ok) {
    return `Mislukt: ${str(record?.error) || 'onbekende fout'}`;
  }
  if (call.name === 'web_search' && Array.isArray(record?.results)) {
    const n = record.results.length;
    return `${n} resultaat${n === 1 ? '' : 'en'}`;
  }
  if (call.name === 'web_fetch' && typeof record?.content === 'string') {
    return `Pagina opgehaald (${record.content.length.toLocaleString('nl-NL')} tekens)`;
  }
  if (call.name === 'remember' && record?.stored === true) {
    return 'Opgeslagen';
  }
  if (call.name === 'search_documents' && Array.isArray(record?.results)) {
    const n = record.results.length;
    return `${n} fragment${n === 1 ? '' : 'en'}`;
  }
  return 'Afgerond';
}

/**
 * Leesbare fragmenten voor de tool-kaart: per veld door sanitizeExternalContent
 * en ingekort (max MAX_ITEMS × MAX_ITEM_CHARS). Dit is een samenvatting —
 * de exacte tekst die het model krijgt gaat apart mee als `preview` en is in
 * de kaart uit te klappen.
 */
export function buildPreviewItems(call: ToolCall, ok: boolean, result: unknown): ToolPreviewItem[] {
  const record = asRecord(result);
  if (!ok || !record) return [];

  if ((call.name === 'web_search' || call.name === 'search_documents') && Array.isArray(record.results)) {
    return record.results.slice(0, MAX_ITEMS).flatMap((raw): ToolPreviewItem[] => {
      const r = asRecord(raw);
      if (!r) return [];
      if (call.name === 'search_documents') {
        return [{ src: clip(str(r.document)), text: clip(str(r.text)) }];
      }
      const snippet = [str(r.title), str(r.snippet)].filter((s) => s.length > 0).join(' — ');
      return [{ src: clip(hostOf(str(r.url))), text: clip(snippet) }];
    });
  }
  if (call.name === 'web_fetch' && typeof record.content === 'string') {
    return [{ src: clip(str(record.url)), text: clip(record.content) }];
  }
  if (call.name === 'remember' && typeof record.text === 'string') {
    return [{ src: 'Geheugen', text: clip(record.text) }];
  }
  return [];
}
