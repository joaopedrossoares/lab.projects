# Cesta Básica

Gráfico do gasto mensal da cesta básica (DIEESE) comparando os períodos set/2018 – set/2022 e set/2022 – set/2026.

## Como usar

1. Deixe as planilhas mensais do DIEESE (`.xls`, uma por mês) em `~/Documents/diaeese/items/`. Para outra pasta, defina `DIEESE_DIR` no `.env` da raiz.
2. Suba com `podman compose up -d --build cesta-basica` (ou `docker compose`).
3. Abra http://cesta.traefik.me:8088 (ou sem a porta, se o Traefik estiver na 80).

A pasta é montada somente leitura em `/data`. O servidor relê as planilhas quando algum arquivo muda.

## Como estender o gráfico

- **Outro período:** acrescente uma linha em `public/config.js`.
- **Novo recurso:** crie um arquivo em `public/features/` e registre-o em `public/features/index.js`. Cada recurso declara seu controle (toggle ou select) e usa os ganchos que precisar: `transform` (mexe nos dados), `chart` (mexe na configuração do Chart.js) ou `panel` (desenha abaixo do gráfico). Os controles e o parâmetro na URL aparecem sozinhos. Veja `media-movel.js` como exemplo curto.

## Testes

```bash
pip install xlrd && python -m unittest discover -s test
```
