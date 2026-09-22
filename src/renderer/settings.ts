const settingsButton = document.getElementById('settings-button') as HTMLButtonElement;
const settingsDialog = document.getElementById('settings-dialog') as HTMLDialogElement;
const closeSettingsButton = document.getElementById('close-settings-button') as HTMLButtonElement;
const settingsErrorEl = document.getElementById('settings-error') as HTMLElement;
const factsListEl = document.getElementById('facts-list') as HTMLUListElement;
const addFactForm = document.getElementById('add-fact-form') as HTMLFormElement;
const newFactInput = document.getElementById('new-fact-input') as HTMLInputElement;

function showSettingsError(message: string): void {
  settingsErrorEl.textContent = message;
  settingsErrorEl.hidden = false;
}

function clearSettingsError(): void {
  settingsErrorEl.hidden = true;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'Onbekende fout';
}

async function refreshFacts(): Promise<void> {
  try {
    const facts = await window.relay.memory.list();
    factsListEl.textContent = '';

    if (facts.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'facts-empty';
      empty.textContent = 'Nog geen feiten opgeslagen.';
      factsListEl.appendChild(empty);
      return;
    }

    for (const fact of facts) {
      factsListEl.appendChild(renderFactRow(fact));
    }
  } catch (error) {
    showSettingsError(describeError(error));
  }
}

function renderFactRow(fact: RelayMemoryFact): HTMLElement {
  const row = document.createElement('li');
  row.className = 'fact-row';

  const textEl = document.createElement('span');
  textEl.className = 'fact-text';
  textEl.textContent = fact.text;
  row.appendChild(textEl);

  if (fact.source === 'model') {
    const badge = document.createElement('span');
    badge.className = 'fact-badge';
    badge.textContent = 'door Relay onthouden';
    row.appendChild(badge);
  }

  const editButton = document.createElement('button');
  editButton.type = 'button';
  editButton.textContent = 'Bewerk';
  editButton.addEventListener('click', () => startEdit(row, fact));
  row.appendChild(editButton);

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.textContent = 'Verwijder';
  deleteButton.addEventListener('click', () => {
    clearSettingsError();
    window.relay.memory
      .remove(fact.id)
      .then(refreshFacts)
      .catch((error: unknown) => showSettingsError(describeError(error)));
  });
  row.appendChild(deleteButton);

  return row;
}

function startEdit(row: HTMLElement, fact: RelayMemoryFact): void {
  row.textContent = '';

  const input = document.createElement('input');
  input.type = 'text';
  input.value = fact.text;
  input.maxLength = 500;
  row.appendChild(input);

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.textContent = 'Opslaan';
  saveButton.addEventListener('click', () => {
    const newText = input.value.trim();
    if (newText.length === 0) return;
    clearSettingsError();
    window.relay.memory
      .update(fact.id, newText)
      .then(refreshFacts)
      .catch((error: unknown) => showSettingsError(describeError(error)));
  });
  row.appendChild(saveButton);

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.textContent = 'Annuleer';
  cancelButton.addEventListener('click', () => {
    void refreshFacts();
  });
  row.appendChild(cancelButton);

  input.focus();
}

settingsButton.addEventListener('click', () => {
  clearSettingsError();
  settingsDialog.showModal();
  void refreshFacts();
});

closeSettingsButton.addEventListener('click', () => {
  settingsDialog.close();
});

addFactForm.addEventListener('submit', (event: SubmitEvent) => {
  event.preventDefault();
  const text = newFactInput.value.trim();
  if (text.length === 0) return;

  clearSettingsError();
  window.relay.memory
    .add(text)
    .then(() => {
      newFactInput.value = '';
      return refreshFacts();
    })
    .catch((error: unknown) => showSettingsError(describeError(error)));
});
