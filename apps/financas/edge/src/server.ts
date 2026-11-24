import crypto from "node:crypto";
import express, { type Express } from "express";
import fs from "node:fs";
import path from "node:path";
import { createClosingsRouter, createCouplePlansRouter } from "./routes/closings.js";
import { createLabelsRouter } from "./routes/labels.js";
import type { VaultClient } from "./vaultClient.js";

export interface EdgeAppOptions {
  webDistDir?: string;
  vaultClient?: VaultClient;
  keySource?: "env" | "local-file" | "generated";
}

export function createEdgeApp(options: EdgeAppOptions = {}): Express {
  const { webDistDir, vaultClient, keySource = "env" } = options;
  const app = express();
  app.use(express.json({ limit: "5mb" }));

  app.get("/health", async (_req, res) => {
    const status = vaultClient ? await vaultClient.getPrivacyStatus() : null;
    res.json({
      status: "ok",
      service: "financas-edge",
      mode: status?.mode ?? (process.env.BACKEND_URL ? "hybrid-remote" : "local-sqlite"),
      backendReachable: status?.backendHealth.reachable ?? true,
    });
  });

  app.get("/api/privacy/status", async (_req, res) => {
    if (!vaultClient) {
      res.status(503).json({ error: "VaultClient não configurado." });
      return;
    }
    const status = await vaultClient.getPrivacyStatus();
    res.json({ ...status, keySource });
  });

  app.get("/api/privacy/audit", async (req, res) => {
    if (!vaultClient) {
      res.status(503).json({ error: "VaultClient não configurado." });
      return;
    }
    try {
      const limit = Math.min(20, Math.max(1, Number(req.query.limit || 5)));
      const samples = await vaultClient.getAuditComparison(limit);
      res.json({ samples });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "Erro ao consultar auditoria.",
      });
    }
  });

  app.post("/api/privacy/test-roundtrip", async (_req, res) => {
    if (!vaultClient) {
      res.status(503).json({ error: "VaultClient não configurado." });
      return;
    }

    const testId = `audit-test-${crypto.randomUUID()}`;
    const sampleData = {
      id: testId,
      text: "Plano de teste Zero-Knowledge (não visível em produção)",
      status: "active" as const,
      updatedAt: new Date().toISOString(),
    };

    try {
      await vaultClient.saveEntity("couple_plan", testId, sampleData, {
        blindKey: { namespace: "audit", value: testId },
      });

      const audit = await vaultClient.getAuditComparison(10);
      const matched = audit.find((entry) => entry.id === testId) ?? null;

      await vaultClient.deleteEntity(testId);

      res.json({
        ok: Boolean(matched),
        verifiedZeroKnowledge:
          Boolean(matched) &&
          !matched!.productionOpaque.encryptedPayloadPreview.includes("Zero-Knowledge"),
        sample: matched,
      });
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: err instanceof Error ? err.message : "Falha no teste de roundtrip.",
      });
    }
  });

  app.get("/api/privacy/snapshot", async (_req, res) => {
    if (!vaultClient) {
      res.status(503).json({ error: "VaultClient não configurado." });
      return;
    }
    try {
      const records = await vaultClient.exportOpaqueSnapshot();
      res.json({
        version: 1,
        keyFingerprint: vaultClient.getKeyFingerprint(),
        exportedAt: new Date().toISOString(),
        count: records.length,
        records,
      });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "Erro ao exportar snapshot.",
      });
    }
  });

  app.post("/api/privacy/snapshot", async (req, res) => {
    if (!vaultClient) {
      res.status(503).json({ error: "VaultClient não configurado." });
      return;
    }
    if (!Array.isArray(req.body?.records)) {
      res.status(400).json({ error: "Snapshot inválido." });
      return;
    }
    try {
      const imported = await vaultClient.importOpaqueSnapshot(req.body.records);
      res.json({ imported });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "Erro ao importar snapshot.",
      });
    }
  });

  if (vaultClient) {
    app.use("/api/labels", createLabelsRouter(vaultClient));
    app.use("/api/closings", createClosingsRouter(vaultClient));
    app.use("/api/couple-plans", createCouplePlansRouter(vaultClient));
  }

  if (webDistDir && fs.existsSync(webDistDir)) {
    app.use(express.static(webDistDir));

    app.get("/{*splat}", (req, res, next) => {
      if (req.path.startsWith("/api/") || req.path === "/health") {
        next();
        return;
      }
      res.sendFile(path.join(webDistDir, "index.html"));
    });
  }

  return app;
}
