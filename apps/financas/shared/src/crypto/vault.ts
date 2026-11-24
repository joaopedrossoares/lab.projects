import crypto from "node:crypto";

const ENVELOPE_VERSION = "v1";
const IV_BYTES = 12;
const KEY_BYTES = 32;
const HKDF_SALT = Buffer.from("lab.projects:financas:vault:v1", "utf8");

export class CryptoVault {
  private readonly encKey: Buffer;
  private readonly hmacKey: Buffer;
  private readonly keyFingerprint: string;

  constructor(masterKey: string) {
    const normalized = masterKey.trim();
    if (normalized.length < 16) {
      throw new Error("LOCAL_MASTER_KEY deve ter pelo menos 16 caracteres.");
    }

    const ikm = Buffer.from(normalized, "utf8");
    this.encKey = Buffer.from(
      crypto.hkdfSync("sha256", ikm, HKDF_SALT, Buffer.from("aes-256-gcm", "utf8"), KEY_BYTES)
    );
    this.hmacKey = Buffer.from(
      crypto.hkdfSync("sha256", ikm, HKDF_SALT, Buffer.from("hmac-blind-index", "utf8"), KEY_BYTES)
    );
    this.keyFingerprint = crypto
      .createHmac("sha256", this.hmacKey)
      .update("fingerprint")
      .digest("hex")
      .slice(0, 12);
  }

  static generateMasterKey(): string {
    return crypto.randomBytes(32).toString("base64url");
  }

  fingerprint(): string {
    return this.keyFingerprint;
  }

  encryptJson(payload: unknown): string {
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.encKey, iv);
    const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return [
      ENVELOPE_VERSION,
      iv.toString("base64url"),
      authTag.toString("base64url"),
      encrypted.toString("base64url"),
    ].join(":");
  }

  decryptJson<T>(envelope: string): T {
    const parts = envelope.split(":");
    if (parts.length !== 4 || parts[0] !== ENVELOPE_VERSION) {
      throw new Error("Formato de envelope criptográfico inválido.");
    }

    const [, ivB64, tagB64, cipherB64] = parts;
    const iv = Buffer.from(ivB64, "base64url");
    const authTag = Buffer.from(tagB64, "base64url");
    const ciphertext = Buffer.from(cipherB64, "base64url");

    const decipher = crypto.createDecipheriv("aes-256-gcm", this.encKey, iv);
    decipher.setAuthTag(authTag);

    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    return JSON.parse(plaintext) as T;
  }

  blindIndex(namespace: string, value: string): string {
    const normalized = value.trim().toLowerCase();
    const digest = crypto
      .createHmac("sha256", this.hmacKey)
      .update(`${namespace}:${normalized}`)
      .digest("hex")
      .slice(0, 32);

    return `bi_${digest}`;
  }
}
