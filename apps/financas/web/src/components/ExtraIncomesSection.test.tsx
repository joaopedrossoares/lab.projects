// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ExtraIncomesSection } from "./ExtraIncomesSection";

describe("ExtraIncomesSection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calcula automaticamente o restante no Fluxo de Caixa e envia alocação completa ao salvar", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          item: {
            id: "extra-2026-11-1",
            kind: "extra",
            month: "2026-11",
            title: "13º Salário",
            amount: 3000,
            allocation: { toReserve: 1000, toCouple: 500, toChecking: 1500 },
            appliedToBalances: true,
            updatedAt: "2026-11-25T00:00:00Z",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    const onChanged = vi.fn();

    render(
      <ExtraIncomesSection fixedMonth="2026-11" items={[]} onChanged={onChanged} />
    );

    fireEvent.change(screen.getByLabelText("Descrição da entrada"), {
      target: { value: "13º Salário" },
    });
    // CurrencyInput uses cent-based typing: 300000 -> R$ 3.000,00
    fireEvent.change(screen.getByLabelText("Valor total"), {
      target: { value: "300000" },
    });
    fireEvent.change(screen.getByLabelText("Para Reserva"), {
      target: { value: "100000" },
    });
    fireEvent.change(screen.getByLabelText("Para Casal"), {
      target: { value: "50000" },
    });

    expect(screen.getByTestId("extra-to-checking").textContent).toContain("1.500,00");

    fireEvent.click(screen.getByRole("button", { name: "Registrar entrada extra" }));

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledTimes(1);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/safety/extra-incomes",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          month: "2026-11",
          title: "13º Salário",
          amount: 3000,
          toReserve: 1000,
          toCouple: 500,
          applyToBalances: true,
        }),
      })
    );
  });

  it("bloqueia envio quando Reserva + Casal excedem o valor total", () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    render(<ExtraIncomesSection fixedMonth="2026-11" items={[]} onChanged={() => {}} />);

    fireEvent.change(screen.getByLabelText("Descrição da entrada"), {
      target: { value: "Freela" },
    });
    fireEvent.change(screen.getByLabelText("Valor total"), {
      target: { value: "100000" }, // R$ 1.000,00
    });
    fireEvent.change(screen.getByLabelText("Para Reserva"), {
      target: { value: "70000" }, // R$ 700,00
    });
    fireEvent.change(screen.getByLabelText("Para Casal"), {
      target: { value: "50000" }, // R$ 500,00
    });

    expect(screen.getByTestId("extra-to-checking")).toHaveTextContent("Excede o total");
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrada extra" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
