import { COMPARISONS, DEFAULT_COMPARISON } from '../config.js';

// Escolhe quais períodos entram no gráfico (lista em config.js).
export default {
    id: 'comparar',
    label: 'Comparar',
    control: {
        type: 'select',
        default: DEFAULT_COMPARISON,
        options: Object.entries(COMPARISONS).map(([value, c]) => ({ value, label: c.label })),
    },
    periods(_periods, value) {
        return (COMPARISONS[value] ?? COMPARISONS[DEFAULT_COMPARISON]).periods;
    },
};
