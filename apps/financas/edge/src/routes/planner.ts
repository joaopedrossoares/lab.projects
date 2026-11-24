import crypto from "node:crypto";
import { Router } from "express";
import type {
  PlannedPurchase,
  PlannedPurchaseStatus,
  TransactionScope,
} from "@financas/shared";
import type { VaultClient } from "../vaultClient.js";

const VALID_STATUSES = new Set<PlannedPurchaseStatus>([
  "wishlist",
  "evaluating",
  "approved",
  "bought",
  "dropped",
]);

export function createPlannerRouter(vaultClient: VaultClient): Router {
  const router = Router();

  router.get("/purchases", async (_req, res) => {
    try {
      const purchases = await vaultClient.listEntities<PlannedPurchase>("purchase");
      purchases.sort((a, b) => {
        const rankA = a.aiAssessment?.recommendedRank ?? 999;
        const rankB = b.aiAssessment?.recommendedRank ?? 999;
        if (rankA !== rankB) return rankA - rankB;
        return b.urgency + b.desireImpact - (a.urgency + a.desireImpact);
      });
      res.json({ purchases });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "Erro ao listar compras planejadas.",
      });
    }
  });

  router.post("/purchases", async (req, res) => {
    const body = req.body as Partial<PlannedPurchase>;
    const title = (body.title || "").trim();
    const estimatedPrice = Number(body.estimatedPrice);

    if (!title || !Number.isFinite(estimatedPrice) || estimatedPrice <= 0) {
      res.status(400).json({ error: "Nome da compra e preço estimado positivo são obrigatórios." });
      return;
    }

    const scope: TransactionScope = body.scope === "couple" ? "couple" : "individual";
    const purchase: PlannedPurchase = {
      id: `buy-${crypto.randomUUID()}`,
      title,
      estimatedPrice,
      defaultInstallments: Math.max(1, Math.min(36, Math.round(Number(body.defaultInstallments) || 1))),
      scope,
      urgency: Math.max(1, Math.min(5, Math.round(Number(body.urgency) || 3))),
      desireImpact: Math.max(1, Math.min(5, Math.round(Number(body.desireImpact) || 3))),
      notes: typeof body.notes === "string" ? body.notes.trim() : "",
      status: "wishlist",
      updatedAt: new Date().toISOString(),
    };

    try {
      await vaultClient.saveEntity("purchase", purchase.id, purchase);
      res.json({ purchase });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "Erro ao salvar compra planejada.",
      });
    }
  });

  router.put("/purchases/:id", async (req, res) => {
    const existing = await vaultClient.getEntity<PlannedPurchase>(req.params.id);
    if (!existing) {
      res.status(404).json({ error: "Compra não encontrada." });
      return;
    }

    const body = req.body as Partial<PlannedPurchase>;
    const updated: PlannedPurchase = {
      ...existing,
      title: typeof body.title === "string" && body.title.trim() ? body.title.trim() : existing.title,
      estimatedPrice:
        typeof body.estimatedPrice === "number" && Number.isFinite(body.estimatedPrice) && body.estimatedPrice > 0
          ? body.estimatedPrice
          : existing.estimatedPrice,
      defaultInstallments:
        typeof body.defaultInstallments === "number" && Number.isFinite(body.defaultInstallments)
          ? Math.max(1, Math.min(36, Math.round(body.defaultInstallments)))
          : existing.defaultInstallments,
      scope: body.scope === "couple" || body.scope === "individual" ? body.scope : existing.scope,
      urgency:
        typeof body.urgency === "number"
          ? Math.max(1, Math.min(5, Math.round(body.urgency)))
          : existing.urgency,
      desireImpact:
        typeof body.desireImpact === "number"
          ? Math.max(1, Math.min(5, Math.round(body.desireImpact)))
          : existing.desireImpact,
      notes: typeof body.notes === "string" ? body.notes.trim() : existing.notes,
      status:
        body.status && VALID_STATUSES.has(body.status) ? body.status : existing.status,
      updatedAt: new Date().toISOString(),
    };

    await vaultClient.saveEntity("purchase", updated.id, updated);
    res.json({ purchase: updated });
  });

  router.delete("/purchases/:id", async (req, res) => {
    const deleted = await vaultClient.deleteEntity(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: "Compra não encontrada." });
      return;
    }
    res.json({ deleted: true });
  });

  return router;
}
