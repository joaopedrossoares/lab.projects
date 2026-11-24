import { createBackendApp } from "./server.js";

const PORT = Number(process.env.PORT || 3001);
const app = createBackendApp();

app.listen(PORT, () => {
  console.log(`Finanças Backend rodando na porta ${PORT}`);
});
