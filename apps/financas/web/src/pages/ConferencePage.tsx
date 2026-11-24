import { useId, useMemo, useState, type ChangeEvent } from "react";
import type {
  FutureInstallment,
  ParsedBillResult,
  ParsedTransaction,
  TransactionScope,
} from "@financas/shared";
import { formatBRL } from "../lib/format";
import { readAndParseItauPdf } from "../lib/pdfReader";

export interface DraftTransaction extends ParsedTransaction {
  scope: TransactionScope;
}

interface ConferencePageProps {
  pdfParser?: (file: File) => Promise<ParsedBillResult>;
}

export function ConferencePage({ pdfParser = readAndParseItauPdf }: ConferencePageProps) {
  const [transactions, setTransactions] = useState<DraftTransaction[]>([]);
  const [futureInstallments, setFutureInstallments] = useState<FutureInstallment[]>([]);
  const [filter, setFilter] = useState("");
  const [fileName, setFileName] = useState("Aguardando PDF");
  const [statusMessage, setStatusMessage] = useState("Selecione o PDF da fatura para começar.");
  const [isLoading, setIsLoading] = useState(false);

  const fileInputId = useId();
  const searchInputId = useId();

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setStatusMessage("Selecione um arquivo PDF válido.");
      return;
    }

    setIsLoading(true);
    setStatusMessage("Lendo PDF localmente no navegador...");

    try {
      const parsed = await pdfParser(file);
      const nextTransactions: DraftTransaction[] = parsed.transactions.map((tx) => ({
        ...tx,
        scope: "individual",
      }));

      setTransactions(nextTransactions);
      setFutureInstallments(parsed.futureInstallments);
      setFileName(file.name);

      if (nextTransactions.length === 0) {
        setStatusMessage("Não encontrei compras nesse PDF. Confira se é uma fatura Itaú em texto.");
      } else {
        setStatusMessage("");
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

  function updateScope(id: string, scope: TransactionScope) {
    setTransactions((prev) =>
      prev.map((item) => (item.id === id ? { ...item, scope } : item))
    );
  }

  function updateAllScopes(scope: TransactionScope) {
    setTransactions((prev) => prev.map((item) => ({ ...item, scope })));
  }

  const filteredTransactions = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return transactions;

    return transactions.filter((item) =>
      `${item.date} ${item.description} ${item.normalizedMerchant} ${item.category} ${item.section}`
        .toLowerCase()
        .includes(term)
    );
  }, [transactions, filter]);

  const coupleTotal = useMemo(
    () =>
      transactions
        .filter((item) => item.scope === "couple")
        .reduce((sum, item) => sum + item.amount, 0),
    [transactions]
  );

  const futureNextMonthTotal = useMemo(
    () => futureInstallments.reduce((sum, item) => sum + item.nextBillAmount, 0),
    [futureInstallments]
  );

  return (
    <>
      <section className="hero card">
        <div>
          <p className="eyebrow">Fatura de cartão • Local-First</p>
          <h1 id="conteudo-principal" tabIndex={-1}>
            Conferência mensal
          </h1>
          <p className="hero-text">
            Selecione o PDF da fatura do Itaú para leitura 100% local (sem CDN externa), confira as
            compras e marque o que é <strong>Individual</strong> ou <strong>Casal</strong>.
          </p>
        </div>

        <label className="upload-box" htmlFor={fileInputId}>
          <span className="upload-icon" aria-hidden="true">
            ＋
          </span>
          <span>
            <strong>{isLoading ? "Processando PDF..." : "Selecionar PDF"}</strong>
            <small>Processado localmente no navegador com worker embutido</small>
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
          <span className="label">Cada um deve pagar</span>
          <strong data-testid="each-pays">{formatBRL(coupleTotal / 2)}</strong>
          <small>Divisão padrão 50/50</small>
        </article>

        <article className="result-card card">
          <span className="label">Compras encontradas</span>
          <strong data-testid="items-count">{transactions.length}</strong>
          <small>{fileName}</small>
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
            <label htmlFor={searchInputId}>Filtrar compras por estabelecimento</label>
            <input
              id={searchInputId}
              type="search"
              name="search"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Ex.: mercado, farmácia, 04/11..."
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
            />
          </search>

          <div className="toolbar-actions">
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

      {filteredTransactions.length > 0 && (
        <ul className="transactions-list" role="list">
          {filteredTransactions.map((tx) => (
            <li key={tx.id}>
              <article className="transaction-card card">
                <div className="transaction-main">
                  <div className="transaction-meta">
                    <span className="pill">{tx.date}</span>
                    {tx.installment && <span className="pill pill-accent">Parcela {tx.installment}</span>}
                    {tx.section === "international" && <span className="pill">Internacional</span>}
                  </div>
                  <h2>{tx.description}</h2>
                  <p className="category">
                    {tx.category || `Chave normalizada: ${tx.normalizedMerchant}`}
                  </p>
                </div>

                <div className="transaction-side">
                  <strong className="amount">{formatBRL(tx.amount)}</strong>
                  <div
                    className="toggle-group"
                    role="group"
                    aria-label={`Classificação de ${tx.description}`}
                  >
                    <button
                      type="button"
                      aria-pressed={tx.scope === "individual"}
                      onClick={() => updateScope(tx.id, "individual")}
                    >
                      Individual
                    </button>
                    <button
                      type="button"
                      aria-pressed={tx.scope === "couple"}
                      onClick={() => updateScope(tx.id, "couple")}
                    >
                      Casal
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
            Estes compromissos futuros alimentarão o cálculo de comprometimento de renda na Fase 4.
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
