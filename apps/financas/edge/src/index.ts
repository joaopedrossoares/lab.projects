import path from "node:path";
import { fileURLToPath } from "node:url";
import { CryptoVault } from "@financas/shared/crypto";
import { LocalConfigStore } from "./localConfigStore.js";
import { resolveMasterKey } from "./masterKey.js";
import { HttpOpaqueTransport, SqliteLocalOpaqueTransport, type OpaqueTransport } from "./opaqueTransport.js";
import { createEdgeApp } from "./server.js";
import { VaultClient } from "./vaultClient.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function start() {
  const port = Number(process.env.PORT || 3000);
  const webDistDir = process.env.WEB_DIST_DIR || path.resolve(__dirname, "../../web/dist");
  const configDir = process.env.LOCAL_CONFIG_DIR || path.resolve(process.cwd(), "local-config");
  const dataDir = process.env.DATA_DIR || path.resolve(process.cwd(), "data");

  const resolvedKey = resolveMasterKey({
    envKey: process.env.LOCAL_MASTER_KEY,
    configDir,
  });
  const vault = new CryptoVault(resolvedKey.key);

  const backendUrl = process.env.BACKEND_URL?.trim();
  const syncApiToken = process.env.SYNC_API_TOKEN?.trim() || undefined;

  const transport: OpaqueTransport = backendUrl
    ? new HttpOpaqueTransport(backendUrl, syncApiToken)
    : new SqliteLocalOpaqueTransport(path.join(dataDir, "opaque.sqlite"));

  const vaultClient = new VaultClient(vault, transport);
  await vaultClient.init();
  const localConfigStore = new LocalConfigStore(configDir, vault);

  const app = createEdgeApp({
    webDistDir,
    vaultClient,
    localConfigStore,
    keySource: resolvedKey.source,
  });

  app.listen(port, "0.0.0.0", () => {
    console.log(
      `Finanças Edge (${transport.mode} -> ${transport.targetLabel}, key=${vault.fingerprint()}) na porta ${port}`
    );
  });
}

start().catch((err) => {
  console.error("Falha ao iniciar Finanças Edge:", err);
  process.exit(1);
});
