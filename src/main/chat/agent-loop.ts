import { streamChat } from '../ollama-client';
import type { ChatMessage } from '../../shared/ipc-types';
import type { ToolDefinition } from '../tools';
import { toToolSchemas } from '../tools';
import { sanitizeExternalContent } from '../tools/sanitize';
import type { ToolMode } from './capabilities';
import { buildToolResultMessage, normalizeNativeToolCalls, tryExtractPromptToolCall, type ToolCall } from './tool-protocol';

const MAX_ITERATIONS = 5;
const TOOL_TIMEOUT_MS = 15_000;

export interface AgentContext {
  ollamaUrl: string;
  model: string;
  toolMode: ToolMode;
  tools: Map<string, ToolDefinition>;
}

export interface AgentEvents {
  onToken(text: string): void;
  onToolCall(label: string): void;
  onToolResult(summary: string, ok: boolean): void;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} duurde langer dan ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function describeCall(call: ToolCall): string {
  if (call.name === 'web_search' && typeof call.args.query === 'string') {
    return `Zoekt naar: "${call.args.query}"`;
  }
  if (call.name === 'web_fetch' && typeof call.args.url === 'string') {
    return `Haalt op: ${call.args.url}`;
  }
  return `Roept tool aan: ${call.name}`;
}

function describeResult(call: ToolCall, ok: boolean, result: unknown): string {
  const asRecord = result && typeof result === 'object' ? (result as Record<string, unknown>) : null;

  if (!ok) {
    const message = typeof asRecord?.error === 'string' ? asRecord.error : 'onbekende fout';
    return `Mislukt: ${message}`;
  }
  if (call.name === 'web_search' && Array.isArray(asRecord?.results)) {
    const n = (asRecord.results as unknown[]).length;
    return `${n} resultaat${n === 1 ? '' : 'en'} gevonden`;
  }
  if (call.name === 'web_fetch' && typeof asRecord?.content === 'string') {
    return `Pagina opgehaald (${asRecord.content.length} tekens)`;
  }
  return 'Tool-aanroep afgerond';
}

async function executeCall(call: ToolCall, tools: Map<string, ToolDefinition>): Promise<{ ok: boolean; result: unknown }> {
  const tool = tools.get(call.name);
  if (!tool) {
    return { ok: false, result: { error: `Onbekende tool: "${call.name}"` } };
  }

  console.log(`[relay] tool-aanroep: ${call.name} input=${JSON.stringify(call.args)}`);

  try {
    const result = await withTimeout(tool.execute(call.args), TOOL_TIMEOUT_MS, `Tool "${call.name}"`);
    return { ok: true, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Tool-aanroep mislukt';
    return { ok: false, result: { error: message } };
  }
}

/**
 * Voert één gebruikersbeurt van de function-calling-loop uit: stuurt berichten
 * naar Ollama, herkent tool-aanroepen (native tool_calls, of — als het model
 * dat niet ondersteunt — het prompt-fallback-protocol uit tool-protocol.ts),
 * voert ze uit en stuurt het resultaat terug, tot het model klaar is of een
 * guard (max iteraties, dubbele aanroep) ingrijpt. Geeft alle in deze beurt
 * toegevoegde berichten terug (assistant + eventuele tool-berichten) zodat de
 * aanroeper (ipc/chat-handler.ts) de renderer-geschiedenis kan bijwerken.
 */
export async function runAgentTurn(ctx: AgentContext, messages: ChatMessage[], events: AgentEvents): Promise<ChatMessage[]> {
  const turnMessages = [...messages];
  const appended: ChatMessage[] = [];
  const seenCalls = new Set<string>();

  // Zonder tools (geen API-key, zie tools/index.ts) is dit exact het Fase 1-pad:
  // gewoon live streamen, nooit de prompt-detectie inschakelen.
  const usePlainStreaming = ctx.tools.size === 0 || ctx.toolMode === 'native';
  const toolSchemas = ctx.toolMode === 'native' && ctx.tools.size > 0 ? toToolSchemas(ctx.tools) : undefined;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    let pendingCall: ToolCall | null = null;
    let assistantText = '';

    if (usePlainStreaming) {
      await streamChat(
        { baseUrl: ctx.ollamaUrl, model: ctx.model, messages: turnMessages, tools: toolSchemas },
        {
          onToken: (token) => {
            assistantText += token;
            events.onToken(token);
          },
          onToolCalls: (calls) => {
            if (pendingCall === null) {
              pendingCall = normalizeNativeToolCalls(calls)[0] ?? null;
            }
          },
        },
      );
    } else {
      // Prompt-fallback: niet live streamen naar de UI vóórdat we weten of dit
      // een tool-aanroep is (anders lekt het rauwe JSON-blok in de chat).
      const controller = new AbortController();
      let rawBuffer = '';
      let malformedError: string | null = null;

      await streamChat(
        { baseUrl: ctx.ollamaUrl, model: ctx.model, messages: turnMessages, signal: controller.signal },
        {
          onToken: (token) => {
            rawBuffer += token;
            const extracted = tryExtractPromptToolCall(rawBuffer);
            if (extracted.type === 'call') {
              pendingCall = extracted.call;
              if (extracted.prefixText.trim().length > 0) events.onToken(extracted.prefixText);
              controller.abort();
            } else if (extracted.type === 'malformed') {
              malformedError = extracted.error;
              if (extracted.prefixText.trim().length > 0) events.onToken(extracted.prefixText);
              controller.abort();
            }
          },
        },
      );

      if (malformedError !== null) {
        const notice = buildToolResultMessage(
          ctx.toolMode,
          { name: 'onbekend', args: {} },
          JSON.stringify({ error: malformedError }),
        );
        events.onToolCall('Onherkenbare tool-aanroep');
        events.onToolResult(`Mislukt: ${malformedError}`, false);
        turnMessages.push(notice);
        appended.push(notice);
        continue;
      }

      if (!pendingCall) {
        assistantText = rawBuffer;
        events.onToken(rawBuffer);
      }
    }

    const assistantMessage: ChatMessage = { role: 'assistant', content: assistantText };
    turnMessages.push(assistantMessage);
    appended.push(assistantMessage);

    if (!pendingCall) break;
    const call: ToolCall = pendingCall;

    const dedupeKey = `${call.name}:${JSON.stringify(call.args)}`;
    if (seenCalls.has(dedupeKey)) {
      const notice = buildToolResultMessage(
        ctx.toolMode,
        call,
        JSON.stringify({ error: 'Deze tool-aanroep is al eerder met dezelfde argumenten uitgevoerd.' }),
      );
      turnMessages.push(notice);
      appended.push(notice);
      break;
    }
    seenCalls.add(dedupeKey);

    events.onToolCall(describeCall(call));
    const { ok, result } = await executeCall(call, ctx.tools);
    events.onToolResult(describeResult(call, ok, result), ok);

    const sanitized = sanitizeExternalContent(JSON.stringify(result));
    const toolResultMessage = buildToolResultMessage(ctx.toolMode, call, sanitized);
    turnMessages.push(toolResultMessage);
    appended.push(toolResultMessage);
  }

  return appended;
}
