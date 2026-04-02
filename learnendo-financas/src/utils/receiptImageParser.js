function normalize(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

const AMOUNT_PATTERN_SOURCE = String.raw`\d{1,3}(?:[.\s]\d{3})*,\d{2}|\d+(?:,\d{2})|\d{1,3}(?:,\d{3})*\.\d{2}`
const AMOUNT_PATTERN = new RegExp(AMOUNT_PATTERN_SOURCE, 'g')
const RECEIPT_DATE_PATTERN = /\b(\d{2})[\/.-](\d{2})[\/.-](\d{2,4})\b/g

function todayLocalIso() {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 10)
}

function buildIsoDate(day, month, year) {
  const numericDay = Number(day)
  const numericMonth = Number(month)
  const fullYear = Number(String(year).length === 2 ? `20${year}` : year)
  if (!Number.isInteger(numericDay) || !Number.isInteger(numericMonth) || !Number.isInteger(fullYear)) {
    return null
  }

  const iso = `${String(fullYear).padStart(4, '0')}-${String(numericMonth).padStart(2, '0')}-${String(numericDay).padStart(2, '0')}`
  const parsed = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(parsed.getTime())) return null
  if (parsed.getUTCFullYear() !== fullYear || parsed.getUTCMonth() + 1 !== numericMonth || parsed.getUTCDate() !== numericDay) {
    return null
  }
  return iso
}

function diffDaysBetween(leftIso, rightIso) {
  const left = new Date(`${String(leftIso).slice(0, 10)}T12:00:00`)
  const right = new Date(`${String(rightIso).slice(0, 10)}T12:00:00`)
  if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) return Number.POSITIVE_INFINITY
  return Math.round((left.getTime() - right.getTime()) / 86400000)
}

function parseAmount(value) {
  const raw = String(value || '').trim()
  if (!raw) return 0

  const match = raw.match(new RegExp(`(${AMOUNT_PATTERN_SOURCE})`))
  if (!match) return 0

  const token = match[1]
  if (token.includes(',') && token.includes('.')) {
    if (token.lastIndexOf(',') > token.lastIndexOf('.')) {
      return Number(token.replace(/\./g, '').replace(',', '.')) || 0
    }
    return Number(token.replace(/,/g, '')) || 0
  }

  if (token.includes(',')) {
    return Number(token.replace(/\./g, '').replace(',', '.')) || 0
  }

  return Number(token.replace(/\s/g, '')) || 0
}

function cleanLine(line) {
  return String(line || '')
    .replace(/\s+/g, ' ')
    .replace(/[|]{2,}/g, ' ')
    .trim()
}

function lineHasAmount(line) {
  return new RegExp(`(${AMOUNT_PATTERN_SOURCE})`).test(line)
}

function extractLineAmounts(line) {
  const matches = []
  for (const match of String(line || '').matchAll(AMOUNT_PATTERN)) {
    matches.push({
      token: match[0],
      index: match.index ?? 0,
      value: parseAmount(match[0]),
    })
  }
  return matches.filter((match) => match.value > 0)
}

function findReceiptDate(lines) {
  const todayIso = todayLocalIso()
  const candidates = []

  lines.forEach((line, lineIndex) => {
    const normalizedLine = normalize(line)
    for (const match of String(line || '').matchAll(RECEIPT_DATE_PATTERN)) {
      const iso = buildIsoDate(match[1], match[2], match[3])
      if (!iso) continue

      const dayDistance = diffDaysBetween(iso, todayIso)
      const year = Number(iso.slice(0, 4))
      let score = 0

      if (lineIndex <= 6) score += 4 - (lineIndex * 0.45)
      else if (lineIndex <= 14) score += 0.5

      if (/\b(data|emissao|emissao|compra|movimento|transacao|cupom)\b/.test(normalizedLine)) score += 4
      if (/\b(vencimento|fechamento|validade)\b/.test(normalizedLine)) score -= 3

      if (dayDistance <= 7) score += 4
      else if (dayDistance <= 45) score += 3
      else if (dayDistance <= 400) score += 2
      else if (dayDistance <= 900) score += 0.5
      else score -= 1.5

      if (year < 2020 || year > new Date().getFullYear() + 1) score -= 4

      candidates.push({ iso, score, lineIndex })
    }
  })

  if (candidates.length === 0) return todayIso

  candidates.sort((left, right) => (
    right.score - left.score
    || left.lineIndex - right.lineIndex
    || Math.abs(diffDaysBetween(left.iso, todayIso)) - Math.abs(diffDaysBetween(right.iso, todayIso))
  ))

  return candidates[0].iso
}

function findMerchantName(lines, file) {
  const baseName = String(file?.name || 'cupom')
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim()

  for (const line of lines.slice(0, 8)) {
    const normalized = normalize(line)
    if (!normalized) continue
    if (/cnpj|cpf|ie|cupom|documento|extrato|caixa|operador|cliente|www|http|tel|codigo/.test(normalized)) continue
    if (lineHasAmount(line)) continue
    if (line.length < 4) continue
    return line
  }

  return baseName || 'Cupom importado'
}

function hasSummaryKeyword(text) {
  return /(total|subtotal|desconto|acrescimo|troco|pagamento|valor recebido|dinheiro|cartao|credito|debito|pix)/.test(text)
}

function isDiscountLine(line) {
  return /(desconto|desc\.?|desc promocional|cupom desconto)/.test(normalize(line))
}

function isSubtotalLine(line) {
  return /(subtotal|sub total|parcial)/.test(normalize(line))
}

function isTotalLine(line) {
  const normalized = normalize(line)
  return (
    /(valor total|total a pagar|total r\$|vl total|total compra|total da compra|liquido)/.test(normalized)
    || (/total/.test(normalized) && !isSubtotalLine(line) && !isDiscountLine(line))
  )
}

function isMetadataLine(line) {
  const normalized = normalize(line)
  return (
    !normalized
    || /cnpj|cpf|ie|im|sat|nfce|danfe|cupom fiscal|documento auxiliar|consumidor/.test(normalized)
    || /www|http|obrigado|volte sempre|ate logo|chave pix|protocolo/.test(normalized)
    || /operador|caixa|cliente|terminal|serie|extrato|documento/.test(normalized)
    || /^\d{2}[\/.-]\d{2}[\/.-]\d{2,4}/.test(normalized)
    || /^\d+$/.test(normalized)
  )
}

function shouldBufferDescription(line) {
  const normalized = normalize(line)
  return (
    normalized.length >= 3
    && !lineHasAmount(line)
    && !isMetadataLine(line)
    && !hasSummaryKeyword(normalized)
  )
}

function rebuildReceiptLines(lines) {
  const rebuilt = []
  let pendingDescription = ''

  for (const rawLine of lines) {
    const line = cleanLine(rawLine)
    if (!line) continue

    if (shouldBufferDescription(line)) {
      pendingDescription = pendingDescription ? `${pendingDescription} ${line}` : line
      continue
    }

    if (lineHasAmount(line) && pendingDescription) {
      rebuilt.push(cleanLine(`${pendingDescription} ${line}`))
      pendingDescription = ''
      continue
    }

    if (pendingDescription) {
      rebuilt.push(cleanLine(pendingDescription))
      pendingDescription = ''
    }

    rebuilt.push(line)
  }

  if (pendingDescription) {
    rebuilt.push(cleanLine(pendingDescription))
  }

  return rebuilt
}

function extractQuantity(line) {
  const match = String(line || '').match(/(\d+(?:[.,]\d{1,3})?)\s*(?:x|X)\s*\d+[.,]\d{2}/)
  if (!match) return ''
  const quantity = Number(match[1].replace(',', '.'))
  return Number.isFinite(quantity) && quantity > 0 ? quantity : ''
}

function cleanTrailingAmountTokens(text) {
  return String(text || '')
    .replace(new RegExp(`(?:${AMOUNT_PATTERN_SOURCE})(?:\\s+(?:${AMOUNT_PATTERN_SOURCE}))*\\s*$`), ' ')
    .trim()
}

function cleanLeadingCodes(text) {
  return String(text || '')
    .replace(/^\d{3,}\s+/, '')
    .replace(/^\d+\s+(?=[a-zA-ZÀ-ÿ])/u, '')
    .trim()
}

function findTotalAmount(summary, itemTotal = 0) {
  if (summary.total > 0) return summary.total
  if (summary.subtotal > 0 || summary.discountTotal > 0 || summary.surchargeTotal > 0) {
    const derivedTotal = summary.subtotal - summary.discountTotal + summary.surchargeTotal
    if (derivedTotal > 0) return Number(derivedTotal.toFixed(2))
  }
  return itemTotal
}

function isReceiptNoise(line) {
  const normalized = normalize(line)
  if (!normalized) return true

  return (
    normalized.length < 3
    || /^(qtd|item|cod|codigo|sku)\b/.test(normalized)
    || isMetadataLine(line)
    || /^\d+$/.test(normalized)
  )
}

function cleanItemDescription(text) {
  return cleanLeadingCodes(
    cleanTrailingAmountTokens(
      String(text || '')
        .replace(/\b(?:qtd\.?|qtde\.?)\s*\d+(?:[.,]\d+)?\b/gi, ' ')
        .replace(/\b\d+(?:[.,]\d+)?\s*(?:x|X)\s*\d+[.,]\d{2}\b/g, ' ')
        .replace(/\b\d+[.,]\d{2}\s*(?:x|X)\s*\d+(?:[.,]\d+)?\b/g, ' ')
        .replace(/\b(?:un|und|kg|g|ml|lt|l)\b/gi, ' ')
        .replace(/[^\p{L}\p{N}\s/-]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    )
  )
}

function classifyReceiptItem(description) {
  const text = normalize(description)
  const rules = [
    {
      when: /(arroz|feijao|macarrao|leite|pao|cafe|acucar|farinha|carne|frango|iogurte|banana|maca|tomate|alface|batata|queijo|presunto)/,
      detailCategoryKey: 'alimentacao',
      detailSubcategoryKey: 'basico',
      budgetCategoryHints: ['Mercado', 'Supermercado', 'Alimentação', 'Alimentacao'],
      importance: 'essential',
    },
    {
      when: /(refrigerante|cerveja|vinho|suco|agua|energetico)/,
      detailCategoryKey: 'alimentacao',
      detailSubcategoryKey: 'bebida',
      budgetCategoryHints: ['Mercado', 'Supermercado', 'Alimentação', 'Alimentacao'],
      importance: 'superfluous',
    },
    {
      when: /(biscoito|bolacha|chocolate|bombom|bala|salgadinho|sorvete)/,
      detailCategoryKey: 'alimentacao',
      detailSubcategoryKey: 'superfluo_alimentar',
      budgetCategoryHints: ['Mercado', 'Supermercado', 'Lazer', 'Outros'],
      importance: 'superfluous',
    },
    {
      when: /(detergente|sabao|amaciante|agua sanitaria|desinfetante|limpa|esponja)/,
      detailCategoryKey: 'limpeza',
      detailSubcategoryKey: 'casa',
      budgetCategoryHints: ['Casa', 'Limpeza', 'Moradia'],
      importance: 'essential',
    },
    {
      when: /(shampoo|condicionador|sabonete|creme dental|escova dental|papel higienico|absorvente|fralda)/,
      detailCategoryKey: 'higiene',
      detailSubcategoryKey: 'cuidados_pessoais',
      budgetCategoryHints: ['Higiene', 'Saúde', 'Saude', 'Farmácia', 'Farmacia'],
      importance: 'essential',
    },
    {
      when: /(camiseta|calca|blusa|vestido|bermuda|tenis|sapato|meia|cueca|lingerie|roupa)/,
      detailCategoryKey: 'outros',
      detailSubcategoryKey: 'geral',
      budgetCategoryHints: ['Vestuário', 'Vestuario', 'Roupas'],
      importance: 'superfluous',
    },
    {
      when: /(pneu|oleo motor|filtro|palheta|bateria|aditivo|fluido|lampada automotiva)/,
      detailCategoryKey: 'uso_domestico',
      detailSubcategoryKey: 'manutencao',
      budgetCategoryHints: ['Carro', 'Automóvel', 'Automovel', 'Transporte'],
      importance: 'essential',
    },
    {
      when: /(racao|petisco pet|areia gato|tapete higienico)/,
      detailCategoryKey: 'outros',
      detailSubcategoryKey: 'pet',
      budgetCategoryHints: ['Pet', 'Animais'],
      importance: 'essential',
    },
  ]

  const matched = rules.find((rule) => rule.when.test(text))
  if (matched) return matched

  return {
    detailCategoryKey: 'outros',
    detailSubcategoryKey: 'geral',
    budgetCategoryHints: ['Outros', 'Despesas diversas'],
    importance: 'essential',
  }
}

function categoryLabelFor(key) {
  const labels = {
    alimentacao: 'Alimentação',
    limpeza: 'Limpeza',
    higiene: 'Higiene',
    uso_domestico: 'Uso doméstico',
    outros: 'Outros',
  }
  return labels[key] || 'Outros'
}

function subcategoryLabelFor(key) {
  const labels = {
    basico: 'Básico',
    proteina: 'Proteína',
    bebida: 'Bebida',
    lanche: 'Lanche',
    superfluo_alimentar: 'Supérfluo alimentar',
    roupa: 'Roupa',
    cozinha: 'Cozinha',
    casa: 'Casa',
    banho: 'Banho',
    cabelo: 'Cabelo',
    cuidados_pessoais: 'Cuidados pessoais',
    utensilios: 'Utensílios',
    organizacao: 'Organização',
    manutencao: 'Manutenção',
    geral: 'Geral',
    pet: 'Pet',
    imprevistos: 'Imprevistos',
  }
  return labels[key] || 'Geral'
}

function createReceiptItem(description, amount, quantity = '') {
  const itemClass = classifyReceiptItem(description)
  return {
    id: createId('receipt_item'),
    description,
    amount,
    quantity,
    detailCategoryKey: itemClass.detailCategoryKey,
    detailCategoryLabel: categoryLabelFor(itemClass.detailCategoryKey),
    detailSubcategoryKey: itemClass.detailSubcategoryKey,
    detailSubcategoryLabel: subcategoryLabelFor(itemClass.detailSubcategoryKey),
    budgetCategoryHints: itemClass.budgetCategoryHints,
    budgetCategoryId: '',
    budgetCategoryName: '',
    importance: itemClass.importance,
  }
}

function buildReceiptItemKey(item) {
  return `${normalize(item?.description)}|${Number(item?.amount || 0).toFixed(2)}`
}

function applyDiscountToItems(items, discountAmount) {
  if (!Array.isArray(items) || items.length === 0 || discountAmount <= 0) return false

  let remainingDiscount = Number(discountAmount)
  for (let index = items.length - 1; index >= 0 && remainingDiscount > 0; index -= 1) {
    const currentAmount = Number(items[index].amount || 0)
    if (currentAmount <= 0) continue
    const appliedDiscount = Math.min(currentAmount, remainingDiscount)
    items[index].amount = Number((currentAmount - appliedDiscount).toFixed(2))
    remainingDiscount = Number((remainingDiscount - appliedDiscount).toFixed(2))
  }

  return remainingDiscount < Number(discountAmount)
}

function parseReceiptSummary(lines) {
  const summary = {
    total: 0,
    subtotal: 0,
    discountTotal: 0,
    surchargeTotal: 0,
  }

  for (const line of lines) {
    if (!lineHasAmount(line)) continue
    const amount = parseAmount(line)
    if (amount <= 0) continue

    if (isTotalLine(line)) {
      summary.total = amount
      continue
    }

    if (isSubtotalLine(line)) {
      summary.subtotal = amount
      continue
    }

    if (isDiscountLine(line)) {
      summary.discountTotal += amount
      continue
    }

    if (/(acrescimo|juros|taxa)/.test(normalize(line))) {
      summary.surchargeTotal += amount
    }
  }

  return summary
}

function trimLikelyOcrDuplicates(items, expectedTotal) {
  if (!Array.isArray(items) || items.length <= 1 || !(expectedTotal > 0)) return items

  let runningTotal = items.reduce((sum, item) => sum + Number(item.amount || 0), 0)
  if (runningTotal <= expectedTotal * 1.2) return items

  const firstIndexByKey = new Map()
  items.forEach((item, index) => {
    const key = buildReceiptItemKey(item)
    if (!firstIndexByKey.has(key)) firstIndexByKey.set(key, index)
  })

  const nextItems = [...items]
  for (let index = nextItems.length - 1; index >= 0 && runningTotal > expectedTotal * 1.08; index -= 1) {
    const item = nextItems[index]
    const key = buildReceiptItemKey(item)
    const previous = nextItems[index - 1]
    const isImmediateRepeat = previous && buildReceiptItemKey(previous) === key
    const isLaterDuplicate = firstIndexByKey.get(key) !== index

    if (!isImmediateRepeat && !isLaterDuplicate) continue

    runningTotal = Number((runningTotal - Number(item.amount || 0)).toFixed(2))
    nextItems.splice(index, 1)
  }

  return nextItems
}

function parseReceiptItems(lines, expectedTotal = 0) {
  const items = []
  let carriedDiscountTotal = 0

  for (const rawLine of lines) {
    const line = cleanLine(rawLine)
    if (!line || isReceiptNoise(line) || !lineHasAmount(line)) continue

    if (isTotalLine(line) || isSubtotalLine(line)) continue

    if (isDiscountLine(line)) {
      const discountAmount = parseAmount(line)
      const applied = applyDiscountToItems(items, discountAmount)
      if (!applied) {
        carriedDiscountTotal += discountAmount
      }
      continue
    }

    const amounts = extractLineAmounts(line)
    if (amounts.length === 0) continue

    const finalAmount = amounts[amounts.length - 1]?.value || 0
    if (!Number.isFinite(finalAmount) || finalAmount <= 0) continue

    const description = cleanItemDescription(line.slice(0, amounts[amounts.length - 1].index))
    if (!description || description.length < 2) continue

    const normalized = normalize(description)
    if (hasSummaryKeyword(normalized)) continue

    items.push(createReceiptItem(description, finalAmount, extractQuantity(line)))
  }

  if (carriedDiscountTotal > 0) {
    applyDiscountToItems(items, carriedDiscountTotal)
  }

  return trimLikelyOcrDuplicates(items, expectedTotal)
}

async function extractTextWithOcr(file) {
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker('por')

  try {
    const { data } = await worker.recognize(file)
    return String(data?.text || '')
  } finally {
    await worker.terminate()
  }
}

export async function parseReceiptImageFile(file) {
  const ocrText = await extractTextWithOcr(file)
  const rawLines = ocrText
    .split(/\r?\n/)
    .map(cleanLine)
    .filter(Boolean)

  if (rawLines.length === 0) {
    throw new Error('Nao foi possivel extrair texto legivel da imagem do cupom.')
  }

  const lines = rebuildReceiptLines(rawLines)
  const merchantName = findMerchantName(lines, file)
  const summary = parseReceiptSummary(lines)
  const expectedTotal = findTotalAmount(summary, 0)
  const receiptItems = parseReceiptItems(lines, expectedTotal)
  const itemTotal = receiptItems.reduce((sum, item) => sum + Number(item.amount || 0), 0)
  const totalAmount = findTotalAmount(summary, itemTotal)
  const topHints = [...new Set(receiptItems.flatMap((item) => item.budgetCategoryHints || []))].slice(0, 4)

  return [{
    date: findReceiptDate(lines),
    description: merchantName ? `Cupom ${merchantName}` : 'Cupom importado por imagem',
    amount: totalAmount > 0 ? totalAmount : itemTotal,
    type: 'expense',
    direction: 'debit',
    balance: null,
    rawLine: lines.slice(0, 12).join(' | ').slice(0, 600),
    source: 'image_receipt',
    categoryHints: topHints.length > 0 ? topHints : ['Outros', 'Despesas diversas'],
    requiresReview: true,
    receiptDetailEnabled: receiptItems.length > 0,
    receiptItems,
    ocrPreviewLines: lines.slice(0, 30),
  }]
}
