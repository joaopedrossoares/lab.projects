import { useCallback, useEffect, useState } from "react";

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

export function SettingsPage() {
  const [status, setStatus] = useState<PrivacyStatusPayload | null>(null);
  const [samples, setSamples] = useState<AuditSample[]>([]);
  const [loading, setLoading] = useState(true);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    verifiedZeroKnowledge: boolean;
    sample: AuditSample | null;
    error?: string;
  } | null>(null);
  const [testing, setTesting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, auditRes] = await Promise.all([
        fetch("/api/privacy/status"),
        fetch("/api/privacy/audit?limit=5"),
      ]);
      if (statusRes.ok) {
        setStatus((await statusRes.json()) as PrivacyStatusPayload);
      }
      if (auditRes.ok) {
        const auditData = (await auditRes.json()) as { samples: AuditSample[] };
        setSamples(auditData.samples);
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

  return (
    <div className="stack-lg">
      <section className="card section-card">
        <p className="eyebrow">Privacidade Zero-Knowledge</p>
        <h1 id="conteudo-principal" tabIndex={-1}>
          Configurações & Auditoria
        </h1>
        <p className="hero-text">
          Todos os dados sensíveis (nomes, estabelecimentos, planos do casal e valores) são
          cifrados no Edge Local com <code>AES-256-GCM</code> antes de chegar ao backend em
          produção.
        </p>

        {loading && !status ? (
          <p className="category">Consultando status do Edge Local...</p>
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
        ) : (
          <p className="category">
            Edge API indisponível neste contexto (rode via Edge Local para ver o status ao vivo).
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
            {testing ? "Testando..." : "Testar gravação cifrada"}
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

        {samples.length > 0 ? (
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
        ) : (
          <p className="category">
            Nenhum envelope gravado ainda. Clique em &ldquo;Testar gravação cifrada&rdquo; acima
            para validar ponta a ponta.
          </p>
        )}
      </section>
    </div>
  );
}
