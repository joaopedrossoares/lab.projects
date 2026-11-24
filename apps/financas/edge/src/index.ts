import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEdgeApp } from "./server.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const webDistDir = process.env.WEB_DIST_DIR || path.resolve(__dirname, "../../web/dist");

const app = createEdgeApp({ webDistDir });

app.listen(PORT, () => {
  console.log(`Finanças Edge rodando na porta ${PORT}`);
});
