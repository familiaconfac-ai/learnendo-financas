function parseIsoAsLocalDate(value) {
  const iso = String(value || '').slice(0, 10)
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null

  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function resolveDateLike(value) {
  if (!value) return null

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }

  if (typeof value?.toDate === 'function') {
    const parsed = value.toDate()
    return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed : null
  }

  if (typeof value?.seconds === 'number') {
    const millis = (value.seconds * 1000) + Math.round(Number(value.nanoseconds || 0) / 1000000)
    const parsed = new Date(millis)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  if (typeof value === 'string') {
    const parsed = parseIsoAsLocalDate(value) || new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  return null
}

/**
 * Formata uma string ISO ou Date para dd/mm/yyyy.
 * @param {string|Date} value
 * @returns {string}
 */
export function formatDateBR(value) {
  const date = resolveDateLike(value)
  if (!date) return '—'
  return date.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

/**
 * Formata uma data com rótulo relativo: "Hoje", "Ontem" ou dd/mm/yyyy.
 * Compara com data local do dispositivo sem conversão de fuso.
 * @param {string|Date} value – string ISO YYYY-MM-DD ou objeto Date
 * @returns {string}
 */
export function formatFriendlyDate(value) {
  const date = resolveDateLike(value)
  if (!date) return '—'

  const str = date.toISOString().slice(0, 10)
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
