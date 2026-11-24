import path from "node:path";
import { PostgresOpaqueRepository } from "./db/postgresRepository.js";
import type { OpaqueRecordRepository } from "./db/repository.js";
import { SqliteOpaqueRepository } from "./db/sqliteRepository.js";
import { createBackendApp } from "./server.js";

async function start() {
  const port = Number(process.env.PORT || 3001);
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const syncApiToken = process.env.SYNC_API_TOKEN?.trim() || undefined;

  let repository: OpaqueRecordRepository;
  if (databaseUrl) {
    repository = new PostgresOpaqueRepository(databaseUrl);
  } else {
    const sqlitePath = process.env.SQLITE_PATH || path.resolve(process.cwd(), "data/opaque.sqlite");
    repository = new SqliteOpaqueRepository(sqlitePath);
  }

  await repository.init();

  const app = createBackendApp({ repository, syncApiToken });
  app.listen(port, "0.0.0.0", () => {
    console.log(`Finanças Backend Opaco (${repository.kind}) rodando na porta ${port}`);
  });
}

start().catch((err) => {
  console.error("Falha ao iniciar Finanças Backend:", err);
  process.exit(1);
});
