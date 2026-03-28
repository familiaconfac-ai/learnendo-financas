/**
 * Formata uma string ISO ou Date para dd/mm/yyyy.
 * @param {string|Date} value
 * @returns {string}
 */
export function formatDateBR(value) {
  if (!value) return '—'
  const date = typeof value === 'string' ? new Date(value) : value
  return date.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

/**
 * Formata uma data com rótulo relativo: "Hoje", "Ontem" ou dd/mm/yyyy.
 * Compara com data local do dispositivo sem conversão de fuso.
 * @param {string|Date} value – string ISO YYYY-MM-DD ou objeto Date
 * @returns {string}
 */
export function formatFriendlyDate(value) {
  if (!value) return '—'
  const str = typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10)
  const [y, m, d] = str.split('-').map(Number)

  const now = new Date()
  const ty = now.getFullYear(), tm = now.getMonth() + 1, td = now.getDate()

  const yest = new Date(now)
  yest.setDate(now.getDate() - 1)
  const yy = yest.getFullYear(), ym = yest.getMonth() + 1, yd = yest.getDate()

  if (y === ty && m === tm && d === td) return 'Hoje'
  if (y === yy && m === ym && d === yd) return 'Ontem'
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`
}

/**
 * Retorna "Março 2026" a partir de mês (1-12) e ano.
 */
export function formatMonthLabel(month, year) {
  return new Date(year, month - 1, 1).toLocaleString('pt-BR', { month: 'long', year: 'numeric' })
}
