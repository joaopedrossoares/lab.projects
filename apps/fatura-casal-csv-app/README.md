# Divisor de fatura com CSV

Fluxo:

1. Converter PDF para CSV localmente.
2. Abrir o front local.
3. Selecionar o CSV gerado.
4. Classificar compras como Individual ou Casal.

## Instalar dependências

```bash
npm install
```

## Converter PDF para CSV

```bash
node scripts/fatura-pdf-para-csv.mjs ./Fatura_Itau_20260602-225106.pdf ./compras.csv
```

## Rodar o front

```bash
python3 -m http.server 8080
```

Acesse:

```text
http://localhost:8080
```

Depois selecione o arquivo `compras.csv` no botão do app.
