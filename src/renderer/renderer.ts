const messagesEl = document.getElementById('messages') as HTMLElement;
const formEl = document.getElementById('chat-form') as HTMLFormElement;
const inputEl = document.getElementById('chat-input') as HTMLTextAreaElement;
const sendButtonEl = document.getElementById('send-button') as HTMLButtonElement;

const conversation: RelayChatMessage[] = [];

let currentRequestId: string | null = null;
let currentAssistantBubble: HTMLElement | null = null;
let currentAssistantText = '';

function appendMessage(role: 'user' | 'assistant', text: string): HTMLElement {
  const bubble = document.createElement('div');
  bubble.className = `message message-${role}`;
  bubble.textContent = text;
  messagesEl.appendChild(bubble);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return bubble;
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

  currentAssistantText = '';
  currentAssistantBubble = appendMessage('assistant', '');
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
  if (payload.requestId !== currentRequestId || currentAssistantBubble === null) return;
  currentAssistantText += payload.token;
  currentAssistantBubble.textContent = currentAssistantText;
  messagesEl.scrollTop = messagesEl.scrollHeight;
});

window.relay.onDone((payload) => {
  if (payload.requestId !== currentRequestId) return;
  conversation.push({ role: 'assistant', content: currentAssistantText });
  currentRequestId = null;
  currentAssistantBubble = null;
  setFormDisabled(false);
  inputEl.focus();
});

window.relay.onError((payload) => {
  if (payload.requestId !== currentRequestId) return;
  if (currentAssistantBubble !== null) {
    currentAssistantBubble.textContent = `Fout: ${payload.message}`;
    currentAssistantBubble.classList.add('message-error');
  }
  currentRequestId = null;
  currentAssistantBubble = null;
  setFormDisabled(false);
});
