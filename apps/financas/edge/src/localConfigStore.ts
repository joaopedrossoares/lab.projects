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

export class LocalConfigStore {
  private readonly filePath: string;

  constructor(
    private readonly configDir: string,
    private readonly vault: CryptoVault
  ) {
    this.filePath = path.join(configDir, "ai-config.enc");
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
}
