// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LoadingSpinner } from "./Loading";
import { CashflowSafetyPage } from "../pages/CashflowSafetyPage";
import { HistoryPage } from "../pages/HistoryPage";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("Skeleton e Loading states", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renderiza LoadingSpinner como <progress> nativo indeterminado", () => {
    render(<LoadingSpinner label="Carregando dados" />);
    const progress = screen.getByRole("progressbar", { name: "Carregando dados" });
    expect(progress.tagName).toBe("PROGRESS");
    expect(progress).not.toHaveAttribute("value");
  });

  it("exibe skeletons no Histórico enquanto carrega e substitui pelos dados ao concluir", async () => {
    const closingsReq = deferred<Response>();
    const plansReq = deferred<Response>();

    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.includes("/api/closings")) return closingsReq.promise;
      return plansReq.promise;
    });

    render(<HistoryPage onOpenMonth={() => {}} />);

    expect(screen.getByTestId("skeleton-summary-grid")).toBeInTheDocument();
    expect(screen.getByTestId("skeleton-card-list")).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "Carregando histórico de fechamentos..." })
    ).toBeInTheDocument();

    closingsReq.resolve(
      new Response(
        JSON.stringify({
          closings: [
            {
              id: "closing-2026-11",
              month: "2026-11",
              status: "closed",
              totalCoupleExpenses: 1200,
              totalMyExpenses: 900,
              netSettlementAmount: 150,
              coupleSavedThisMonth: 500,
              coupleCheckinNotes: "Mês equilibrado",
              updatedAt: "2026-11-24T00:00:00Z",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    plansReq.resolve(
      new Response(JSON.stringify({ plans: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    await waitFor(() => {
      expect(screen.queryByTestId("skeleton-summary-grid")).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId("skeleton-card-list")).not.toBeInTheDocument();
    expect(screen.getByText(/Mês equilibrado/)).toBeInTheDocument();
  });

  it("exibe skeleton na tela de Segurança e desabilita botão durante salvamento de reservas", async () => {
    const initialReq = deferred<Response>();
    const saveReq = deferred<Response>();

    const overviewPayload = {
      indicators: {
        runwayMonths: 6.5,
        monthlyEssentialCost: 3000,
        savingsRatePct: 25,
        incomeCommitmentPct: 45,
        safeFreeMargin: 1500,
        healthStatus: "comfortable",
      },
      breakdown: {
        monthlyIncome: 8000,
        myFixedMonthlyCost: 2800,
        committedInstallmentsNextMonth: 400,
        avgCoupleSavingsShare: 500,
        avgVariableExpenses: 700,
        targetMonthlySavings: 1600,
      },
      recurring: [],
      reserve: {
        liquidEmergencyReserve: 19500,
        coupleAccumulatedSavings: 5000,
        otherInvestments: 10000,
      },
      profile: {
        targetRunwayMonths: 6,
        maxCommitmentPct: 60,
        targetSavingsRatePct: 20,
      },
      futureInstallments: [],
    };

    let overviewCalls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url.includes("/api/safety/overview")) {
        overviewCalls += 1;
        if (overviewCalls === 1) return initialReq.promise;
        return Promise.resolve(
          new Response(JSON.stringify(overviewPayload), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      if (url.includes("/api/safety/reserve") && init?.method === "PUT") {
        return saveReq.promise;
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    });

    render(<CashflowSafetyPage />);

    expect(screen.getByTestId("skeleton-summary-grid")).toBeInTheDocument();
    expect(screen.getAllByTestId("skeleton-form")).toHaveLength(2);

    initialReq.resolve(
      new Response(JSON.stringify(overviewPayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const saveButton = await screen.findByRole("button", { name: "Salvar reservas" });
    expect(screen.queryByTestId("skeleton-summary-grid")).not.toBeInTheDocument();

    fireEvent.click(saveButton);

    await waitFor(() => {
      const busyButton = screen.getByRole("button", { name: "Salvando reservas..." });
      expect(busyButton).toBeDisabled();
    });

    saveReq.resolve(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Salvar reservas" })).toBeEnabled();
    });
  });
});
