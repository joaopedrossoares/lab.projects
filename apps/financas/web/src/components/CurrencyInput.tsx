import type { ChangeEvent, ClipboardEvent } from "react";
import { formatBRL, parseMoneyInput } from "../lib/format";

export interface CurrencyInputProps {
  id?: string;
  name?: string;
  value: number;
  onChange: (value: number) => void;
  placeholder?: string;
  required?: boolean;
  emptyWhenZero?: boolean;
  ariaLabel?: string;
}

const MAX_CENTS = 99_999_999_999; // R$ 999.999.999,99

function centsToNumber(cents: number): number {
  const clamped = Math.min(MAX_CENTS, Math.max(0, Math.round(cents)));
  return Math.round(clamped) / 100;
}

export function CurrencyInput({
  id,
  name,
  value,
  onChange,
  placeholder = "R$ 0,00",
  required = false,
  emptyWhenZero = false,
  ariaLabel,
}: CurrencyInputProps) {
  const numericValue = Number.isFinite(value) && value > 0 ? value : 0;
  const displayValue = numericValue === 0 && emptyWhenZero ? "" : formatBRL(numericValue);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const digitsOnly = event.target.value.replace(/\D/g, "");
    if (!digitsOnly) {
      onChange(0);
      return;
    }

    const cents = Number(digitsOnly);
    if (!Number.isFinite(cents)) {
      onChange(0);
      return;
    }

    onChange(centsToNumber(cents));
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData?.getData("text");
    if (!pasted) return;

    event.preventDefault();
    const parsed = Math.max(0, parseMoneyInput(pasted));
    onChange(centsToNumber(Math.round(parsed * 100)));
  }

  return (
    <input
      id={id}
      name={name}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      required={required}
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={displayValue}
      onChange={handleChange}
      onPaste={handlePaste}
    />
  );
}
