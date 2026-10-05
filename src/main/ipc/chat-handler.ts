import { ipcMain, type IpcMainEvent, type WebContents } from 'electron';
import { escalate, routeInternal, routeMessage } from '../../router/router';
import type { RouteDecision } from '../../router/types';
import { loadConfig, type RelayConfig } from '../config';
import { generateTitle, provisionalTitle } from '../conversations/title';
import type { ImageStore } from '../conversations/images-store';
import type { ConversationStore } from '../conversations/store';
import { validateImages, type IncomingImage } from '../images/validate';
import type { DocumentStore } from '../documents/store';
import type { MemoryStore } from '../memory/store';
import type { CatalogSnapshot, ModelCatalog } from '../model-catalog';
import type { RouterDecisionStore } from '../routing/decisions-store';
import { buildRouterContext } from '../routing/router-context';
import type { SettingsStore } from '../routing/settings-store';
import { noticeRow, runAttempt } from '../chat/run-attempt';
import type { AppDefaults, ConversationUpdatedPayload } from '../../shared/ipc-types';
import { safeSend } from './send';

const MAX_MESSAGE_CHARS = 100_000;
/** Na zoveel door het model veroorzaakte tool-fouten in één poging probeert de router een slimmer model. */
const TOOL_FAILURES_BEFORE_ESCALATION = 2;

export interface ChatDeps {
  conversationStore: ConversationStore;
  memoryStore: MemoryStore;
  documentStore: DocumentStore;
  imageStore: ImageStore;
  decisionStore: RouterDecisionStore;
  settingsStore: SettingsStore;
  catalog: ModelCatalog;
}

interface ChatSendPayload {
  requestId: string;
  conversationId: number;
  text: string;
  /** Nog ongecontroleerd; zie validateImages. */
  images?: unknown;
}

interface ChatRetryPayload {
  requestId: string;
  conversationId: number;
}

function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 100;
}

function isConversationId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * Alleen nieuwe gebruikerstekst (en eventuele afbeeldingen) komt uit de
 * renderer; de geschiedenis leest main zelf uit de database. Daarmee kan een
 * gecompromitteerde renderer geen nagemaakte tool-resultaten of
 * assistant-berichten in het gesprek smokkelen.
 */
function isChatSendPayload(value: unknown): value is ChatSendPayload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return isRequestId(v.requestId) && isConversationId(v.conversationId) && typeof v.text === 'string' && v.text.length <= MAX_MESSAGE_CHARS;
}

function isChatRetryPayload(value: unknown): value is ChatRetryPayload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return isRequestId(v.requestId) && isConversationId(v.conversationId);
}

/** Lopende verzoeken, zodat relay:chat:stop de juiste kan afbreken — alleen vanuit het venster dat ze startte. */
const activeRequests = new Map<string, { controller: AbortController; senderId: number; conversationId: number; model: string }>();

/** Modellen waarmee nu een antwoord loopt — die mogen nooit ge-unload worden (dat zou die stream afbreken). */
export function modelsInUse(): string[] {
  return [...new Set([...activeRequests.values()].map((active) => active.model).filter((m) => m.length > 0))];
}

/** Voor afsluiten: breek alles af vóórdat de database sluit. */
export function abortAllChatRequests(): void {
  for (const { controller } of activeRequests.values()) controller.abort();
}

/** Voor het verwijderen van een gesprek: stop eerst wat daar nog loopt. */
export function abortConversationRequests(conversationId: number): void {
  for (const active of activeRequests.values()) {
    if (active.conversationId === conversationId) active.controller.abort();
  }
}

function isConversationBusy(conversationId: number): boolean {
  return [...activeRequests.values()].some((active) => active.conversationId === conversationId);
}

function sendConversationUpdated(sender: WebContents, store: ConversationStore, conversationId: number): void {
  const conversation = store.get(conversationId);
  if (!conversation) return;
  const payload: ConversationUpdatedPayload = { id: conversation.id, title: conversation.title, updatedAt: conversation.updatedAt };
  safeSend(sender, 'relay:conversations:updated', payload);
}

export function allowMax(deps: Pick<ChatDeps, 'settingsStore'>, config: RelayConfig): boolean {
  return deps.settingsStore.get('allowMax', config.router.allowMax);
}

interface TurnContext {
  sender: WebContents;
  requestId: string;
  conversationId: number;
  turn: number;
  /** Aantal afbeeldingen in het gebruikersbericht van deze beurt (escalatie mag dan alleen naar beeldmodellen). */
  images: number;
  /** Alleen in Automatisch: na 2× tool mislukt zelf een slimmer model proberen. Een vast model blijft vast. */
  autoEscalate: boolean;
  controller: AbortController;
  deps: ChatDeps;
  config: RelayConfig;
  snapshot: CatalogSnapshot;
}

/**
 * Voert een beurt uit met het gekozen model, en escaleert zolang de agent-loop
 * meldt dat het model zelf twee keer een tool-aanroep verprutste en er een
 * hoger model is. Elke poging komt in het routerlog, met de laadtijd erbij.
 */
async function runWithEscalation(ctx: TurnContext, first: RouteDecision): Promise<{ lastAnswer: string }> {
  const { deps, config, snapshot, controller } = ctx;
  const emit = (channel: string, payload: Record<string, unknown>): void => safeSend(ctx.sender, channel, { requestId: ctx.requestId, ...payload });
  let decision = first;
  let lastAnswer = '';

  for (;;) {
    const logged = deps.decisionStore.record(ctx.conversationId, ctx.turn, decision);
    const active = activeRequests.get(ctx.requestId);
    if (active) active.model = decision.model;
    emit('relay:chat:route', { model: decision.model, reason: decision.reason, source: decision.source, attempt: logged.attempt });

    const next = ctx.autoEscalate ? escalate(decision.model, snapshot, { allowMax: allowMax(deps, config), images: ctx.images, reason: '2× tool mislukt' }) : null;
    const result = await runAttempt(
      {
        conversationId: ctx.conversationId,
        ref: { turn: ctx.turn, attempt: logged.attempt },
        decision,
        maxToolFailures: next ? TOOL_FAILURES_BEFORE_ESCALATION : undefined,
        signal: controller.signal,
        emit,
        modelsInUse,
      },
      deps,
      snapshot,
      config,
    );
    deps.decisionStore.setLoadMs(logged.id, result.loadMs);
    if (result.lastAnswer) lastAnswer = result.lastAnswer;

    if (!result.escalate || !next || controller.signal.aborted) return { lastAnswer };
    console.log(`[relay] router: ${decision.model} → ${next.model} na ${TOOL_FAILURES_BEFORE_ESCALATION} mislukte tool-aanroepen`);
    decision = next;
  }
}

function recordFailure(deps: ChatDeps, conversationId: number, turn: number, message: string): void {
  try {
    const { conversationStore, decisionStore } = deps;
    if (!conversationStore.get(conversationId)) return;
    const attempt = decisionStore.latestFor(turn)?.attempt ?? 1;
    conversationStore.appendMessages(conversationId, { turn, attempt }, [noticeRow(message)]);
  } catch (persistError) {
    console.error(`[relay] foutmelding niet opgeslagen: ${persistError instanceof Error ? persistError.message : String(persistError)}`);
  }
}

async function handleSend(sender: WebContents, payload: ChatSendPayload, images: IncomingImage[], deps: ChatDeps, controller: AbortController): Promise<void> {
  const { conversationStore, imageStore, catalog } = deps;
  const { requestId, conversationId } = payload;
  const text = payload.text.trim();
  let turn = 0;
  try {
    const conversation = conversationStore.get(conversationId);
    if (!conversation) throw new Error('Gesprek bestaat niet (meer).');
    const config = loadConfig();

    const isFirstTurn = conversationStore.listMessages(conversationId).length === 0;
    turn = conversationStore.appendUserMessage(conversationId, text, (messageId) => imageStore.insert(messageId, images));
    if (isFirstTurn) conversationStore.setAutoTitle(conversationId, provisionalTitle(text || images[0]?.name || 'Afbeelding'));
    sendConversationUpdated(sender, conversationStore, conversationId);

    const snapshot = await catalog.current();
    // Opnieuw lezen na de await: de modelkeuze kan intussen gewijzigd zijn.
    const current = conversationStore.get(conversationId);
    if (!current) throw new Error('Gesprek bestaat niet (meer).');
    const currentModel = current.modelMode === 'fixed' ? current.model : (current.routedModel ?? '');
    // De afbeeldingsregel kijkt alleen naar dít bericht; een vervolgvraag gaat gewoon via de classificatie.
    const decision = await routeMessage(
      { text: text || '(afbeelding)', images: images.length, mode: current.modelMode, currentModel, allowMax: allowMax(deps, config) },
      buildRouterContext(snapshot, config),
    );
    // Stickiness onthoudt alleen gewone routerkeuzes; een escalatie is eenmalig.
    if (current.modelMode === 'auto') conversationStore.setRoutedModel(conversationId, decision.model);

    const ctx: TurnContext = { sender, requestId, conversationId, turn, images: images.length, autoEscalate: current.modelMode === 'auto', controller, deps, config, snapshot };
    const { lastAnswer } = await runWithEscalation(ctx, decision);

    const stopped = controller.signal.aborted;
    safeSend(sender, 'relay:chat:done', { requestId, stopped });
    sendConversationUpdated(sender, conversationStore, conversationId);

    if (isFirstTurn && !stopped && !conversation.titleIsCustom && lastAnswer) {
      const titleModel = routeInternal('titel', snapshot.roles).model;
      void generateTitle(config.ollamaUrl, titleModel, text || '(een afbeelding)', lastAnswer, config.router.backgroundKeepAlive).then((title) => {
        if (title && conversationStore.get(conversationId) && conversationStore.setAutoTitle(conversationId, title)) {
          sendConversationUpdated(sender, conversationStore, conversationId);
        }
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Onbekende fout bij Ollama-aanroep';
    console.error(`[relay] chat request mislukt: ${message}`);
    if (turn > 0) recordFailure(deps, conversationId, turn, message);
    safeSend(sender, 'relay:chat:error', { requestId, message });
  }
}

/**
 * "Probeer slimmer": de laatste beurt opnieuw, met het volgende model omhoog
 * vanaf het model dat het huidige antwoord gaf. Het oude antwoord blijft
 * staan tot het nieuwe iets oplevert, en wordt dan gedimd (vervangen).
 */
async function handleRetry(sender: WebContents, payload: ChatRetryPayload, deps: ChatDeps, controller: AbortController): Promise<void> {
  const { conversationStore, decisionStore, imageStore, catalog } = deps;
  const { requestId, conversationId } = payload;
  try {
    const conversation = conversationStore.get(conversationId);
    if (!conversation) throw new Error('Gesprek bestaat niet (meer).');
    const latest = conversationStore.latestTurn(conversationId);
    if (!latest) throw new Error('Er is nog geen vraag om opnieuw te proberen.');
    const config = loadConfig();
    const snapshot = await catalog.current();
    const previousModel =
      decisionStore.latestFor(latest.turn)?.model ?? (conversation.modelMode === 'fixed' ? conversation.model : (conversation.routedModel ?? ''));
    const max = allowMax(deps, config);
    const images = imageStore.countFor(latest.turn);
    const decision = escalate(previousModel, snapshot, { allowMax: max, images, reason: 'probeer slimmer' });
    if (!decision) {
      // Alleen naar de max-instelling verwijzen als die echt een slimmer model zou opleveren.
      const maxWouldHelp = !max && escalate(previousModel, snapshot, { allowMax: true, images, reason: 'probeer slimmer' }) !== null;
      const vision = images > 0 ? ' dat afbeeldingen kan zien' : '';
      throw new Error(
        maxWouldHelp
          ? `Er is geen slimmer model dan ${previousModel} — zet "Max-model toestaan" aan in Instellingen.`
          : `Er is geen slimmer model dan ${previousModel}${vision} geïnstalleerd.`,
      );
    }

    const autoEscalate = conversation.modelMode === 'auto';
    await runWithEscalation({ sender, requestId, conversationId, turn: latest.turn, images, autoEscalate, controller, deps, config, snapshot }, decision);
    safeSend(sender, 'relay:chat:done', { requestId, stopped: controller.signal.aborted });
    sendConversationUpdated(sender, conversationStore, conversationId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Opnieuw proberen mislukt';
    console.error(`[relay] probeer slimmer mislukt: ${message}`);
    safeSend(sender, 'relay:chat:error', { requestId, message });
  }
}

function startRequest(event: IpcMainEvent, requestId: string, conversationId: number, run: (controller: AbortController) => Promise<void>): void {
  if (activeRequests.has(requestId)) {
    console.error('[relay] dubbel requestId genegeerd');
    return;
  }
  if (isConversationBusy(conversationId)) {
    safeSend(event.sender, 'relay:chat:error', { requestId, message: 'Er loopt al een antwoord in dit gesprek.' });
    return;
  }
  const controller = new AbortController();
  activeRequests.set(requestId, { controller, senderId: event.sender.id, conversationId, model: '' });
  void run(controller).finally(() => activeRequests.delete(requestId));
}

export function registerChatHandler(deps: ChatDeps): void {
  ipcMain.handle('relay:app:defaults', (): AppDefaults => ({ options: loadConfig().options }));

  ipcMain.on('relay:chat:send', (event: IpcMainEvent, payload: unknown) => {
    if (!isChatSendPayload(payload)) {
      console.error('[relay] ongeldig chat:send-bericht genegeerd');
      return;
    }
    let images: IncomingImage[];
    try {
      images = validateImages(payload.images);
    } catch (error) {
      safeSend(event.sender, 'relay:chat:error', { requestId: payload.requestId, message: error instanceof Error ? error.message : 'Ongeldige afbeelding.' });
      return;
    }
    if (payload.text.trim().length === 0 && images.length === 0) return;
    startRequest(event, payload.requestId, payload.conversationId, (controller) => handleSend(event.sender, payload, images, deps, controller));
  });

  ipcMain.on('relay:chat:retry', (event: IpcMainEvent, payload: unknown) => {
    if (!isChatRetryPayload(payload)) {
      console.error('[relay] ongeldig chat:retry-bericht genegeerd');
      return;
    }
    startRequest(event, payload.requestId, payload.conversationId, (controller) => handleRetry(event.sender, payload, deps, controller));
  });

  ipcMain.on('relay:chat:stop', (event: IpcMainEvent, requestId: unknown) => {
    if (typeof requestId !== 'string') return;
    const active = activeRequests.get(requestId);
    // Een stop die ná done/error binnenkomt vindt niets meer — dat is prima.
    if (active && active.senderId === event.sender.id) active.controller.abort();
  });
}
