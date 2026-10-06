# Mercado

Compara o preço da sua lista de compras entre supermercados que entregam no seu CEP e monta o carrinho em cada loja. Quem finaliza e paga é você, no site da loja.

## Como usar

1. Defina o CEP em `CEP` no `docker-compose.yml` da raiz e suba com `docker compose up -d --build mercado`.
2. Abra http://mercado.traefik.me, cole a lista (um item por linha, quantidade no fim: `Água c/ gás 2`) e clique em **Comparar preços**.
3. Confira o produto escolhido em cada loja. Use **Fixar** para travar um produto (pelo código de barras); nas próximas compras ele é escolhido sozinho em todas as lojas.
4. **Frete e carrinho** calcula o total com frete no seu CEP e abre o carrinho já preenchido na loja.

## Como funciona

- Lojas VTEX (Atacadão, Carrefour Mercado) são consultadas pelas mesmas APIs públicas que o site usa: `regions` (qual loja entrega no CEP), `intelligent-search` (produtos, preço e EAN) e `orderForms/simulation` (preço final e frete).
- O mesmo produto é reconhecido entre lojas pelo EAN. Quando não há EAN em comum, o app usa o primeiro resultado da busca e avisa.
- A busca roda com no máximo 4 requisições ao mesmo tempo e fica em cache por 30 minutos.
- A última lista e os produtos fixados ficam em `data/state.json`.

## Limitações conhecidas

- Super Nosso e Verdemar ainda não têm conector.
- Hortifrúti e carnes são vendidos por peso; a comparação desses itens é aproximada.
- Para adicionar outra loja VTEX, inclua uma linha em `src/stores.js`.

## Testes

```bash
npm install && npm test
```
