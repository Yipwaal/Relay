import type { ChatMessage, ConversationMessage } from '../../shared/ipc-types';
import type { ToolMode } from '../chat/capabilities';
import { buildToolResultMessage, stripPartialToolCall } from '../chat/tool-protocol';
import type { StoredMessage } from './store';

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
export function toModelHistory(rows: StoredMessage[], toolMode: ToolMode): ChatMessage[] {
  const history: ChatMessage[] = [];

  rows.forEach((row, index) => {
    if (row.kind === 'notice') return;

    if (row.kind === 'user') {
      history.push({ role: 'user', content: row.content });
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

/** Wat de UI toont: bubbels zonder protocoltekst, tool-kaarten, meldingen. */
export function toConversationMessages(rows: StoredMessage[]): ConversationMessage[] {
  const messages: ConversationMessage[] = [];
  for (const row of rows) {
    if (row.kind === 'user') {
      messages.push({ kind: 'user', text: row.content });
    } else if (row.kind === 'assistant') {
      const text = stripPartialToolCall(row.content).trim();
      if (text.length > 0) messages.push({ kind: 'assistant', text, model: row.model ?? '', interrupted: row.status === 'interrupted' });
    } else if (row.kind === 'tool_result') {
      if (row.display) messages.push({ kind: 'tool', display: row.display });
    } else {
      messages.push({ kind: 'notice', text: row.content });
    }
  }
  return messages;
}
