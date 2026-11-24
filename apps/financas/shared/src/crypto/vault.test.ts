import { describe, expect, it } from "vitest";
import { CryptoVault } from "./vault.js";

describe("CryptoVault (Zero-Knowledge AES-256-GCM + HMAC)", () => {
  const masterKey = "minha-chave-mestra-super-secreta-2026";
  const vault = new CryptoVault(masterKey);

  it("encrypts and decrypts structured financial payloads without exposing plaintext", () => {
    const secretPayload = {
      friendlyName: "Restaurante Especial Casal",
      amount: 248.9,
      couplePlan: "Viagem Japão 2027",
    };

    const ciphertext = vault.encryptJson(secretPayload);

    expect(ciphertext).toMatch(/^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
    expect(ciphertext).not.toContain("Restaurante");
    expect(ciphertext).not.toContain("248.9");
    expect(ciphertext).not.toContain("Japão");

    // Different IVs produce different ciphertexts for the same plaintext
    const ciphertext2 = vault.encryptJson(secretPayload);
    expect(ciphertext2).not.toBe(ciphertext);

    expect(vault.decryptJson(ciphertext)).toEqual(secretPayload);
    expect(vault.decryptJson(ciphertext2)).toEqual(secretPayload);
  });

  it("rejects decryption with wrong master key or tampered ciphertext", () => {
    const ciphertext = vault.encryptJson({ salary: 12500 });
    const otherVault = new CryptoVault("outra-chave-completamente-diferente");

    expect(() => otherVault.decryptJson(ciphertext)).toThrow();

    const parts = ciphertext.split(":");
    const tampered = [parts[0], parts[1], parts[2], `${parts[3]}X`].join(":");
    expect(() => vault.decryptJson(tampered)).toThrow();
  });

  it("produces deterministic namespace-isolated blind indexes", () => {
    const idx1 = vault.blindIndex("merchant", "padaria central");
    const idx2 = vault.blindIndex("merchant", "  PADARIA CENTRAL ");
    const idxOtherNs = vault.blindIndex("category", "padaria central");

    expect(idx1).toBe(idx2);
    expect(idx1).not.toBe(idxOtherNs);
    expect(idx1).toMatch(/^bi_[a-f0-9]{32}$/);
    expect(idx1).not.toContain("padaria");
  });

  it("rejects short master keys", () => {
    expect(() => new CryptoVault("curta")).toThrow(/16 caracteres/);
  });
});
