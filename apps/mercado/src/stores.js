// Lojas comparadas. Para adicionar outra loja VTEX basta incluir uma linha aqui.
// Carrefour Mercado ficou de fora: a proteção anti-robô deles responde 403 a tudo que não é navegador.
// Verdemar ainda não tem conector (a loja online não é VTEX).
const { createVtexStore } = require('./vtex');

const STORES = [
    // Atacadão é FastStore (Next.js): o checkout fica em outro domínio.
    createVtexStore({ id: 'atacadao', name: 'Atacadão', baseUrl: 'https://www.atacadao.com.br', checkoutUrl: 'https://secure.atacadao.com.br' }),
    createVtexStore({ id: 'supernosso', name: 'Super Nosso', baseUrl: 'https://www.supernosso.com' }),
];

module.exports = { STORES };
