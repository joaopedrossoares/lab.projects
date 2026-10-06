// Lojas comparadas. Para adicionar outra loja VTEX basta incluir uma linha aqui.
// Super Nosso e Verdemar ainda não têm conector: precisam ser investigados de dentro da rede de casa.
const { createVtexStore } = require('./vtex');

const STORES = [
    createVtexStore({ id: 'atacadao', name: 'Atacadão', baseUrl: 'https://www.atacadao.com.br', checkoutUrl: 'https://secure.atacadao.com.br' }),
    createVtexStore({ id: 'carrefour', name: 'Carrefour', baseUrl: 'https://mercado.carrefour.com.br' }),
];

module.exports = { STORES };
