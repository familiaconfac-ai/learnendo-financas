/**
 * Formata um número como moeda brasileira (BRL).
 * @param {number} value
 * @returns {string} Ex: "R$ 1.234,56"
 */
export function formatCurrency(value) {
  if (value === null || value === undefined) return 'R$ 0,00'
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  }).format(value)
}
