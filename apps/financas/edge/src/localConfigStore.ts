import fs from "node:fs";
import path from "node:path";
import type { AIProviderConfig, AIProviderType } from "@financas/shared";
import type { CryptoVault } from "@financas/shared/crypto";

export const DEFAULT_AI_CONFIG: AIProviderConfig = {
  provider: "gemini",
  model: "gemini-3.5-flash-lite",
  baseUrl: "",
};

export interface SafeAIConfigView {
  provider: AIProviderType;
  model: string;
  baseUrl: string;
  hasApiKey: boolean;
  apiKeySource: "local-settings" | "env" | "none";
  apiKeyPreview: string;
  updatedAt?: string;
}

export type AIUsageOperation = "suggest_labels" | "prioritize" | "chat" | "test";

export interface AIUsageEvent {
  timestamp: string;
  month: string; // YYYY-MM
  day: string; // YYYY-MM-DD
  operation: AIUsageOperation;
  provider: string;
  model: string;
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  estimated?: boolean;
  ok: boolean;
}

export interface AIUsageSummary {
  currentMonthKey: string;
  todayKey: string;
  currentMonth: {
    calls: number;
    okCalls: number;
    errorCalls: number;
    promptTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
    byOperation: Record<AIUsageOperation, { calls: number; totalTokens: number }>;
    byModel: Array<{
      model: string;
      provider: string;
      calls: number;
      totalTokens: number;
      estimatedCostUsd: number;
    }>;
  };
  today: {
    calls: number;
    totalTokens: number;
    estimatedCostUsd: number;
  };
  allTime: {
    calls: number;
    totalTokens: number;
    estimatedCostUsd: number;
  };
  recentEvents: AIUsageEvent[];
  recommendation: {
    level: "ok" | "tip" | "warn";
    message: string;
  };
}

export interface RailwayMonitorConfig {
  apiToken?: string;
  projectId: string;
  updatedAt?: string;
}

export interface SafeRailwayConfigView {
  hasToken: boolean;
  tokenSource: "local-settings" | "env" | "none";
  tokenPreview: string;
  projectId: string;
  updatedAt?: string;
}

/** Approximate public USD per 1M tokens (input / output) for quick cost awareness. */
export function estimateAIUsageCostUsd(
  provider: string,
  model: string,
  promptTokens: number,
  outputTokens: number
): number {
  if (provider === "ollama") return 0;
  const m = model.toLowerCase();

  let inputPer1M = 0.3;
  let outputPer1M = 1.2;

  if (m.includes("flash-lite") || m.includes("mini")) {
    inputPer1M = 0.1;
    outputPer1M = 0.4;
  } else if (m.includes("flash") || m.includes("hydrogen")) {
    inputPer1M = 0.3;
    outputPer1M = 1.2;
  } else if (m.includes("pro") || m.includes("argon") || m.includes("neon")) {
    inputPer1M = 1.25;
    outputPer1M = 5.0;
  }

  const usd = (promptTokens / 1_000_000) * inputPer1M + (outputTokens / 1_000_000) * outputPer1M;
  return Math.round(usd * 100000) / 100000;
}

export class LocalConfigStore {
  private readonly filePath: string;
  private readonly usageFilePath: string;
  private readonly railwayFilePath: string;

  constructor(
    private readonly configDir: string,
    private readonly vault: CryptoVault
  ) {
    this.filePath = path.join(configDir, "ai-config.enc");
    this.usageFilePath = path.join(configDir, "ai-usage.enc");
    this.railwayFilePath = path.join(configDir, "railway-config.enc");
  }

  private readStoredRaw(): Partial<AIProviderConfig> {
    if (!fs.existsSync(this.filePath)) {
      return {};
    }
    try {
      const encrypted = fs.readFileSync(this.filePath, "utf8").trim();
      if (!encrypted) return {};
      return this.vault.decryptJson<Partial<AIProviderConfig>>(encrypted);
    } catch {
      return {};
    }
  }

  getResolvedConfig(): AIProviderConfig & { apiKeySource: "local-settings" | "env" | "none" } {
    const stored = this.readStoredRaw();
    const provider: AIProviderType =
      stored.provider === "ollama" || stored.provider === "openai_compatible"
        ? stored.provider
        : "gemini";

    const defaultModel =
      provider === "ollama"
        ? "llama3.1"
        : provider === "openai_compatible"
          ? "gpt-4o-mini"
          : DEFAULT_AI_CONFIG.model;

    const storedKey = stored.apiKey?.trim() || "";
    const envKey = provider === "gemini" ? process.env.GEMINI_API_KEY?.trim() || "" : "";

    const apiKey = storedKey || envKey || undefined;
    const apiKeySource = storedKey ? "local-settings" : envKey ? "env" : "none";

    return {
      provider,
      model: stored.model?.trim() || defaultModel,
      baseUrl: stored.baseUrl?.trim() || (provider === "ollama" ? "http://host.docker.internal:11434" : ""),
      apiKey,
      updatedAt: stored.updatedAt,
      apiKeySource,
    };
  }

  getSafeConfig(): SafeAIConfigView {
    const resolved = this.getResolvedConfig();
    const key = resolved.apiKey || "";
    const apiKeyPreview =
      key.length > 8 ? `${key.slice(0, 4)}…${key.slice(-4)}` : key ? "••••" : "";

    return {
      provider: resolved.provider,
      model: resolved.model,
      baseUrl: resolved.baseUrl || "",
      hasApiKey: Boolean(key),
      apiKeySource: resolved.apiKeySource,
      apiKeyPreview,
      updatedAt: resolved.updatedAt,
    };
  }

  saveConfig(patch: Partial<AIProviderConfig> & { clearApiKey?: boolean }): SafeAIConfigView {
    const current = this.readStoredRaw();

    const nextProvider: AIProviderType =
      patch.provider === "gemini" ||
      patch.provider === "ollama" ||
      patch.provider === "openai_compatible"
        ? patch.provider
        : current.provider || "gemini";

    let nextApiKey = current.apiKey;
    if (patch.clearApiKey) {
      nextApiKey = undefined;
    } else if (typeof patch.apiKey === "string" && patch.apiKey.trim()) {
      nextApiKey = patch.apiKey.trim();
    }

    const nextConfig: AIProviderConfig = {
      provider: nextProvider,
      model:
        typeof patch.model === "string" && patch.model.trim()
          ? patch.model.trim()
          : current.model || DEFAULT_AI_CONFIG.model,
      baseUrl:
        typeof patch.baseUrl === "string" ? patch.baseUrl.trim() : current.baseUrl || "",
      apiKey: nextApiKey,
      updatedAt: new Date().toISOString(),
    };

    fs.mkdirSync(this.configDir, { recursive: true });
    const encrypted = this.vault.encryptJson(nextConfig);
    fs.writeFileSync(this.filePath, `${encrypted}\n`, { encoding: "utf8", mode: 0o600 });

    return this.getSafeConfig();
  }

  private readAIUsageEvents(): AIUsageEvent[] {
    if (!fs.existsSync(this.usageFilePath)) return [];
    try {
      const encrypted = fs.readFileSync(this.usageFilePath, "utf8").trim();
      if (!encrypted) return [];
      const parsed = this.vault.decryptJson<{ events?: AIUsageEvent[] }>(encrypted);
      return Array.isArray(parsed.events) ? parsed.events : [];
    } catch {
      return [];
    }
  }

  private writeAIUsageEvents(events: AIUsageEvent[]): void {
    fs.mkdirSync(this.configDir, { recursive: true });
    const trimmed = events.slice(-500);
    const encrypted = this.vault.encryptJson({ events: trimmed });
    fs.writeFileSync(this.usageFilePath, `${encrypted}\n`, { encoding: "utf8", mode: 0o600 });
  }

  recordAIUsage(input: {
    operation: AIUsageOperation;
    provider: string;
    model: string;
    promptTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimated?: boolean;
    ok: boolean;
  }): AIUsageEvent {
    const now = new Date();
    const iso = now.toISOString();
    const event: AIUsageEvent = {
      timestamp: iso,
      month: iso.slice(0, 7),
      day: iso.slice(0, 10),
      operation: input.operation,
      provider: input.provider,
      model: input.model,
      promptTokens: Math.max(0, Math.round(input.promptTokens || 0)),
      outputTokens: Math.max(0, Math.round(input.outputTokens || 0)),
      totalTokens: Math.max(0, Math.round(input.totalTokens || 0)),
      estimatedCostUsd: estimateAIUsageCostUsd(
        input.provider,
        input.model,
        Math.max(0, input.promptTokens || 0),
        Math.max(0, input.outputTokens || 0)
      ),
      estimated: input.estimated,
      ok: input.ok,
    };

    const events = this.readAIUsageEvents();
    events.push(event);
    this.writeAIUsageEvents(events);
    return event;
  }

  clearAIUsage(): void {
    this.writeAIUsageEvents([]);
  }

  getAIUsageSummary(): AIUsageSummary {
    const events = this.readAIUsageEvents();
    const nowIso = new Date().toISOString();
    const currentMonthKey = nowIso.slice(0, 7);
    const todayKey = nowIso.slice(0, 10);

    const byOperation: Record<AIUsageOperation, { calls: number; totalTokens: number }> = {
      suggest_labels: { calls: 0, totalTokens: 0 },
      prioritize: { calls: 0, totalTokens: 0 },
      chat: { calls: 0, totalTokens: 0 },
      test: { calls: 0, totalTokens: 0 },
    };
    const byModelMap = new Map<
      string,
      { model: string; provider: string; calls: number; totalTokens: number; estimatedCostUsd: number }
    >();

    let monthCalls = 0;
    let monthOkCalls = 0;
    let monthErrorCalls = 0;
    let monthPrompt = 0;
    let monthOutput = 0;
    let monthTotal = 0;
    let monthCost = 0;

    let todayCalls = 0;
    let todayTotal = 0;
    let todayCost = 0;

    let allCalls = 0;
    let allTotal = 0;
    let allCost = 0;

    for (const ev of events) {
      allCalls += 1;
      allTotal += ev.totalTokens;
      allCost += ev.estimatedCostUsd;

      if (ev.day === todayKey) {
        todayCalls += 1;
        todayTotal += ev.totalTokens;
        todayCost += ev.estimatedCostUsd;
      }

      if (ev.month === currentMonthKey) {
        monthCalls += 1;
        if (ev.ok) monthOkCalls += 1;
        else monthErrorCalls += 1;
        monthPrompt += ev.promptTokens;
        monthOutput += ev.outputTokens;
        monthTotal += ev.totalTokens;
        monthCost += ev.estimatedCostUsd;

        if (byOperation[ev.operation]) {
          byOperation[ev.operation].calls += 1;
          byOperation[ev.operation].totalTokens += ev.totalTokens;
        }

        const key = `${ev.provider}::${ev.model}`;
        const existing = byModelMap.get(key) || {
          model: ev.model,
          provider: ev.provider,
          calls: 0,
          totalTokens: 0,
          estimatedCostUsd: 0,
        };
        existing.calls += 1;
        existing.totalTokens += ev.totalTokens;
        existing.estimatedCostUsd = Math.round((existing.estimatedCostUsd + ev.estimatedCostUsd) * 100000) / 100000;
        byModelMap.set(key, existing);
      }
    }

    const activeCfg = this.getResolvedConfig();
    let recommendation: AIUsageSummary["recommendation"];
    if (activeCfg.provider === "ollama") {
      recommendation = {
        level: "ok",
        message: "Provedor local (Ollama) ativo — custo em nuvem US$ 0,00.",
      };
    } else if (monthCost >= 5) {
      recommendation = {
        level: "warn",
        message: `Custo estimado no mês em ~US$ ${monthCost.toFixed(2)}. Considere trocar para "gemini-3.5-flash-lite" ou Ollama local para economizar.`,
      };
    } else if (
      monthCalls >= 20 &&
      !activeCfg.model.toLowerCase().includes("flash-lite") &&
      activeCfg.provider === "gemini"
    ) {
      recommendation = {
        level: "tip",
        message: `Você fez ${monthCalls} chamadas no mês com "${activeCfg.model}". O modelo "gemini-3.5-flash-lite" costuma ser mais econômico e rápido para uso diário.`,
      };
    } else {
      recommendation = {
        level: "ok",
        message:
          monthCalls === 0
            ? "Nenhuma chamada de IA registrada neste mês ainda."
            : `Uso leve neste mês (${monthCalls} chamada(s), ~US$ ${monthCost.toFixed(4)} estimados) — não precisa reduzir nada.`,
      };
    }

    return {
      currentMonthKey,
      todayKey,
      currentMonth: {
        calls: monthCalls,
        okCalls: monthOkCalls,
        errorCalls: monthErrorCalls,
        promptTokens: monthPrompt,
        outputTokens: monthOutput,
        totalTokens: monthTotal,
        estimatedCostUsd: Math.round(monthCost * 100000) / 100000,
        byOperation,
        byModel: Array.from(byModelMap.values()).sort((a, b) => b.totalTokens - a.totalTokens),
      },
      today: {
        calls: todayCalls,
        totalTokens: todayTotal,
        estimatedCostUsd: Math.round(todayCost * 100000) / 100000,
      },
      allTime: {
        calls: allCalls,
        totalTokens: allTotal,
        estimatedCostUsd: Math.round(allCost * 100000) / 100000,
      },
      recentEvents: events.slice(-8).reverse(),
      recommendation,
    };
  }

  private readRailwayRaw(): Partial<RailwayMonitorConfig> {
    if (!fs.existsSync(this.railwayFilePath)) return {};
    try {
      const encrypted = fs.readFileSync(this.railwayFilePath, "utf8").trim();
      if (!encrypted) return {};
      return this.vault.decryptJson<Partial<RailwayMonitorConfig>>(encrypted);
    } catch {
      return {};
    }
  }

  getResolvedRailwayConfig(): RailwayMonitorConfig & {
    tokenSource: "local-settings" | "env" | "none";
  } {
    const stored = this.readRailwayRaw();
    const storedToken = stored.apiToken?.trim() || "";
    const envToken = process.env.RAILWAY_API_TOKEN?.trim() || "";
    const apiToken = storedToken || envToken || undefined;
    const tokenSource = storedToken ? "local-settings" : envToken ? "env" : "none";
    const projectId =
      stored.projectId?.trim() || process.env.RAILWAY_PROJECT_ID?.trim() || "";

    return {
      apiToken,
      projectId,
      updatedAt: stored.updatedAt,
      tokenSource,
    };
  }

  getSafeRailwayConfig(): SafeRailwayConfigView {
    const resolved = this.getResolvedRailwayConfig();
    const token = resolved.apiToken || "";
    const tokenPreview =
      token.length > 8 ? `${token.slice(0, 4)}…${token.slice(-4)}` : token ? "••••" : "";

    return {
      hasToken: Boolean(token),
      tokenSource: resolved.tokenSource,
      tokenPreview,
      projectId: resolved.projectId,
      updatedAt: resolved.updatedAt,
    };
  }

  saveRailwayConfig(patch: {
    apiToken?: string;
    clearToken?: boolean;
    projectId?: string;
  }): SafeRailwayConfigView {
    const current = this.readRailwayRaw();
    let nextToken = current.apiToken;
    if (patch.clearToken) {
      nextToken = undefined;
    } else if (typeof patch.apiToken === "string" && patch.apiToken.trim()) {
      nextToken = patch.apiToken.trim();
    }

    const nextConfig: RailwayMonitorConfig = {
      apiToken: nextToken,
      projectId:
        typeof patch.projectId === "string" ? patch.projectId.trim() : current.projectId || "",
      updatedAt: new Date().toISOString(),
    };

    fs.mkdirSync(this.configDir, { recursive: true });
    const encrypted = this.vault.encryptJson(nextConfig);
    fs.writeFileSync(this.railwayFilePath, `${encrypted}\n`, { encoding: "utf8", mode: 0o600 });

    return this.getSafeRailwayConfig();
  }
}
