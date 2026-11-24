// @vitest-environment jsdom
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CurrencyInput } from "./CurrencyInput";

function Harness({ initial = 0, emptyWhenZero = false }) {
  const [val, setVal] = useState(initial);
  return (
    <div>
      <CurrencyInput
        ariaLabel="Valor teste"
        value={val}
        onChange={setVal}
        emptyWhenZero={emptyWhenZero}
      />
      <output data-testid="numeric">{val}</output>
    </div>
  );
}

describe("CurrencyInput BRL mask", () => {
  it("formats typed digits into BRL currency (cents from right)", () => {
    render(<Harness emptyWhenZero />);
    const input = screen.getByLabelText("Valor teste") as HTMLInputElement;

    expect(input.value).toBe("");

    fireEvent.change(input, { target: { value: "150050" } });
    expect(screen.getByTestId("numeric")).toHaveTextContent("1500.5");
    expect(input.value).toContain("1.500,50");
    expect(input.value).toContain("R$");

    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getByTestId("numeric")).toHaveTextContent("0");
    expect(input.value).toBe("");
  });

  it("parses pasted BRL/numeric strings without shifting decimal places", () => {
    render(<Harness />);
    const input = screen.getByLabelText("Valor teste") as HTMLInputElement;

    fireEvent.paste(input, {
      clipboardData: { getData: () => "R$ 15.000,75" },
    });
    expect(screen.getByTestId("numeric")).toHaveTextContent("15000.75");
    expect(input.value).toContain("15.000,75");

    fireEvent.paste(input, {
      clipboardData: { getData: () => "2500" },
    });
    expect(screen.getByTestId("numeric")).toHaveTextContent("2500");
    expect(input.value).toContain("2.500,00");
  });
});
