const settingsButton = document.getElementById('settings-button') as HTMLButtonElement;
const settingsDialog = document.getElementById('settings-dialog') as HTMLDialogElement;
const closeSettingsButton = document.getElementById('close-settings-button') as HTMLButtonElement;
const settingsCloseIcon = document.getElementById('settings-close-icon') as HTMLButtonElement;
const settingsErrorEl = document.getElementById('settings-error') as HTMLElement;
const factsListEl = document.getElementById('facts-list') as HTMLElement;
const addFactForm = document.getElementById('add-fact-form') as HTMLFormElement;
const newFactInput = document.getElementById('new-fact-input') as HTMLInputElement;
const addFactButton = document.getElementById('add-fact-button') as HTMLButtonElement;

let editingFactId: number | null = null;

function showSettingsError(message: string): void {
  settingsErrorEl.textContent = message;
  settingsErrorEl.hidden = false;
}

function clearSettingsError(): void {
  settingsErrorEl.hidden = true;
}

function runFactAction(action: Promise<unknown>): void {
  clearSettingsError();
  action.then(refreshFacts).catch((error: unknown) => showSettingsError(describeUnknownError(error)));
}

async function refreshFacts(): Promise<void> {
  const facts = await window.relay.memory.list();
  appState.factsCount = facts.length;
  renderSidebar();
  renderFacts(facts);
}

function buildFactEditRow(fact: RelayMemoryFact): HTMLElement {
  const input = h('input', { class: 'inline-input' });
  input.value = fact.text;
  input.maxLength = 500;
  let finished = false;
  const finish = (commit: boolean): void => {
    if (finished) return;
    finished = true;
    editingFactId = null;
    const text = input.value.trim();
    if (commit && text.length > 0 && text !== fact.text) {
      runFactAction(window.relay.memory.update(fact.id, text));
    } else {
      void refreshFacts();
    }
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') finish(true);
    if (event.key === 'Escape') {
      event.preventDefault();
      finish(false);
    }
  });
  input.addEventListener('blur', () => finish(true));
  requestAnimationFrame(() => input.focus());
  return h('div', { class: 'fact-row' }, [input]);
}

function buildFactRow(fact: RelayMemoryFact): HTMLElement {
  if (editingFactId === fact.id) return buildFactEditRow(fact);

  const auto = fact.source === 'model';
  return h('div', { class: 'fact-row' }, [
    h('span', { class: 'fact-text', text: fact.text }),
    h('span', { class: `fact-badge ${auto ? 'is-auto' : 'is-user'}`, text: auto ? 'Automatisch' : 'Door jou' }),
    iconButton('edit', 'Bewerken', 'plain', () => {
      editingFactId = fact.id;
      void refreshFacts();
    }),
    iconButton('trash', 'Vergeten', 'danger', () => runFactAction(window.relay.memory.remove(fact.id))),
  ]);
}

function renderFacts(facts: RelayMemoryFact[]): void {
  factsListEl.textContent = '';
  if (facts.length === 0) {
    factsListEl.appendChild(
      h('div', {
        class: 'facts-empty',
        text: 'Nog niets onthouden. Voeg hieronder een feit toe, of vraag Relay in een gesprek om iets te onthouden.',
      }),
    );
    return;
  }
  for (const fact of facts) factsListEl.appendChild(buildFactRow(fact));
}

function updateAddFactButton(): void {
  addFactButton.disabled = newFactInput.value.trim().length === 0;
}

function openSettings(): void {
  clearSettingsError();
  editingFactId = null;
  settingsDialog.showModal();
  settingsButton.classList.add('is-active');
  refreshFacts().catch((error: unknown) => showSettingsError(describeUnknownError(error)));
}

settingsButton.addEventListener('click', openSettings);
closeSettingsButton.addEventListener('click', () => settingsDialog.close());
settingsCloseIcon.addEventListener('click', () => settingsDialog.close());
settingsDialog.addEventListener('close', () => {
  editingFactId = null;
  settingsButton.classList.remove('is-active');
});

newFactInput.addEventListener('input', updateAddFactButton);

addFactForm.addEventListener('submit', (event: SubmitEvent) => {
  event.preventDefault();
  const text = newFactInput.value.trim();
  if (text.length === 0) return;
  runFactAction(
    window.relay.memory.add(text).then(() => {
      newFactInput.value = '';
      updateAddFactButton();
    }),
  );
});
