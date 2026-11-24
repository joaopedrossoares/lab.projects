import fs from "node:fs";
import path from "node:path";
import { CryptoVault } from "@financas/shared/crypto";

export interface ResolvedMasterKey {
  key: string;
  source: "env" | "local-file" | "generated";
  keyFilePath?: string;
}

export function resolveMasterKey(options: {
  envKey?: string;
  configDir: string;
}): ResolvedMasterKey {
  const fromEnv = options.envKey?.trim();
  if (fromEnv && fromEnv.length >= 16) {
    return { key: fromEnv, source: "env" };
  }

  fs.mkdirSync(options.configDir, { recursive: true });
  const keyFilePath = path.join(options.configDir, "master.key");

  if (fs.existsSync(keyFilePath)) {
    const existing = fs.readFileSync(keyFilePath, "utf8").trim();
    if (existing.length >= 16) {
      return { key: existing, source: "local-file", keyFilePath };
    }
  }

  const generated = CryptoVault.generateMasterKey();
  fs.writeFileSync(keyFilePath, `${generated}\n`, { encoding: "utf8", mode: 0o600 });
  return { key: generated, source: "generated", keyFilePath };
}
