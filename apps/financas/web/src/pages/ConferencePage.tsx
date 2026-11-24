import { useId, useMemo, useState, type ChangeEvent } from "react";
import type {
  FutureInstallment,
  LabelRule,
  ParsedBillResult,
  ParsedTransaction,
  TransactionScope,
} from "@financas/shared";
import { DEFAULT_CATEGORIES } from "../lib/categories";
import { formatBRL } from "../lib/format";
import { readAndParseItauPdf } from "../lib/pdfReader";

export interface DraftTransaction extends ParsedTransaction {
  friendlyName: string;
  scope: TransactionScope;
  mySharePct: number;
  matchedRuleId?: string;
}

type ReviewFilter = "all" | "unmatched" | "matched";

interface ConferencePageProps {
  pdfParser?: (file: File) => Promise<ParsedBillResult>;
}

export function ConferencePage({ pdfParser = readAndParseItauPdf }: ConferencePageProps) {
  const [transactions, setTransactions] = useState<DraftTransaction[]>([]);
  const [futureInstallments, setFutureInstallments] = useState<FutureInstallment[]>([]);
  const [filter, setFilter] = useState("");
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("all");
  const [fileName, setFileName] = useState("Aguardando PDF");
  const [statusMessage, setStatusMessage] = useState("Selecione o PDF da fatura para começar.");
  const [isLoading, setIsLoading] = useState(false);
  const [savingRuleId, setSavingRuleId] = useState<string | null>(null);

  const fileInputId = useId();
  const searchInputId = useId();
  const catListId = useId();

  async function applySavedRules(parsedTxs: ParsedTransaction[]): Promise<DraftTransaction[]> {
    try {
      const res = await fetch("/api/labels/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactions: parsedTxs }),
      });
      if (res.ok) {
        const data = (await res.json()) as { transactions: DraftTransaction[] };
        return data.transactions;
      }
    } catch {
      // Fallback gracefully when running without Edge API
    }

    return parsedTxs.map((tx) => ({
      ...tx,
      friendlyName: tx.description,
      scope: "individual",
      mySharePct: 50,
    }));
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setStatusMessage("Selecione um arquivo PDF válido.");
      return;
    }

    setIsLoading(true);
    setStatusMessage("Lendo PDF localmente e aplicando seus labels salvos...");

    try {
      const parsed = await pdfParser(file);
      const enriched = await applySavedRules(parsed.transactions);

      setTransactions(enriched);
      setFutureInstallments(parsed.futureInstallments);
      setFileName(file.name);

      if (enriched.length === 0) {
        setStatusMessage("Não encontrei compras nesse PDF. Confira se é uma fatura Itaú em texto.");
      } else {
        const matchedCount = enriched.filter((tx) => Boolean(tx.matchedRuleId)).length;
        setStatusMessage(
          matchedCount > 0
            ? `${matchedCount} de ${enriched.length} compras reconhecidas automaticamente pelos seus labels salvos.`
            : ""
        );
      }
    } catch {
      setTransactions([]);
      setFutureInstallments([]);
      setFileName("Erro ao ler PDF");
      setStatusMessage("Não foi possível ler o PDF selecionado.");
    } finally {
      setIsLoading(false);
    }
  }

  function updateTx(id: string, patch: Partial<DraftTransaction>) {
    setTransactions((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  }

  function updateAllScopes(scope: TransactionScope) {
    setTransactions((prev) => prev.map((item) => ({ ...item, scope })));
  }

  async function handleRememberRule(tx: DraftTransaction) {
    setSavingRuleId(tx.id);
    try {
      const res = await fetch("/api/labels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawPattern: tx.normalizedMerchant || tx.description,
          friendlyName: tx.friendlyName.trim() || tx.description,
          category: tx.category.trim() || "Outros",
          defaultScope: tx.scope,
          mySharePct: tx.mySharePct,
        }),
      });

      if (!res.ok) throw new Error("Falha ao salvar regra.");
      const data = (await res.json()) as { rule: LabelRule };

      // Apply the newly saved rule to all matching items in the current bill
      setTransactions((prev) =>
        prev.map((item) =>
          item.normalizedMerchant === data.rule.normalizedPattern
            ? {
                ...item,
                friendlyName: data.rule.friendlyName,
                category: data.rule.category,
                scope: data.rule.defaultScope,
                mySharePct: data.rule.mySharePct,
                matchedRuleId: data.rule.id,
              }
            : item
        )
      );
      setStatusMessage(`Regra "${data.rule.friendlyName}" salva para futuras faturas.`);
    } catch {
      setStatusMessage("Não foi possível salvar a regra no Edge Local.");
    } finally {
      setSavingRuleId(null);
    }
  }

  const filteredTransactions = useMemo(() => {
    const term = filter.trim().toLowerCase();

    return transactions.filter((item) => {
      if (reviewFilter === "matched" && !item.matchedRuleId) return false;
      if (reviewFilter === "unmatched" && item.matchedRuleId) return false;
      if (!term) return true;

      return `${item.date} ${item.friendlyName} ${item.description} ${item.normalizedMerchant} ${item.category} ${item.section}`
        .toLowerCase()
        .includes(term);
    });
  }, [transactions, filter, reviewFilter]);

  const coupleTotal = useMemo(
    () =>
      transactions
        .filter((item) => item.scope === "couple")
        .reduce((sum, item) => sum + item.amount, 0),
    [transactions]
  );

  const partnerOwes = useMemo(
    () =>
      transactions
        .filter((item) => item.scope === "couple")
        .reduce((sum, item) => sum + item.amount * ((100 - item.mySharePct) / 100), 0),
    [transactions]
  );

  const futureNextMonthTotal = useMemo(
    () => futureInstallments.reduce((sum, item) => sum + item.nextBillAmount, 0),
    [futureInstallments]
  );

  const unmatchedCount = useMemo(
    () => transactions.filter((tx) => !tx.matchedRuleId).length,
    [transactions]
  );

  return (
    <>
      <section className="hero card">
        <div>
          <p className="eyebrow">Fatura de cartão • Memória de Labels</p>
          <h1 id="conteudo-principal" tabIndex={-1}>
            Conferência mensal
          </h1>
          <p className="hero-text">
            Selecione o PDF da fatura, renomeie compras, escolha categorias e clique em{" "}
            <strong>Lembrar regra</strong> para reconhecer automaticamente nos próximos meses.
          </p>
        </div>

        <label className="upload-box" htmlFor={fileInputId}>
          <span className="upload-icon" aria-hidden="true">
            ＋
          </span>
          <span>
            <strong>{isLoading ? "Processando PDF..." : "Selecionar PDF"}</strong>
            <small>Leitura 100% local + aplicação automática de labels salvos</small>
          </span>
          <input
            id={fileInputId}
            className="visually-hidden"
            type="file"
            accept=".pdf,application/pdf"
            onChange={handleFileChange}
          />
        </label>
      </section>

      <section className="summary-grid" aria-label="Resumo da conferência">
        <article className="result-card card">
          <span className="label">Total marcado como Casal</span>
          <strong data-testid="couple-total">{formatBRL(coupleTotal)}</strong>
          <small>Soma das compras compartilhadas</small>
        </article>

        <article className="result-card highlight card">
          <span className="label">Cota da parceira</span>
          <strong data-testid="each-pays">{formatBRL(partnerOwes)}</strong>
          <small>Respeitando % de divisão de cada item</small>
        </article>

        <article className="result-card card">
          <span className="label">Compras encontradas</span>
          <strong data-testid="items-count">{transactions.length}</strong>
          <small>
            {fileName} {transactions.length > 0 ? `• ${unmatchedCount} nova(s)` : ""}
          </small>
        </article>

        <article className="result-card card">
          <span className="label">Parcelas próximas faturas</span>
          <strong data-testid="future-total">{formatBRL(futureNextMonthTotal)}</strong>
          <small>{futureInstallments.length} parcelamento(s) detectado(s)</small>
        </article>
      </section>

      {transactions.length > 0 && (
        <section className="toolbar card">
          <search className="search-field">
            <label htmlFor={searchInputId}>Filtrar compras</label>
            <input
              id={searchInputId}
              type="search"
              name="search"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Buscar por label, estabelecimento, categoria ou data..."
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
            />
          </search>

          <div className="toolbar-actions">
            <div className="toggle-group" role="group" aria-label="Filtro de reconhecimento">
              <button
                type="button"
                aria-pressed={reviewFilter === "all"}
                onClick={() => setReviewFilter("all")}
              >
                Todas
              </button>
              <button
                type="button"
                aria-pressed={reviewFilter === "unmatched"}
                onClick={() => setReviewFilter("unmatched")}
              >
                Novas ({unmatchedCount})
              </button>
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={() => updateAllScopes("couple")}
            >
              Tudo Casal
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => updateAllScopes("individual")}
            >
              Tudo Individual
            </button>
          </div>
        </section>
      )}

      {statusMessage && (
        <section className="message card" role="status" aria-live="polite">
          {statusMessage}
        </section>
      )}

      <datalist id={catListId}>
        {DEFAULT_CATEGORIES.map((cat) => (
          <option key={cat} value={cat} />
        ))}
      </datalist>

      {filteredTransactions.length > 0 && (
        <ul className="transactions-list" role="list">
          {filteredTransactions.map((tx) => (
            <li key={tx.id}>
              <article className="transaction-card card">
                <div className="transaction-main">
                  <div className="transaction-meta">
                    <span className="pill">{tx.date}</span>
                    {tx.matchedRuleId && (
                      <span className="pill pill-success">Reconhecido automaticamente</span>
                    )}
                    {tx.installment && (
                      <span className="pill pill-accent">Parcela {tx.installment}</span>
                    )}
                    {tx.section === "international" && <span className="pill">Internacional</span>}
                  </div>

                  <div className="inline-edit-row">
                    <input
                      aria-label={`Nome amigável para ${tx.description}`}
                      className="tx-title-input"
                      type="text"
                      value={tx.friendlyName}
                      onChange={(e) => updateTx(tx.id, { friendlyName: e.target.value })}
                    />
                    <input
                      aria-label={`Categoria para ${tx.description}`}
                      className="tx-category-input"
                      type="text"
                      list={catListId}
                      placeholder="Categoria..."
                      value={tx.category}
                      onChange={(e) => updateTx(tx.id, { category: e.target.value })}
                    />
                  </div>

                  <p className="category">Original na fatura: {tx.description}</p>
                </div>

                <div className="transaction-side">
                  <strong className="amount">{formatBRL(tx.amount)}</strong>

                  <div className="side-controls">
                    <div
                      className="toggle-group"
                      role="group"
                      aria-label={`Classificação de ${tx.description}`}
                    >
                      <button
                        type="button"
                        aria-pressed={tx.scope === "individual"}
                        onClick={() => updateTx(tx.id, { scope: "individual" })}
                      >
                        Individual
                      </button>
                      <button
                        type="button"
                        aria-pressed={tx.scope === "couple"}
                        onClick={() => updateTx(tx.id, { scope: "couple" })}
                      >
                        Casal
                      </button>
                    </div>

                    {tx.scope === "couple" && (
                      <label className="share-pill">
                        <span>Meu %</span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={tx.mySharePct}
                          onChange={(e) =>
                            updateTx(tx.id, {
                              mySharePct: Math.min(100, Math.max(0, Number(e.target.value) || 0)),
                            })
                          }
                        />
                      </label>
                    )}

                    <button
                      type="button"
                      className="secondary-button compact-button"
                      disabled={savingRuleId === tx.id}
                      onClick={() => void handleRememberRule(tx)}
                    >
                      {savingRuleId === tx.id
                        ? "Salvando..."
                        : tx.matchedRuleId
                          ? "Atualizar regra"
                          : "Lembrar regra"}
                    </button>
                  </div>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}

      {futureInstallments.length > 0 && (
        <section className="future-section card">
          <h2>Compras parceladas detectadas para próximas faturas</h2>
          <p className="category">
            Estes compromissos futuros alimentam o cálculo de comprometimento de renda.
          </p>
          <table className="data-table">
            <caption className="visually-hidden">
              Lista de compras parceladas para próximas faturas
            </caption>
            <thead>
              <tr>
                <th scope="col">Data</th>
                <th scope="col">Estabelecimento</th>
                <th scope="col">Parcela</th>
                <th scope="col">Próxima fatura</th>
                <th scope="col">Demais faturas</th>
              </tr>
            </thead>
            <tbody>
              {futureInstallments.map((item) => (
                <tr key={item.id}>
                  <td>{item.date}</td>
                  <td>{item.description}</td>
                  <td>{item.installment ?? "—"}</td>
                  <td>{formatBRL(item.nextBillAmount)}</td>
                  <td>{formatBRL(item.remainingAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
