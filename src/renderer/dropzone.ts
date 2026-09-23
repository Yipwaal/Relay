const chatMainEl = document.getElementById('chat-main') as HTMLElement;
const dropOverlayEl = document.getElementById('drop-overlay') as HTMLElement;

const DROP_EXTENSIONS = ['.txt', '.md', '.markdown', '.pdf', '.docx'];
// Ruwe voorcheck zodat we geen enorme bestanden over IPC sturen; main controleert per type precies (pdf/docx: 5 MB).
const DROP_MAX_BYTES = 20 * 1024 * 1024;

function draggingFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes('Files') ?? false;
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

/** Na elkaar, want main verwerkt maar één document tegelijk. */
async function addDroppedFiles(conversationId: number, files: File[]): Promise<void> {
  for (const file of files) {
    if (!DROP_EXTENSIONS.includes(fileExtension(file.name))) {
      showComposerError(`"${file.name}" wordt niet ondersteund — alleen .txt, .md, .pdf en .docx.`);
      continue;
    }
    if (file.size > DROP_MAX_BYTES) {
      showComposerError(`"${file.name}" is te groot (max ${DROP_MAX_BYTES / (1024 * 1024)} MB).`);
      continue;
    }
    await runDocumentAdd(conversationId, async () => {
      const data = new Uint8Array(await file.arrayBuffer());
      return window.relay.documents.addDropped(conversationId, file.name, data);
    });
  }
}

chatMainEl.addEventListener('dragover', (event) => {
  if (!draggingFiles(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  dropOverlayEl.hidden = false;
});

chatMainEl.addEventListener('dragleave', (event) => {
  if (!chatMainEl.contains(event.relatedTarget as Node | null)) dropOverlayEl.hidden = true;
});

chatMainEl.addEventListener('drop', (event) => {
  event.preventDefault();
  dropOverlayEl.hidden = true;
  const files = Array.from(event.dataTransfer?.files ?? []);
  if (files.length > 0) void addDroppedFiles(appState.activeId, files);
});

// Buiten het chatvenster (bv. de sidebar) mag een gesleept bestand ook niets openen.
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => event.preventDefault());
