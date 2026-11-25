import { Router } from "express";
import type { LocalConfigStore } from "../localConfigStore.js";
import { fetchRailwayProjectUsage } from "../railwayUsage.js";

export interface MonitoringRouterOptions {
  localConfigStore: LocalConfigStore;
  fetchImpl?: typeof fetch;
}

export function createMonitoringRouter(options: MonitoringRouterOptions): Router {
  const { localConfigStore, fetchImpl } = options;
  const router = Router();

  router.get("/railway/config", (_req, res) => {
    res.json({ config: localConfigStore.getSafeRailwayConfig() });
  });

  router.put("/railway/config", (req, res) => {
    const body = (req.body || {}) as {
      apiToken?: string;
      clearToken?: boolean;
      projectId?: string;
    };
    const safe = localConfigStore.saveRailwayConfig(body);
    res.json({ config: safe });
  });

  router.get("/railway/usage", async (req, res) => {
    const resolved = localConfigStore.getResolvedRailwayConfig();
    if (!resolved.apiToken || !resolved.projectId) {
      res.json({
        configured: false,
        config: localConfigStore.getSafeRailwayConfig(),
      });
      return;
    }

    const rawHours = Number(req.query.hours || 24);
    const windowHours = Number.isFinite(rawHours) ? Math.min(168, Math.max(1, Math.round(rawHours))) : 24;

    try {
      const report = await fetchRailwayProjectUsage({
        apiToken: resolved.apiToken,
        projectId: resolved.projectId,
        windowHours,
        fetchImpl,
      });
      res.json(report);
    } catch (err) {
      res.status(502).json({
        configured: true,
        error:
          err instanceof Error
            ? err.message
            : "Não foi possível consultar o consumo na API da Railway.",
      });
    }
  });

  return router;
}
