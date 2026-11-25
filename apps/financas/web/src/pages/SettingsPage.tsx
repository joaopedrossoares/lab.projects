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
  const importBackupId = useId();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, auditRes, aiRes] = await Promise.all([
        fetch("/api/privacy/status"),
        fetch("/api/privacy/audit?limit=5"),
        fetch("/api/ai/config"),
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
    } catch {
      // Edge API might be unavailable in static preview mode
    } finally {
      setLoading(false);
    }
  }, []);

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
    } catch {
      setAiFeedback("Erro ao testar conexão com o provedor de IA.");
    } finally {
      setTestingAI(false);
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
