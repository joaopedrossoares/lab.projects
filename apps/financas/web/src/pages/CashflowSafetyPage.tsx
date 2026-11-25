import { useCallback, useEffect, useState, type FormEvent } from "react";
import type {
  FutureInstallment,
  PaidBy,
  RecurringCashflow,
  ReserveState,
  SafetyIndicators,
  TransactionScope,
  UserProfile,
} from "@financas/shared";
import { CurrencyInput } from "../components/CurrencyInput";
import {
  LoadingButtonContent,
  LoadingSpinner,
  SkeletonCardList,
  SkeletonFormGrid,
  SkeletonSummaryGrid,
} from "../components/Loading";
import { formatBRL } from "../lib/format";

interface SafetyBreakdown {
  monthlyIncome: number;
  myFixedMonthlyCost: number;
  committedInstallmentsNextMonth: number;
  avgCoupleSavingsShare: number;
  avgVariableExpenses: number;
  targetMonthlySavings: number;
}

interface SafetyOverviewResponse {
  indicators: SafetyIndicators;
  breakdown: SafetyBreakdown;
  recurring: RecurringCashflow[];
  reserve: ReserveState;
  profile: UserProfile;
  futureInstallments: FutureInstallment[];
}

const HEALTH_LABELS: Record<SafetyIndicators["healthStatus"], { text: string; badgeClass: string }> = {
  shielded: { text: "Blindado", badgeClass: "pill-success" },
  comfortable: { text: "Confortável", badgeClass: "pill-success" },
  stable: { text: "Estável", badgeClass: "pill-accent" },
  attention: { text: "Atenção", badgeClass: "pill-warn" },
  critical: { text: "Crítico", badgeClass: "pill-danger" },
};

export function CashflowSafetyPage() {
  const [data, setData] = useState<SafetyOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState("");
  const [addingRecurring, setAddingRecurring] = useState(false);
  const [deletingRecurringId, setDeletingRecurringId] = useState<string | null>(null);
  const [savingReserve, setSavingReserve] = useState(false);
  const [savingTargets, setSavingTargets] = useState(false);

  // Recurring form
  const [direction, setDirection] = useState<"income" | "expense">("income");
  const [title, setTitle] = useState("");
  const [expectedAmount, setExpectedAmount] = useState(0);
  const [scope, setScope] = useState<TransactionScope>("couple");
  const [paidBy, setPaidBy] = useState<PaidBy>("me");
  const [mySharePct, setMySharePct] = useState(50);

  // Reserve form
  const [liquidReserve, setLiquidReserve] = useState(0);
  const [coupleSavings, setCoupleSavings] = useState(0);
  const [otherInvestments, setOtherInvestments] = useState(0);

  // Indicator targets form
  const [targetRunway, setTargetRunway] = useState(6);
  const [maxCommitment, setMaxCommitment] = useState(60);
  const [targetSavingsRate, setTargetSavingsRate] = useState(20);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/safety/overview");
      if (!res.ok) return;
      const payload = (await res.json()) as SafetyOverviewResponse;
      setData(payload);
      setLiquidReserve(payload.reserve.liquidEmergencyReserve ?? 0);
      setCoupleSavings(payload.reserve.coupleAccumulatedSavings ?? 0);
      setOtherInvestments(payload.reserve.otherInvestments ?? 0);
      setTargetRunway(payload.profile.targetRunwayMonths ?? 6);
      setMaxCommitment(payload.profile.maxCommitmentPct ?? 60);
      setTargetSavingsRate(payload.profile.targetSavingsRatePct ?? 20);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  async function handleAddRecurring(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !Number.isFinite(expectedAmount) || expectedAmount <= 0 || addingRecurring) {
      return;
    }

    setAddingRecurring(true);
    setFeedback("");
    try {
      const res = await fetch("/api/safety/cashflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          direction,
          title: title.trim(),
          expectedAmount,
          scope: direction === "income" ? "individual" : scope,
          paidBy: direction === "income" ? "me" : paidBy,
          mySharePct: scope === "couple" ? mySharePct : 100,
        }),
      });

      if (res.ok) {
        setTitle("");
        setExpectedAmount(0);
        setFeedback("Item de fluxo recorrente salvo.");
        await loadOverview();
      } else {
        setFeedback("Não foi possível salvar o item recorrente.");
      }
    } catch {
      setFeedback("Falha ao salvar o item recorrente.");
    } finally {
      setAddingRecurring(false);
    }
  }

  async function handleDeleteRecurring(id: string) {
    setDeletingRecurringId(id);
    setFeedback("");
    try {
      const res = await fetch(`/api/safety/cashflow/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setFeedback("Item removido.");
        await loadOverview();
      } else {
        setFeedback("Não foi possível remover o item.");
      }
    } catch {
      setFeedback("Falha ao remover o item.");
    } finally {
      setDeletingRecurringId(null);
    }
  }

  async function handleSaveReserve(event: FormEvent) {
    event.preventDefault();
    if (savingReserve) return;
    setSavingReserve(true);
    setFeedback("");
    try {
      const res = await fetch("/api/safety/reserve", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          liquidEmergencyReserve: liquidReserve,
          coupleAccumulatedSavings: coupleSavings,
          otherInvestments,
        }),
      });
      if (res.ok) {
        setFeedback("Reservas atualizadas e indicadores recalculados.");
        await loadOverview();
      } else {
        setFeedback("Não foi possível atualizar as reservas.");
      }
    } catch {
      setFeedback("Falha ao salvar reservas.");
    } finally {
      setSavingReserve(false);
    }
  }

  async function handleSaveTargets(event: FormEvent) {
    event.preventDefault();
    if (savingTargets) return;
    setSavingTargets(true);
    setFeedback("");
    try {
      const res = await fetch("/api/safety/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetRunwayMonths: targetRunway,
          maxCommitmentPct: maxCommitment,
          targetSavingsRatePct: targetSavingsRate,
        }),
      });
      if (res.ok) {
        setFeedback("Metas de segurança financeira atualizadas.");
        await loadOverview();
      } else {
        setFeedback("Não foi possível atualizar as metas.");
      }
    } catch {
      setFeedback("Falha ao atualizar metas.");
    } finally {
      setSavingTargets(false);
    }
  }

  const indicators = data?.indicators;
  const breakdown = data?.breakdown;
  const healthBadge = indicators ? HEALTH_LABELS[indicators.healthStatus] : null;
  const initialLoading = loading && !data;

  return (
    <div className="stack-lg">
      <section className="card section-card">
        <div className="transaction-meta">
          <p className="eyebrow">Cálculo determinístico • Pessoal + Casal</p>
          {healthBadge && <span className={`pill ${healthBadge.badgeClass}`}>Saúde: {healthBadge.text}</span>}
          {loading && data && <LoadingSpinner size="sm" label="Recalculando indicadores" />}
        </div>
        <h1 id="conteudo-principal" tabIndex={-1}>
          Fluxo de Caixa & Segurança Financeira
        </h1>
        <p className="hero-text">
          Cadastre suas entradas e despesas fixas recorrentes (incluindo sua cota do casal) e suas
          reservas para acompanhar seus 4 indicadores de segurança em tempo real.
        </p>

        {initialLoading ? (
          <SkeletonSummaryGrid
            highlightIndex={3}
            label="Calculando indicadores de segurança..."
          />
        ) : indicators && breakdown ? (
          <div className="summary-grid">
            <article className="result-card card">
              <span className="label">1. Runway da Reserva</span>
              <strong>{indicators.runwayMonths.toFixed(1)} meses</strong>
              <small>
                Meta: {targetRunway} meses • Custo base: {formatBRL(indicators.monthlyEssentialCost)}
              </small>
            </article>

            <article className="result-card card">
              <span className="label">2. Taxa de Poupança</span>
              <strong>{indicators.savingsRatePct.toFixed(0)}%</strong>
              <small>Meta configurada: {targetSavingsRate}% da renda</small>
            </article>

            <article className="result-card card">
              <span className="label">3. Comprometimento</span>
              <strong>{indicators.incomeCommitmentPct.toFixed(0)}%</strong>
              <small>
                Limite: {maxCommitment}% • Fixos {formatBRL(breakdown.myFixedMonthlyCost)} + Parcelas{" "}
                {formatBRL(breakdown.committedInstallmentsNextMonth)}
              </small>
            </article>

            <article className="result-card highlight card">
              <span className="label">4. Margem Segura Livre</span>
              <strong>{formatBRL(indicators.safeFreeMargin)}</strong>
              <small>Disponível/mês após fixos, casal, parcelas e meta de poupança</small>
            </article>
          </div>
        ) : null}

        {feedback && (
          <p className="status-inline" role="status" aria-live="polite">
            {feedback}
          </p>
        )}
      </section>

      <div className="two-col-grid">
        <section className="card section-card">
          <h2>Reservas & Patrimônio</h2>
          {initialLoading ? (
            <SkeletonFormGrid fields={3} />
          ) : (
            <form className="stack-md" onSubmit={handleSaveReserve}>
              <div className="field">
                <label htmlFor="res-liquid">Minha reserva líquida de emergência</label>
                <CurrencyInput
                  id="res-liquid"
                  value={liquidReserve}
                  onChange={setLiquidReserve}
                />
              </div>

              <div className="field">
                <label htmlFor="res-couple">Economias acumuladas do casal</label>
                <CurrencyInput
                  id="res-couple"
                  value={coupleSavings}
                  onChange={setCoupleSavings}
                />
              </div>

              <div className="field">
                <label htmlFor="res-other">Outros investimentos</label>
                <CurrencyInput
                  id="res-other"
                  value={otherInvestments}
                  onChange={setOtherInvestments}
                />
              </div>

              <button type="submit" className="primary-button" disabled={savingReserve}>
                <LoadingButtonContent
                  loading={savingReserve}
                  loadingLabel="Salvando reservas..."
                  idleLabel="Salvar reservas"
                />
              </button>
            </form>
          )}
        </section>

        <section className="card section-card">
          <h2>Metas dos 4 Indicadores</h2>
          {initialLoading ? (
            <SkeletonFormGrid fields={3} />
          ) : (
            <form className="stack-md" onSubmit={handleSaveTargets}>
              <div className="field">
                <label htmlFor="meta-runway">Meta de Runway (meses de reserva)</label>
                <input
                  id="meta-runway"
                  type="number"
                  min={1}
                  max={36}
                  value={targetRunway}
                  onChange={(e) => setTargetRunway(Number(e.target.value))}
                />
              </div>

              <div className="field">
                <label htmlFor="meta-commit">Limite máximo de comprometimento de renda (%)</label>
                <input
                  id="meta-commit"
                  type="number"
                  min={10}
                  max={95}
                  value={maxCommitment}
                  onChange={(e) => setMaxCommitment(Number(e.target.value))}
                />
              </div>

              <div className="field">
                <label htmlFor="meta-savings">Meta mínima de poupança mensal (%)</label>
                <input
                  id="meta-savings"
                  type="number"
                  min={0}
                  max={80}
                  value={targetSavingsRate}
                  onChange={(e) => setTargetSavingsRate(Number(e.target.value))}
                />
              </div>

              <button type="submit" className="secondary-button" disabled={savingTargets}>
                <LoadingButtonContent
                  loading={savingTargets}
                  loadingLabel="Atualizando metas..."
                  idleLabel="Atualizar metas"
                />
              </button>
            </form>
          )}
        </section>
      </div>

      <section className="card section-card">
        <h2>Entradas & Saídas Recorrentes (Auto-base mensal)</h2>
        <form className="inline-form" onSubmit={handleAddRecurring}>
          <div className="field field-compact">
            <label htmlFor="cf-dir">Tipo</label>
            <select
              id="cf-dir"
              value={direction}
              onChange={(e) => setDirection(e.target.value as "income" | "expense")}
            >
              <option value="income">Entrada (Receita)</option>
              <option value="expense">Saída Fixa</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="cf-title">Descrição</label>
            <input
              id="cf-title"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={direction === "income" ? "Ex.: Salário líquido" : "Ex.: Aluguel, Internet..."}
            />
          </div>

          <div className="field field-compact">
            <label htmlFor="cf-amt">Valor mensal</label>
            <CurrencyInput
              id="cf-amt"
              required
              emptyWhenZero
              value={expectedAmount}
              onChange={setExpectedAmount}
            />
          </div>

          {direction === "expense" && (
            <>
              <div className="field field-compact">
                <label htmlFor="cf-scope">Escopo</label>
                <select
                  id="cf-scope"
                  value={scope}
                  onChange={(e) => setScope(e.target.value as TransactionScope)}
                >
                  <option value="couple">Casal</option>
                  <option value="individual">Individual</option>
                </select>
              </div>
              <div className="field field-compact">
                <label htmlFor="cf-paidby">Quem paga</label>
                <select
                  id="cf-paidby"
                  value={paidBy}
                  onChange={(e) => setPaidBy(e.target.value as PaidBy)}
                >
                  <option value="me">Eu pago</option>
                  <option value="partner">Ela paga</option>
                </select>
              </div>
              {scope === "couple" && (
                <div className="field field-compact">
                  <label htmlFor="cf-pct">Meu %</label>
                  <input
                    id="cf-pct"
                    type="number"
                    min={0}
                    max={100}
                    value={mySharePct}
                    onChange={(e) => setMySharePct(Number(e.target.value))}
                  />
                </div>
              )}
            </>
          )}

          <button type="submit" className="primary-button" disabled={addingRecurring}>
            <LoadingButtonContent
              loading={addingRecurring}
              loadingLabel="Adicionando..."
              idleLabel="Adicionar"
            />
          </button>
        </form>

        {initialLoading ? (
          <SkeletonCardList count={3} />
        ) : data && data.recurring.length > 0 ? (
          <ul className="transactions-list" role="list">
            {data.recurring.map((item) => (
              <li key={item.id}>
                <article className="transaction-card card">
                  <div className="transaction-main">
                    <div className="transaction-meta">
                      <span
                        className={`pill ${item.direction === "income" ? "pill-success" : "pill-accent"}`}
                      >
                        {item.direction === "income" ? "Entrada" : "Saída Fixa"}
                      </span>
                      {item.direction === "expense" && (
                        <span className="pill">
                          {item.scope === "couple"
                            ? `Casal (${item.mySharePct}% meu)`
                            : "Individual"}
                        </span>
                      )}
                    </div>
                    <h2>{item.title}</h2>
                  </div>

                  <div className="toolbar-actions">
                    <strong className="amount">{formatBRL(item.expectedAmount)}</strong>
                    <button
                      type="button"
                      className="danger-button compact-button"
                      disabled={deletingRecurringId === item.id}
                      onClick={() => void handleDeleteRecurring(item.id)}
                    >
                      <LoadingButtonContent
                        loading={deletingRecurringId === item.id}
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
          <p className="category">
            Cadastre sua renda mensal e principais contas fixas acima para ativar os indicadores.
          </p>
        )}
      </section>

      {data && data.futureInstallments.length > 0 && (
        <section className="card section-card">
          <h2>Parcelas Futuras Comprometidas ({data.futureInstallments.length})</h2>
          <p className="category">
            Extraídas automaticamente da sua última fatura Itaú importada e descontadas da sua
            Margem Segura Livre.
          </p>
          <table className="data-table">
            <caption className="visually-hidden">Parcelas futuras comprometidas</caption>
            <thead>
              <tr>
                <th scope="col">Estabelecimento</th>
                <th scope="col">Parcela</th>
                <th scope="col">Próxima fatura</th>
                <th scope="col">Restante total</th>
              </tr>
            </thead>
            <tbody>
              {data.futureInstallments.map((item) => (
                <tr key={item.id}>
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
    </div>
  );
}
