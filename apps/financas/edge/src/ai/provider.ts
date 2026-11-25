import { GoogleGenAI } from "@google/genai";
import type { AIProviderConfig } from "@financas/shared";

export interface AIGenerateRequest {
  systemInstruction: string;
  prompt: string;
  expectJson?: boolean;
}

export interface AITokenUsage {
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimated?: boolean;
}

export interface AIGenerateResponse {
  text: string;
  provider: string;
  model: string;
  usage?: AITokenUsage;
}

function estimateTokensFromChars(text: string): number {
  const len = (text || "").trim().length;
  return len > 0 ? Math.max(1, Math.ceil(len / 4)) : 0;
}

function normalizeTokenUsage(
  promptTokens: unknown,
  outputTokens: unknown,
  totalTokens: unknown,
  fallbackPrompt: string,
  fallbackOutput: string
): AITokenUsage {
  const p = typeof promptTokens === "number" && Number.isFinite(promptTokens) && promptTokens >= 0 ? Math.round(promptTokens) : null;
  const o = typeof outputTokens === "number" && Number.isFinite(outputTokens) && outputTokens >= 0 ? Math.round(outputTokens) : null;
  const t = typeof totalTokens === "number" && Number.isFinite(totalTokens) && totalTokens >= 0 ? Math.round(totalTokens) : null;

  if (p !== null || o !== null || t !== null) {
    const resolvedPrompt = p ?? (t !== null && o !== null ? Math.max(0, t - o) : estimateTokensFromChars(fallbackPrompt));
    const resolvedOutput = o ?? (t !== null && p !== null ? Math.max(0, t - p) : estimateTokensFromChars(fallbackOutput));
    const resolvedTotal = t ?? resolvedPrompt + resolvedOutput;
    return {
      promptTokens: resolvedPrompt,
      outputTokens: resolvedOutput,
      totalTokens: resolvedTotal,
      estimated: false,
    };
  }

  const estPrompt = estimateTokensFromChars(fallbackPrompt);
  const estOutput = estimateTokensFromChars(fallbackOutput);
  return {
    promptTokens: estPrompt,
    outputTokens: estOutput,
    totalTokens: estPrompt + estOutput,
    estimated: true,
  };
}

export interface AIProvider {
  readonly providerName: string;
  readonly modelName: string;
  generateText(request: AIGenerateRequest): Promise<AIGenerateResponse>;
  testConnection(): Promise<{ ok: boolean; provider: string; model: string; message: string }>;
}

export function isVertexExpressApiKey(apiKey: string): boolean {
  return apiKey.trim().startsWith("AQ.");
}

export function formatGeminiError(err: unknown, isVertexExpress: boolean, model: string): string {
  const raw = err instanceof Error ? err.message : String(err);

  // Extract readable Google API error message if embedded as JSON
  const jsonStart = raw.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart)) as {
        error?: { code?: number; status?: string; message?: string };
      };
      if (parsed?.error?.message) {
        const code = parsed.error.code ? `HTTP ${parsed.error.code} ` : "";
        const hint =
          isVertexExpress && parsed.error.code === 404
            ? ` (Dica: sua chave do Google Cloud usa Vertex AI Express Mode — tente o modelo "gemini-3.5-flash-lite" em vez de "${model}".)`
            : "";
        return `${code}${parsed.error.message}${hint}`;
      }
    } catch {
      // Fall through to raw string
    }
  }

  if (raw.includes("403") && isVertexExpress) {
    return "HTTP 403: chave Vertex AI Express Mode sem permissão para este modelo/endpoint.";
  }

  return raw;
}

export class GeminiAIProvider implements AIProvider {
  readonly providerName: string;
  readonly modelName: string;
  readonly isVertexExpress: boolean;
  private readonly client: GoogleGenAI;

  constructor(apiKey: string, model = "gemini-4-hydrogen") {
    const trimmedKey = apiKey.trim();
    this.isVertexExpress = isVertexExpressApiKey(trimmedKey);
    this.providerName = this.isVertexExpress ? "gemini-vertex-express" : "gemini";
    this.modelName = model;
    this.client = this.isVertexExpress
      ? new GoogleGenAI({ vertexai: true, apiKey: trimmedKey })
      : new GoogleGenAI({ apiKey: trimmedKey });
  }

  async generateText(request: AIGenerateRequest): Promise<AIGenerateResponse> {
    if (this.isVertexExpress) {
      const response = await this.client.models.generateContent({
        model: this.modelName,
        contents: request.prompt,
        config: {
          systemInstruction: request.systemInstruction,
          ...(request.expectJson ? { responseMimeType: "application/json" } : {}),
        },
      });

      const outText = response.text || "";
      const meta = (
        response as {
          usageMetadata?: {
            promptTokenCount?: number;
            candidatesTokenCount?: number;
            totalTokenCount?: number;
          };
        }
      ).usageMetadata;

      return {
        text: outText,
        provider: this.providerName,
        model: this.modelName,
        usage: normalizeTokenUsage(
          meta?.promptTokenCount,
          meta?.candidatesTokenCount,
          meta?.totalTokenCount,
          `${request.systemInstruction}\n${request.prompt}`,
          outText
        ),
      };
    }

    const interaction = await this.client.interactions.create({
      model: this.modelName,
      system_instruction: request.systemInstruction,
      input: request.prompt,
      store: false,
    });

    const outputText =
      (interaction as { output_text?: string | null }).output_text ??
      extractTextFromInteraction(interaction);
    const usageRaw = (
      interaction as {
        usage?: {
          total_input_tokens?: number;
          total_output_tokens?: number;
          total_tokens?: number;
          input_tokens?: number;
          output_tokens?: number;
        };
      }
    ).usage;

    return {
      text: outputText || "",
      provider: this.providerName,
      model: this.modelName,
      usage: normalizeTokenUsage(
        usageRaw?.total_input_tokens ?? usageRaw?.input_tokens,
        usageRaw?.total_output_tokens ?? usageRaw?.output_tokens,
        usageRaw?.total_tokens,
        `${request.systemInstruction}\n${request.prompt}`,
        outputText || ""
      ),
    };
  }

  async testConnection() {
    try {
      const res = await this.generateText({
        systemInstruction: "Responda apenas com OK.",
        prompt: "Teste de conexão.",
      });
      return {
        ok: Boolean(res.text),
        provider: this.providerName,
        model: this.modelName,
        message: this.isVertexExpress
          ? `Conectado ao Vertex AI Express (${this.modelName}).`
          : `Conectado ao Gemini (${this.modelName}).`,
      };
    } catch (err) {
      return {
        ok: false,
        provider: this.providerName,
        model: this.modelName,
        message: formatGeminiError(err, this.isVertexExpress, this.modelName),
      };
    }
  }
}

function extractTextFromInteraction(interaction: unknown): string {
  if (!interaction || typeof interaction !== "object") return "";
  const outputs = (interaction as { outputs?: Array<{ type?: string; text?: string }> }).outputs;
  if (!Array.isArray(outputs)) return "";
  return outputs
    .filter((part) => typeof part?.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

export class OllamaAIProvider implements AIProvider {
  readonly providerName = "ollama";
  readonly modelName: string;
  private readonly baseUrl: string;

  constructor(baseUrl: string, model = "llama3.1") {
    this.baseUrl = (baseUrl || "http://host.docker.internal:11434").replace(/\/+$/, "");
    this.modelName = model;
  }

  async generateText(request: AIGenerateRequest): Promise<AIGenerateResponse> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.modelName,
        stream: false,
        format: request.expectJson ? "json" : undefined,
        messages: [
          { role: "system", content: request.systemInstruction },
          { role: "user", content: request.prompt },
        ],
      }),
    });

    if (!res.ok) {
      throw new Error(`Ollama respondeu HTTP ${res.status}`);
    }

    const data = (await res.json()) as {
      message?: { content?: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };
    const outText = data.message?.content || "";
    return {
      text: outText,
      provider: this.providerName,
      model: this.modelName,
      usage: normalizeTokenUsage(
        data.prompt_eval_count,
        data.eval_count,
        undefined,
        `${request.systemInstruction}\n${request.prompt}`,
        outText
      ),
    };
  }

  async testConnection() {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return {
        ok: true,
        provider: this.providerName,
        model: this.modelName,
        message: `Conectado ao Ollama local em ${this.baseUrl}.`,
      };
    } catch (err) {
      return {
        ok: false,
        provider: this.providerName,
        model: this.modelName,
        message: err instanceof Error ? err.message : "Ollama inacessível.",
      };
    }
  }
}

export class OpenAICompatibleAIProvider implements AIProvider {
  readonly providerName = "openai_compatible";
  readonly modelName: string;
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly apiKey: string | undefined,
    model = "gpt-4o-mini"
  ) {
    this.baseUrl = (baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
    this.modelName = model;
  }

  async generateText(request: AIGenerateRequest): Promise<AIGenerateResponse> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: this.modelName,
        messages: [
          { role: "system", content: request.systemInstruction },
          { role: "user", content: request.prompt },
        ],
      }),
    });

    if (!res.ok) {
      throw new Error(`Provedor OpenAI-compatible respondeu HTTP ${res.status}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };
    const outText = data.choices?.[0]?.message?.content || "";
    return {
      text: outText,
      provider: this.providerName,
      model: this.modelName,
      usage: normalizeTokenUsage(
        data.usage?.prompt_tokens,
        data.usage?.completion_tokens,
        data.usage?.total_tokens,
        `${request.systemInstruction}\n${request.prompt}`,
        outText
      ),
    };
  }

  async testConnection() {
    try {
      const res = await this.generateText({
        systemInstruction: "Responda apenas OK.",
        prompt: "Teste de conexão.",
      });
      return {
        ok: Boolean(res.text),
        provider: this.providerName,
        model: this.modelName,
        message: `Conectado a ${this.baseUrl} (${this.modelName}).`,
      };
    } catch (err) {
      return {
        ok: false,
        provider: this.providerName,
        model: this.modelName,
        message: err instanceof Error ? err.message : "Falha na conexão.",
      };
    }
  }
}

export function createAIProvider(config: AIProviderConfig): AIProvider {
  if (config.provider === "ollama") {
    return new OllamaAIProvider(config.baseUrl || "http://host.docker.internal:11434", config.model);
  }
  if (config.provider === "openai_compatible") {
    return new OpenAICompatibleAIProvider(
      config.baseUrl || "https://api.openai.com/v1",
      config.apiKey,
      config.model
    );
  }
  if (!config.apiKey) {
    throw new Error(
      "API Key do Gemini não configurada. Configure na aba Configurações (salva apenas localmente)."
    );
  }
  return new GeminiAIProvider(config.apiKey, config.model || "gemini-3.5-flash-lite");
}

export function parseJsonFromAIResponse<T>(rawText: string): T {
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  return JSON.parse(cleaned) as T;
}
