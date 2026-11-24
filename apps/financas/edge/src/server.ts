import express, { type Express } from "express";
import fs from "node:fs";
import path from "node:path";

export interface EdgeAppOptions {
  webDistDir?: string;
}

export function createEdgeApp(options: EdgeAppOptions = {}): Express {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "financas-edge",
      mode: process.env.BACKEND_URL ? "hybrid" : "local",
    });
  });

  if (options.webDistDir && fs.existsSync(options.webDistDir)) {
    app.use(express.static(options.webDistDir));

    app.get("/{*splat}", (req, res, next) => {
      if (req.path.startsWith("/api/") || req.path === "/health") {
        next();
        return;
      }
      res.sendFile(path.join(options.webDistDir!, "index.html"));
    });
  }

  return app;
}
