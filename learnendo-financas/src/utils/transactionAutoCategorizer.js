function normalize(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function hasAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword))
}

function inferTypeFromDescription(description) {
  const text = normalize(description)

  if (!text) return { type: 'expense', confidence: 'low', reason: 'empty_description' }

  const incomeKeywords = [
    'transferencia recebida',
    'pix recebido',
    'recebido',
    'entrada',
    'credito',
    'rendimento',
    'rend liquido',
    'salario',
    'prebenda',
    'oferta',
    'igreja batista central',
  ]

  const expenseKeywords = [
    'compra no debito',
    'compra',
    'pagamento',
    'pagamento de fatura',
    'pagt fatura',
    'pgto fatura',
    'debito',
    'fatura',
    'cartao',
    'ifood',
    'uber',
    '99',
    'supermercado',
    'mercado',
    'drogal',
    'farmacia',
    'drogaria',
  ]

  if (hasAny(text, incomeKeywords)) {
    return { type: 'income', confidence: 'high', reason: 'income_keyword' }
  }

  if (hasAny(text, expenseKeywords)) {
    return { type: 'expense', confidence: 'high', reason: 'expense_keyword' }
  }

  return { type: 'expense', confidence: 'low', reason: 'fallback' }
}

function categoryCandidatesFor(description, type) {
  const text = normalize(description)

  if (type === 'expense') {
    if (hasAny(text, ['muffato', 'supermercado', 'mercado', 'atacadao'])) {
      return ['Supermercado', 'Alimentação', 'Alimentacao']
    }
    if (hasAny(text, ['drogal', 'farmacia', 'drogaria'])) {
      return ['Farmácia', 'Farmacia', 'Saúde', 'Saude']
    }
    if (hasAny(text, ['ifood', 'restaurante', 'lanchonete'])) {
      return ['Alimentação', 'Alimentacao', 'Restaurante']
    }
    if (hasAny(text, ['uber', ' 99 ', '99pop', 'combustivel', 'posto'])) {
      return ['Transporte', 'Mobilidade']
    }
    if (hasAny(text, ['pagamento de fatura', 'pagt fatura', 'pgto fatura'])) {
      return ['Cartão de Crédito', 'Cartao de Credito', 'Cartão', 'Cartao', 'Fatura']
    }
    if (hasAny(text, ['fatura', 'cartao'])) {
      return ['Cartão', 'Cartao', 'Fatura']
    }

    return ['Outros', 'Despesas diversas', 'Alimentação', 'Alimentacao']
  }

  if (type === 'income') {
    if (hasAny(text, ['rendimento', 'rend liquido'])) {
      return ['Receitas Financeiras', 'Investimentos', 'Receitas diversas']
    }
    if (hasAny(text, ['pix recebido', 'transferencia recebida', 'recebido'])) {
      return ['Transferências recebidas', 'Transferencias recebidas', 'Receitas diversas']
    }
    if (hasAny(text, ['igreja batista central', 'oferta'])) {
      return ['Oferta', 'Receitas diversas']
    }

    return ['Receitas diversas', 'Entrada diversa', 'Transferências recebidas', 'Transferencias recebidas']
  }

  if (type === 'investment') {
    return ['Investimentos', 'Poupança', 'Poupanca']
  }

  return []
}

function findCategoryIdByCandidates(categories, type, candidates) {
  const normalizedCandidates = candidates.map(normalize)
  const typedCategories = categories.filter((category) => category.type === type)

  for (const candidate of normalizedCandidates) {
    const exact = typedCategories.find((category) => normalize(category.name) === candidate)
    if (exact) return exact.id
  }

  for (const candidate of normalizedCandidates) {
    const partial = typedCategories.find((category) => normalize(category.name).includes(candidate))
    if (partial) return partial.id
  }

  return ''
}

export function suggestTypeAndCategory(description, categories, currentType = 'expense') {
  const typeSuggestion = inferTypeFromDescription(description)
  const resolvedType = typeSuggestion.confidence === 'high' ? typeSuggestion.type : currentType
  const candidates = categoryCandidatesFor(description, resolvedType)
  const categoryId = findCategoryIdByCandidates(categories, resolvedType, candidates)

  return {
    suggestedType: resolvedType,
    typeConfidence: typeSuggestion.confidence,
    suggestedCategoryId: categoryId,
    categoryCandidates: candidates,
  }
}
