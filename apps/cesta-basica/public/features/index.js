// Registro de recursos do gráfico. Cada recurso é um módulo neste diretório que
// exporta um objeto com:
//
//   id        chave do recurso (vira parâmetro na URL)
//   label     texto do controle
//   control   { type: 'toggle', default } | { type: 'select', options: [{ value, label }], default }
//             (omita para recursos sempre ativos, como painéis)
//   transform(series, value, ctx) -> series   altera os pontos antes de desenhar
//   chart(config, value, ctx)                 ajusta a configuração do Chart.js
//   panel(el, value, ctx)                     desenha algo abaixo do gráfico
//
// Todos os ganchos são opcionais. Os transforms rodam na ordem desta lista, depois
// os ajustes de gráfico, depois os painéis. Para um recurso novo: crie o arquivo e
// acrescente-o aqui.
import eixo from './eixo.js';
import mediaMovel from './media-movel.js';
import escala from './escala.js';
import resumo from './resumo.js';

export const FEATURES = [eixo, mediaMovel, escala, resumo];
