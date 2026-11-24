import { describe, expect, it } from "vitest";
import { parseMoneyInput } from "./format";

describe("parseMoneyInput", () => {
  it("parses Brazilian currency strings with dots, commas, and R$ prefix", () => {
    expect(parseMoneyInput("15.000,50")).toBe(15000.5);
    expect(parseMoneyInput("R$ 1.250,00")).toBe(1250);
    expect(parseMoneyInput("350,90")).toBe(350.9);
    expect(parseMoneyInput("15.000")).toBe(15000);
    expect(parseMoneyInput("1500.50")).toBe(1500.5);
    expect(parseMoneyInput("")).toBe(0);
  });
});
