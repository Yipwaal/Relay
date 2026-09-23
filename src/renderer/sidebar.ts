const conversationListEl = document.getElementById('conversation-list') as HTMLElement;
const chatTitleEl = document.getElementById('chat-title') as HTMLElement;
const chatMetaEl = document.getElementById('chat-meta') as HTMLElement;
const factsSummaryEl = document.getElementById('facts-summary') as HTMLElement;
const deleteDialog = document.getElementById('delete-dialog') as HTMLDialogElement;
const deleteTextEl = document.getElementById('delete-text') as HTMLElement;
const deleteConfirmButton = document.getElementById('delete-confirm-button') as HTMLButtonElement;
const deleteCancelButton = document.getElementById('delete-cancel-button') as HTMLButtonElement;

function conversationMeta(c: ConversationView, now: number): string {
  return `${c.model} · ${c.history.length === 0 && c.display.length === 0 ? 'nu' : sidebarTimeLabel(c.updatedAt, now)}`;
}

function buildRenameInput(c: ConversationView): HTMLInputElement {
  const input = h('input', { class: 'rename-input' });
  input.value = c.title;
  input.maxLength = 120;
  let finished = false;
  const finish = (commit: boolean): void => {
    if (finished) return;
    finished = true;
    appState.renamingId = null;
    const title = input.value.trim();
    if (commit && title.length > 0 && title !== c.title) {
      c.title = title;
      void conversationStore.rename(c.id, title).catch((error: unknown) => showComposerError(describeUnknownError(error)));
    }
    renderSidebar();
    renderHeader();
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') finish(true);
    if (event.key === 'Escape') {
      event.stopPropagation();
      finish(false);
    }
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (event) => event.stopPropagation());
  return input;
}

function buildConversationItem(c: ConversationView, now: number): HTMLElement {
  const isActive = c.id === appState.activeId;
  const item = h('div', { class: `conv-item${isActive ? ' is-active' : ''}` });
  item.addEventListener('click', () => void selectConversation(c.id));

  if (appState.renamingId === c.id) {
    const input = buildRenameInput(c);
    item.appendChild(input);
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
    return item;
  }

  const startRename = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    startRenaming(c.id);
  };
  item.addEventListener('dblclick', startRename);
  item.addEventListener('contextmenu', startRename);

  item.append(
    h('div', { class: 'conv-text' }, [h('span', { class: 'conv-title', text: c.title }), h('span', { class: 'conv-meta', text: conversationMeta(c, now) })]),
    h('div', { class: 'conv-actions' }, [
      iconButton('edit', 'Hernoemen', 'solid', startRename),
      iconButton('trash', 'Verwijderen', 'danger', (event) => {
        event.stopPropagation();
        askDeleteConversation(c.id);
      }),
    ]),
  );
  return item;
}

function renderSidebar(): void {
  const now = Date.now();
  conversationListEl.textContent = '';
  for (const group of groupByDate(appState.conversations, now)) {
    conversationListEl.appendChild(
      h('div', { class: 'conv-group' }, [h('div', { class: 'conv-group-label', text: group.label }), ...group.items.map((c) => buildConversationItem(c, now))]),
    );
  }
  factsSummaryEl.textContent =
    `${countLabel(appState.factsCount, 'feit', 'feiten')} in geheugen` +
    (appState.defaults.numCtx > 0 ? ` · context ${Math.round(appState.defaults.numCtx / 1024)}K` : '');
}

function renderHeader(): void {
  const c = activeConversation();
  if (!c) return;
  chatTitleEl.textContent = c.title;
  const messageCount = c.display.filter((m) => m.kind !== 'tool').length;
  const docCount = appState.documents.length;
  chatMetaEl.textContent = [
    messageCount > 0 ? countLabel(messageCount, 'bericht', 'berichten') : 'Nog geen berichten',
    docCount > 0 ? `${countLabel(docCount, 'document', 'documenten')} doorzoekbaar` : 'geen documenten',
    `gestart ${startedLabel(c.createdAt, Date.now())}`,
  ].join(' · ');
}

function startRenaming(id: number): void {
  appState.renamingId = id;
  renderSidebar();
}

function askDeleteConversation(id: number): void {
  const c = conversationById(id);
  if (!c) return;
  appState.deleteId = id;
  deleteTextEl.textContent = `“${c.title}” wordt verwijderd. Dit kan niet ongedaan worden gemaakt.`;
  deleteDialog.showModal();
}

chatTitleEl.addEventListener('dblclick', () => startRenaming(appState.activeId));

deleteCancelButton.addEventListener('click', () => deleteDialog.close());
deleteDialog.addEventListener('close', () => {
  appState.deleteId = null;
});
deleteConfirmButton.addEventListener('click', () => {
  const id = appState.deleteId;
  deleteDialog.close();
  if (id !== null) void deleteConversation(id);
});
