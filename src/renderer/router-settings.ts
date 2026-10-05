const allowMaxInputEl = document.getElementById('allow-max-input') as HTMLInputElement;
const routerRolesEl = document.getElementById('router-roles') as HTMLElement;

const ROLE_LABELS: Record<RelayRouterSettings['roles'][number]['role'], string> = {
  fast: 'Snel / beeld',
  reasoning: 'Redeneren',
  max: 'Max',
  background: 'Achtergrond',
  embedding: 'Documenten',
};

const ROLE_HINTS: Record<RelayRouterSettings['roles'][number]['role'], string> = {
  fast: 'Gewone vragen en afbeeldingen',
  reasoning: 'Code, redeneren en onderzoek',
  max: 'Alleen als hierboven toegestaan',
  background: 'Vragen indelen en titels maken',
  embedding: 'Documenten doorzoekbaar maken',
};

function buildRoleRow(role: RelayRouterSettings['roles'][number]): HTMLElement {
  const missing = role.model === null;
  const note = missing ? `${role.configured} ontbreekt — ollama pull ${role.configured}` : role.fallback ? `vervangt ${role.configured}` : '';
  return h('div', { class: 'role-row', title: ROLE_HINTS[role.role] }, [
    h('span', { class: 'role-name', text: ROLE_LABELS[role.role] }),
    h('span', { class: `role-model${missing ? ' is-missing' : ''}`, text: role.model ?? 'geen model' }),
    note ? h('span', { class: `role-note${missing ? ' is-warning' : ''}`, text: note }) : null,
  ]);
}

function renderRouterSettings(info: RelayRouterSettings): void {
  allowMaxInputEl.checked = info.allowMax;
  routerRolesEl.textContent = '';
  if (info.roles.length === 0) {
    routerRolesEl.appendChild(h('div', { class: 'facts-empty', text: 'Ollama is niet bereikbaar, dus de modellen per rol zijn nu onbekend.' }));
    return;
  }
  for (const role of info.roles) routerRolesEl.appendChild(buildRoleRow(role));
}

async function refreshRouterSettings(): Promise<void> {
  renderRouterSettings(await window.relay.router.settings());
}

allowMaxInputEl.addEventListener('change', () => {
  clearSettingsError();
  const wanted = allowMaxInputEl.checked;
  window.relay.router
    .setAllowMax(wanted)
    .then(renderRouterSettings)
    .catch((error: unknown) => {
      allowMaxInputEl.checked = !wanted;
      showSettingsError(describeUnknownError(error));
    });
});
