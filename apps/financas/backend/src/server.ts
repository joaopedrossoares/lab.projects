import express, { type Express } from "express";

export function createBackendApp(): Express {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "financas-backend",
    });
  });

  return app;
}
