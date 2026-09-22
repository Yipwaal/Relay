export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChunkPayload {
  requestId: string;
  token: string;
}

export interface DonePayload {
  requestId: string;
}

export interface ErrorPayload {
  requestId: string;
  message: string;
}
