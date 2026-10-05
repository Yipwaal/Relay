const messagesScrollEl = document.getElementById('messages-scroll') as HTMLElement;
const messagesEl = document.getElementById('messages') as HTMLElement;

const RELAY_ICON_SRC = '../../assets/icon.png';

const TOOL_KIND_LABELS: Record<string, string> = {
  search_documents: 'Documenten doorzoeken',
  web_search: 'Zoeken op het web',
  web_fetch: 'Pagina ophalen',
  remember: 'Geheugen bijwerken',
};

const TOOL_COMPACT_VERBS: Record<string, string> = {
  search_documents: 'Zoekt in documenten naar',
  web_search: 'Zoekt op het web naar',
  web_fetch: 'Haalt op:',
  remember: 'Onthoudt',
};

/** remember levert één regel op — daar is de volle kaart te groot voor (zie compactStyle in het design). */
const COMPACT_TOOLS = new Set(['remember']);

/**
 * Externe inhoud (web, pagina's, documenten) staat standaard opengeklapt:
 * CLAUDE.md eist dat de gebruiker ziet wat een tool opleverde vóórdat het
 * model erop verdergaat, en daar zit het prompt-injection-risico.
 */
const AUTO_OPEN_TOOLS = new Set(['web_search', 'web_fetch', 'search_documents']);

const renderedElements = new WeakMap<DisplayMessage, HTMLElement>();

type ToolMessage = Extract<DisplayMessage, { kind: 'tool' }>;

function toolStatusText(m: ToolMessage): string {
  if (m.status === 'running') return 'Bezig…';
  if (m.status === 'error') {
    const prefix = m.summary.split(':')[0]?.trim();
    return prefix && prefix.length <= 14 ? prefix : 'Mislukt';
  }
  return m.durationMs > 0 ? `${m.summary} · ${formatSeconds(m.durationMs)}` : m.summary;
}

function toolErrorText(m: ToolMessage): string {
  const colon = m.summary.indexOf(':');
  return colon >= 0 ? m.summary.slice(colon + 1).trim() : m.summary;
}

function quoted(text: string): string {
  return `“${text}”`;
}

function buildToolCard(m: ToolMessage): HTMLElement {
  const hasPreview = m.status === 'done' && (m.items.length > 0 || m.preview.length > 0);
  const card = h('div', { class: `tool-card is-${m.status}${m.open && hasPreview ? ' is-open' : ''}${m.superseded ? ' is-superseded' : ''}`, title: m.label });

  const head = h('button', { class: 'tool-card-head', type: 'button' }, [
    h('span', { class: 'tool-glyph' }, [relayGlyph(20, true)]),
    h('div', { class: 'tool-card-text' }, [
      h('span', { class: 'tool-kind', text: TOOL_KIND_LABELS[m.tool] ?? 'Tool-aanroep' }),
      h('span', { class: 'tool-query', text: m.query ? quoted(m.query) : m.tool }),
    ]),
    h('span', { class: 'tool-status', text: toolStatusText(m) }),
    hasPreview ? h('span', { class: 'tool-chevron' }, [icon('chevron', 14, 2.4)]) : null,
  ]);
  head.disabled = !hasPreview;
  head.setAttribute('aria-expanded', String(m.open && hasPreview));
  head.addEventListener('click', () => {
    if (!hasPreview) return;
    m.open = !m.open;
    updateMessageElement(m);
  });
  card.appendChild(head);

  if (hasPreview && m.open) {
    const raw = h('details', { class: 'tool-raw' }, [
      h('summary', { text: 'Toon exact wat het model ontvangt' }),
      h('pre', { class: 'tool-raw-text', text: m.preview }),
    ]);
    card.appendChild(
      h('div', { class: 'tool-card-preview' }, [
        ...m.items.map((item) =>
          h('div', { class: 'tool-item' }, [h('span', { class: 'tool-item-src', text: item.src }), h('span', { class: 'tool-item-text', text: item.text })]),
        ),
        m.preview.length > 0 ? raw : null,
      ]),
    );
  }
  if (m.status === 'error') {
    card.appendChild(h('div', { class: 'tool-card-error', text: toolErrorText(m) }));
  }
  return card;
}

function buildToolCompact(m: ToolMessage): HTMLElement {
  const verb = TOOL_COMPACT_VERBS[m.tool] ?? 'Tool-aanroep:';
  return h('div', { class: `tool-compact is-${m.status}${m.superseded ? ' is-superseded' : ''}`, title: m.status === 'error' ? toolErrorText(m) : m.label }, [
    h('span', { class: 'tool-glyph' }, [relayGlyph(14, false)]),
    h('span', { class: 'tool-compact-text', text: `${verb} ${quoted(m.query)}` }),
    h('span', { class: 'tool-status', text: toolStatusText(m) }),
  ]);
}

/** "gpt-oss:20b · code"; leeg als het model onbekend is (bv. een foutmelding). */
function routeLabel(m: AssistantMessage): string {
  const parts = [m.model, m.route ?? ''].filter((part) => part.length > 0);
  if (parts.length === 0) return '';
  return parts.join(' · ') + (m.superseded ? ' · vervangen' : '');
}

function buildAnswerFooter(m: AssistantMessage): HTMLElement | null {
  const label = m.showRoute ? routeLabel(m) : '';
  if (!label && !m.canRetry) return null;
  let retry: HTMLButtonElement | null = null;
  if (m.canRetry) {
    retry = h('button', { class: 'retry-button', type: 'button', title: 'Stel dezelfde vraag opnieuw aan het volgende, slimmere model' }, [
      icon('up', 13, 2.4),
      h('span', { text: 'Probeer slimmer' }),
    ]);
    retry.disabled = appState.pending !== null;
    retry.addEventListener('click', retryLatest);
  }
  return h('div', { class: 'msg-footer' }, [label ? h('span', { class: 'msg-route', text: label }) : null, retry]);
}

/**
 * Het label staat onder het laatste antwoord van elke poging (bij een beurt
 * met tool-aanroepen dus niet onder elk tussenstuk), "Probeer slimmer" alleen
 * onder het huidige antwoord op de laatste vraag. Geeft de antwoorden terug
 * die opnieuw getekend moeten worden.
 */
function computeAnswerFooters(c: ConversationView): AssistantMessage[] {
  const lastOfAttempt = new Map<string, AssistantMessage>();
  let turn = 0;
  let latest: AssistantMessage | null = null;
  for (const m of c.display) {
    if (m.kind === 'user') {
      turn++;
      latest = null;
      continue;
    }
    if (m.kind !== 'assistant' || m.failed) continue;
    lastOfAttempt.set(`${turn}:${m.attempt}`, m);
    if (!m.superseded) latest = m;
  }
  const finals = new Set(lastOfAttempt.values());
  const changed: AssistantMessage[] = [];
  for (const m of c.display) {
    if (m.kind !== 'assistant') continue;
    const showRoute = finals.has(m);
    const canRetry = m === latest && !m.streaming;
    // Het antwoord met de knop altijd opnieuw tekenen: die hangt ook af van appState.pending.
    if (m.showRoute !== showRoute || m.canRetry !== canRetry || canRetry) {
      m.showRoute = showRoute;
      m.canRetry = canRetry;
      changed.push(m);
    }
  }
  return changed;
}

function refreshAnswerFooters(c: ConversationView): void {
  for (const m of computeAnswerFooters(c)) updateMessageElement(m);
}

function buildMessageElement(m: DisplayMessage): HTMLElement {
  if (m.kind === 'user') {
    return h('div', { class: 'msg-user', text: m.text });
  }
  if (m.kind === 'tool') {
    return COMPACT_TOOLS.has(m.tool) ? buildToolCompact(m) : buildToolCard(m);
  }

  const avatar = h('img', { class: 'msg-avatar' });
  avatar.src = RELAY_ICON_SRC;
  avatar.alt = '';
  const bubble = h('div', { class: `msg-bubble${m.failed ? ' is-error' : ''}`, text: m.text });
  if (m.loadingModel && m.text.length === 0) {
    bubble.appendChild(h('span', { class: 'msg-loading', text: `${m.model} wordt geladen… de eerste keer kan dat even duren.` }));
  } else if (m.streaming) {
    bubble.appendChild(h('span', { class: 'stream-cursor' }));
  }
  return h('div', { class: `msg-assistant${m.superseded ? ' is-superseded' : ''}` }, [
    h('div', { class: 'msg-assistant-head' }, [avatar, h('span', { class: 'msg-author', text: 'Relay' })]),
    bubble,
    buildAnswerFooter(m),
  ]);
}

function isNearBottom(): boolean {
  return messagesScrollEl.scrollHeight - messagesScrollEl.scrollTop - messagesScrollEl.clientHeight < 80;
}

function scrollToBottom(): void {
  messagesScrollEl.scrollTop = messagesScrollEl.scrollHeight;
}

function renderMessages(conversation: ConversationView): void {
  computeAnswerFooters(conversation);
  messagesEl.textContent = '';
  for (const m of conversation.display) {
    const element = buildMessageElement(m);
    renderedElements.set(m, element);
    messagesEl.appendChild(element);
  }
  scrollToBottom();
}

/** Voegt één bericht toe aan het actieve gesprek op het scherm (no-op als het gesprek niet zichtbaar is). */
function appendMessageElement(conversationId: number, m: DisplayMessage): void {
  if (conversationId !== appState.activeId) return;
  const follow = isNearBottom();
  const element = buildMessageElement(m);
  renderedElements.set(m, element);
  messagesEl.appendChild(element);
  if (follow) scrollToBottom();
}

function updateMessageElement(m: DisplayMessage): void {
  const current = renderedElements.get(m);
  if (!current || !current.isConnected) return;
  const follow = isNearBottom();
  const next = buildMessageElement(m);
  renderedElements.set(m, next);
  current.replaceWith(next);
  if (follow) scrollToBottom();
}

function removeMessageElement(m: DisplayMessage): void {
  renderedElements.get(m)?.remove();
}
