const documentsListEl = document.getElementById('documents-list') as HTMLUListElement;
const documentsErrorEl = document.getElementById('documents-error') as HTMLElement;
const documentsProgressEl = document.getElementById('documents-progress') as HTMLElement;
const addDocumentButton = document.getElementById('add-document-button') as HTMLButtonElement;
const documentsSettingsButton = document.getElementById('settings-button') as HTMLButtonElement;

function showDocumentsError(message: string): void {
  documentsErrorEl.textContent = message;
  documentsErrorEl.hidden = false;
}

function clearDocumentsError(): void {
  documentsErrorEl.hidden = true;
}

function describeDocumentsError(error: unknown): string {
  return error instanceof Error ? error.message : 'Onbekende fout';
}

function formatDocumentDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString('nl-NL', { year: 'numeric', month: 'short', day: 'numeric' });
}

async function refreshDocuments(): Promise<void> {
  try {
    const docs = await window.relay.documents.list();
    documentsListEl.textContent = '';

    if (docs.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'documents-empty';
      empty.textContent = 'Nog geen documenten toegevoegd.';
      documentsListEl.appendChild(empty);
      return;
    }

    for (const doc of docs) {
      documentsListEl.appendChild(renderDocumentRow(doc));
    }
  } catch (error) {
    showDocumentsError(describeDocumentsError(error));
  }
}

function renderDocumentRow(doc: RelayDocumentInfo): HTMLElement {
  const row = document.createElement('li');
  row.className = 'document-row';

  const info = document.createElement('div');
  info.className = 'document-info';

  const titleEl = document.createElement('span');
  titleEl.className = 'document-title';
  titleEl.textContent = doc.title;
  info.appendChild(titleEl);

  const metaEl = document.createElement('span');
  metaEl.className = 'document-meta';
  metaEl.textContent = `${doc.chunkCount} passages · ${formatDocumentDate(doc.createdAt)}`;
  info.appendChild(metaEl);

  if (doc.outdated) {
    const badge = document.createElement('span');
    badge.className = 'document-badge';
    badge.textContent = 'verouderd embedding-model';
    info.appendChild(badge);
  }

  row.appendChild(info);

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.textContent = 'Verwijder';
  deleteButton.addEventListener('click', () => {
    clearDocumentsError();
    window.relay.documents
      .remove(doc.id)
      .then(refreshDocuments)
      .catch((error: unknown) => showDocumentsError(describeDocumentsError(error)));
  });
  row.appendChild(deleteButton);

  return row;
}

addDocumentButton.addEventListener('click', () => {
  clearDocumentsError();
  addDocumentButton.disabled = true;
  documentsProgressEl.hidden = false;
  documentsProgressEl.textContent = 'Bestand kiezen...';

  window.relay.documents
    .add()
    .then((result) => (result ? refreshDocuments() : undefined))
    .catch((error: unknown) => showDocumentsError(describeDocumentsError(error)))
    .finally(() => {
      addDocumentButton.disabled = false;
      documentsProgressEl.hidden = true;
    });
});

window.relay.documents.onProgress((payload) => {
  documentsProgressEl.hidden = false;
  documentsProgressEl.textContent = `Verwerkt "${payload.title}": ${payload.done}/${payload.total} stukken`;
});

// settings.ts opent de dialoog en ververst het geheugen; hier alleen de documentenlijst verversen.
documentsSettingsButton.addEventListener('click', () => {
  clearDocumentsError();
  void refreshDocuments();
});
