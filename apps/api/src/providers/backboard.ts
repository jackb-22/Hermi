import type { Config } from '../config.ts';

/** OpenAI-style function tool, as Backboard and our Gemini fallback both take it. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
}

export interface BbToolCall {
  id: string;
  type?: string;
  function: { name: string; arguments: string | Record<string, unknown> };
}

export interface BbResponse {
  status?: 'IN_PROGRESS' | 'REQUIRES_ACTION' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | null;
  content?: string | null;
  thread_id: string;
  run_id?: string | null;
  tool_calls?: BbToolCall[] | null;
}

/**
 * Backboard: one assistant per user holds long-term memory; every planner turn is sent with memory Auto and
 * Gemini as the model. Tools are executed by our server and their outputs submitted back.
 */
export interface Backboard {
  readonly name: string;
  readonly enabled: boolean;
  createAssistant(name: string, systemPrompt: string): Promise<string>;
  send(o: {
    assistantId: string;
    threadId?: string;
    content: string;
    systemPrompt: string;
    tools: ToolSpec[];
  }): Promise<BbResponse>;
  submitToolOutputs(o: {
    threadId: string;
    runId?: string | null;
    outputs: { tool_call_id: string; output: string }[];
    tools: ToolSpec[];
  }): Promise<BbResponse>;
  addMemory(
    assistantId: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<void>;
}

const openAiTools = (tools: ToolSpec[]) => tools.map((t) => ({ type: 'function', function: t }));

export class OffBackboard implements Backboard {
  readonly name = 'off';
  readonly enabled = false;
  private no(): never {
    throw new Error('Backboard is not configured');
  }
  async createAssistant(): Promise<string> {
    this.no();
  }
  async send(): Promise<BbResponse> {
    this.no();
  }
  async submitToolOutputs(): Promise<BbResponse> {
    this.no();
  }
  async addMemory(): Promise<void> {
    this.no();
  }
}

export class HttpBackboard implements Backboard {
  readonly name = 'backboard';
  readonly enabled = true;
  constructor(
    private key: string,
    private base: string,
    private model: string,
  ) {}

  private async call<T>(path: string, body: unknown): Promise<T> {
    const r = await fetch(`${this.base.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: { 'X-API-Key': this.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) throw new Error(`backboard ${path} ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return (await r.json()) as T;
  }

  async createAssistant(name: string, systemPrompt: string) {
    const r = await this.call<{ assistant_id: string }>('/assistants', {
      name,
      system_prompt: systemPrompt,
    });
    return r.assistant_id;
  }

  send(o: {
    assistantId: string;
    threadId?: string;
    content: string;
    systemPrompt: string;
    tools: ToolSpec[];
  }) {
    return this.call<BbResponse>('/threads/messages', {
      assistant_id: o.assistantId,
      thread_id: o.threadId,
      content: o.content,
      system_prompt: o.systemPrompt,
      tools: openAiTools(o.tools),
      memory: 'Auto',
      llm_provider: 'google',
      model_name: this.model,
      stream: false,
    });
  }

  submitToolOutputs(o: {
    threadId: string;
    runId?: string | null;
    outputs: { tool_call_id: string; output: string }[];
    tools: ToolSpec[];
  }) {
    return o.runId
      ? this.call<BbResponse>(`/threads/${o.threadId}/runs/${o.runId}/submit-tool-outputs`, {
          tool_outputs: o.outputs,
          tools: openAiTools(o.tools),
        })
      : this.call<BbResponse>('/threads/tool-outputs', {
          thread_id: o.threadId,
          tool_outputs: o.outputs,
        });
  }

  async addMemory(assistantId: string, content: string, metadata?: Record<string, unknown>) {
    await this.call(`/assistants/${assistantId}/memories`, { content, metadata });
  }
}

export function createBackboard(c: Config): Backboard {
  return c.BACKBOARD_API_KEY
    ? new HttpBackboard(c.BACKBOARD_API_KEY, c.BACKBOARD_BASE_URL, c.GEMINI_MODEL)
    : new OffBackboard();
}
