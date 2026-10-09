const conversationListEl = document.getElementById('conversation-list') as HTMLElement;
const conversationSearchWrapEl = document.getElementById('conversation-search-wrap') as HTMLElement;
const conversationSearchEl = document.getElementById('conversation-search') as HTMLInputElement;
/** Bij weinig gesprekken is een zoekveld ruis. */
const SEARCH_FROM_CONVERSATIONS = 9;
const chatTitleEl = document.getElementById('chat-title') as HTMLElement;
const chatMetaEl = document.getElementById('chat-meta') as HTMLElement;
const factsSummaryEl = document.getElementById('facts-summary') as HTMLElement;
const deleteDialog = document.getElementById('delete-dialog') as HTMLDialogElement;
const deleteTextEl = document.getElementById('delete-text') as HTMLElement;
const deleteConfirmButton = document.getElementById('delete-confirm-button') as HTMLButtonElement;
const deleteCancelButton = document.getElementById('delete-cancel-button') as HTMLButtonElement;

function conversationMeta(c: ConversationView, now: number): string {
  const fresh = c.updatedAt === c.createdAt && now - c.createdAt < 60_000;
  const parts = [currentModelName(c) || modelModeLabel(c), fresh ? 'nu' : sidebarTimeLabel(c.updatedAt, now)];
  if (c.documentCount > 0) parts.push(countLabel(c.documentCount, 'document', 'documenten'));
  return parts.join(' · ');
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
      void renameConversation(c, title);
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

/** Filtert op titel (hoofdletterongevoelig); de hele lijst staat al in het geheugen van de renderer. */
function visibleConversations(): ConversationView[] {
  const searchable = appState.conversations.length >= SEARCH_FROM_CONVERSATIONS;
  conversationSearchWrapEl.hidden = !searchable;
  if (!searchable) conversationSearchEl.value = '';
  const query = conversationSearchEl.value.trim().toLocaleLowerCase('nl');
  if (!query) return appState.conversations;
  return appState.conversations.filter((c) => c.title.toLocaleLowerCase('nl').includes(query));
}

function renderSidebar(): void {
  const now = Date.now();
  conversationListEl.textContent = '';
  const conversations = visibleConversations();
  if (conversations.length === 0 && appState.conversations.length > 0) {
    conversationListEl.appendChild(h('div', { class: 'conv-empty', text: 'Geen gesprek met die titel.' }));
  }
  for (const group of groupByDate(conversations, now)) {
    conversationListEl.appendChild(
      h('div', { class: 'conv-group' }, [h('div', { class: 'conv-group-label', text: group.label }), ...group.items.map((c) => buildConversationItem(c, now))]),
    );
  }
  const numCtx = activeConversation()?.options.numCtx ?? 0;
  factsSummaryEl.textContent =
    `${countLabel(appState.factsCount, 'feit', 'feiten')} in geheugen` + (numCtx > 0 ? ` · context ${Math.round(numCtx / 1024)}K` : '');
}

function renderHeader(): void {
  const c = activeConversation();
  if (!c) return;
  chatTitleEl.textContent = c.title;
  const messageCount = c.display.filter((m) => m.kind === 'user' || (m.kind === 'assistant' && !m.failed)).length;
  const docCount = appState.documents.length;
  chatMetaEl.textContent = [
    messageCount > 0 ? countLabel(messageCount, 'bericht', 'berichten') : 'Nog geen berichten',
    docCount > 0 ? `${countLabel(docCount, 'document', 'documenten')} in dit gesprek` : 'geen documenten',
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
  const docs =
    c.documentCount === 0
      ? ''
      : c.documentCount === 1
        ? ', samen met het document dat eraan hangt'
        : `, samen met de ${countLabel(c.documentCount, 'document', 'documenten')} die eraan hangen`;
  deleteTextEl.textContent = `“${c.title}” wordt verwijderd${docs}. Dit kan niet ongedaan worden gemaakt.`;
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

conversationSearchEl.addEventListener('input', renderSidebar);
conversationSearchEl.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || conversationSearchEl.value === '') return;
  event.stopPropagation();
  conversationSearchEl.value = '';
  renderSidebar();
});
