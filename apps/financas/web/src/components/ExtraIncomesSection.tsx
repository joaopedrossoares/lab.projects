import { useId, useState, type FormEvent } from "react";
import type { MonthlyExtraIncome, ReserveState } from "@financas/shared";
import { CurrencyInput } from "./CurrencyInput";
import { LoadingButtonContent, SkeletonCardList } from "./Loading";
import { formatBRL } from "../lib/format";

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

interface ExtraIncomesSectionProps {
  /** Locks the form to a specific YYYY-MM month (e.g., on ConferencePage). */
  fixedMonth?: string;
  items: MonthlyExtraIncome[];
  loading?: boolean;
  compact?: boolean;
  onChanged: (payload?: { reserve?: ReserveState }) => Promise<void> | void;
}

export function ExtraIncomesSection({
  fixedMonth,
  items,
  loading = false,
  compact = false,
  onChanged,
}: ExtraIncomesSectionProps) {
  const [selectedMonth, setSelectedMonth] = useState(fixedMonth || getCurrentMonth());
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState(0);
  const [toReserve, setToReserve] = useState(0);
  const [toCouple, setToCouple] = useState(0);
  const [applyToBalances, setApplyToBalances] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");

  const monthId = useId();
  const titleId = useId();
  const amountId = useId();
  const reserveId = useId();
  const coupleId = useId();
  const applyId = useId();

  const activeMonth = fixedMonth || selectedMonth;
  const allocatedManual = round2(Math.max(0, toReserve) + Math.max(0, toCouple));
  const exceedsAmount = amount > 0 && allocatedManual > round2(amount);
  const toChecking = exceedsAmount ? 0 : round2(Math.max(0, amount - allocatedManual));
  const totalExtras = round2(items.reduce((sum, item) => sum + item.amount, 0));

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (!title.trim() || !Number.isFinite(amount) || amount <= 0) {
      setFeedback("Informe uma descrição e um valor positivo para a entrada extra.");
      return;
    }
    if (exceedsAmount) {
      setFeedback("A soma destinada para Reserva e Casal não pode ultrapassar o valor total.");
      return;
    }

    setSaving(true);
    setFeedback("");
    try {
      const res = await fetch("/api/safety/extra-incomes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month: activeMonth,
          title: title.trim(),
          amount,
          toReserve,
          toCouple,
          applyToBalances,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback(data.error || "Não foi possível registrar a entrada extra.");
        return;
      }

      setTitle("");
      setAmount(0);
      setToReserve(0);
      setToCouple(0);
      setFeedback(
        applyToBalances
          ? `Entrada extra registrada (${activeMonth}) e saldos atualizados automaticamente.`
          : `Entrada extra registrada apenas no histórico de ${activeMonth} (saldos atuais mantidos).`
      );
      await onChanged({ reserve: data.reserve });
    } catch {
      setFeedback("Falha ao salvar entrada extra no Edge Local.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(item: MonthlyExtraIncome) {
    if (deletingId) return;
    setDeletingId(item.id);
    setFeedback("");
    try {
      const res = await fetch(`/api/safety/extra-incomes/${encodeURIComponent(item.id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback(data.error || "Não foi possível remover a entrada extra.");
        return;
      }
      setFeedback(
        data.revertedBalances
          ? `Entrada "${item.title}" removida e valores estornados dos saldos.`
          : `Entrada "${item.title}" removida.`
      );
      await onChanged({ reserve: data.reserve });
    } catch {
      setFeedback("Falha ao remover entrada extra.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className={`card section-card ${compact ? "compact-card" : ""}`.trim()}>
      <div className="section-header-row">
        <div>
          <h2>
            {fixedMonth
              ? `Entradas Extras do Mês (${fixedMonth})`
              : "Entradas Extras Pontuais (13º, PLR, freela, reembolso)"}
          </h2>
          <p className="category">
            Não altera sua renda fixa mensal; divide o valor entre Reserva, Casal e Fluxo de Caixa
            (Conta Corrente).
          </p>
        </div>
        {items.length > 0 && (
          <span className="pill pill-success">Total extras: {formatBRL(totalExtras)}</span>
        )}
      </div>

      <form className="stack-md" onSubmit={handleSubmit}>
        <div className="inline-form">
          {!fixedMonth && (
            <div className="field field-compact">
              <label htmlFor={monthId}>Mês</label>
              <input
                id={monthId}
                type="month"
                required
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
              />
            </div>
          )}

          <div className="field">
            <label htmlFor={titleId}>Descrição da entrada</label>
            <input
              id={titleId}
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex.: 13º salário, PLR, freela, reembolso, venda..."
            />
          </div>

          <div className="field field-compact">
            <label htmlFor={amountId}>Valor total</label>
            <CurrencyInput
              id={amountId}
              required
              emptyWhenZero
              value={amount}
              onChange={setAmount}
            />
          </div>

          <div className="field field-compact">
            <label htmlFor={reserveId}>Para Reserva</label>
            <CurrencyInput id={reserveId} value={toReserve} onChange={setToReserve} />
          </div>

          <div className="field field-compact">
            <label htmlFor={coupleId}>Para Casal</label>
            <CurrencyInput id={coupleId} value={toCouple} onChange={setToCouple} />
          </div>

          <div className="field field-compact">
            <span className="field-caption">Fica no Fluxo de Caixa</span>
            <output
              className={`allocation-output ${exceedsAmount ? "allocation-output-error" : ""}`.trim()}
              data-testid="extra-to-checking"
            >
              {exceedsAmount ? "Excede o total" : formatBRL(toChecking)}
            </output>
          </div>
        </div>

        <div className="section-header-row">
          <label className="plan-checkbox" htmlFor={applyId}>
            <input
              id={applyId}
              type="checkbox"
              checked={applyToBalances}
              onChange={(e) => setApplyToBalances(e.target.checked)}
            />
            <span>
              Atualizar meus saldos automaticamente (Reserva, Casal e Conta Corrente)
            </span>
          </label>

          <button type="submit" className="primary-button" disabled={saving}>
            <LoadingButtonContent
              loading={saving}
              loadingLabel="Salvando entrada..."
              idleLabel="Registrar entrada extra"
            />
          </button>
        </div>
      </form>

      {feedback && (
        <p className="status-inline" role="status" aria-live="polite">
          {feedback}
        </p>
      )}

      {loading ? (
        <SkeletonCardList count={2} />
      ) : items.length > 0 ? (
        <ul className="transactions-list" role="list">
          {items.map((item) => (
            <li key={item.id}>
              <article className="transaction-card card">
                <div className="transaction-main">
                  <div className="transaction-meta">
                    {!fixedMonth && <span className="pill">{item.month}</span>}
                    <span className="pill pill-success">Entrada extra</span>
                    {item.allocation.toReserve > 0 && (
                      <span className="pill">
                        Reserva: {formatBRL(item.allocation.toReserve)}
                      </span>
                    )}
                    {item.allocation.toCouple > 0 && (
                      <span className="pill pill-accent">
                        Casal: {formatBRL(item.allocation.toCouple)}
                      </span>
                    )}
                    {item.allocation.toChecking > 0 && (
                      <span className="pill">
                        Fluxo de caixa: {formatBRL(item.allocation.toChecking)}
                      </span>
                    )}
                    <span className="pill">
                      {item.appliedToBalances ? "Saldos atualizados" : "Somente registro"}
                    </span>
                  </div>
                  <h2>{item.title}</h2>
                </div>

                <div className="toolbar-actions">
                  <strong className="amount">{formatBRL(item.amount)}</strong>
                  <button
                    type="button"
                    className="danger-button compact-button"
                    disabled={deletingId === item.id}
                    onClick={() => void handleDelete(item)}
                  >
                    <LoadingButtonContent
                      loading={deletingId === item.id}
                      loadingLabel="Removendo..."
                      idleLabel="Remover"
                    />
                  </button>
                </div>
              </article>
            </li>
          ))}
        </ul>
      ) : (
        <p className="category" style={{ marginBlockStart: "14px" }}>
          {fixedMonth
            ? `Nenhuma entrada extra registrada em ${fixedMonth}.`
            : "Nenhuma entrada extra registrada ainda."}
        </p>
      )}
    </section>
  );
}
