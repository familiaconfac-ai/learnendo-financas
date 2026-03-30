function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

export const RECEIPT_DETAIL_CATALOG = [
  {
    key: 'alimentacao',
    label: 'Alimentação',
    subcategories: [
      { key: 'basico', label: 'Básico' },
      { key: 'proteina', label: 'Proteína' },
      { key: 'bebida', label: 'Bebida' },
      { key: 'lanche', label: 'Lanche' },
      { key: 'superfluo_alimentar', label: 'Supérfluo alimentar' },
    ],
  },
  {
    key: 'limpeza',
    label: 'Limpeza',
    subcategories: [
      { key: 'roupa', label: 'Roupa' },
      { key: 'cozinha', label: 'Cozinha' },
      { key: 'casa', label: 'Casa' },
    ],
  },
  {
    key: 'higiene',
    label: 'Higiene',
    subcategories: [
      { key: 'banho', label: 'Banho' },
      { key: 'cabelo', label: 'Cabelo' },
      { key: 'cuidados_pessoais', label: 'Cuidados pessoais' },
    ],
  },
  {
    key: 'uso_domestico',
    label: 'Uso doméstico',
    subcategories: [
      { key: 'utensilios', label: 'Utensílios' },
      { key: 'organizacao', label: 'Organização' },
      { key: 'manutencao', label: 'Manutenção' },
    ],
  },
  {
    key: 'outros',
    label: 'Outros',
    subcategories: [
      { key: 'geral', label: 'Geral' },
      { key: 'pet', label: 'Pet' },
      { key: 'imprevistos', label: 'Imprevistos' },
    ],
  },
]

export const RECEIPT_ITEM_IMPORTANCE_OPTIONS = [
  { key: 'essential', label: 'Essencial' },
  { key: 'superfluous', label: 'Supérfluo' },
]

export function getReceiptCategory(categoryKey) {
  return RECEIPT_DETAIL_CATALOG.find((category) => category.key === categoryKey) || RECEIPT_DETAIL_CATALOG[0]
}

export function getReceiptSubcategories(categoryKey) {
  return getReceiptCategory(categoryKey).subcategories
}

export function suggestBudgetCategoryForReceiptItem(expenseCategories, detailCategoryKey) {
  const list = Array.isArray(expenseCategories) ? expenseCategories : []
  const normalizedCategories = list.map((category) => ({
    ...category,
    normalizedName: normalizeText(category.name),
  }))

  const matchers = {
    alimentacao: ['alimentacao', 'mercado', 'supermercado'],
    limpeza: ['limpeza', 'casa', 'moradia'],
    higiene: ['higiene', 'saude', 'farmacia'],
    uso_domestico: ['casa', 'moradia', 'utilidades'],
    outros: ['outros', 'despesas diversas', 'casa'],
  }

  const candidates = matchers[detailCategoryKey] || []
  for (const candidate of candidates) {
    const match = normalizedCategories.find((category) => category.normalizedName.includes(candidate))
    if (match) return match.id
  }

  return ''
}

function nextSubcategoryFor(categoryKey) {
  const subcategories = getReceiptSubcategories(categoryKey)
  return subcategories[0] || { key: '', label: '' }
}

export function createEmptyReceiptItem(expenseCategories = []) {
  const category = RECEIPT_DETAIL_CATALOG[0]
  const firstSubcategory = nextSubcategoryFor(category.key)
  const budgetCategoryId = suggestBudgetCategoryForReceiptItem(expenseCategories, category.key)

  return {
    id: `receipt_item_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    description: '',
    amount: '',
    quantity: '',
    detailCategoryKey: category.key,
    detailCategoryLabel: category.label,
    detailSubcategoryKey: firstSubcategory.key,
    detailSubcategoryLabel: firstSubcategory.label,
    budgetCategoryId,
    budgetCategoryName: '',
    importance: 'essential',
  }
}

function toNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function summarizeReceiptDetail(items = [], totalAmount = 0) {
  const list = Array.isArray(items) ? items : []
  const detailedTotal = list.reduce((sum, item) => sum + toNumber(item.amount), 0)
  const total = toNumber(totalAmount)
  const difference = Number((total - detailedTotal).toFixed(2))
  const allRequiredComplete = list.length > 0 && list.every((item) => (
    item.description?.trim()
    && toNumber(item.amount) > 0
    && item.detailCategoryKey
    && item.detailSubcategoryKey
    && item.importance
    && item.budgetCategoryId
  ))

  return {
    detailedTotal,
    total,
    difference,
    isBalanced: Math.abs(difference) < 0.01,
    allRequiredComplete,
  }
}

export function normalizeReceiptItems(items = [], expenseCategories = []) {
  const categoryMap = new Map((expenseCategories || []).map((category) => [category.id, category]))

  return (Array.isArray(items) ? items : []).map((item) => {
    const detailCategory = getReceiptCategory(item.detailCategoryKey)
    const detailSubcategory = getReceiptSubcategories(item.detailCategoryKey)
      .find((subcategory) => subcategory.key === item.detailSubcategoryKey)
    const budgetCategory = categoryMap.get(item.budgetCategoryId)

    return {
      id: item.id,
      description: String(item.description || '').trim(),
      amount: toNumber(item.amount),
      quantity: item.quantity ? toNumber(item.quantity) : null,
      detailCategoryKey: detailCategory.key,
      detailCategoryLabel: detailCategory.label,
      detailSubcategoryKey: detailSubcategory?.key || '',
      detailSubcategoryLabel: detailSubcategory?.label || '',
      budgetCategoryId: item.budgetCategoryId || null,
      budgetCategoryName: budgetCategory?.name || item.budgetCategoryName || null,
      importance: item.importance === 'superfluous' ? 'superfluous' : 'essential',
    }
  })
}
