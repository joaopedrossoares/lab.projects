import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from "react";
import type { LabelRule, TransactionScope } from "@financas/shared";
import { DEFAULT_CATEGORIES } from "../lib/categories";

export function LabelsPage() {
  const [rules, setRules] = useState<LabelRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  // New rule form state
  const [rawPattern, setRawPattern] = useState("");
  const [friendlyName, setFriendlyName] = useState("");
  const [category, setCategory] = useState("Alimentação");
  const [defaultScope, setDefaultScope] = useState<TransactionScope>("couple");
  const [mySharePct, setMySharePct] = useState(50);
  const [saving, setSaving] = useState(false);

  const searchId = useId();
  const catListId = useId();
  const patternId = useId();
  const nameId = useId();
  const categoryId = useId();
  const shareId = useId();

  const loadRules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/labels");
      if (res.ok) {
        const data = (await res.json()) as { rules: LabelRule[] };
        setRules(data.rules);
      }
    } catch {
      setStatusMessage("Não foi possível carregar as regras salvas.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRules();
  }, [loadRules]);

  async function handleAddRule(event: FormEvent) {
    event.preventDefault();
    if (!rawPattern.trim() || !friendlyName.trim()) return;

    setSaving(true);
    setStatusMessage("");
    try {
      const res = await fetch("/api/labels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawPattern,
          friendlyName,
          category,
          defaultScope,
          mySharePct,
        }),
      });
      if (!res.ok) throw new Error("Erro ao salvar regra.");
      setRawPattern("");
      setFriendlyName("");
      setStatusMessage("Regra salva e criptografada com sucesso.");
      await loadRules();
    } catch {
      setStatusMessage("Falha ao salvar a regra.");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateRule(rule: LabelRule) {
    try {
      const res = await fetch("/api/labels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rule),
      });
      if (res.ok) {
        setStatusMessage(`Regra "${rule.friendlyName}" atualizada.`);
        await loadRules();
      }
    } catch {
      setStatusMessage("Falha ao atualizar regra.");
    }
  }

  async function handleDeleteRule(id: string) {
    try {
      const res = await fetch(`/api/labels/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.ok) {
        setRules((prev) => prev.filter((r) => r.id !== id));
        setStatusMessage("Regra removida.");
      }
    } catch {
      setStatusMessage("Falha ao remover regra.");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rules;
    return rules.filter((r) =>
      `${r.friendlyName} ${r.normalizedPattern} ${r.category}`.toLowerCase().includes(q)
    );
  }, [rules, search]);

  return (
    <div className="stack-lg">
      <section className="card section-card">
        <p className="eyebrow">Memória automática de fatura</p>
        <h1 id="conteudo-principal" tabIndex={-1}>
          Labels & Regras Salvas
        </h1>
        <p className="hero-text">
          Cada estabelecimento renomeado e memorizado aqui é reconhecido automaticamente nas
          próximas faturas — tudo salvo cifrado com índice cego HMAC.
        </p>

        <form className="inline-form" onSubmit={handleAddRule}>
          <div className="field">
            <label htmlFor={patternId}>Texto na fatura (ou parte dele)</label>
            <input
              id={patternId}
              name="rawPattern"
              type="text"
              required
              value={rawPattern}
              onChange={(e) => setRawPattern(e.target.value)}
              placeholder="Ex.: MP *PADARIA CENTRAL"
            />
          </div>

          <div className="field">
            <label htmlFor={nameId}>Nome amigável (Label)</label>
            <input
              id={nameId}
              name="friendlyName"
              type="text"
              required
              value={friendlyName}
              onChange={(e) => setFriendlyName(e.target.value)}
              placeholder="Ex.: Padaria do Bairro"
            />
          </div>

          <div className="field">
            <label htmlFor={categoryId}>Categoria</label>
            <input
              id={categoryId}
              name="category"
              type="text"
              list={catListId}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor={shareId}>Escopo padrão</label>
            <div className="toggle-group" role="group" aria-label="Escopo padrão da regra">
              <button
                type="button"
                aria-pressed={defaultScope === "individual"}
                onClick={() => setDefaultScope("individual")}
              >
                Individual
              </button>
              <button
                type="button"
                aria-pressed={defaultScope === "couple"}
                onClick={() => setDefaultScope("couple")}
              >
                Casal
              </button>
            </div>
          </div>

          {defaultScope === "couple" && (
            <div className="field field-compact">
              <label htmlFor={shareId}>Minha cota (%)</label>
              <input
                id={shareId}
                name="mySharePct"
                type="number"
                min={0}
                max={100}
                value={mySharePct}
                onChange={(e) => setMySharePct(Number(e.target.value))}
              />
            </div>
          )}

          <button type="submit" className="primary-button" disabled={saving}>
            {saving ? "Salvando..." : "Salvar regra"}
          </button>
        </form>

        <datalist id={catListId}>
          {DEFAULT_CATEGORIES.map((cat) => (
            <option key={cat} value={cat} />
          ))}
        </datalist>

        {statusMessage && (
          <p className="status-inline" role="status" aria-live="polite">
            {statusMessage}
          </p>
        )}
      </section>

      <section className="card section-card">
        <div className="section-header-row">
          <h2>Regras memorizadas ({rules.length})</h2>
          <search className="search-field">
            <label htmlFor={searchId}>Buscar label salvo</label>
            <input
              id={searchId}
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filtrar por apelido, categoria ou padrão..."
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
            />
          </search>
        </div>

        {loading ? (
          <p className="category">Carregando regras...</p>
        ) : filtered.length === 0 ? (
          <p className="category">Nenhuma regra cadastrada ainda.</p>
        ) : (
          <ul className="transactions-list" role="list">
            {filtered.map((rule) => (
              <li key={rule.id}>
                <article className="transaction-card card">
                  <div className="transaction-main">
                    <div className="transaction-meta">
                      <span className="pill">Padrão: {rule.normalizedPattern}</span>
                      <span className="pill pill-accent">{rule.category}</span>
                      <span className="pill">
                        {rule.defaultScope === "couple"
                          ? `Casal (${rule.mySharePct}% meu)`
                          : "Individual"}
                      </span>
                    </div>
                    <div className="inline-edit-row">
                      <input
                        aria-label={`Renomear ${rule.friendlyName}`}
                        type="text"
                        value={rule.friendlyName}
                        onChange={(e) =>
                          setRules((prev) =>
                            prev.map((item) =>
                              item.id === rule.id
                                ? { ...item, friendlyName: e.target.value }
                                : item
                            )
                          )
                        }
                      />
                      <input
                        aria-label={`Categoria de ${rule.friendlyName}`}
                        type="text"
                        list={catListId}
                        value={rule.category}
                        onChange={(e) =>
                          setRules((prev) =>
                            prev.map((item) =>
                              item.id === rule.id ? { ...item, category: e.target.value } : item
                            )
                          )
                        }
                      />
                    </div>
                  </div>

                  <div className="toolbar-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void handleUpdateRule(rule)}
                    >
                      Atualizar
                    </button>
                    <button
                      type="button"
                      className="danger-button"
                      onClick={() => void handleDeleteRule(rule.id)}
                    >
                      Excluir
                    </button>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
