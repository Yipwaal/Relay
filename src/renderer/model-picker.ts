const modelButtonEl = document.getElementById('model-button') as HTMLButtonElement;
const modelMenuEl = document.getElementById('model-menu') as HTMLElement;
const modelListEl = document.getElementById('model-list') as HTMLElement;
const modelMenuErrorEl = document.getElementById('model-menu-error') as HTMLElement;
const modelPillNameEl = document.getElementById('model-pill-name') as HTMLElement;
const modelPillParamsEl = document.getElementById('model-pill-params') as HTMLElement;

function findModel(name: string): RelayLocalModel | undefined {
  return appState.models.find((m) => m.name === name);
}

function modelDescription(m: RelayLocalModel): string {
  return [m.family, m.parameterSize, m.quantization].filter((part) => part.length > 0).join(' · ');
}

function renderModelPicker(): void {
  const c = activeConversation();
  if (!c) return;
  modelPillNameEl.textContent = c.model;
  modelPillParamsEl.textContent = findModel(c.model)?.parameterSize ?? '';
  // Tijdens een antwoord in dít gesprek niet van model wisselen.
  modelButtonEl.disabled = appState.pending?.conversationId === c.id;
}

function closeModelMenu(): void {
  modelMenuEl.hidden = true;
  modelButtonEl.setAttribute('aria-expanded', 'false');
}

async function refreshModels(): Promise<void> {
  appState.models = await window.relay.listModels();
  renderModelPicker();
}

async function pickModel(c: ConversationView, name: string): Promise<void> {
  closeModelMenu();
  if (name === c.model) return;
  try {
    const updated = await window.relay.conversations.setModel(c.id, name);
    c.model = updated.model;
  } catch (error) {
    showComposerError(describeUnknownError(error));
  }
  renderModelPicker();
  renderSidebar();
  if (c.id === appState.activeId) renderActive();
}

function renderModelList(): void {
  const c = activeConversation();
  modelListEl.textContent = '';
  if (!c) return;
  if (appState.models.length === 0) {
    modelListEl.appendChild(h('p', { class: 'model-menu-empty', text: 'Nog geen modellen gevonden in Ollama.' }));
    return;
  }
  for (const m of appState.models) {
    const selected = m.name === c.model;
    const item = h('button', { class: `model-item${selected ? ' is-selected' : ''}`, type: 'button' }, [
      h('div', { class: 'model-item-text' }, [h('span', { class: 'model-item-name', text: m.name }), h('span', { class: 'model-item-desc', text: modelDescription(m) })]),
      h('span', { class: 'model-item-size', text: m.sizeBytes > 0 ? formatBytes(m.sizeBytes) : '' }),
      selected ? icon('check', 15, 2.6) : null,
    ]);
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(selected));
    item.addEventListener('click', () => void pickModel(c, m.name));
    modelListEl.appendChild(item);
  }
}

async function openModelMenu(): Promise<void> {
  modelMenuErrorEl.hidden = true;
  modelMenuEl.hidden = false;
  modelButtonEl.setAttribute('aria-expanded', 'true');
  renderModelList();
  try {
    await refreshModels();
    if (!modelMenuEl.hidden) renderModelList();
  } catch (error) {
    modelMenuErrorEl.textContent = describeUnknownError(error);
    modelMenuErrorEl.hidden = false;
  }
}

modelButtonEl.addEventListener('click', (event) => {
  event.stopPropagation();
  if (modelMenuEl.hidden) void openModelMenu();
  else closeModelMenu();
});

modelMenuEl.addEventListener('click', (event) => event.stopPropagation());
document.addEventListener('click', closeModelMenu);
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeModelMenu();
});
