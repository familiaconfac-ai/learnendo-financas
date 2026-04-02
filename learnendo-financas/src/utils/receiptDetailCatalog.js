import {
  buildBudgetCategoryHints,
  canonicalizeReceiptDetailCategoryKey,
  canonicalizeReceiptDetailSubcategoryKey,
  getReceiptDetailCatalog,
  getReceiptDetailCategoryByKey,
  getReceiptDetailSubcategory,
  suggestBudgetCategoryFromReceiptDetail,
} from './financeTaxonomy'

export const RECEIPT_DETAIL_CATALOG = getReceiptDetailCatalog()

export const RECEIPT_ITEM_IMPORTANCE_OPTIONS = [
  { key: 'essential', label: 'Essencial' },
  { key: 'necessary', label: 'Necessário' },
  { key: 'superfluous', label: 'Supérfluo' },
]

export function getReceiptCategory(categoryKey) {
  return getReceiptDetailCategoryByKey(categoryKey)
}

export function getReceiptSubcategories(categoryKey) {
  return getReceiptCategory(categoryKey).subcategories
}

export function suggestBudgetCategoryForReceiptItem(expenseCategories, detailCategoryKey, detailSubcategoryKey = '') {
  return suggestBudgetCategoryFromReceiptDetail(expenseCategories, detailCategoryKey, detailSubcategoryKey)
}

export function createEmptyReceiptItem(expenseCategories = []) {
  const category = RECEIPT_DETAIL_CATALOG[0]
  const firstSubcategory = category.subcategories[0] || { key: '', label: '' }
  const budgetCategoryId = suggestBudgetCategoryForReceiptItem(
    expenseCategories,
    category.key,
    firstSubcategory.key,
  )

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
    budgetCategoryHints: buildBudgetCategoryHints(category.key, firstSubcategory.key),
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
    const detailCategoryKey = canonicalizeReceiptDetailCategoryKey(item.detailCategoryKey)
    const detailSubcategoryKey = canonicalizeReceiptDetailSubcategoryKey(
      detailCategoryKey,
      item.detailSubcategoryKey,
    )
    const detailCategory = getReceiptCategory(detailCategoryKey)
    const detailSubcategory = getReceiptDetailSubcategory(detailCategoryKey, detailSubcategoryKey)
    const budgetCategory = categoryMap.get(item.budgetCategoryId)

    return {
      id: item.id,
      description: String(item.description || '').trim(),
      amount: toNumber(item.amount),
      quantity: item.quantity ? toNumber(item.quantity) : null,
      detailCategoryKey: detailCategory.key,
      detailCategoryLabel: detailCategory.label,
      detailSubcategoryKey: detailSubcategory.key,
      detailSubcategoryLabel: detailSubcategory.label,
      budgetCategoryId: item.budgetCategoryId || null,
      budgetCategoryName: budgetCategory?.name || item.budgetCategoryName || null,
      budgetCategoryHints: Array.isArray(item.budgetCategoryHints) && item.budgetCategoryHints.length > 0
        ? [...item.budgetCategoryHints]
        : buildBudgetCategoryHints(detailCategory.key, detailSubcategory.key),
      importance: item.importance === 'superfluous'
        ? 'superfluous'
        : item.importance === 'necessary'
          ? 'necessary'
          : 'essential',
    }
  })
}
