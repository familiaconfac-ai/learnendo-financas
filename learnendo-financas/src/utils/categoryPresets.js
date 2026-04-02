function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export const DEFAULT_EXPENSE_CATEGORY_PRESETS = [
  {
    name: 'Moradia',
    icon: '🏠',
    items: ['Aluguel / Financiamento', 'Energia', 'Água', 'Internet', 'Gás', 'Condomínio', 'IPTU'],
  },
  {
    name: 'Alimentação',
    icon: '🍽️',
    items: ['Supermercado', 'Padaria', 'Restaurante', 'Delivery'],
  },
  {
    name: 'Transporte',
    icon: '🚗',
    items: ['Combustível', 'Manutenção', 'Seguro', 'IPVA', 'Estacionamento', 'Transporte público', 'Apps (Uber)'],
  },
  {
    name: 'Saúde',
    icon: '❤️',
    items: ['Plano de saúde', 'Consultas', 'Exames', 'Medicamentos'],
  },
  {
    name: 'Educação',
    icon: '📚',
    items: ['Escola', 'Faculdade', 'Cursos', 'Material'],
  },
  {
    name: 'Casa',
    icon: '🏡',
    items: ['Eletrodoméstico', 'Móveis', 'Utensílios', 'Decoração'],
  },
  {
    name: 'Tecnologia',
    icon: '📱',
    items: ['Celular', 'Computador', 'Equipamentos', 'Acessórios', 'Eletrônicos'],
  },
  {
    name: 'Pessoal',
    icon: '🧴',
    items: ['Roupas', 'Beleza', 'Higiene'],
  },
  {
    name: 'Pet',
    icon: '🐾',
    items: ['Ração', 'Veterinário', 'Higiene pet', 'Acessórios pet'],
  },
  {
    name: 'Lazer',
    icon: '🎯',
    items: ['Viagens', 'Cinema', 'Assinaturas'],
  },
  {
    name: 'Financeiro',
    icon: '💸',
    items: ['Juros', 'Tarifas', 'Multas', 'Impostos'],
  },
  {
    name: 'Trabalho',
    icon: '💼',
    items: ['Ferramentas', 'Software', 'Serviços', 'Equipamentos', 'Impostos'],
  },
  {
    name: 'Doações',
    icon: '🤝',
    items: ['Igreja', 'Doações'],
  },
]

export const DEFAULT_INCOME_CATEGORY_PRESETS = [
  {
    name: 'Renda',
    icon: '📈',
    items: ['Salário', 'Renda extra', 'Freelance', 'Aluguel recebido'],
  },
]

export const DEFAULT_INVESTMENT_CATEGORY_PRESETS = [
  {
    name: 'Investimentos',
    icon: '📊',
    items: ['Renda fixa', 'Renda variável', 'Tesouro Direto'],
  },
]

function buildCategoryId(type, name) {
  return `preset_${type}_${slugify(name)}`
}

function buildSubcategoryId(type, categoryName, subcategoryName) {
  return `preset_${type}_${slugify(categoryName)}_${slugify(subcategoryName)}`
}

function buildCategoryFromPreset(preset, type) {
  return {
    id: buildCategoryId(type, preset.name),
    name: preset.name,
    icon: preset.icon,
    type,
    subcategories: preset.items.map((item) => ({
      id: buildSubcategoryId(type, preset.name, item),
      name: item,
    })),
  }
}

export function getDefaultCategories() {
  return [
    ...DEFAULT_EXPENSE_CATEGORY_PRESETS.map((preset) => buildCategoryFromPreset(preset, 'expense')),
    ...DEFAULT_INCOME_CATEGORY_PRESETS.map((preset) => buildCategoryFromPreset(preset, 'income')),
    ...DEFAULT_INVESTMENT_CATEGORY_PRESETS.map((preset) => buildCategoryFromPreset(preset, 'investment')),
  ]
}

function normalizedKey(type, name) {
  return `${type || 'expense'}::${slugify(name)}`
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
      (existing.subcategories || []).map((subcategory) => slugify(subcategory.name)),
    )
    const extraSubcategories = (Array.isArray(category.subcategories) ? category.subcategories : [])
      .filter((subcategory) => !seenSubcategories.has(slugify(subcategory.name)))

    merged.set(key, {
      ...existing,
      ...category,
      icon: category.icon || existing.icon,
      subcategories: [...(existing.subcategories || []), ...extraSubcategories],
    })
  })

  return [...merged.values()]
}
