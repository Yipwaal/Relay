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
  numCtx: number;
}

export interface AgentEvents {
  onToken(text: string): void;
  onToolCall(label: string): void;
  /** preview: de exacte (gesaneerde) inhoud die het model krijgt — zichtbaar vóór gebruik, zie CLAUDE.md. */
  onToolResult(summary: string, ok: boolean, preview: string): void;
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
  if (call.name === 'remember' && typeof call.args.fact === 'string') {
    return `Onthoudt: "${call.args.fact}"`;
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
  if (call.name === 'remember' && asRecord?.stored === true) {
    return 'Feit opgeslagen';
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
const REMEMBER_AFTER_WEB_TOOL_MESSAGE =
  'remember geweigerd: er is deze beurt al web_search/web_fetch gebruikt. Vraag de gebruiker expliciet te ' +
  'bevestigen (bv. door het feit zelf te herhalen), of sla het handmatig op via het instellingenscherm.';

export async function runAgentTurn(ctx: AgentContext, messages: ChatMessage[], events: AgentEvents): Promise<ChatMessage[]> {
  const turnMessages = [...messages];
  const appended: ChatMessage[] = [];
  const seenCalls = new Set<string>();
  // Voorkomt dat een manipulatieve webpagina het model binnen dezelfde beurt
  // laat overtuigen om iets via remember op te slaan — dat zou anders
  // onvoorwaardelijk in élk toekomstig gesprek terugkomen (zie security-review
  // Fase 3). Dekt niet het multi-beurt-scenario (fetch in beurt 1, remember
  // in beurt 2): agent-loop houdt bewust geen state tussen beurten bij, zie
  // README.md.
  let usedWebToolThisTurn = false;

  // Met 'remember' altijd geregistreerd (zie tools/index.ts) is er nu altijd
  // minstens één tool beschikbaar. Welk pad gekozen wordt hangt dus alleen
  // nog af van de (gedetecteerde of geforceerde) toolMode: in prompt-modus
  // wordt daarom voortaan élke beurt gebufferd i.p.v. live gestreamd, ook
  // zonder OLLAMA_API_KEY — een bewuste afruil, zie README.md.
  const usePlainStreaming = ctx.toolMode === 'native';
  const toolSchemas = usePlainStreaming ? toToolSchemas(ctx.tools) : undefined;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    let pendingCall: ToolCall | null = null;
    let assistantMessage: ChatMessage;

    if (usePlainStreaming) {
      let assistantText = '';

      await streamChat(
        { baseUrl: ctx.ollamaUrl, model: ctx.model, messages: turnMessages, tools: toolSchemas, numCtx: ctx.numCtx },
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

      // Native tool_calls horen bij het assistant-bericht zelf terug de
      // geschiedenis in, anders mist Ollama bij de volgende iteratie de
      // context waarom er een tool-resultaat volgt.
      if (pendingCall) {
        const call: ToolCall = pendingCall;
        assistantMessage = { role: 'assistant', content: assistantText, toolCalls: [{ name: call.name, args: call.args }] };
      } else {
        assistantMessage = { role: 'assistant', content: assistantText };
      }
    } else {
      // Prompt-fallback: niet live streamen naar de UI vóórdat we weten of dit
      // een tool-aanroep is (anders lekt het rauwe JSON-blok in de chat).
      const controller = new AbortController();
      let rawBuffer = '';
      let malformedError: string | null = null;

      await streamChat(
        { baseUrl: ctx.ollamaUrl, model: ctx.model, messages: turnMessages, signal: controller.signal, numCtx: ctx.numCtx },
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
        events.onToolResult(`Mislukt: ${malformedError}`, false, malformedError);
        turnMessages.push(notice);
        appended.push(notice);
        continue;
      }

      // rawBuffer (incl. een eventueel tool-call-blok) blijft altijd de echte
      // geschiedenis in — alleen de live UI (events.onToken) laat het blok
      // zelf weg, zodat de gebruiker nooit rauwe protocol-JSON te zien krijgt.
      if (!pendingCall) {
        events.onToken(rawBuffer);
      }
      assistantMessage = { role: 'assistant', content: rawBuffer };
    }

    turnMessages.push(assistantMessage);
    appended.push(assistantMessage);

    if (!pendingCall) break;
    const call: ToolCall = pendingCall;

    const dedupeKey = `${call.name}:${JSON.stringify(call.args)}`;
    if (seenCalls.has(dedupeKey)) {
      const duplicateNotice = 'Deze tool-aanroep is al eerder met dezelfde argumenten uitgevoerd.';
      const notice = buildToolResultMessage(ctx.toolMode, call, JSON.stringify({ error: duplicateNotice }));
      events.onToolResult(`Overgeslagen: ${duplicateNotice}`, false, duplicateNotice);
      turnMessages.push(notice);
      appended.push(notice);
      break;
    }
    seenCalls.add(dedupeKey);

    if (call.name === 'remember' && usedWebToolThisTurn) {
      events.onToolCall(describeCall(call));
      events.onToolResult(`Geweigerd: ${REMEMBER_AFTER_WEB_TOOL_MESSAGE}`, false, REMEMBER_AFTER_WEB_TOOL_MESSAGE);
      const notice = buildToolResultMessage(
        ctx.toolMode,
        call,
        JSON.stringify({ error: REMEMBER_AFTER_WEB_TOOL_MESSAGE }),
      );
      turnMessages.push(notice);
      appended.push(notice);
      continue;
    }

    events.onToolCall(describeCall(call));
    const { ok, result } = await executeCall(call, ctx.tools);
    if (ok && (call.name === 'web_search' || call.name === 'web_fetch')) {
      usedWebToolThisTurn = true;
    }

    const sanitized = sanitizeExternalContent(JSON.stringify(result));
    events.onToolResult(describeResult(call, ok, result), ok, sanitized);

    const toolResultMessage = buildToolResultMessage(ctx.toolMode, call, sanitized);
    turnMessages.push(toolResultMessage);
    appended.push(toolResultMessage);
  }

  return appended;
}
