const messagesEl = document.getElementById('messages') as HTMLElement;
const formEl = document.getElementById('chat-form') as HTMLFormElement;
const inputEl = document.getElementById('chat-input') as HTMLTextAreaElement;
const sendButtonEl = document.getElementById('send-button') as HTMLButtonElement;

type DisplayRole = 'user' | 'assistant' | 'tool-call' | 'tool-result' | 'tool-error';

const conversation: RelayChatMessage[] = [];

let currentRequestId: string | null = null;
let currentSegmentBubble: HTMLElement | null = null;
let currentSegmentText = '';

function appendMessage(role: DisplayRole, text: string): HTMLElement {
  const bubble = document.createElement('div');
  bubble.className = `message message-${role}`;
  bubble.textContent = text;
  messagesEl.appendChild(bubble);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return bubble;
}

/** Sluit het huidige streaming-segment af (en verwijdert een leeg gebleven bubbel, bv. vóór een tool-aanroep). */
function finishCurrentSegment(): void {
  if (currentSegmentBubble !== null && currentSegmentText.length === 0) {
    currentSegmentBubble.remove();
  }
  currentSegmentBubble = null;
  currentSegmentText = '';
}

function setFormDisabled(disabled: boolean): void {
  inputEl.disabled = disabled;
  sendButtonEl.disabled = disabled;
}

function handleSubmit(event: SubmitEvent): void {
  event.preventDefault();

  const text = inputEl.value.trim();
  if (text.length === 0 || currentRequestId !== null) return;

  conversation.push({ role: 'user', content: text });
  appendMessage('user', text);
  inputEl.value = '';
  setFormDisabled(true);

  currentSegmentBubble = null;
  currentSegmentText = '';
  currentRequestId = window.relay.sendMessage(conversation);
}

formEl.addEventListener('submit', handleSubmit);

inputEl.addEventListener('keydown', (event: KeyboardEvent) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    formEl.requestSubmit();
  }
});

window.relay.onChunk((payload) => {
  if (payload.requestId !== currentRequestId) return;
  if (currentSegmentBubble === null) {
    currentSegmentBubble = appendMessage('assistant', '');
  }
  currentSegmentText += payload.token;
  currentSegmentBubble.textContent = currentSegmentText;
  messagesEl.scrollTop = messagesEl.scrollHeight;
});

window.relay.onToolCall((payload) => {
  if (payload.requestId !== currentRequestId) return;
  finishCurrentSegment();
  appendMessage('tool-call', payload.label);
});

window.relay.onToolResult((payload) => {
  if (payload.requestId !== currentRequestId) return;
  finishCurrentSegment();
  appendMessage(payload.ok ? 'tool-result' : 'tool-error', payload.summary);
});

window.relay.onDone((payload) => {
  if (payload.requestId !== currentRequestId) return;
  finishCurrentSegment();
  conversation.push(...payload.appended);
  currentRequestId = null;
  setFormDisabled(false);
  inputEl.focus();
});

window.relay.onError((payload) => {
  if (payload.requestId !== currentRequestId) return;
  if (currentSegmentBubble === null) {
    currentSegmentBubble = appendMessage('assistant', '');
  }
  currentSegmentBubble.textContent = `Fout: ${payload.message}`;
  currentSegmentBubble.classList.add('message-error');
  currentSegmentBubble = null;
  currentSegmentText = '';
  currentRequestId = null;
  setFormDisabled(false);
});
