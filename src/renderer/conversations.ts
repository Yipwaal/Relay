const chatBodyEl = document.getElementById('chat-body') as HTMLElement;
const emptyIntroEl = document.getElementById('empty-intro') as HTMLElement;
const modelPillNameEl = document.getElementById('model-pill-name') as HTMLElement;

function renderActive(): void {
  const c = activeConversation();
  if (!c) return;
  const isEmpty = c.loaded && c.display.length === 0;
  chatBodyEl.classList.toggle('is-empty', isEmpty);
  emptyIntroEl.textContent =
    `Alles blijft op deze computer. ${c.model} draait lokaal via Ollama; Relay kan je geheugen gebruiken, ` +
    'op het web zoeken en de documenten doorzoeken die je aan dit gesprek toevoegt.';
  modelPillNameEl.textContent = c.model;
  renderMessages(c);
  renderHeader();
  renderSidebar();
  renderDocChips();
  updateSendButton();
}

async function loadConversation(c: ConversationView): Promise<void> {
  if (c.loaded) return;
  const messages = await window.relay.conversations.messages(c.id);
  c.display = messages.map(toDisplayMessage);
  c.loaded = true;
}

async function selectConversation(id: number): Promise<void> {
  const c = conversationById(id);
  if (!c) return;
  appState.activeId = id;
  appState.renamingId = null;
  appState.documents = [];
  clearComposerError();
  try {
    await Promise.all([loadConversation(c), refreshDocuments()]);
  } catch (error) {
    showComposerError(describeUnknownError(error));
  }
  if (appState.activeId !== id) return;
  renderActive();
  chatInputEl.focus();
}

async function refreshConversations(): Promise<void> {
  const summaries = await window.relay.conversations.list();
  const existing = new Map(appState.conversations.map((c) => [c.id, c]));
  appState.conversations = summaries.map((s) => {
    const known = existing.get(s.id);
    return known ? Object.assign(known, s) : toConversationView(s);
  });
}

async function newConversation(): Promise<void> {
  const current = activeConversation();
  if (current && current.loaded && current.display.length === 0) {
    chatInputEl.focus();
    return;
  }
  try {
    const created = toConversationView(await window.relay.conversations.create());
    created.loaded = true;
    appState.conversations.unshift(created);
    await selectConversation(created.id);
  } catch (error) {
    showComposerError(describeUnknownError(error));
  }
}

async function renameConversation(c: ConversationView, title: string): Promise<void> {
  try {
    const updated = await window.relay.conversations.rename(c.id, title);
    c.title = updated.title;
  } catch (error) {
    showComposerError(describeUnknownError(error));
  }
  renderSidebar();
  renderHeader();
}

async function deleteConversation(id: number): Promise<void> {
  try {
    await window.relay.conversations.remove(id);
  } catch (error) {
    showComposerError(describeUnknownError(error));
    return;
  }
  appState.conversations = appState.conversations.filter((c) => c.id !== id);
  if (appState.conversations.length === 0) {
    await newConversation();
    return;
  }
  if (appState.activeId === id) {
    const first = appState.conversations[0];
    if (first) await selectConversation(first.id);
  } else {
    renderSidebar();
  }
}

window.relay.conversations.onUpdated((payload) => {
  const c = conversationById(payload.id);
  if (!c) return;
  c.title = payload.title;
  c.updatedAt = payload.updatedAt;
  renderSidebar();
  if (c.id === appState.activeId) renderHeader();
});

document.getElementById('new-chat-button')?.addEventListener('click', () => void newConversation());

window.addEventListener('keydown', (event: KeyboardEvent) => {
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'n') {
    event.preventDefault();
    void newConversation();
  }
});
