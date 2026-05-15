import type { MessageData, Session, ToolCall } from '../types';

const env = (import.meta as unknown as { env?: { DEV?: boolean; VITE_OPENCODE_BASE_URL?: string } }).env;
const baseUrl = env?.DEV ? '/api' : (env?.VITE_OPENCODE_BASE_URL ?? 'http://localhost:40082');

type ApiSession = {
  id: string;
  title: string;
  time: {
    updated: number;
    created: number;
  };
};

type ApiMessage = {
  info: {
    id: string;
    role: 'user' | 'assistant';
    time: {
      created: number;
    };
  };
  parts: ApiPart[];
};

type ApiPart =
  | {
      id: string;
      type: 'text';
      text: string;
    }
  | {
      id: string;
      type: 'reasoning';
      text: string;
    }
  | {
      id: string;
      type: 'file';
      mime: string;
      url: string;
    }
  | {
      id: string;
      type: 'tool';
      tool: string;
      state:
        | { status: 'pending' | 'running'; input?: unknown; time?: { start: number } }
        | { status: 'completed'; input?: unknown; output: string; time: { start: number; end: number } }
        | { status: 'error'; input?: unknown; error: string; time: { start: number; end: number } };
    }
  | {
      id: string;
      type: string;
      [key: string]: unknown;
    };

export type ApiEvent = {
  type: string;
  properties?: {
    sessionID?: string;
    status?: {
      type?: string;
    };
    [key: string]: unknown;
  };
};

type GlobalEventFrame = {
  directory?: string;
  project?: string;
  workspace?: string;
  payload: ApiEvent;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`${response.status} ${response.statusText}${text ? `: ${text}` : ''}`);
  }

  return response.json() as Promise<T>;
}

function timeLabel(value?: number) {
  if (!value) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function stringify(value: unknown) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return String(value);
  }
}

function mapTool(part: Extract<ApiPart, { type: 'tool' }>): ToolCall {
  const state = part.state;
  const status = state.status === 'completed' ? 'success' : state.status === 'error' ? 'error' : 'running';
  const time = state.time as { start?: number; end?: number } | undefined;
  const start = time?.start;
  const end = time?.end;

  return {
    id: part.id,
    name: part.tool,
    status,
    input: stringify('input' in state ? state.input : {}),
    output: state.status === 'completed' ? state.output : undefined,
    error: state.status === 'error' ? state.error : undefined,
    duration: start && end ? end - start : undefined,
  };
}

export function mapSession(info: ApiSession, messages: MessageData[] = []): Session {
  return {
    id: info.id,
    title: info.title || '新会话',
    date: timeLabel(info.time.updated),
    messages,
  };
}

export function mapMessage(input: ApiMessage): MessageData {
  const text = input.parts
    .filter((part): part is Extract<ApiPart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim();
  const reasoning = input.parts
    .filter((part): part is Extract<ApiPart, { type: 'reasoning' }> => part.type === 'reasoning')
    .map((part) => part.text)
    .join('\n')
    .trim();
  const images = input.parts
    .filter((part): part is Extract<ApiPart, { type: 'file' }> =>
      part.type === 'file' && typeof part.mime === 'string' && part.mime.startsWith('image/') && 'url' in part
    )
    .map((part) => part.url);
  const toolCalls = input.parts
    .filter((part): part is Extract<ApiPart, { type: 'tool' }> => part.type === 'tool')
    .map(mapTool);

  return {
    id: input.info.id,
    role: input.info.role,
    content: text,
    timestamp: timeLabel(input.info.time.created),
    thinking: reasoning || undefined,
    toolCalls: toolCalls.length ? toolCalls : undefined,
    images: images.length ? images : undefined,
  };
}

export async function listSessions() {
  const sessions = await request<ApiSession[]>('/session?limit=50');
  return sessions.map((session) => mapSession(session));
}

export async function createSession() {
  const session = await request<ApiSession>('/session', {
    method: 'POST',
    body: JSON.stringify({ title: '' }),
  });
  return mapSession(session);
}

export async function listMessages(sessionID: string) {
  const messages = await request<ApiMessage[]>(`/session/${encodeURIComponent(sessionID)}/message?limit=100`);
  return messages.map(mapMessage);
}

export async function sendPrompt(sessionID: string, content: string, images: string[]) {
  await request(`/session/${encodeURIComponent(sessionID)}/message`, {
    method: 'POST',
    body: JSON.stringify({
      parts: [
        ...images.map((url, index) => ({
          type: 'file',
          url,
          filename: `image-${index + 1}.png`,
          mime: 'image/png',
        })),
        ...(content ? [{ type: 'text', text: content }] : []),
      ],
    }),
  });
}

export async function subscribeEvents(onEvent: (event: ApiEvent) => void) {
  const source = new EventSource(`${baseUrl}/global/event`);

  source.onmessage = (message) => {
    try {
      const frame = JSON.parse(message.data) as GlobalEventFrame | ApiEvent;
      onEvent('payload' in frame ? frame.payload : frame);
    } catch {
      // Ignore malformed SSE frames.
    }
  };

  return () => source.close();
}
