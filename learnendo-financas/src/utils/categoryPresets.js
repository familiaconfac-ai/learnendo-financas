import {
  EXPENSE_CATEGORY_TAXONOMY,
  INCOME_CATEGORY_TAXONOMY,
  INVESTMENT_CATEGORY_TAXONOMY,
  buildDefaultCategoriesFromTaxonomy,
  normalizeTaxonomyText,
} from './financeTaxonomy'

export const DEFAULT_EXPENSE_CATEGORY_PRESETS = EXPENSE_CATEGORY_TAXONOMY.map((preset) => ({
  name: preset.name,
  icon: preset.icon,
  items: [...preset.items],
}))

export const DEFAULT_INCOME_CATEGORY_PRESETS = INCOME_CATEGORY_TAXONOMY.map((preset) => ({
  name: preset.name,
  icon: preset.icon,
  items: [...preset.items],
}))

export const DEFAULT_INVESTMENT_CATEGORY_PRESETS = INVESTMENT_CATEGORY_TAXONOMY.map((preset) => ({
  name: preset.name,
  icon: preset.icon,
  items: [...preset.items],
}))

export function getDefaultCategories() {
  return buildDefaultCategoriesFromTaxonomy()
}

function normalizedKey(type, name) {
  return `${type || 'expense'}::${normalizeTaxonomyText(name)}`
}

export function mergeCategoriesWithDefaults(categories = []) {
  const merged = new Map()

  getDefaultCategories().forEach((category) => {
    merged.set(normalizedKey(category.type, category.name), {
      ...category,
      subcategories: [...(category.subcategories || [])],
    })
  })

  categories.forEach((category) => {
    const key = normalizedKey(category.type, category.name)
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, {
        ...category,
        subcategories: [...(Array.isArray(category.subcategories) ? category.subcategories : [])],
      })
      return
    }

    const seenSubcategories = new Set(
      (existing.subcategories || []).map((subcategory) => normalizeTaxonomyText(subcategory.name)),
    )
    const extraSubcategories = (Array.isArray(category.subcategories) ? category.subcategories : [])
      .filter((subcategory) => !seenSubcategories.has(normalizeTaxonomyText(subcategory.name)))

    merged.set(key, {
      ...existing,
      ...category,
      icon: category.icon || existing.icon,
      subcategories: [...(existing.subcategories || []), ...extraSubcategories],
    })
  })

  return [...merged.values()]
}
