import { useCallback, useEffect, useMemo, useState } from "react";
import type { CouplePlanNote, MonthlyClosing } from "@financas/shared";
import { SkeletonCardList, SkeletonSummaryGrid } from "../components/Loading";
import { formatBRL } from "../lib/format";

interface HistoryPageProps {
  onOpenMonth: (month: string) => void;
}

export function HistoryPage({ onOpenMonth }: HistoryPageProps) {
  const [closings, setClosings] = useState<MonthlyClosing[]>([]);
  const [plans, setPlans] = useState<CouplePlanNote[]>([]);
  const [loading, setLoading] = useState(true);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const [closingsRes, plansRes] = await Promise.all([
        fetch("/api/closings"),
        fetch("/api/couple-plans"),
      ]);
      if (closingsRes.ok) {
        const data = (await closingsRes.json()) as { closings: MonthlyClosing[] };
        setClosings(data.closings);
      }
      if (plansRes.ok) {
        const data = (await plansRes.json()) as { plans: CouplePlanNote[] };
        setPlans(data.plans);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const totalCoupleSavedAllTime = useMemo(
    () => closings.reduce((sum, item) => sum + (item.coupleSavedThisMonth || 0), 0),
    [closings]
  );

  const maxSaved = useMemo(
    () => Math.max(1, ...closings.map((item) => item.coupleSavedThisMonth || 0)),
    [closings]
  );

  return (
    <div className="stack-lg">
      <section className="card section-card">
        <p className="eyebrow">Memória mensal do casal</p>
        <h1 id="conteudo-principal" tabIndex={-1}>
          Histórico de Fechamentos
        </h1>
        <p className="hero-text">
          Acompanhe a evolução dos fechamentos mensais, quanto vocês conseguiram guardar juntos e os
          planos ativos do casal.
        </p>

        {loading ? (
          <SkeletonSummaryGrid
            highlightIndex={1}
            label="Carregando histórico de fechamentos..."
          />
        ) : (
          <div className="summary-grid">
            <article className="result-card card">
              <span className="label">Meses registrados</span>
              <strong>{closings.length}</strong>
              <small>Snapshots salvos com Zero-Knowledge</small>
            </article>

            <article className="result-card highlight card">
              <span className="label">Guardado juntos (histórico)</span>
              <strong>{formatBRL(totalCoupleSavedAllTime)}</strong>
              <small>Soma dos check-ins mensais</small>
            </article>

            <article className="result-card card">
              <span className="label">Planos ativos do casal</span>
              <strong>{plans.filter((p) => p.status === "active").length}</strong>
              <small>Considerados pelo assistente de planejamento</small>
            </article>

            <article className="result-card card">
              <span className="label">Último fechamento</span>
              <strong>{closings[0]?.month ?? "—"}</strong>
              <small>{closings[0]?.status === "closed" ? "Fechado" : "Rascunho"}</small>
            </article>
          </div>
        )}
      </section>

      {plans.length > 0 && (
        <section className="card section-card">
          <h2>Planos do casal registrados</h2>
          <ul className="plan-list" role="list">
            {plans.map((plan) => (
              <li key={plan.id} className="plan-item">
                <span className={`pill ${plan.status === "done" ? "pill-success" : "pill-accent"}`}>
                  {plan.status === "done" ? "Concluído" : "Ativo"}
                </span>
                <span className={plan.status === "done" ? "line-through" : ""}>{plan.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card section-card">
        <h2>Competências mensais</h2>
        {loading ? (
          <SkeletonCardList count={3} />
        ) : closings.length === 0 ? (
          <p className="category">
            Nenhum mês fechado ainda. Faça sua primeira conferência e clique em &ldquo;Fechar mês
            (Check-in)&rdquo;.
          </p>
        ) : (
          <ul className="transactions-list" role="list">
            {closings.map((item) => {
              const barPct = Math.round(((item.coupleSavedThisMonth || 0) / maxSaved) * 100);
              return (
                <li key={item.id}>
                  <article className="transaction-card card">
                    <div className="transaction-main">
                      <div className="transaction-meta">
                        <span className="pill">{item.month}</span>
                        <span
                          className={`pill ${item.status === "closed" ? "pill-success" : "pill-accent"}`}
                        >
                          {item.status === "closed" ? "Fechado" : "Rascunho"}
                        </span>
                      </div>

                      <h2>
                        Casal: {formatBRL(item.totalCoupleExpenses)} • Meu gasto total:{" "}
                        {formatBRL(item.totalMyExpenses)}
                      </h2>
                      <p className="category">
                        Guardado juntos no mês: <strong>{formatBRL(item.coupleSavedThisMonth)}</strong>
                        {item.coupleCheckinNotes ? ` • ${item.coupleCheckinNotes}` : ""}
                      </p>

                      <div className="progress-track" aria-hidden="true">
                        <div className="progress-fill" style={{ width: `${barPct}%` }} />
                      </div>
                    </div>

                    <div className="transaction-side">
                      <strong className="amount">
                        {item.netSettlementAmount >= 0
                          ? `+${formatBRL(item.netSettlementAmount)}`
                          : formatBRL(item.netSettlementAmount)}
                      </strong>
                      <small className="category">
                        {item.netSettlementAmount > 0
                          ? "Ela transferiu"
                          : item.netSettlementAmount < 0
                            ? "Você transferiu"
                            : "Quitado"}
                      </small>
                      <button
                        type="button"
                        className="secondary-button compact-button"
                        onClick={() => onOpenMonth(item.month)}
                      >
                        Abrir mês
                      </button>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
