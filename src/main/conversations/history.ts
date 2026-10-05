import type { ChatMessage, ConversationMessage } from '../../shared/ipc-types';
import type { ToolMode } from '../chat/capabilities';
import { buildToolResultMessage, stripPartialToolCall } from '../chat/tool-protocol';
import type { StoredMessage, TurnRef } from './store';

/**
 * Rijen die het model (nog) mag zien: geen vervangen pogingen, en tijdens een
 * nieuwe poging (active) ook niets van eerdere pogingen van díe beurt — die
 * worden pas als vervangen gemarkeerd zodra de nieuwe poging iets oplevert.
 */
function activeRows(rows: StoredMessage[], active?: TurnRef): StoredMessage[] {
  return rows.filter((row) => {
    if (row.superseded) return false;
    if (active && row.kind !== 'user' && row.turn === active.turn && row.attempt !== active.attempt) return false;
    return true;
  });
}

/**
 * Bouwt de geschiedenis die naar het model gaat uit opgeslagen rijen. Main
 * is de bron van waarheid: de renderer stuurt alleen nog nieuwe
 * gebruikerstekst, dus nagemaakte tool-berichten uit de renderer bestaan
 * niet meer. Meldingen (fouten) gaan nooit mee.
 *
 * Het gesprek kan in een andere tool-modus opgeslagen zijn dan het huidige
 * model gebruikt (ander model gekozen): native tool-berichten worden in
 * prompt-modus omgezet naar het tekstformaat, en een assistant-bericht
 * houdt zijn native tool_calls alleen als het resultaat er ook echt achter staat.
 */
/**
 * Afbeeldingen voor de modelgeschiedenis: `data` (base64) alleen voor de
 * berichten waarvan het model de beelden echt mag zien — de recentste
 * beurten, en alleen als het model beelden ziet — en `counts` voor alle
 * berichten, zodat oudere of onzichtbare afbeeldingen als "[afbeelding]" in
 * de tekst blijven staan. Bewust zonder bestandsnaam: die komt van buiten
 * (een gedownload bestand) en hoort niet als gebruikerstekst in de prompt.
 */
export interface HistoryImages {
  data: Map<number, string[]>;
  counts: Map<number, number>;
}

const NO_IMAGES: HistoryImages = { data: new Map(), counts: new Map() };

function userMessage(row: StoredMessage, images: HistoryImages): ChatMessage {
  const data = images.data.get(row.id);
  if (data && data.length > 0) return { role: 'user', content: row.content, images: data };
  const count = images.counts.get(row.id) ?? 0;
  if (count === 0) return { role: 'user', content: row.content };
  const placeholder = count === 1 ? '[afbeelding — hier niet meegestuurd]' : `[${count} afbeeldingen — hier niet meegestuurd]`;
  return { role: 'user', content: row.content ? `${row.content}\n\n${placeholder}` : placeholder };
}

export function toModelHistory(allRows: StoredMessage[], toolMode: ToolMode, active?: TurnRef, images: HistoryImages = NO_IMAGES): ChatMessage[] {
  const rows = activeRows(allRows, active);
  const history: ChatMessage[] = [];

  rows.forEach((row, index) => {
    if (row.kind === 'notice') return;

    if (row.kind === 'user') {
      history.push(userMessage(row, images));
      return;
    }

    if (row.kind === 'assistant') {
      const answered = rows[index + 1]?.kind === 'tool_result';
      const keepCalls = toolMode === 'native' && answered && row.toolCalls !== null && row.toolCalls.length > 0;
      history.push(keepCalls ? { role: 'assistant', content: row.content, toolCalls: row.toolCalls ?? [] } : { role: 'assistant', content: row.content });
      return;
    }

    if (row.role !== 'tool') {
      history.push({ role: 'user', content: row.content });
      return;
    }
    const toolName = row.toolName ?? 'onbekend';
    history.push(
      toolMode === 'native' ? { role: 'tool', content: row.content, toolName } : buildToolResultMessage('prompt', { name: toolName, args: {} }, row.content),
    );
  });

  return history;
}

/** Wat de UI toont: bubbels zonder protocoltekst, tool-kaarten, meldingen — vervangen pogingen gemarkeerd. */
export function toConversationMessages(rows: StoredMessage[], images: Array<{ id: number; messageId: number; name: string }> = []): ConversationMessage[] {
  const messages: ConversationMessage[] = [];
  for (const row of rows) {
    const superseded = row.superseded;
    if (row.kind === 'user') {
      const own = images.filter((image) => image.messageId === row.id).map((image) => ({ id: image.id, name: image.name }));
      messages.push({ kind: 'user', text: row.content, images: own });
    } else if (row.kind === 'assistant') {
      const text = stripPartialToolCall(row.content).trim();
      if (text.length > 0) {
        messages.push({ kind: 'assistant', text, model: row.model ?? '', interrupted: row.status === 'interrupted', route: row.route, attempt: row.attempt, superseded });
      }
    } else if (row.kind === 'tool_result') {
      if (row.display) messages.push({ kind: 'tool', display: row.display, superseded });
    } else {
      messages.push({ kind: 'notice', text: row.content, superseded });
    }
  }
  return messages;
}
