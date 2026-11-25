import { useCallback, useEffect, useId, useState, type ChangeEvent, type FormEvent } from "react";
import type { AIProviderType } from "@financas/shared";
import {
  LoadingButtonContent,
  SkeletonAuditGrid,
  SkeletonFormGrid,
  SkeletonSummaryGrid,
} from "../components/Loading";

interface PrivacyStatusPayload {
  mode: "hybrid-remote" | "local-sqlite";
  targetLabel: string;
  keyFingerprint: string;
  keySource: string;
  backendHealth: {
    reachable: boolean;
    storage?: string;
    totalActive?: number;
    error?: string;
  };
  stats: {
    totalActive: number;
    byEntityType: Record<string, number>;
  };
}

interface SafeAIConfig {
  provider: AIProviderType;
  model: string;
  baseUrl: string;
  hasApiKey: boolean;
  apiKeySource: "local-settings" | "env" | "none";
  apiKeyPreview: string;
}

interface AIUsageSummaryPayload {
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
    byOperation: {
      suggest_labels: { calls: number; totalTokens: number };
      prioritize: { calls: number; totalTokens: number };
      chat: { calls: number; totalTokens: number };
      test: { calls: number; totalTokens: number };
    };
  };
  today: { calls: number; totalTokens: number; estimatedCostUsd: number };
  allTime: { calls: number; totalTokens: number; estimatedCostUsd: number };
  recommendation: { level: "ok" | "tip" | "warn"; message: string };
}

interface SafeRailwayConfigPayload {
  hasToken: boolean;
  tokenSource: "local-settings" | "env" | "none";
  tokenPreview: string;
  projectId: string;
  updatedAt?: string;
}

interface RailwayUsageReportPayload {
  configured: boolean;
  error?: string;
  projectName?: string;
  environmentName?: string;
  windowHours?: number;
  services?: Array<{
    serviceId: string;
    serviceName: string;
    cpuAvg: number;
    cpuPeak: number;
    memoryMbCurrent: number;
    memoryMbPeak: number;
    diskGbCurrent: number;
    networkTxMb: number;
  }>;
  totals?: {
    memoryMbCurrent: number;
    memoryMbPeak: number;
    diskGbCurrent: number;
    cpuAvg: number;
  };
  billingEstimate?: {
    available: boolean;
    monthToDateUsd: number | null;
    projectedMonthlyUsd: number | null;
    note: string;
  };
  recommendation?: { level: "ok" | "tip" | "warn"; message: string };
}

function formatUsd(value: number, decimals = 4): string {
  return `US$ ${value.toFixed(decimals)}`;
}

function recommendationBadgeClass(level?: "ok" | "tip" | "warn"): string {
  if (level === "warn") return "pill-warn";
  if (level === "tip") return "pill-accent";
  return "pill-success";
}

function recommendationBadgeLabel(level?: "ok" | "tip" | "warn"): string {
  if (level === "warn") return "Atenção";
  if (level === "tip") return "Dica";
  return "Saudável";
}

interface AuditSample {
  id: string;
  entityType: string;
  periodKey: string | null;
  localReadable: unknown;
  productionOpaque: {
    id: string;
    entityType: string;
    periodKey: string | null;
    blindIndex: string | null;
    encryptedPayloadPreview: string;
    encryptedPayloadLength: number;
    updatedAt: string;
  };
}

const GEMINI_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-4-hydrogen",
  "gemini-4-argon",
  "gemini-4-neon",
];

export function SettingsPage() {
  const [status, setStatus] = useState<PrivacyStatusPayload | null>(null);
  const [samples, setSamples] = useState<AuditSample[]>([]);
  const [loading, setLoading] = useState(true);

  // AI local settings
  const [aiConfig, setAiConfig] = useState<SafeAIConfig | null>(null);
  const [provider, setProvider] = useState<AIProviderType>("gemini");
  const [model, setModel] = useState("gemini-4-hydrogen");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [aiFeedback, setAiFeedback] = useState("");
  const [savingAI, setSavingAI] = useState(false);
  const [testingAI, setTestingAI] = useState(false);

  // Usage monitoring (AI + Railway)
  const [aiUsage, setAiUsage] = useState<AIUsageSummaryPayload | null>(null);
  const [clearingUsage, setClearingUsage] = useState(false);
  const [railwayConfig, setRailwayConfig] = useState<SafeRailwayConfigPayload | null>(null);
  const [railwayProjectId, setRailwayProjectId] = useState("");
  const [railwayTokenInput, setRailwayTokenInput] = useState("");
  const [showRailwayToken, setShowRailwayToken] = useState(false);
  const [savingRailway, setSavingRailway] = useState(false);
  const [loadingRailwayUsage, setLoadingRailwayUsage] = useState(false);
  const [railwayUsage, setRailwayUsage] = useState<RailwayUsageReportPayload | null>(null);
  const [railwayFeedback, setRailwayFeedback] = useState("");

  // Privacy audit & backup
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    verifiedZeroKnowledge: boolean;
    sample: AuditSample | null;
    error?: string;
  } | null>(null);
  const [testing, setTesting] = useState(false);
  const [exportingBackup, setExportingBackup] = useState(false);
  const [importingBackup, setImportingBackup] = useState(false);
  const [backupFeedback, setBackupFeedback] = useState("");

  const providerId = useId();
  const modelId = useId();
  const baseUrlId = useId();
  const apiKeyId = useId();
  const railwayProjectInputId = useId();
  const railwayTokenInputId = useId();
  const importBackupId = useId();

  const fetchRailwayUsage = useCallback(async () => {
    setLoadingRailwayUsage(true);
    setRailwayFeedback("");
    try {
      const res = await fetch("/api/monitoring/railway/usage?hours=24");
      const data = (await res.json()) as RailwayUsageReportPayload;
      if (!res.ok) {
        setRailwayUsage({ configured: true, error: data.error || "Erro ao consultar Railway." });
      } else {
        setRailwayUsage(data);
      }
    } catch {
      setRailwayUsage({ configured: true, error: "Falha ao consultar consumo da Railway." });
    } finally {
      setLoadingRailwayUsage(false);
    }
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, auditRes, aiRes, aiUsageRes, railwayCfgRes] = await Promise.all([
        fetch("/api/privacy/status"),
        fetch("/api/privacy/audit?limit=5"),
        fetch("/api/ai/config"),
        fetch("/api/ai/usage"),
        fetch("/api/monitoring/railway/config"),
      ]);
      if (statusRes.ok) {
        setStatus((await statusRes.json()) as PrivacyStatusPayload);
      }
      if (auditRes.ok) {
        const auditData = (await auditRes.json()) as { samples: AuditSample[] };
        setSamples(auditData.samples);
      }
      if (aiRes.ok) {
        const data = (await aiRes.json()) as { config: SafeAIConfig };
        setAiConfig(data.config);
        setProvider(data.config.provider);
        setModel(data.config.model);
        setBaseUrl(data.config.baseUrl);
      }
      if (aiUsageRes.ok) {
        const data = (await aiUsageRes.json()) as { usage: AIUsageSummaryPayload };
        setAiUsage(data.usage);
      }
      if (railwayCfgRes.ok) {
        const data = (await railwayCfgRes.json()) as { config: SafeRailwayConfigPayload };
        setRailwayConfig(data.config);
        setRailwayProjectId(data.config.projectId || "");
        if (data.config.hasToken && data.config.projectId) {
          void fetchRailwayUsage();
        }
      }
    } catch {
      // Edge API might be unavailable in static preview mode
    } finally {
      setLoading(false);
    }
  }, [fetchRailwayUsage]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleSaveAIConfig(event: FormEvent) {
    event.preventDefault();
    if (savingAI) return;
    setSavingAI(true);
    setAiFeedback("");
    try {
      const res = await fetch("/api/ai/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          model,
          baseUrl,
          apiKey: apiKeyInput.trim() || undefined,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { config: SafeAIConfig };
        setAiConfig(data.config);
        setApiKeyInput("");
        setAiFeedback("Configuração de IA salva exclusivamente no volume local cifrado do Edge.");
      } else {
        setAiFeedback("Falha ao salvar configuração de IA.");
      }
    } catch {
      setAiFeedback("Falha ao salvar configuração de IA.");
    } finally {
      setSavingAI(false);
    }
  }

  async function handleTestAI() {
    setTestingAI(true);
    setAiFeedback("");
    try {
      const res = await fetch("/api/ai/test", { method: "POST" });
      const data = (await res.json()) as { ok: boolean; message: string };
      setAiFeedback(data.ok ? `✓ ${data.message}` : `✕ ${data.message}`);
      const usageRes = await fetch("/api/ai/usage");
      if (usageRes.ok) {
        const u = (await usageRes.json()) as { usage: AIUsageSummaryPayload };
        setAiUsage(u.usage);
      }
    } catch {
      setAiFeedback("Erro ao testar conexão com o provedor de IA.");
    } finally {
      setTestingAI(false);
    }
  }

  async function handleClearAIUsage() {
    if (clearingUsage) return;
    setClearingUsage(true);
    try {
      const res = await fetch("/api/ai/usage", { method: "DELETE" });
      if (res.ok) {
        const data = (await res.json()) as { usage: AIUsageSummaryPayload };
        setAiUsage(data.usage);
      }
    } finally {
      setClearingUsage(false);
    }
  }

  async function handleSaveRailwayConfig(event: FormEvent) {
    event.preventDefault();
    if (savingRailway) return;
    setSavingRailway(true);
    setRailwayFeedback("");
    try {
      const res = await fetch("/api/monitoring/railway/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: railwayProjectId.trim(),
          apiToken: railwayTokenInput.trim() || undefined,
        }),
      });
      if (!res.ok) {
        setRailwayFeedback("Falha ao salvar configuração de monitoramento Railway.");
        return;
      }
      const data = (await res.json()) as { config: SafeRailwayConfigPayload };
      setRailwayConfig(data.config);
      setRailwayTokenInput("");
      setRailwayFeedback(
        "Token e Project ID da Railway salvos exclusivamente no volume local cifrado do Edge."
      );
      if (data.config.hasToken && data.config.projectId) {
        await fetchRailwayUsage();
      }
    } catch {
      setRailwayFeedback("Falha ao salvar configuração Railway.");
    } finally {
      setSavingRailway(false);
    }
  }

  async function handleRunRoundtripTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/privacy/test-roundtrip", { method: "POST" });
      const data = await res.json();
      setTestResult(data);
      await loadData();
    } catch (err) {
      setTestResult({
        ok: false,
        verifiedZeroKnowledge: false,
        sample: null,
        error: err instanceof Error ? err.message : "Erro ao executar teste.",
      });
    } finally {
      setTesting(false);
    }
  }

  async function handleExportSnapshot() {
    if (exportingBackup) return;
    setExportingBackup(true);
    setBackupFeedback("");
    try {
      const res = await fetch("/api/privacy/snapshot");
      if (!res.ok) {
        setBackupFeedback("Erro ao exportar backup cifrado.");
        return;
      }
      const payload = await res.json();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `financas-backup-cifrado-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setBackupFeedback(`Backup exportado com ${payload.count} envelopes cifrados.`);
    } catch {
      setBackupFeedback("Erro ao exportar backup cifrado.");
    } finally {
      setExportingBackup(false);
    }
  }

  async function handleImportSnapshot(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || importingBackup) return;
    setImportingBackup(true);
    setBackupFeedback("");
    try {
      const parsed = JSON.parse(await file.text());
      const res = await fetch("/api/privacy/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records: parsed.records }),
      });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { imported: number };
      setBackupFeedback(`${data.imported} envelopes cifrados restaurados com sucesso.`);
      await loadData();
    } catch {
      setBackupFeedback("Arquivo de backup inválido ou erro ao restaurar.");
    } finally {
      setImportingBackup(false);
      event.target.value = "";
    }
  }

  return (
    <div className="stack-lg">
      <section className="card section-card">
        <p className="eyebrow">IA Plugável • Chave 100% Local</p>
        <h1 id="conteudo-principal" tabIndex={-1}>
          Configurações, IA & Privacidade
        </h1>
        <p className="hero-text">
          Configure o provedor de IA diretamente por aqui. A chave fica salva{" "}
          <strong>apenas no volume local cifrado do Edge</strong> (nunca sobe para a Railway).
        </p>

        {loading && !aiConfig ? (
          <SkeletonFormGrid fields={3} label="Carregando configurações locais de IA..." />
        ) : (
          <form className="stack-md" onSubmit={handleSaveAIConfig}>
            <div className="inline-form">
              <div className="field field-compact">
                <label htmlFor={providerId}>Provedor de IA</label>
                <select
                  id={providerId}
                  value={provider}
                  onChange={(e) => {
                    const next = e.target.value as AIProviderType;
                    setProvider(next);
                    if (next === "gemini") setModel("gemini-4-hydrogen");
                    if (next === "ollama") {
                      setModel("llama3.1");
                      if (!baseUrl) setBaseUrl("http://host.docker.internal:11434");
                    }
                  }}
                >
                  <option value="gemini">Google Gemini API</option>
                  <option value="ollama">Ollama (Local / Homelab LAN)</option>
                  <option value="openai_compatible">OpenAI-Compatible</option>
                </select>
              </div>

              <div className="field">
                <label htmlFor={modelId}>Modelo</label>
                <input
                  id={modelId}
                  type="text"
                  list="gemini-models-list"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  required
                />
                <datalist id="gemini-models-list">
                  {GEMINI_MODELS.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </div>

              {provider !== "gemini" && (
                <div className="field">
                  <label htmlFor={baseUrlId}>URL do Servidor</label>
                  <input
                    id={baseUrlId}
                    type="url"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="http://host.docker.internal:11434"
                  />
                </div>
              )}

              {provider !== "ollama" && (
                <div className="field">
                  <label htmlFor={apiKeyId}>
                    API Key{" "}
                    {aiConfig?.hasApiKey
                      ? `(ativa: ${aiConfig.apiKeyPreview} via ${aiConfig.apiKeySource})`
                      : "(não configurada)"}
                  </label>
                  <div className="inline-edit-row">
                    <input
                      id={apiKeyId}
                      type={showKey ? "text" : "password"}
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      placeholder="Cole nova API key para atualizar..."
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      className="secondary-button compact-button"
                      aria-pressed={showKey}
                      onClick={() => setShowKey((prev) => !prev)}
                    >
                      {showKey ? "Ocultar" : "Mostrar"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="toolbar-actions">
              <button type="submit" className="primary-button" disabled={savingAI}>
                <LoadingButtonContent
                  loading={savingAI}
                  loadingLabel="Salvando..."
                  idleLabel="Salvar configuração local"
                />
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={testingAI}
                onClick={() => void handleTestAI()}
              >
                <LoadingButtonContent
                  loading={testingAI}
                  loadingLabel="Testando..."
                  idleLabel="Testar conexão IA"
                />
              </button>
            </div>
          </form>
        )}

        {aiFeedback && (
          <p className="status-inline" role="status" aria-live="polite">
            {aiFeedback}
          </p>
        )}
      </section>

      <section className="card section-card">
        <div className="section-header-row">
          <div>
            <h2>Monitoramento de Consumo — IA & Railway</h2>
            <p className="category">
              Acompanhe tokens de IA e uso real de recursos da Railway para saber se precisa
              ajustar modelo ou infraestrutura. Tudo salvo apenas no volume local cifrado.
            </p>
          </div>
          {aiUsage && aiUsage.allTime.calls > 0 && (
            <button
              type="button"
              className="secondary-button compact-button"
              disabled={clearingUsage}
              onClick={() => void handleClearAIUsage()}
            >
              <LoadingButtonContent
                loading={clearingUsage}
                loadingLabel="Zerando..."
                idleLabel="Zerar histórico de IA"
              />
            </button>
          )}
        </div>

        <div className="stack-md">
          <div>
            <h3>Consumo de IA ({aiUsage?.currentMonthKey || "mês atual"})</h3>
            {loading && !aiUsage ? (
              <SkeletonSummaryGrid count={4} label="Carregando telemetria local de IA..." />
            ) : aiUsage ? (
              <>
                <div className="summary-grid">
                  <article className="result-card card">
                    <span className="label">Chamadas no mês</span>
                    <strong>{aiUsage.currentMonth.calls}</strong>
                    <small>
                      Hoje: {aiUsage.today.calls} • Falhas: {aiUsage.currentMonth.errorCalls}
                    </small>
                  </article>

                  <article className="result-card card">
                    <span className="label">Tokens no mês</span>
                    <strong>{aiUsage.currentMonth.totalTokens.toLocaleString("pt-BR")}</strong>
                    <small>
                      Entrada: {aiUsage.currentMonth.promptTokens.toLocaleString("pt-BR")} • Saída:{" "}
                      {aiUsage.currentMonth.outputTokens.toLocaleString("pt-BR")}
                    </small>
                  </article>

                  <article className="result-card highlight card">
                    <span className="label">Custo estimado (mês)</span>
                    <strong>{formatUsd(aiUsage.currentMonth.estimatedCostUsd)}</strong>
                    <small>Acumulado total: {formatUsd(aiUsage.allTime.estimatedCostUsd)}</small>
                  </article>

                  <article className="result-card card">
                    <span className="label">Uso por operação</span>
                    <strong>
                      {aiUsage.currentMonth.byOperation.chat.calls +
                        aiUsage.currentMonth.byOperation.prioritize.calls +
                        aiUsage.currentMonth.byOperation.suggest_labels.calls}{" "}
                      ações
                    </strong>
                    <small>
                      Chat: {aiUsage.currentMonth.byOperation.chat.calls} • Priorizar:{" "}
                      {aiUsage.currentMonth.byOperation.prioritize.calls} • Labels:{" "}
                      {aiUsage.currentMonth.byOperation.suggest_labels.calls}
                    </small>
                  </article>
                </div>

                <div className="audit-banner">
                  <span
                    className={`pill ${recommendationBadgeClass(aiUsage.recommendation.level)}`}
                  >
                    {recommendationBadgeLabel(aiUsage.recommendation.level)}
                  </span>{" "}
                  <span>{aiUsage.recommendation.message}</span>
                </div>
              </>
            ) : null}
          </div>

          <div>
            <h3>Consumo da Railway (opcional)</h3>
            <p className="category">
              Cole um Railway API Token (salvo apenas localmente no Edge) + Project ID para
              consultar CPU, RAM, Disco e estimativa mensal direto por aqui.
            </p>

            <form className="inline-form" onSubmit={handleSaveRailwayConfig}>
              <div className="field">
                <label htmlFor={railwayProjectInputId}>Railway Project ID</label>
                <input
                  id={railwayProjectInputId}
                  type="text"
                  value={railwayProjectId}
                  onChange={(e) => setRailwayProjectId(e.target.value)}
                  placeholder="Ex.: 153abc4d-03eb-462a-95cb-8d2d3ca78cbb"
                />
              </div>

              <div className="field">
                <label htmlFor={railwayTokenInputId}>
                  Railway API Token{" "}
                  {railwayConfig?.hasToken
                    ? `(ativo: ${railwayConfig.tokenPreview} via ${railwayConfig.tokenSource})`
                    : "(não configurado)"}
                </label>
                <div className="inline-edit-row">
                  <input
                    id={railwayTokenInputId}
                    type={showRailwayToken ? "text" : "password"}
                    value={railwayTokenInput}
                    onChange={(e) => setRailwayTokenInput(e.target.value)}
                    placeholder="Cole seu Railway API Token..."
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    className="secondary-button compact-button"
                    aria-pressed={showRailwayToken}
                    onClick={() => setShowRailwayToken((prev) => !prev)}
                  >
                    {showRailwayToken ? "Ocultar" : "Mostrar"}
                  </button>
                </div>
              </div>

              <div className="toolbar-actions">
                <button type="submit" className="secondary-button" disabled={savingRailway}>
                  <LoadingButtonContent
                    loading={savingRailway}
                    loadingLabel="Salvando..."
                    idleLabel="Salvar Railway"
                  />
                </button>
                <button
                  type="button"
                  className="primary-button"
                  disabled={loadingRailwayUsage || !railwayConfig?.hasToken || !railwayProjectId.trim()}
                  onClick={() => void fetchRailwayUsage()}
                >
                  <LoadingButtonContent
                    loading={loadingRailwayUsage}
                    loadingLabel="Consultando..."
                    idleLabel="Consultar consumo Railway"
                  />
                </button>
              </div>
            </form>

            {railwayFeedback && (
              <p className="status-inline" role="status" aria-live="polite">
                {railwayFeedback}
              </p>
            )}

            {loadingRailwayUsage ? (
              <SkeletonSummaryGrid count={4} label="Consultando métricas da Railway (24h)..." />
            ) : railwayUsage?.error ? (
              <p className="status-inline" role="status" aria-live="polite">
                ✕ {railwayUsage.error}
              </p>
            ) : railwayUsage?.configured && railwayUsage.totals ? (
              <>
                <div className="summary-grid">
                  <article className="result-card card">
                    <span className="label">Memória total atual</span>
                    <strong>{railwayUsage.totals.memoryMbCurrent.toFixed(0)} MB</strong>
                    <small>Pico 24h: {railwayUsage.totals.memoryMbPeak.toFixed(0)} MB</small>
                  </article>

                  <article className="result-card card">
                    <span className="label">CPU média (24h)</span>
                    <strong>{railwayUsage.totals.cpuAvg.toFixed(4)} vCPU</strong>
                    <small>
                      {railwayUsage.projectName} ({railwayUsage.environmentName})
                    </small>
                  </article>

                  <article className="result-card card">
                    <span className="label">Disco em uso</span>
                    <strong>{railwayUsage.totals.diskGbCurrent.toFixed(3)} GB</strong>
                    <small>{railwayUsage.services?.length || 0} serviço(s) monitorado(s)</small>
                  </article>

                  <article className="result-card highlight card">
                    <span className="label">Estimativa do ciclo</span>
                    <strong>
                      {railwayUsage.billingEstimate?.projectedMonthlyUsd != null
                        ? `${formatUsd(railwayUsage.billingEstimate.projectedMonthlyUsd, 2)}/mês`
                        : "N/D"}
                    </strong>
                    <small>
                      {railwayUsage.billingEstimate?.monthToDateUsd != null
                        ? `Acumulado no mês: ${formatUsd(railwayUsage.billingEstimate.monthToDateUsd, 2)}`
                        : railwayUsage.billingEstimate?.note}
                    </small>
                  </article>
                </div>

                {railwayUsage.recommendation && (
                  <div className="audit-banner">
                    <span
                      className={`pill ${recommendationBadgeClass(railwayUsage.recommendation.level)}`}
                    >
                      {recommendationBadgeLabel(railwayUsage.recommendation.level)}
                    </span>{" "}
                    <span>{railwayUsage.recommendation.message}</span>
                  </div>
                )}

                {railwayUsage.services && railwayUsage.services.length > 0 && (
                  <table className="data-table">
                    <caption className="visually-hidden">
                      Uso de recursos por serviço na Railway
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Serviço</th>
                        <th scope="col">Memória (atual / pico)</th>
                        <th scope="col">CPU (média / pico)</th>
                        <th scope="col">Disco</th>
                        <th scope="col">Rede TX (24h)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {railwayUsage.services.map((svc) => (
                        <tr key={svc.serviceId}>
                          <td>{svc.serviceName}</td>
                          <td>
                            {svc.memoryMbCurrent.toFixed(0)} MB / {svc.memoryMbPeak.toFixed(0)} MB
                          </td>
                          <td>
                            {svc.cpuAvg.toFixed(4)} / {svc.cpuPeak.toFixed(4)} vCPU
                          </td>
                          <td>{svc.diskGbCurrent.toFixed(3)} GB</td>
                          <td>{svc.networkTxMb.toFixed(2)} MB</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            ) : null}
          </div>
        </div>
      </section>

      <section className="card section-card">
        <h2>Privacidade Zero-Knowledge & Backup Portável (Railway ↔ Homelab)</h2>
        {loading && !status ? (
          <SkeletonSummaryGrid count={4} label="Consultando status do Edge Local..." />
        ) : status ? (
          <div className="summary-grid">
            <article className="result-card card">
              <span className="label">Modo de armazenamento</span>
              <strong>{status.mode === "hybrid-remote" ? "Híbrido (Railway)" : "Local SQLite"}</strong>
              <small>{status.targetLabel}</small>
            </article>

            <article className="result-card card">
              <span className="label">Conexão Backend</span>
              <strong>{status.backendHealth.reachable ? "Online" : "Indisponível"}</strong>
              <small>
                {status.backendHealth.storage
                  ? `Storage: ${status.backendHealth.storage}`
                  : status.backendHealth.error || "Verifique BACKEND_URL"}
              </small>
            </article>

            <article className="result-card card">
              <span className="label">Chave Mestra Local</span>
              <strong>{status.keyFingerprint}</strong>
              <small>Origem: {status.keySource}</small>
            </article>

            <article className="result-card card">
              <span className="label">Envelopes Cifrados</span>
              <strong>{status.stats.totalActive}</strong>
              <small>Registros opacos ativos</small>
            </article>
          </div>
        ) : null}

        <div className="toolbar-actions" style={{ marginBlockStart: "16px" }}>
          <button
            type="button"
            className="secondary-button"
            disabled={exportingBackup}
            onClick={() => void handleExportSnapshot()}
          >
            <LoadingButtonContent
              loading={exportingBackup}
              loadingLabel="Exportando..."
              idleLabel="Exportar Backup Cifrado (.json)"
            />
          </button>
          <label
            className={`secondary-button ${importingBackup ? "is-disabled-label" : ""}`.trim()}
            htmlFor={importBackupId}
            style={{ display: "inline-flex", alignItems: "center" }}
          >
            <LoadingButtonContent
              loading={importingBackup}
              loadingLabel="Restaurando..."
              idleLabel="Importar Backup Cifrado"
            />
            <input
              id={importBackupId}
              className="visually-hidden"
              type="file"
              accept="application/json,.json"
              disabled={importingBackup}
              onChange={handleImportSnapshot}
            />
          </label>
        </div>

        {backupFeedback && (
          <p className="status-inline" role="status" aria-live="polite">
            {backupFeedback}
          </p>
        )}
      </section>

      <section className="card section-card">
        <div className="section-header-row">
          <div>
            <h2>Auditoria: Local Legível vs. Produção Opaca</h2>
            <p className="category">
              Compare o que você vê localmente com o registro exatamente como fica gravado no banco
              de produção.
            </p>
          </div>
          <button
            type="button"
            className="primary-button"
            onClick={handleRunRoundtripTest}
            disabled={testing}
          >
            <LoadingButtonContent
              loading={testing}
              loadingLabel="Testando..."
              idleLabel="Testar gravação cifrada"
            />
          </button>
        </div>

        {testResult && (
          <div className="audit-banner" role="status" aria-live="polite">
            {testResult.ok && testResult.verifiedZeroKnowledge ? (
              <p>
                <strong>Zero-Knowledge verificado!</strong> O registro foi gravado cifrado, lido e
                descriptografado localmente sem expor texto claro no banco.
              </p>
            ) : (
              <p>
                <strong>Falha no teste:</strong> {testResult.error || "Não foi possível verificar."}
              </p>
            )}

            {testResult.sample && (
              <div className="audit-grid">
                <div>
                  <h3>Local (descriptografado no Edge)</h3>
                  <pre className="code-box">
                    {JSON.stringify(testResult.sample.localReadable, null, 2)}
                  </pre>
                </div>
                <div>
                  <h3>Produção (como fica salvo no banco)</h3>
                  <pre className="code-box">
                    {JSON.stringify(testResult.sample.productionOpaque, null, 2)}
                  </pre>
                </div>
              </div>
            )}
          </div>
        )}

        {loading && samples.length === 0 ? (
          <SkeletonAuditGrid count={2} />
        ) : samples.length > 0 ? (
          <div className="stack-md">
            {samples.map((item) => (
              <div key={item.id} className="audit-grid">
                <div>
                  <h3>Local ({item.entityType})</h3>
                  <pre className="code-box">{JSON.stringify(item.localReadable, null, 2)}</pre>
                </div>
                <div>
                  <h3>Produção Opaca</h3>
                  <pre className="code-box">{JSON.stringify(item.productionOpaque, null, 2)}</pre>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
