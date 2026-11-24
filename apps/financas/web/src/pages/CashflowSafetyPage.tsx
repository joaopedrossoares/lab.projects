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

  // Recurring form
  const [direction, setDirection] = useState<"income" | "expense">("income");
  const [title, setTitle] = useState("");
  const [expectedAmount, setExpectedAmount] = useState("");
  const [scope, setScope] = useState<TransactionScope>("couple");
  const [paidBy, setPaidBy] = useState<PaidBy>("me");
  const [mySharePct, setMySharePct] = useState(50);

  // Reserve form
  const [liquidReserve, setLiquidReserve] = useState("0");
  const [coupleSavings, setCoupleSavings] = useState("0");
  const [otherInvestments, setOtherInvestments] = useState("0");

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
      setLiquidReserve(String(payload.reserve.liquidEmergencyReserve ?? 0));
      setCoupleSavings(String(payload.reserve.coupleAccumulatedSavings ?? 0));
      setOtherInvestments(String(payload.reserve.otherInvestments ?? 0));
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
    const numeric = Number(expectedAmount.replace(",", "."));
    if (!title.trim() || !Number.isFinite(numeric) || numeric <= 0) return;

    const res = await fetch("/api/safety/cashflow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        direction,
        title: title.trim(),
        expectedAmount: numeric,
        scope: direction === "income" ? "individual" : scope,
        paidBy: direction === "income" ? "me" : paidBy,
        mySharePct: scope === "couple" ? mySharePct : 100,
      }),
    });

    if (res.ok) {
      setTitle("");
      setExpectedAmount("");
      setFeedback("Item de fluxo recorrente salvo.");
      await loadOverview();
    }
  }

  async function handleDeleteRecurring(id: string) {
    const res = await fetch(`/api/safety/cashflow/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setFeedback("Item removido.");
      await loadOverview();
    }
  }

  async function handleSaveReserve(event: FormEvent) {
    event.preventDefault();
    const res = await fetch("/api/safety/reserve", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        liquidEmergencyReserve: Number(liquidReserve.replace(",", ".")) || 0,
        coupleAccumulatedSavings: Number(coupleSavings.replace(",", ".")) || 0,
        otherInvestments: Number(otherInvestments.replace(",", ".")) || 0,
      }),
    });
    if (res.ok) {
      setFeedback("Reservas atualizadas e indicadores recalculados.");
      await loadOverview();
    }
  }

  async function handleSaveTargets(event: FormEvent) {
    event.preventDefault();
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
    }
  }

  const indicators = data?.indicators;
  const breakdown = data?.breakdown;
  const healthBadge = indicators ? HEALTH_LABELS[indicators.healthStatus] : null;

  return (
    <div className="stack-lg">
      <section className="card section-card">
        <div className="transaction-meta">
          <p className="eyebrow">Cálculo determinístico • Pessoal + Casal</p>
          {healthBadge && <span className={`pill ${healthBadge.badgeClass}`}>Saúde: {healthBadge.text}</span>}
        </div>
        <h1 id="conteudo-principal" tabIndex={-1}>
          Fluxo de Caixa & Segurança Financeira
        </h1>
        <p className="hero-text">
          Cadastre suas entradas e despesas fixas recorrentes (incluindo sua cota do casal) e suas
          reservas para acompanhar seus 4 indicadores de segurança em tempo real.
        </p>

        {loading && !indicators ? (
          <p className="category">Calculando indicadores...</p>
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
          <form className="stack-md" onSubmit={handleSaveReserve}>
            <div className="field">
              <label htmlFor="res-liquid">Minha reserva líquida de emergência (R$)</label>
              <input
                id="res-liquid"
                type="text"
                inputMode="decimal"
                value={liquidReserve}
                onChange={(e) => setLiquidReserve(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="res-couple">Economias acumuladas do casal (R$)</label>
              <input
                id="res-couple"
                type="text"
                inputMode="decimal"
                value={coupleSavings}
                onChange={(e) => setCoupleSavings(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="res-other">Outros investimentos (R$)</label>
              <input
                id="res-other"
                type="text"
                inputMode="decimal"
                value={otherInvestments}
                onChange={(e) => setOtherInvestments(e.target.value)}
              />
            </div>

            <button type="submit" className="primary-button">
              Salvar reservas
            </button>
          </form>
        </section>

        <section className="card section-card">
          <h2>Metas dos 4 Indicadores</h2>
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

            <button type="submit" className="secondary-button">
              Atualizar metas
            </button>
          </form>
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
            <label htmlFor="cf-amt">Valor mensal (R$)</label>
            <input
              id="cf-amt"
              type="text"
              inputMode="decimal"
              required
              value={expectedAmount}
              onChange={(e) => setExpectedAmount(e.target.value)}
              placeholder="2500,00"
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

          <button type="submit" className="primary-button">
            Adicionar
          </button>
        </form>

        {data && data.recurring.length > 0 ? (
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
                      onClick={() => void handleDeleteRecurring(item.id)}
                    >
                      Remover
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
