const ollamaStatusEl = document.getElementById('ollama-status') as HTMLElement;
const ollamaStatusTextEl = document.getElementById('ollama-status-text') as HTMLElement;
const OLLAMA_STATUS_INTERVAL_MS = 30_000;

async function sendCurrentDraft(): Promise<void> {
  const c = activeConversation();
  const text = chatInputEl.value.trim();
  if (!c || text.length === 0 || appState.pending !== null) return;
  clearComposerError();

  const wasEmpty = c.display.length === 0;
  const userMessage: DisplayMessage = { kind: 'user', text };
  c.display.push(userMessage);
  c.updatedAt = Date.now();

  chatInputEl.value = '';
  autoGrowInput();
  if (wasEmpty) renderActive();
  else appendMessageElement(c.id, userMessage);

  appState.pending = newPending(window.relay.sendMessage(c.id, text), c.id);
  afterRequestStarted(c);
}

/**
 * "Probeer slimmer": de laatste vraag opnieuw, met het volgende model omhoog.
 * Main kiest het model; het oude antwoord blijft staan tot het nieuwe iets
 * oplevert en wordt dan gedimd.
 */
function retryLatest(): void {
  const c = activeConversation();
  if (!c || appState.pending !== null) return;
  clearComposerError();
  appState.pending = newPending(window.relay.retryMessage(c.id), c.id);
  afterRequestStarted(c);
}

function afterRequestStarted(c: ConversationView): void {
  updateSendButton();
  renderModelPicker();
  renderSidebar();
  renderHeader();
  refreshAnswerFooters(c);
}

/** Alles na de laatste vraag: het antwoord (of de antwoorden) van de huidige beurt. */
function currentTurnMessages(c: ConversationView): DisplayMessage[] {
  let lastUser = -1;
  c.display.forEach((m, index) => {
    if (m.kind === 'user') lastUser = index;
  });
  return c.display.slice(lastUser + 1);
}

/** De nieuwe poging levert iets op: nu pas de vorige dimmen (zoals main ze dan ook als vervangen opslaat). */
function supersedeReplaced(pending: PendingRequest, conversation: ConversationView): void {
  if (pending.replacing.length === 0) return;
  for (const m of pending.replacing) {
    if (m.kind === 'user') continue;
    m.superseded = true;
    updateMessageElement(m);
  }
  pending.replacing = [];
  refreshAnswerFooters(conversation);
}

function pendingFor(requestId: string): { pending: PendingRequest; conversation: ConversationView | undefined } | null {
  const pending = appState.pending;
  if (!pending || pending.requestId !== requestId) return null;
  return { pending, conversation: conversationById(pending.conversationId) };
}

function startSegment(pending: PendingRequest, conversation: ConversationView): AssistantMessage {
  const model = pending.model || currentModelName(conversation);
  const segment = newAssistant({ text: '', model, streaming: true, route: pending.route, attempt: pending.attempt });
  pending.segment = segment;
  conversation.display.push(segment);
  appendMessageElement(conversation.id, segment);
  refreshAnswerFooters(conversation);
  return segment;
}

/** Sluit de lopende assistant-bubbel af; een lege bubbel (bv. direct vóór een tool-aanroep) verdwijnt. */
function finishSegment(pending: PendingRequest, conversation: ConversationView | undefined): void {
  const segment = pending.segment;
  pending.segment = null;
  if (!segment) return;
  segment.streaming = false;
  if (segment.text.trim().length === 0) {
    if (conversation) conversation.display = conversation.display.filter((m) => m !== segment);
    removeMessageElement(segment);
  } else {
    updateMessageElement(segment);
  }
  if (conversation) refreshAnswerFooters(conversation);
}

function endRequest(conversation: ConversationView | undefined): void {
  appState.pending = null;
  updateSendButton();
  renderModelPicker();
  renderHeader();
  renderSidebar();
  if (conversation) refreshAnswerFooters(conversation);
}

window.relay.onRoute((payload) => {
  const match = pendingFor(payload.requestId);
  if (!match?.conversation) return;
  finishSegment(match.pending, match.conversation);
  match.pending.model = payload.model;
  match.pending.route = payload.reason;
  match.pending.attempt = payload.attempt;
  // Escalatie of "Probeer slimmer": wat er nu van deze beurt staat wordt vervangen.
  if (payload.attempt > 1) match.pending.replacing = currentTurnMessages(match.conversation);
  // Stickiness volgt alleen gewone routerkeuzes; een escalatie is eenmalig (zie main).
  if (match.conversation.modelMode === 'auto' && payload.source !== 'escalation') match.conversation.routedModel = payload.model;
  renderModelPicker();
  renderSidebar();
});

window.relay.onChunk((payload) => {
  const match = pendingFor(payload.requestId);
  if (!match?.conversation) return;
  supersedeReplaced(match.pending, match.conversation);
  const segment = match.pending.segment ?? startSegment(match.pending, match.conversation);
  segment.loadingModel = false;
  segment.text += payload.token;
  updateMessageElement(segment);
});

window.relay.onStatus((payload) => {
  const match = pendingFor(payload.requestId);
  if (!match?.conversation || payload.status !== 'loading-model') return;
  const segment = match.pending.segment ?? startSegment(match.pending, match.conversation);
  segment.loadingModel = true;
  updateMessageElement(segment);
});

window.relay.onToolCall((payload) => {
  const match = pendingFor(payload.requestId);
  if (!match?.conversation) return;
  supersedeReplaced(match.pending, match.conversation);
  finishSegment(match.pending, match.conversation);
  const tool: DisplayMessage = {
    kind: 'tool',
    tool: payload.tool,
    query: payload.query,
    label: payload.label,
    status: 'running',
    summary: '',
    items: [],
    preview: '',
    durationMs: 0,
    open: AUTO_OPEN_TOOLS.has(payload.tool),
    superseded: false,
  };
  match.conversation.display.push(tool);
  appendMessageElement(match.conversation.id, tool);
});

window.relay.onToolResult((payload) => {
  const match = pendingFor(payload.requestId);
  if (!match?.conversation) return;
  const running = [...match.conversation.display].reverse().find((m): m is ToolMessage => m.kind === 'tool' && m.status === 'running');
  if (!running) return;
  running.status = payload.ok ? 'done' : 'error';
  running.summary = payload.summary;
  running.items = payload.items;
  running.preview = payload.preview;
  running.durationMs = payload.durationMs;
  updateMessageElement(running);
});

window.relay.onDone((payload) => {
  const match = pendingFor(payload.requestId);
  if (!match) return;
  const segment = match.pending.segment;
  if (payload.stopped && segment && segment.text.trim().length > 0) segment.text = `${segment.text.trimEnd()} …`;
  finishSegment(match.pending, match.conversation);
  endRequest(match.conversation);
  chatInputEl.focus();
});

window.relay.onError((payload) => {
  const match = pendingFor(payload.requestId);
  if (!match) return;
  finishSegment(match.pending, match.conversation);
  const conversation = match.conversation;
  if (conversation) {
    for (const m of conversation.display) {
      if (m.kind === 'tool' && m.status === 'running') {
        m.status = 'error';
        m.summary = 'Afgebroken';
        updateMessageElement(m);
      }
    }
    const errorMessage = newAssistant({ text: payload.message, model: '', failed: true });
    conversation.display.push(errorMessage);
    appendMessageElement(conversation.id, errorMessage);
  }
  endRequest(conversation);
  void refreshOllamaStatus();
});

async function refreshOllamaStatus(): Promise<void> {
  const { running } = await window.relay.ollamaStatus().catch(() => ({ running: false }));
  ollamaStatusEl.classList.toggle('is-down', !running);
  ollamaStatusTextEl.textContent = running ? 'Lokaal · Ollama actief' : 'Ollama niet bereikbaar';
}

async function initApp(): Promise<void> {
  try {
    appState.defaults = await window.relay.defaults();
    await refreshConversations();
    const first = appState.conversations[0];
    if (first) await selectConversation(first.id);
    else await newConversation();
  } catch (error) {
    showComposerError(describeUnknownError(error));
  }

  void refreshOllamaStatus();
  refreshModels().catch(() => undefined);
  setInterval(() => void refreshOllamaStatus(), OLLAMA_STATUS_INTERVAL_MS);

  window.relay.memory
    .list()
    .then((facts) => {
      appState.factsCount = facts.length;
      renderSidebar();
    })
    .catch((error: unknown) => showComposerError(describeUnknownError(error)));
}

void initApp();
