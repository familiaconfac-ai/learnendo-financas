export function normalizeTaxonomyText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function slugifyTaxonomy(value) {
  return normalizeTaxonomyText(value).replace(/\s+/g, '_')
}

function buildCategoryId(type, name) {
  return `preset_${type}_${slugifyTaxonomy(name)}`
}

function buildSubcategoryId(type, categoryName, subcategoryName) {
  return `preset_${type}_${slugifyTaxonomy(categoryName)}_${slugifyTaxonomy(subcategoryName)}`
}

export const EXPENSE_CATEGORY_TAXONOMY = [
  {
    name: 'Moradia',
    icon: '🏠',
    aliases: ['habitacao', 'habitacao', 'casa', 'lar', 'morar'],
    items: [
      'Aluguel / Financiamento',
      'Energia',
      'Água',
      'Internet',
      'Gás',
      'Condomínio',
      'IPTU',
      'Manutenção / Reparos',
      'Itens de casa',
    ],
  },
  {
    name: 'Alimentação',
    icon: '🍽️',
    aliases: ['alimentacao', 'mercado', 'supermercado', 'comida'],
    items: [
      'Supermercado',
      'Açougue',
      'Padaria',
      'Restaurante',
      'Delivery',
      'Bebidas',
    ],
  },
  {
    name: 'Transporte',
    icon: '🚗',
    aliases: ['mobilidade', 'carro', 'veiculo', 'veículo'],
    items: [
      'Combustível',
      'Mecânica',
      'Estética Automotiva',
      'Estacionamento',
      'Documentos',
      'Seguro',
      'IPVA',
      'Transporte público',
      'Apps (Uber)',
    ],
  },
  {
    name: 'Saúde',
    icon: '❤️',
    aliases: ['saude', 'farmacia', 'farmácia', 'medico', 'médico'],
    items: [
      'Plano de saúde',
      'Consultas',
      'Exames',
      'Medicamentos',
      'Farmácia',
    ],
  },
  {
    name: 'Pessoal',
    icon: '🧴',
    aliases: ['higiene', 'pessoal', 'vestuario', 'vestuário', 'beleza'],
    items: [
      'Higiene pessoal',
      'Vestuário',
      'Barbeiro',
      'Beleza',
    ],
  },
  {
    name: 'Educação',
    icon: '📚',
    aliases: ['educacao', 'estudo', 'cursos'],
    items: ['Escola', 'Faculdade', 'Cursos', 'Material'],
  },
  {
    name: 'Casa',
    icon: '🏡',
    aliases: ['lar', 'utensilios', 'utensílios', 'organizacao', 'organização'],
    items: ['Limpeza', 'Utensílios', 'Móveis', 'Eletrodomésticos', 'Decoração'],
  },
  {
    name: 'Tecnologia',
    icon: '📱',
    aliases: ['tech', 'eletronicos', 'eletrônicos', 'equipamentos'],
    items: ['Celular', 'Computador', 'Equipamentos', 'Acessórios', 'Eletrônicos'],
  },
  {
    name: 'Pet',
    icon: '🐾',
    aliases: ['animais'],
    items: ['Ração', 'Veterinário', 'Higiene pet', 'Acessórios pet'],
  },
  {
    name: 'Lazer',
    icon: '🎯',
    aliases: ['diversao', 'diversão', 'entretenimento'],
    items: ['Viagens', 'Cinema', 'Assinaturas', 'Passeios'],
  },
  {
    name: 'Financeiro',
    icon: '💸',
    aliases: ['bancario', 'bancário', 'taxas', 'juros'],
    items: ['Juros', 'Tarifas', 'Multas', 'Impostos', 'Empréstimos'],
  },
  {
    name: 'Trabalho',
    icon: '💼',
    aliases: ['profissional', 'empresa'],
    items: ['Ferramentas', 'Software', 'Serviços', 'Equipamentos', 'Impostos'],
  },
  {
    name: 'Doações',
    icon: '🤝',
    aliases: ['doacoes', 'igreja', 'dizimo', 'dízimo'],
    items: ['Igreja', 'Dízimo', 'Doações'],
  },
]

export const INCOME_CATEGORY_TAXONOMY = [
  {
    name: 'Renda',
    icon: '📈',
    items: ['Salário', 'Renda extra', 'Freelance', 'Aluguel recebido', 'Vale / Adiantamento'],
  },
]

export const INVESTMENT_CATEGORY_TAXONOMY = [
  {
    name: 'Investimentos',
    icon: '📊',
    items: ['Renda fixa', 'Renda variável', 'Tesouro Direto'],
  },
]

export const RECEIPT_DETAIL_TAXONOMY = [
  {
    key: 'alimentacao',
    label: 'Alimentação',
    budgetCategoryHints: ['Alimentação', 'Supermercado', 'Mercado'],
    subcategories: [
      {
        key: 'supermercado',
        label: 'Supermercado',
        budgetCategoryHints: ['Alimentação', 'Supermercado', 'Mercado'],
      },
      {
        key: 'acougue',
        label: 'Açougue',
        budgetCategoryHints: ['Alimentação', 'Açougue', 'Supermercado'],
      },
      {
        key: 'padaria',
        label: 'Padaria',
        budgetCategoryHints: ['Alimentação', 'Padaria', 'Supermercado'],
      },
      {
        key: 'restaurante_delivery',
        label: 'Restaurante / Delivery',
        budgetCategoryHints: ['Alimentação', 'Restaurante', 'Delivery'],
      },
      {
        key: 'bebidas',
        label: 'Bebidas',
        budgetCategoryHints: ['Alimentação', 'Bebidas', 'Supermercado'],
      },
      {
        key: 'superfluos',
        label: 'Supérfluos alimentares',
        budgetCategoryHints: ['Alimentação', 'Lazer', 'Outros'],
      },
    ],
  },
  {
    key: 'transporte',
    label: 'Transporte',
    budgetCategoryHints: ['Transporte', 'Mobilidade', 'Carro'],
    subcategories: [
      {
        key: 'combustivel',
        label: 'Combustível',
        budgetCategoryHints: ['Transporte', 'Combustível', 'Posto'],
      },
      {
        key: 'mecanica',
        label: 'Mecânica',
        budgetCategoryHints: ['Transporte', 'Mecânica', 'Manutenção'],
      },
      {
        key: 'estetica_automotiva',
        label: 'Estética Automotiva',
        budgetCategoryHints: ['Transporte', 'Estética Automotiva', 'Manutenção'],
      },
      {
        key: 'estacionamento',
        label: 'Estacionamento',
        budgetCategoryHints: ['Transporte', 'Estacionamento'],
      },
      {
        key: 'documentos',
        label: 'Documentos',
        budgetCategoryHints: ['Transporte', 'Documentos', 'IPVA', 'Seguro'],
      },
      {
        key: 'transporte_publico',
        label: 'Transporte público',
        budgetCategoryHints: ['Transporte', 'Transporte público', 'Mobilidade'],
      },
    ],
  },
  {
    key: 'habitacao',
    label: 'Habitação',
    budgetCategoryHints: ['Moradia', 'Casa', 'Habitação'],
    subcategories: [
      {
        key: 'energia',
        label: 'Energia',
        budgetCategoryHints: ['Moradia', 'Energia'],
      },
      {
        key: 'agua',
        label: 'Água',
        budgetCategoryHints: ['Moradia', 'Água'],
      },
      {
        key: 'internet',
        label: 'Internet',
        budgetCategoryHints: ['Moradia', 'Internet'],
      },
      {
        key: 'manutencao_reparos',
        label: 'Manutenção / Reparos',
        budgetCategoryHints: ['Moradia', 'Casa', 'Manutenção'],
      },
      {
        key: 'itens_de_casa',
        label: 'Itens de casa',
        budgetCategoryHints: ['Casa', 'Moradia', 'Utensílios'],
      },
      {
        key: 'limpeza_casa',
        label: 'Limpeza da casa',
        budgetCategoryHints: ['Casa', 'Moradia', 'Limpeza'],
      },
    ],
  },
  {
    key: 'saude_pessoal',
    label: 'Saúde / Pessoal',
    budgetCategoryHints: ['Saúde', 'Pessoal', 'Farmácia'],
    subcategories: [
      {
        key: 'farmacia',
        label: 'Farmácia',
        budgetCategoryHints: ['Saúde', 'Farmácia', 'Medicamentos'],
      },
      {
        key: 'higiene_pessoal',
        label: 'Higiene pessoal',
        budgetCategoryHints: ['Pessoal', 'Saúde', 'Higiene'],
      },
      {
        key: 'vestuario',
        label: 'Vestuário',
        budgetCategoryHints: ['Pessoal', 'Vestuário', 'Roupas'],
      },
      {
        key: 'barbeiro',
        label: 'Barbeiro',
        budgetCategoryHints: ['Pessoal', 'Beleza', 'Barbeiro'],
      },
      {
        key: 'dizimo',
        label: 'Dízimo',
        budgetCategoryHints: ['Doações', 'Igreja', 'Dízimo', 'Pessoal'],
      },
    ],
  },
  {
    key: 'outros',
    label: 'Outros',
    budgetCategoryHints: ['Outros', 'Despesas diversas'],
    subcategories: [
      {
        key: 'pet',
        label: 'Pet',
        budgetCategoryHints: ['Pet', 'Animais'],
      },
      {
        key: 'lazer',
        label: 'Lazer',
        budgetCategoryHints: ['Lazer', 'Outros'],
      },
      {
        key: 'imprevistos',
        label: 'Imprevistos',
        budgetCategoryHints: ['Outros', 'Financeiro'],
      },
      {
        key: 'geral',
        label: 'Geral',
        budgetCategoryHints: ['Outros', 'Despesas diversas'],
      },
    ],
  },
]

const RECEIPT_DETAIL_CATEGORY_ALIASES = {
  limpeza: 'habitacao',
  higiene: 'saude_pessoal',
  uso_domestico: 'habitacao',
}

const RECEIPT_DETAIL_SUBCATEGORY_ALIASES = {
  alimentacao: {
    basico: 'supermercado',
    proteina: 'acougue',
    bebida: 'bebidas',
    lanche: 'restaurante_delivery',
    superfluo_alimentar: 'superfluos',
  },
  habitacao: {
    roupa: 'limpeza_casa',
    cozinha: 'itens_de_casa',
    casa: 'limpeza_casa',
    utensilios: 'itens_de_casa',
    organizacao: 'itens_de_casa',
    manutencao: 'manutencao_reparos',
    banho: 'limpeza_casa',
    cabelo: 'limpeza_casa',
    cuidados_pessoais: 'limpeza_casa',
  },
  saude_pessoal: {
    banho: 'higiene_pessoal',
    cabelo: 'higiene_pessoal',
    cuidados_pessoais: 'higiene_pessoal',
    roupa: 'vestuario',
  },
  outros: {
    geral: 'geral',
    pet: 'pet',
    imprevistos: 'imprevistos',
  },
}

function firstReceiptSubcategory(categoryKey) {
  const category = getReceiptDetailCategoryByKey(categoryKey)
  return category?.subcategories?.[0] || null
}

export function canonicalizeReceiptDetailCategoryKey(categoryKey) {
  const normalizedKey = String(categoryKey || '').trim()
  const candidate = RECEIPT_DETAIL_CATEGORY_ALIASES[normalizedKey] || normalizedKey
  return RECEIPT_DETAIL_TAXONOMY.some((category) => category.key === candidate)
    ? candidate
    : RECEIPT_DETAIL_TAXONOMY[0].key
}

export function canonicalizeReceiptDetailSubcategoryKey(categoryKey, subcategoryKey) {
  const canonicalCategoryKey = canonicalizeReceiptDetailCategoryKey(categoryKey)
  const category = getReceiptDetailCategoryByKey(canonicalCategoryKey)
  if (!category) return ''

  const directMatch = category.subcategories.find((subcategory) => subcategory.key === subcategoryKey)
  if (directMatch) return directMatch.key

  const aliasMap = RECEIPT_DETAIL_SUBCATEGORY_ALIASES[canonicalCategoryKey] || {}
  const aliasCandidate = aliasMap[String(subcategoryKey || '').trim()]
  if (aliasCandidate && category.subcategories.some((subcategory) => subcategory.key === aliasCandidate)) {
    return aliasCandidate
  }

  return category.subcategories[0]?.key || ''
}

export function getReceiptDetailCatalog() {
  return RECEIPT_DETAIL_TAXONOMY.map((category) => ({
    key: category.key,
    label: category.label,
    budgetCategoryHints: [...(category.budgetCategoryHints || [])],
    subcategories: category.subcategories.map((subcategory) => ({
      key: subcategory.key,
      label: subcategory.label,
      budgetCategoryHints: [...(subcategory.budgetCategoryHints || [])],
    })),
  }))
}

export function getReceiptDetailCategoryByKey(categoryKey) {
  const canonicalKey = canonicalizeReceiptDetailCategoryKey(categoryKey)
  return RECEIPT_DETAIL_TAXONOMY.find((category) => category.key === canonicalKey) || RECEIPT_DETAIL_TAXONOMY[0]
}

export function getReceiptDetailSubcategory(categoryKey, subcategoryKey) {
  const category = getReceiptDetailCategoryByKey(categoryKey)
  const canonicalSubcategoryKey = canonicalizeReceiptDetailSubcategoryKey(category.key, subcategoryKey)
  return category.subcategories.find((subcategory) => subcategory.key === canonicalSubcategoryKey)
    || category.subcategories[0]
  }

function findExpenseCategoryByHint(expenseCategories, hint) {
  const normalizedHint = normalizeTaxonomyText(hint)
  if (!normalizedHint) return null

  return (expenseCategories || []).find((category) => {
    const normalizedName = normalizeTaxonomyText(category.name)
    return normalizedName === normalizedHint
      || normalizedName.includes(normalizedHint)
      || normalizedHint.includes(normalizedName)
  }) || null
}

export function buildBudgetCategoryHints(categoryKey, subcategoryKey = '') {
  const category = getReceiptDetailCategoryByKey(categoryKey)
  const subcategory = subcategoryKey ? getReceiptDetailSubcategory(category.key, subcategoryKey) : null
  return [
    ...(subcategory?.budgetCategoryHints || []),
    ...(category?.budgetCategoryHints || []),
  ]
}

export function suggestBudgetCategoryFromReceiptDetail(expenseCategories, categoryKey, subcategoryKey = '') {
  const hints = buildBudgetCategoryHints(categoryKey, subcategoryKey)
  for (const hint of hints) {
    const match = findExpenseCategoryByHint(expenseCategories, hint)
    if (match) return match.id
  }
  return ''
}

function buildReceiptClassification(categoryKey, subcategoryKey, options = {}) {
  const category = getReceiptDetailCategoryByKey(categoryKey)
  const subcategory = getReceiptDetailSubcategory(category.key, subcategoryKey)
  return {
    detailCategoryKey: category.key,
    detailCategoryLabel: category.label,
    detailSubcategoryKey: subcategory.key,
    detailSubcategoryLabel: subcategory.label,
    budgetCategoryHints: buildBudgetCategoryHints(category.key, subcategory.key),
    importance: options.importance || 'essential',
  }
}

export function resolveReceiptClassification(categoryKey, subcategoryKey, options = {}) {
  return buildReceiptClassification(categoryKey, subcategoryKey, options)
}

const RECEIPT_CLASSIFICATION_RULES = [
  {
    pattern: /\b(cera automotiva|cera auto|cer auto|shampoo carro|shampoo auto|lava auto|limpa pneu|pretinho|silicone automotivo|painel automotivo|desengraxante automotivo)\b/,
    categoryKey: 'transporte',
    subcategoryKey: 'estetica_automotiva',
    importance: 'necessary',
  },
  {
    pattern: /\b(gasolina|etanol|diesel|gnv|aditivada|combustivel|abastecimento)\b/,
    categoryKey: 'transporte',
    subcategoryKey: 'combustivel',
    importance: 'essential',
  },
  {
    pattern: /\b(oleo motor|filtro de oleo|filtro de ar|pastilha de freio|palheta|bateria|pneu|alinhamento|balanceamento|mecanica|mecanic|revisao|correia|radiador)\b/,
    categoryKey: 'transporte',
    subcategoryKey: 'mecanica',
    importance: 'essential',
  },
  {
    pattern: /\b(estacionamento|zona azul|valet|pedagio|pedagio)\b/,
    categoryKey: 'transporte',
    subcategoryKey: 'estacionamento',
    importance: 'necessary',
  },
  {
    pattern: /\b(ipva|licenciamento|seguro auto|seguro veicular|vistoria|documento veiculo|emplacamento)\b/,
    categoryKey: 'transporte',
    subcategoryKey: 'documentos',
    importance: 'necessary',
  },
  {
    pattern: /\b(onibus|ônibus|metr|metro|bilhete unico|uber|99pop|taxi|táxi|mobilidade)\b/,
    categoryKey: 'transporte',
    subcategoryKey: 'transporte_publico',
    importance: 'necessary',
  },
  {
    pattern: /\b(arroz|feijao|macarrao|leite|cafe|café|acucar|açucar|farinha|ovo|ovos|banana|maca|maç[aã]|tomate|alface|batata|cebola|alho|oleo de soja|azeite)\b/,
    categoryKey: 'alimentacao',
    subcategoryKey: 'supermercado',
    importance: 'essential',
  },
  {
    pattern: /\b(carne|frango|peixe|linguica|lingui[cç]a|contra file|contra fil[eé]|picanha|acem|ac[eé]m)\b/,
    categoryKey: 'alimentacao',
    subcategoryKey: 'acougue',
    importance: 'essential',
  },
  {
    pattern: /\b(pao|pão|rosca|bolo|sonho|croissant|padaria|salgado assado)\b/,
    categoryKey: 'alimentacao',
    subcategoryKey: 'padaria',
    importance: 'necessary',
  },
  {
    pattern: /\b(ifood|restaurante|lanchonete|lanche|pizza|hamburguer|hamb[uú]rguer|pastel|delivery|marmita)\b/,
    categoryKey: 'alimentacao',
    subcategoryKey: 'restaurante_delivery',
    importance: 'necessary',
  },
  {
    pattern: /\b(refrigerante|cerveja|vinho|suco|agua mineral|água mineral|energetico|energ[eé]tico)\b/,
    categoryKey: 'alimentacao',
    subcategoryKey: 'bebidas',
    importance: 'superfluous',
  },
  {
    pattern: /\b(chocolate|bombom|bala|salgadinho|sorvete|bolacha recheada|biscoito recheado)\b/,
    categoryKey: 'alimentacao',
    subcategoryKey: 'superfluos',
    importance: 'superfluous',
  },
  {
    pattern: /\b(detergente|desinfetante|agua sanitaria|água sanit[aá]ria|sabao em po|sab[aã]o em p[oó]|amaciante|limpa vidro|limpa piso|esponja|multiuso)\b/,
    categoryKey: 'habitacao',
    subcategoryKey: 'limpeza_casa',
    importance: 'essential',
  },
  {
    pattern: /\b(lampada|l[aâ]mpada|extensao|extensão|tomada|chuveiro|torneira|tinta|massa corrida|parafuso|prego|cimento|argamassa|rejunte)\b/,
    categoryKey: 'habitacao',
    subcategoryKey: 'manutencao_reparos',
    importance: 'necessary',
  },
  {
    pattern: /\b(balde|vasilha|pano de prato|toalha|utensilio|utens[ií]lio|organizador|cabide|caixa organizadora)\b/,
    categoryKey: 'habitacao',
    subcategoryKey: 'itens_de_casa',
    importance: 'necessary',
  },
  {
    pattern: /\b(conta de luz|energia|cpfl|copel|enel)\b/,
    categoryKey: 'habitacao',
    subcategoryKey: 'energia',
    importance: 'essential',
  },
  {
    pattern: /\b(conta de agua|água saneamento|sanepar|sabesp|copasa)\b/,
    categoryKey: 'habitacao',
    subcategoryKey: 'agua',
    importance: 'essential',
  },
  {
    pattern: /\b(internet|fibra|wi fi|wifi|banda larga)\b/,
    categoryKey: 'habitacao',
    subcategoryKey: 'internet',
    importance: 'essential',
  },
  {
    pattern: /\b(paracetamol|dipirona|ibuprofeno|antibiotico|antibiótico|remedio|rem[eé]dio|medicamento|vitamina|farmacia|farm[aá]cia|drogaria)\b/,
    categoryKey: 'saude_pessoal',
    subcategoryKey: 'farmacia',
    importance: 'essential',
  },
  {
    pattern: /\b(shampoo|condicionador|sabonete|papel higienico|papel higi[eê]nico|creme dental|pasta de dente|escova dental|desodorante|absorvente|fralda)\b/,
    categoryKey: 'saude_pessoal',
    subcategoryKey: 'higiene_pessoal',
    importance: 'essential',
  },
  {
    pattern: /\b(camiseta|camisa|calca|calça|bermuda|vestido|saia|meia|cueca|lingerie|tenis|t[eê]nis|sapato|chinelo|roupa)\b/,
    categoryKey: 'saude_pessoal',
    subcategoryKey: 'vestuario',
    importance: 'necessary',
  },
  {
    pattern: /\b(barbearia|barbeiro|corte de cabelo|cabelo|escova progressiva|manicure|pedicure)\b/,
    categoryKey: 'saude_pessoal',
    subcategoryKey: 'barbeiro',
    importance: 'necessary',
  },
  {
    pattern: /\b(dizimo|d[ií]zimo|oferta igreja|oferta)\b/,
    categoryKey: 'saude_pessoal',
    subcategoryKey: 'dizimo',
    importance: 'essential',
  },
  {
    pattern: /\b(racao|ração|petisco pet|areia gato|tapete higienico pet|tapete higi[eê]nico pet)\b/,
    categoryKey: 'outros',
    subcategoryKey: 'pet',
    importance: 'essential',
  },
  {
    pattern: /\b(cinema|streaming|netflix|spotify|ingresso|parque|brinquedo|game)\b/,
    categoryKey: 'outros',
    subcategoryKey: 'lazer',
    importance: 'superfluous',
  },
]

export function classifyReceiptItemByTaxonomy(description) {
  const normalizedDescription = normalizeTaxonomyText(description)
  const matchedRule = RECEIPT_CLASSIFICATION_RULES.find((rule) => rule.pattern.test(normalizedDescription))

  if (matchedRule) {
    return buildReceiptClassification(
      matchedRule.categoryKey,
      matchedRule.subcategoryKey,
      { importance: matchedRule.importance },
    )
  }

  return buildReceiptClassification('outros', 'geral', { importance: 'essential' })
}

function buildCategoryFromTaxonomyEntry(preset, type) {
  return {
    id: buildCategoryId(type, preset.name),
    name: preset.name,
    icon: preset.icon,
    type,
    aliases: [...(preset.aliases || [])],
    subcategories: preset.items.map((item) => ({
      id: buildSubcategoryId(type, preset.name, item),
      name: item,
    })),
  }
}

export function buildDefaultCategoriesFromTaxonomy() {
  return [
    ...EXPENSE_CATEGORY_TAXONOMY.map((preset) => buildCategoryFromTaxonomyEntry(preset, 'expense')),
    ...INCOME_CATEGORY_TAXONOMY.map((preset) => buildCategoryFromTaxonomyEntry(preset, 'income')),
    ...INVESTMENT_CATEGORY_TAXONOMY.map((preset) => buildCategoryFromTaxonomyEntry(preset, 'investment')),
  ]
}

export function getReceiptAiTaxonomyPayload() {
  return {
    allowedImportance: ['essential', 'necessary', 'superfluous'],
    categories: RECEIPT_DETAIL_TAXONOMY.map((category) => ({
      key: category.key,
      label: category.label,
      budgetCategoryHints: [...(category.budgetCategoryHints || [])],
      subcategories: category.subcategories.map((subcategory) => ({
        key: subcategory.key,
        label: subcategory.label,
        budgetCategoryHints: [...(subcategory.budgetCategoryHints || [])],
      })),
    })),
  }
}
