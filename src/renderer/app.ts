const chatBodyEl = document.getElementById('chat-body') as HTMLElement;
const emptyIntroEl = document.getElementById('empty-intro') as HTMLElement;
const modelPillNameEl = document.getElementById('model-pill-name') as HTMLElement;

function renderActive(): void {
  const c = activeConversation();
  if (!c) return;
  const isEmpty = c.display.length === 0;
  chatBodyEl.classList.toggle('is-empty', isEmpty);
  emptyIntroEl.textContent =
    `Alles blijft op deze computer. ${c.model} draait lokaal via Ollama; Relay kan je geheugen gebruiken, ` +
    'op het web zoeken en de documenten doorzoeken die je toevoegt.';
  modelPillNameEl.textContent = c.model;
  renderMessages(c);
  renderHeader();
  renderSidebar();
  renderDocChips();
  updateSendButton();
}

async function selectConversation(id: number): Promise<void> {
  if (!conversationById(id)) return;
  appState.activeId = id;
  appState.renamingId = null;
  renderActive();
  chatInputEl.focus();
}

async function newConversation(): Promise<void> {
  const current = activeConversation();
  if (current && current.display.length === 0) {
    chatInputEl.focus();
    return;
  }
  const created = await conversationStore.create(current?.model ?? appState.defaults.model);
  appState.conversations.unshift(created);
  await selectConversation(created.id);
}

async function deleteConversation(id: number): Promise<void> {
  try {
    await conversationStore.remove(id);
  } catch (error) {
    showComposerError(describeUnknownError(error));
    return;
  }
  appState.conversations = appState.conversations.filter((c) => c.id !== id);
  if (appState.conversations.length === 0) {
    appState.conversations.push(await conversationStore.create(appState.defaults.model));
  }
  if (appState.activeId === id || !activeConversation()) {
    const first = appState.conversations[0];
    if (first) await selectConversation(first.id);
  } else {
    renderSidebar();
  }
}

async function sendCurrentDraft(): Promise<void> {
  const c = activeConversation();
  const text = chatInputEl.value.trim();
  if (!c || text.length === 0 || appState.pending !== null) return;
  clearComposerError();

  const wasEmpty = c.display.length === 0;
  if (wasEmpty) {
    c.title = titleFromText(text);
    void conversationStore.rename(c.id, c.title).catch(() => undefined);
  }
  c.history.push({ role: 'user', content: text });
  const userMessage: DisplayMessage = { kind: 'user', text };
  c.display.push(userMessage);
  c.updatedAt = Date.now();

  chatInputEl.value = '';
  autoGrowInput();
  if (wasEmpty) renderActive();
  else appendMessageElement(c.id, userMessage);

  appState.pending = { requestId: window.relay.sendMessage(c.history), conversationId: c.id, segment: null };
  updateSendButton();
  renderSidebar();
  renderHeader();
}

function pendingFor(requestId: string): { pending: PendingRequest; conversation: ConversationView | undefined } | null {
  const pending = appState.pending;
  if (!pending || pending.requestId !== requestId) return null;
  return { pending, conversation: conversationById(pending.conversationId) };
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
  renderHeader();
  renderSidebar();
}

window.relay.onChunk((payload) => {
  const match = pendingFor(payload.requestId);
  if (!match?.conversation) return;
  const { pending, conversation } = match;
  if (!pending.segment) {
    pending.segment = { kind: 'assistant', text: '', model: conversation.model, streaming: true, failed: false };
    conversation.display.push(pending.segment);
    appendMessageElement(conversation.id, pending.segment);
  }
  pending.segment.text += payload.token;
  updateMessageElement(pending.segment);
});

window.relay.onToolCall((payload) => {
  const match = pendingFor(payload.requestId);
  if (!match?.conversation) return;
  finishSegment(match.pending, match.conversation);
  const tool: DisplayMessage = { kind: 'tool', tool: payload.tool, query: payload.query, status: 'running', summary: '', items: [], durationMs: 0, open: false };
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
  running.durationMs = payload.durationMs;
  updateMessageElement(running);
});

window.relay.onDone((payload) => {
  const match = pendingFor(payload.requestId);
  if (!match) return;
  finishSegment(match.pending, match.conversation);
  if (match.conversation) {
    match.conversation.history.push(...payload.appended);
    match.conversation.updatedAt = Date.now();
  }
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
    const errorMessage: DisplayMessage = { kind: 'assistant', text: payload.message, model: conversation.model, streaming: false, failed: true };
    conversation.display.push(errorMessage);
    appendMessageElement(conversation.id, errorMessage);
  }
  endRequest();
});

document.getElementById('new-chat-button')?.addEventListener('click', () => void newConversation());

window.addEventListener('keydown', (event: KeyboardEvent) => {
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'n') {
    event.preventDefault();
    void newConversation();
  }
});

async function initApp(): Promise<void> {
  try {
    appState.defaults = await window.relay.defaults();
  } catch (error) {
    showComposerError(describeUnknownError(error));
  }
  appState.conversations = [await conversationStore.create(appState.defaults.model)];
  appState.activeId = appState.conversations[0]?.id ?? 0;
  renderActive();
  chatInputEl.focus();

  await Promise.all([
    refreshDocuments(),
    window.relay.memory.list().then((facts) => {
      appState.factsCount = facts.length;
      renderSidebar();
    }),
  ]).catch((error: unknown) => showComposerError(describeUnknownError(error)));
}

void initApp();
