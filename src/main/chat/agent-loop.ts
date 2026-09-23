import { streamChat } from '../ollama-client';
import type { ChatMessage, ToolCallInfo, ToolDisplay, ToolResultInfo } from '../../shared/ipc-types';
import type { ToolDefinition } from '../tools';
import { toToolSchemas } from '../tools';
import { sanitizeExternalContent } from '../tools/sanitize';
import { abortable, withTimeout } from '../timeout';
import type { ToolMode } from './capabilities';
import { buildPreviewItems, callQuery, describeCall, describeResult } from './tool-display';
import {
  buildToolResultMessage,
  normalizeNativeToolCalls,
  stripPartialToolCall,
  tryExtractPromptToolCall,
  type ToolCall,
} from './tool-protocol';

const MAX_ITERATIONS = 5;
const TOOL_TIMEOUT_MS = 15_000;

export interface AgentContext {
  ollamaUrl: string;
  model: string;
  toolMode: ToolMode;
  tools: Map<string, ToolDefinition>;
  numCtx: number;
  /** Stop-knop: breekt de lopende stream of tool-aanroep af; de beurt eindigt dan netjes. */
  signal?: AbortSignal;
}

/** Eén bericht dat deze beurt aan de geschiedenis is toegevoegd, met wat de UI erover moet weten. */
export interface AppendedEntry {
  message: ChatMessage;
  /** Alleen bij een tool-resultaat: de gegevens voor de tool-kaart. */
  tool?: ToolDisplay;
  /** Assistant-tekst die door de stop-knop halverwege is afgebroken. */
  interrupted?: boolean;
}

export interface AgentEvents {
  onToken(text: string): void;
  onToolCall(info: ToolCallInfo): void;
  /** info.preview: de exacte (gesaneerde) inhoud die het model krijgt — zichtbaar vóór gebruik, zie CLAUDE.md. */
  onToolResult(info: ToolResultInfo): void;
  /**
   * Per iteratie één batch (assistant-bericht + bijbehorend tool-resultaat),
   * zodat de aanroeper die atomair kan opslaan: een tool-aanroep staat nooit
   * zonder resultaat in de database, en al uitgevoerde neveneffecten
   * (remember) gaan niet verloren als een latere iteratie faalt.
   */
  onAppend?(entries: AppendedEntry[]): void;
}

async function executeCall(
  call: ToolCall,
  tools: Map<string, ToolDefinition>,
  signal: AbortSignal | undefined,
): Promise<{ ok: boolean; result: unknown }> {
  const tool = tools.get(call.name);
  if (!tool) {
    return { ok: false, result: { error: `Onbekende tool: "${call.name}"` } };
  }

  console.log(`[relay] tool-aanroep: ${call.name} input=${JSON.stringify(call.args)}`);

  try {
    // abortable: ook tools die het signaal (nog) niet zelf afhandelen laten de beurt direct stoppen.
    const result = await abortable(withTimeout(tool.execute(call.args, signal), TOOL_TIMEOUT_MS, `Tool "${call.name}"`), signal);
    return { ok: true, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Tool-aanroep mislukt';
    return { ok: false, result: { error: message } };
  }
}

const REMEMBER_AFTER_EXTERNAL_CONTENT_MESSAGE =
  'remember geweigerd: er is deze beurt al web_search/web_fetch/search_documents gebruikt. Vraag de gebruiker ' +
  'expliciet te bevestigen (bv. door het feit zelf te herhalen), of sla het handmatig op via het instellingenscherm.';

const EXTERNAL_CONTENT_TOOLS = new Set(['web_search', 'web_fetch', 'search_documents']);

function callInfo(call: ToolCall): ToolCallInfo {
  return { tool: call.name, query: callQuery(call), label: describeCall(call) };
}

function failure(summary: string, preview: string): ToolResultInfo {
  return { summary, ok: false, preview, items: [], durationMs: 0 };
}

/**
 * Voert één gebruikersbeurt van de function-calling-loop uit: stuurt berichten
 * naar Ollama, herkent tool-aanroepen (native tool_calls, of — als het model
 * dat niet ondersteunt — het prompt-fallback-protocol uit tool-protocol.ts),
 * voert ze uit en stuurt het resultaat terug, tot het model klaar is, de
 * gebruiker stopt, of een guard (max iteraties, dubbele aanroep) ingrijpt.
 * Geeft alle in deze beurt toegevoegde berichten terug; events.onAppend krijgt
 * ze al per iteratie.
 */
export async function runAgentTurn(ctx: AgentContext, messages: ChatMessage[], events: AgentEvents): Promise<ChatMessage[]> {
  const turnMessages = [...messages];
  const appended: ChatMessage[] = [];
  const append = (entries: AppendedEntry[]): void => {
    for (const entry of entries) {
      turnMessages.push(entry.message);
      appended.push(entry.message);
    }
    events.onAppend?.(entries);
  };
  const reportTool = (info: ToolCallInfo, result: ToolResultInfo): ToolDisplay => {
    events.onToolResult(result);
    return { ...info, ...result };
  };
  const seenCalls = new Set<string>();
  // Voorkomt dat manipulatieve externe content (een webpagina, of — sinds
  // Fase 4 — een geïndexeerd document) het model binnen dezelfde beurt laat
  // overtuigen om iets via remember op te slaan — dat zou anders
  // onvoorwaardelijk in élk toekomstig gesprek terugkomen (zie security-review
  // Fase 3, uitgebreid naar search_documents in Fase 4). Dekt niet het
  // multi-beurt-scenario (content ophalen in beurt 1, remember in beurt 2):
  // agent-loop houdt bewust geen state tussen beurten bij, zie README.md.
  let usedExternalContentThisTurn = false;

  // Met 'remember' altijd geregistreerd (zie tools/index.ts) is er nu altijd
  // minstens één tool beschikbaar. Welk pad gekozen wordt hangt dus alleen
  // nog af van de (gedetecteerde of geforceerde) toolMode: in prompt-modus
  // wordt daarom voortaan élke beurt gebufferd i.p.v. live gestreamd, ook
  // zonder OLLAMA_API_KEY — een bewuste afruil, zie README.md.
  const usePlainStreaming = ctx.toolMode === 'native';
  const toolSchemas = usePlainStreaming ? toToolSchemas(ctx.tools) : undefined;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    if (ctx.signal?.aborted) break;
    let pendingCall: ToolCall | null = null;
    let assistantMessage: ChatMessage;

    if (usePlainStreaming) {
      let assistantText = '';

      await streamChat(
        { baseUrl: ctx.ollamaUrl, model: ctx.model, messages: turnMessages, tools: toolSchemas, numCtx: ctx.numCtx, signal: ctx.signal },
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

      // Na een stop voeren we een eventueel al ontvangen tool-aanroep niet meer uit.
      if (ctx.signal?.aborted) pendingCall = null;

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
      const signal = ctx.signal ? AbortSignal.any([ctx.signal, controller.signal]) : controller.signal;
      let rawBuffer = '';
      let malformedError: string | null = null;

      await streamChat(
        { baseUrl: ctx.ollamaUrl, model: ctx.model, messages: turnMessages, signal, numCtx: ctx.numCtx },
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
        const info: ToolCallInfo = { tool: 'onbekend', query: '', label: 'Onherkenbare tool-aanroep' };
        events.onToolCall(info);
        append([{ message: notice, tool: reportTool(info, failure(`Mislukt: ${malformedError}`, malformedError)) }]);
        continue;
      }

      // rawBuffer (incl. een eventueel tool-call-blok) blijft altijd de echte
      // geschiedenis in — alleen de live UI (events.onToken) laat het blok
      // zelf weg, zodat de gebruiker nooit rauwe protocol-JSON te zien krijgt.
      if (ctx.signal?.aborted && !pendingCall) {
        rawBuffer = stripPartialToolCall(rawBuffer);
      }
      if (!pendingCall) {
        events.onToken(rawBuffer);
      }
      assistantMessage = { role: 'assistant', content: rawBuffer };
    }

    if (!pendingCall) {
      append([{ message: assistantMessage, interrupted: ctx.signal?.aborted === true }]);
      break;
    }
    const call: ToolCall = pendingCall;
    const info = callInfo(call);

    const dedupeKey = `${call.name}:${JSON.stringify(call.args)}`;
    if (seenCalls.has(dedupeKey)) {
      const duplicateNotice = 'Deze tool-aanroep is al eerder met dezelfde argumenten uitgevoerd.';
      const notice = buildToolResultMessage(ctx.toolMode, call, JSON.stringify({ error: duplicateNotice }));
      events.onToolCall(info);
      append([{ message: assistantMessage }, { message: notice, tool: reportTool(info, failure(`Overgeslagen: ${duplicateNotice}`, duplicateNotice)) }]);
      break;
    }
    seenCalls.add(dedupeKey);

    if (call.name === 'remember' && usedExternalContentThisTurn) {
      events.onToolCall(info);
      const notice = buildToolResultMessage(ctx.toolMode, call, JSON.stringify({ error: REMEMBER_AFTER_EXTERNAL_CONTENT_MESSAGE }));
      const refused = failure(`Geweigerd: ${REMEMBER_AFTER_EXTERNAL_CONTENT_MESSAGE}`, REMEMBER_AFTER_EXTERNAL_CONTENT_MESSAGE);
      append([{ message: assistantMessage }, { message: notice, tool: reportTool(info, refused) }]);
      continue;
    }

    events.onToolCall(info);
    const startedAt = Date.now();
    const { ok, result } = await executeCall(call, ctx.tools, ctx.signal);
    const durationMs = Date.now() - startedAt;
    if (ok && EXTERNAL_CONTENT_TOOLS.has(call.name)) {
      usedExternalContentThisTurn = true;
    }

    const sanitized = sanitizeExternalContent(JSON.stringify(result));
    const display = reportTool(info, {
      summary: describeResult(call, ok, result),
      ok,
      preview: sanitized,
      items: buildPreviewItems(call, ok, result),
      durationMs,
    });
    append([{ message: assistantMessage }, { message: buildToolResultMessage(ctx.toolMode, call, sanitized), tool: display }]);
  }

  return appended;
}
