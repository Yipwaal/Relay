const chatInputEl = document.getElementById('chat-input') as HTMLTextAreaElement;
const sendButtonEl = document.getElementById('send-button') as HTMLButtonElement;
const stopButtonEl = document.getElementById('stop-button') as HTMLButtonElement;
const attachButtonEl = document.getElementById('attach-button') as HTMLButtonElement;
const docChipsEl = document.getElementById('doc-chips') as HTMLElement;
const composerErrorEl = document.getElementById('composer-error') as HTMLElement;

function showComposerError(message: string): void {
  composerErrorEl.textContent = message;
  composerErrorEl.hidden = false;
}

function clearComposerError(): void {
  composerErrorEl.hidden = true;
}

function autoGrowInput(): void {
  chatInputEl.style.height = 'auto';
  chatInputEl.style.height = `${Math.min(chatInputEl.scrollHeight, 220)}px`;
}

function updateSendButton(): void {
  const streaming = appState.pending !== null;
  sendButtonEl.hidden = streaming;
  stopButtonEl.hidden = !streaming;
  stopButtonEl.disabled = appState.pending?.stopping ?? false;
  sendButtonEl.disabled = streaming || chatInputEl.value.trim().length === 0;
}

function documentMeta(doc: RelayDocumentInfo): string {
  if (doc.outdated) return 'verouderd embedding-model';
  return `${countLabel(doc.chunkCount, 'fragment', 'fragmenten')} · doorzoekbaar`;
}

function buildDocChip(title: string, meta: HTMLElement, onRemove: (() => void) | null): HTMLElement {
  return h('div', { class: 'doc-chip', title }, [
    icon('doc', 16, 2),
    h('div', { class: 'doc-chip-text' }, [h('span', { class: 'doc-chip-name', text: title }), meta]),
    onRemove ? iconButton('close', 'Document verwijderen', 'plain', onRemove) : null,
  ]);
}

function renderDocChips(): void {
  docChipsEl.textContent = '';

  for (const doc of appState.documents) {
    const meta = h('span', { class: `doc-chip-meta${doc.outdated ? ' is-warning' : ''}`, text: documentMeta(doc) });
    docChipsEl.appendChild(
      buildDocChip(doc.title, meta, () => {
        clearComposerError();
        window.relay.documents
          .remove(doc.id)
          .then(refreshDocuments)
          .catch((error: unknown) => showComposerError(describeUnknownError(error)));
      }),
    );
  }

  const indexing = appState.indexing;
  if (indexing) {
    const pct = indexing.total > 0 ? Math.round((indexing.done / indexing.total) * 100) : 0;
    const fill = h('span', { class: 'progress-fill' });
    fill.style.width = `${pct}%`;
    const meta = h('span', { class: 'doc-chip-progress' }, [h('span', { class: 'progress-track' }, [fill]), h('span', { class: 'progress-label', text: `Indexeren ${pct}%` })]);
    docChipsEl.appendChild(buildDocChip(indexing.title, meta, null));
  }

  docChipsEl.hidden = docChipsEl.childElementCount === 0;
}

async function refreshDocuments(): Promise<void> {
  appState.documents = await window.relay.documents.list();
  renderDocChips();
  renderHeader();
}

chatInputEl.addEventListener('input', () => {
  autoGrowInput();
  updateSendButton();
});

chatInputEl.addEventListener('keydown', (event: KeyboardEvent) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    void sendCurrentDraft();
  }
});

sendButtonEl.addEventListener('click', () => void sendCurrentDraft());

stopButtonEl.addEventListener('click', () => {
  const pending = appState.pending;
  if (!pending || pending.stopping) return;
  pending.stopping = true;
  window.relay.stopMessage(pending.requestId);
  updateSendButton();
});

attachButtonEl.addEventListener('click', () => {
  clearComposerError();
  attachButtonEl.disabled = true;
  window.relay.documents
    .add()
    .then((added) => (added ? refreshDocuments() : undefined))
    .catch((error: unknown) => showComposerError(describeUnknownError(error)))
    .finally(() => {
      attachButtonEl.disabled = false;
      appState.indexing = null;
      renderDocChips();
    });
});

window.relay.documents.onProgress((payload) => {
  appState.indexing = { title: payload.title, done: payload.done, total: payload.total };
  renderDocChips();
});
