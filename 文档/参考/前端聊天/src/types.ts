export type Role = 'user' | 'assistant';

export interface ToolCall {
  id: string;
  name: string;
  status: 'running' | 'success' | 'error';
  input: string; // JSON string or text representing input
  output?: string; // JSON string or text representing output
  duration?: number; // ms
  error?: string;
}

export interface MessageData {
  id: string;
  role: Role;
  content: string;
  timestamp: string;
  thinking?: string;
  toolCalls?: ToolCall[];
  images?: string[];
}

export interface Session {
  id: string;
  title: string;
  date: string; // ISO or 'today', 'yesterday', etc. for grouping
  messages: MessageData[];
}
