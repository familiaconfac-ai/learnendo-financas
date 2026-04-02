function parseMonthKey(monthKey) {
  const [year, month] = String(monthKey || '').split('-').map(Number)
  return { year, month }
}

export function addMonthsToMonthKey(monthKey, offset) {
  const { year, month } = parseMonthKey(monthKey)
  if (!year || !month) return ''
  const date = new Date(year, month - 1 + offset, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function monthKeyLabel(monthKey) {
  const { year, month } = parseMonthKey(monthKey)
  if (!year || !month) return ''
  return new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month - 1, 1))
}

export function computeCreditCardCompetencyMonth(dateIso, card) {
  const monthKey = String(dateIso || '').slice(0, 7)
  const day = Number(String(dateIso || '').slice(8, 10))
  const closingDay = Number(card?.closingDay || 0)
  if (!monthKey || !day || !closingDay) return monthKey

  const closingCycleMonth = day <= closingDay ? monthKey : addMonthsToMonthKey(monthKey, 1)
  return addMonthsToMonthKey(closingCycleMonth, 1)
}

export function computeBestPurchaseDay(card) {
  const closingDay = Number(card?.closingDay || 0)
  if (!closingDay) return null
  return closingDay >= 31 ? 1 : closingDay + 1
}

export function buildCardPlanningSnapshot(card, referenceDate = new Date()) {
  const closingDay = Number(card?.closingDay || 0)
  const dueDay = Number(card?.dueDay || 0)
  if (!closingDay) return null

  const year = referenceDate.getFullYear()
  const month = referenceDate.getMonth()
  const todayDay = referenceDate.getDate()
  const currentMonthKey = `${year}-${String(month + 1).padStart(2, '0')}`

  const currentClosingMonth = todayDay <= closingDay
    ? currentMonthKey
    : addMonthsToMonthKey(currentMonthKey, 1)

  const nextClosingDate = `${currentClosingMonth}-${String(closingDay).padStart(2, '0')}`
  const nextDueMonth = addMonthsToMonthKey(currentClosingMonth, 1)
  const nextDueDate = dueDay ? `${nextDueMonth}-${String(Math.min(dueDay, 28)).padStart(2, '0')}` : ''

  return {
    bestPurchaseDay: computeBestPurchaseDay(card),
    currentClosingMonth,
    nextClosingDate,
    nextDueDate,
  }
}

export function detectCardCommitment(description) {
  const text = String(description || '')
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

  const installmentMatch = normalized.match(/(?:parcela\s*)?(\d{1,2})\s*\/\s*(\d{1,2})/)
  if (installmentMatch) {
    const currentInstallment = Number(installmentMatch[1])
    const totalInstallments = Number(installmentMatch[2])
    if (currentInstallment > 0 && totalInstallments >= currentInstallment) {
      return {
        recurring: true,
        recurrenceType: 'fixed',
        currentInstallment,
        totalInstallments,
        reason: `Parcela ${currentInstallment}/${totalInstallments}`,
      }
    }
  }

  if (/\bassinatura\b|\bmensalidade\b|\bplano\b|\bnetflix\b|\bspotify\b|\bdisney\b|\bmax\b|\bamazon prime\b|\bprime video\b|\byoutube premium\b|\bapple\.com\/bill\b|\bgoogle\b|\badobe\b|\bcanva\b/.test(normalized)) {
    return {
      recurring: true,
      recurrenceType: 'indefinite',
      currentInstallment: 1,
      totalInstallments: null,
      reason: 'Assinatura/recorrência sugerida',
    }
  }

  return null
}

export function buildCardCommitmentRecurringFields(description, competencyMonth, existing = {}) {
  const hint = detectCardCommitment(description)
  const normalizedMonth = String(competencyMonth || '').slice(0, 7)

  if (!hint) {
    return {
      hint: null,
      recurring: Boolean(existing?.recurring),
      recurrenceType: existing?.recurrenceType || null,
      recurringStartDate: existing?.recurringStartDate || null,
      recurringEndDate: existing?.recurringEndDate || null,
      totalInstallments: Number.isFinite(Number(existing?.totalInstallments))
        ? Number(existing.totalInstallments)
        : null,
      currentInstallment: Number.isFinite(Number(existing?.currentInstallment))
        ? Number(existing.currentInstallment)
        : null,
      installmentNumber: Number.isFinite(Number(existing?.installmentNumber))
        ? Number(existing.installmentNumber)
        : null,
    }
  }

  const recurringStartDate = existing?.recurringStartDate || (normalizedMonth ? `${normalizedMonth}-01` : null)
  const currentInstallment = Number.isFinite(Number(existing?.currentInstallment))
    ? Number(existing.currentInstallment)
    : Number(hint.currentInstallment || 1)
  const totalInstallments = hint.recurrenceType === 'fixed'
    ? (Number.isFinite(Number(existing?.totalInstallments))
        ? Number(existing.totalInstallments)
        : Number(hint.totalInstallments || currentInstallment))
    : null
  const recurringEndDate = hint.recurrenceType === 'fixed' && normalizedMonth && totalInstallments && currentInstallment
    ? `${addMonthsToMonthKey(normalizedMonth, totalInstallments - currentInstallment)}-01`
    : null

  return {
    hint,
    recurring: true,
    recurrenceType: hint.recurrenceType,
    recurringStartDate,
    recurringEndDate: existing?.recurringEndDate || recurringEndDate,
    totalInstallments,
    currentInstallment,
    installmentNumber: hint.recurrenceType === 'fixed' ? currentInstallment : null,
  }
}

export function buildCreditCardGuidance(dateIso, card) {
  if (!dateIso || !card?.closingDay) return null

  const competencyMonth = computeCreditCardCompetencyMonth(dateIso, card)
  const monthLabel = monthKeyLabel(competencyMonth)
  const bestPurchaseDay = computeBestPurchaseDay(card)

  return {
    competencyMonth,
    monthLabel,
    bestPurchaseDay,
    message: `Esta compra no crédito tende a comprometer o orçamento de ${monthLabel}.`,
  }
}
