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
  const parts = [m.family, m.parameterSize, m.quantization].filter((part) => part.length > 0);
  // Een cloudmodel draait niet lokaal: dat moet je zien vóórdat je het kiest.
  if (m.remote) parts.unshift('cloud — niet lokaal');
  return parts.join(' · ');
}

function renderModelPicker(): void {
  const c = activeConversation();
  if (!c) return;
  modelPillNameEl.textContent = modelModeLabel(c);
  // In Automatisch: welk model de router het laatst koos.
  modelPillParamsEl.textContent = c.modelMode === 'fixed' ? (findModel(c.model)?.parameterSize ?? '') : (c.routedModel ?? '');
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

/** name null = Automatisch. */
async function pickModel(c: ConversationView, name: string | null): Promise<void> {
  closeModelMenu();
  if (name === null ? c.modelMode === 'auto' : c.modelMode === 'fixed' && name === c.model) return;
  try {
    const updated = await window.relay.conversations.setModel(c.id, name);
    c.modelMode = updated.modelMode;
    c.model = updated.model;
    c.routedModel = updated.routedModel;
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
  modelListEl.appendChild(modelItem('Automatisch', 'Relay kiest per vraag het beste model', '', c.modelMode === 'auto', () => void pickModel(c, null)));
  if (appState.models.length === 0) {
    modelListEl.appendChild(h('p', { class: 'model-menu-empty', text: 'Nog geen modellen gevonden in Ollama.' }));
    return;
  }
  for (const m of appState.models) {
    const selected = c.modelMode === 'fixed' && m.name === c.model;
    modelListEl.appendChild(modelItem(m.name, modelDescription(m), m.sizeBytes > 0 ? formatBytes(m.sizeBytes) : '', selected, () => void pickModel(c, m.name)));
  }
}

function modelItem(name: string, description: string, size: string, selected: boolean, onPick: () => void): HTMLElement {
  const item = h('button', { class: `model-item${selected ? ' is-selected' : ''}`, type: 'button' }, [
    h('div', { class: 'model-item-text' }, [h('span', { class: 'model-item-name', text: name }), h('span', { class: 'model-item-desc', text: description })]),
    h('span', { class: 'model-item-size', text: size }),
    selected ? icon('check', 15, 2.6) : null,
  ]);
  item.setAttribute('role', 'option');
  item.setAttribute('aria-selected', String(selected));
  item.addEventListener('click', onPick);
  return item;
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
