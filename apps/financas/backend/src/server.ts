import crypto from "node:crypto";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { OpaqueEntityType, OpaqueRecord } from "@financas/shared";
import type { OpaqueRecordRepository } from "./db/repository.js";

const VALID_ENTITY_TYPES = new Set<OpaqueEntityType>([
  "label_rule",
  "closing",
  "tx",
  "future_installment",
  "cashflow",
  "reserve",
  "couple_plan",
  "profile",
  "purchase",
  "ai_chat",
]);

function safeCompareTokens(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function validateRecordInput(id: string, body: unknown): OpaqueRecord | null {
  if (!body || typeof body !== "object") return null;
  const raw = body as Record<string, unknown>;

  if (typeof raw.entityType !== "string" || !VALID_ENTITY_TYPES.has(raw.entityType as OpaqueEntityType)) {
    return null;
  }
  if (typeof raw.encryptedPayload !== "string" || !raw.encryptedPayload.startsWith("v1:")) {
    return null;
  }

  return {
    id,
    entityType: raw.entityType as OpaqueEntityType,
    periodKey: typeof raw.periodKey === "string" && raw.periodKey.trim() ? raw.periodKey.trim() : null,
    blindIndex: typeof raw.blindIndex === "string" && raw.blindIndex.trim() ? raw.blindIndex.trim() : null,
    encryptedPayload: raw.encryptedPayload,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
    deletedAt: typeof raw.deletedAt === "string" ? raw.deletedAt : null,
  };
}

export interface BackendAppOptions {
  repository: OpaqueRecordRepository;
  syncApiToken?: string;
}

export function createBackendApp(options: BackendAppOptions): Express {
  const { repository, syncApiToken } = options;
  const app = express();
  app.use(express.json({ limit: "5mb" }));

  app.get("/health", async (_req, res) => {
    try {
      const stats = await repository.stats();
      res.json({
        status: "ok",
        service: "financas-backend",
        storage: repository.kind,
        totalActive: stats.totalActive,
      });
    } catch {
      res.status(503).json({ status: "error", service: "financas-backend" });
    }
  });

  function requireSyncAuth(req: Request, res: Response, next: NextFunction) {
    if (!syncApiToken) {
      next();
      return;
    }

    const header = req.headers.authorization || "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match || !safeCompareTokens(match[1].trim(), syncApiToken)) {
      res.status(401).json({ error: "Não autorizado." });
      return;
    }

    next();
  }

  app.use("/api/v1", requireSyncAuth);

  app.get("/api/v1/stats", async (_req, res) => {
    const stats = await repository.stats();
    res.json(stats);
  });

  app.get("/api/v1/records", async (req, res) => {
    const entityType = typeof req.query.entityType === "string" ? (req.query.entityType as OpaqueEntityType) : undefined;
    const periodKey = typeof req.query.periodKey === "string" ? req.query.periodKey : undefined;
    const blindIndex = typeof req.query.blindIndex === "string" ? req.query.blindIndex : undefined;
    const includeDeleted = req.query.includeDeleted === "true";
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;

    const records = await repository.list({
      entityType,
      periodKey,
      blindIndex,
      includeDeleted,
      limit: Number.isFinite(limit) ? limit : undefined,
    });

    res.json({ records });
  });

  app.get("/api/v1/records/:id", async (req, res) => {
    const record = await repository.getById(req.params.id);
    if (!record || record.deletedAt) {
      res.status(404).json({ error: "Registro não encontrado." });
      return;
    }
    res.json({ record });
  });

  app.put("/api/v1/records/:id", async (req, res) => {
    const validated = validateRecordInput(req.params.id, req.body);
    if (!validated) {
      res.status(400).json({ error: "Envelope opaco inválido (esperado encryptedPayload v1:...)." });
      return;
    }
    const saved = await repository.upsert(validated);
    res.json({ record: saved });
  });

  app.post("/api/v1/records/batch", async (req, res) => {
    const rawList = Array.isArray(req.body?.records) ? req.body.records : null;
    if (!rawList) {
      res.status(400).json({ error: "Esperado array 'records'." });
      return;
    }

    const validated: OpaqueRecord[] = [];
    for (const item of rawList) {
      const id = typeof item?.id === "string" && item.id.trim() ? item.id.trim() : null;
      if (!id) {
        res.status(400).json({ error: "Todos os registros devem possuir id." });
        return;
      }
      const record = validateRecordInput(id, item);
      if (!record) {
        res.status(400).json({ error: `Envelope opaco inválido no registro ${id}.` });
        return;
      }
      validated.push(record);
    }

    const saved = await repository.upsertMany(validated);
    res.json({ count: saved.length });
  });

  app.delete("/api/v1/records/:id", async (req, res) => {
    const deleted = await repository.softDelete(req.params.id, new Date().toISOString());
    if (!deleted) {
      res.status(404).json({ error: "Registro não encontrado." });
      return;
    }
    res.json({ deleted: true });
  });

  app.get("/api/v1/snapshot", async (_req, res) => {
    const records = await repository.exportAll();
    res.json({
      version: 1,
      exportedAt: new Date().toISOString(),
      count: records.length,
      records,
    });
  });

  app.post("/api/v1/snapshot", async (req, res) => {
    const rawList = Array.isArray(req.body?.records) ? req.body.records : null;
    if (!rawList) {
      res.status(400).json({ error: "Snapshot inválido: campo 'records' ausente." });
      return;
    }

    const validated: OpaqueRecord[] = [];
    for (const item of rawList) {
      const id = typeof item?.id === "string" && item.id.trim() ? item.id.trim() : null;
      if (!id) {
        res.status(400).json({ error: "Registro sem id no snapshot." });
        return;
      }
      const record = validateRecordInput(id, item);
      if (!record) {
        res.status(400).json({ error: `Envelope inválido no snapshot (${id}).` });
        return;
      }
      validated.push(record);
    }

    const imported = await repository.importAll(validated);
    res.json({ imported });
  });

  return app;
}
