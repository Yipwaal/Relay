const ollamaStatusEl = document.getElementById('ollama-status') as HTMLElement;
const ollamaStatusTextEl = document.getElementById('ollama-status-text') as HTMLElement;
const OLLAMA_STATUS_INTERVAL_MS = 30_000;

type AssistantMessage = Extract<DisplayMessage, { kind: 'assistant' }>;

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

  appState.pending = { requestId: window.relay.sendMessage(c.id, text), conversationId: c.id, segment: null, stopping: false };
  updateSendButton();
  renderModelPicker();
  renderSidebar();
  renderHeader();
}

function pendingFor(requestId: string): { pending: PendingRequest; conversation: ConversationView | undefined } | null {
  const pending = appState.pending;
  if (!pending || pending.requestId !== requestId) return null;
  return { pending, conversation: conversationById(pending.conversationId) };
}

function startSegment(pending: PendingRequest, conversation: ConversationView): AssistantMessage {
  const segment: AssistantMessage = { kind: 'assistant', text: '', model: conversation.model, streaming: true, failed: false, loadingModel: false };
  pending.segment = segment;
  conversation.display.push(segment);
  appendMessageElement(conversation.id, segment);
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
}

function endRequest(): void {
  appState.pending = null;
  updateSendButton();
  renderModelPicker();
  renderHeader();
  renderSidebar();
}

window.relay.onChunk((payload) => {
  const match = pendingFor(payload.requestId);
  if (!match?.conversation) return;
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
  endRequest();
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
    const errorMessage: DisplayMessage = { kind: 'assistant', text: payload.message, model: conversation.model, streaming: false, failed: true, loadingModel: false };
    conversation.display.push(errorMessage);
    appendMessageElement(conversation.id, errorMessage);
  }
  endRequest();
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
