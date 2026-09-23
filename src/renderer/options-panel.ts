const optionsScopeEl = document.getElementById('options-scope') as HTMLElement;
const ctxOptionsEl = document.getElementById('ctx-options') as HTMLElement;
const ctxLabelEl = document.getElementById('ctx-label') as HTMLElement;
const ctxWordsEl = document.getElementById('ctx-words') as HTMLElement;
const ctxMemEl = document.getElementById('ctx-mem') as HTMLElement;
const ctxReloadNoteEl = document.getElementById('ctx-reload-note') as HTMLElement;
const predictOptionsEl = document.getElementById('predict-options') as HTMLElement;
const predictLabelEl = document.getElementById('predict-label') as HTMLElement;
const budgetTextEl = document.getElementById('budget-text') as HTMLElement;
const tempInputEl = document.getElementById('temp-input') as HTMLInputElement;
const tempLabelEl = document.getElementById('temp-label') as HTMLElement;

const CTX_CHOICES = [2048, 4096, 8192, 16384, 32768];
const PREDICT_CHOICES = [512, 1024, 2048, 4096, -1];

function buildSegmented(container: HTMLElement, choices: number[], current: number, label: (value: number) => string, onPick: (value: number) => void): void {
  container.textContent = '';
  for (const value of choices) {
    const selected = value === current;
    const button = h('button', { class: `segment${selected ? ' is-selected' : ''}`, type: 'button', text: label(value) });
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(selected));
    button.addEventListener('click', () => onPick(value));
    container.appendChild(button);
  }
}

function renderOptionsPanel(): void {
  const c = activeConversation();
  if (!c) return;
  const { numCtx, numPredict, temperature } = c.options;

  optionsScopeEl.textContent = `De instellingen hieronder gelden voor “${c.title}”. Nieuwe gesprekken starten met de standaard uit config.json.`;

  buildSegmented(ctxOptionsEl, CTX_CHOICES, numCtx, (v) => `${v / 1024}K`, (v) => void saveOptions(c, { ...c.options, numCtx: v }));
  ctxLabelEl.textContent = tokensLabel(numCtx);
  ctxWordsEl.textContent = contextWordsLabel(numCtx);
  const kv = findModel(c.model)?.kvBytesPerToken ?? null;
  ctxMemEl.hidden = kv === null;
  if (kv !== null) ctxMemEl.textContent = kvMemoryLabel(numCtx, kv, c.model);

  buildSegmented(predictOptionsEl, PREDICT_CHOICES, numPredict, (v) => (v < 0 ? 'Onbeperkt' : formatInt(v)), (v) => void saveOptions(c, { ...c.options, numPredict: v }));
  predictLabelEl.textContent = tokensLabel(numPredict);
  const budget = budgetInfo(numCtx, numPredict);
  budgetTextEl.textContent = budget.text;
  budgetTextEl.classList.toggle('is-tight', budget.tight);

  tempInputEl.value = String(temperature);
  tempLabelEl.textContent = temperature.toFixed(1).replace('.', ',');
}

/** Direct opslaan per wijziging (zie de tekst onderaan het instellingenscherm). */
async function saveOptions(c: ConversationView, options: RelayChatOptions): Promise<void> {
  const ctxChanged = options.numCtx !== c.options.numCtx;
  try {
    const updated = await window.relay.conversations.setOptions(c.id, options);
    c.options = updated.options;
    if (ctxChanged) ctxReloadNoteEl.hidden = false;
  } catch (error) {
    showSettingsError(describeUnknownError(error));
  }
  renderOptionsPanel();
  renderSidebar();
}

tempInputEl.addEventListener('input', () => {
  tempLabelEl.textContent = Number(tempInputEl.value).toFixed(1).replace('.', ',');
});

tempInputEl.addEventListener('change', () => {
  const c = activeConversation();
  if (c) void saveOptions(c, { ...c.options, temperature: Number(tempInputEl.value) });
});

settingsButton.addEventListener('click', () => {
  ctxReloadNoteEl.hidden = true;
  renderOptionsPanel();
  // Voor de werkgeheugen-schatting; faalt stil als Ollama niet draait.
  refreshModels()
    .then(renderOptionsPanel)
    .catch(() => undefined);
});
