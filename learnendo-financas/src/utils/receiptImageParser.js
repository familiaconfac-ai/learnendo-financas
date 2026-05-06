import { classifyReceiptItemByTaxonomy } from './financeTaxonomy'
import {
  analyzeReceiptWithAiFallback,
  analyzeReceiptTextWithAiFallback,
  hydrateReceiptItemsFromCache,
  isReceiptAiFallbackConfigured,
  isGeminiRateLimitError,
} from '../services/receiptAiFallbackService'

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
const RECEIPT_ITEM_COUNT_PATTERN = /(?:qtd\.?\s*)?total\s+de\s+itens?\D+(\d{1,4})/i

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
    && !/^\d{1,3}\s+\d{2,}/.test(String(line || '').trim())
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

function normalizeQuantityNumber(value) {
  const quantity = Number(String(value || '').replace(',', '.'))
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

function shouldUseAiFallback(receiptItems, totalAmount) {
  const items = Array.isArray(receiptItems) ? receiptItems : []
  if (!isReceiptAiFallbackConfigured()) return false
  if (items.length === 0) return true
  if (!(Number(totalAmount) > 0)) return true

  const genericCount = items.filter((item) =>
    item.detailCategoryKey === 'outros'
    || item.detailSubcategoryKey === 'geral'
  ).length

  return genericCount === items.length
}

function isLikelyCorruptedDescription(description) {
  const text = String(description || '').trim()
  if (!text) return true

  const tokens = text.split(/\s+/).filter(Boolean)
  const oneLetterTokens = tokens.filter((token) => token.length === 1).length
  const vowelCount = (normalize(text).match(/[aeiou]/g) || []).length
  const suspiciousChunkCount = (text.match(/[A-Z0-9]{8,}/g) || []).length

  return (
    (text.length >= 18 && oneLetterTokens >= 4)
    || (text.length >= 14 && vowelCount <= 1)
    || suspiciousChunkCount >= 2
  )
}

function shouldForceAiFallback(receiptItems, summary = {}, totalAmount = 0) {
  const items = Array.isArray(receiptItems) ? receiptItems : []
  const expectedCount = Number(summary?.itemCount || 0)
  const partialCount = items.filter((item) => item?.status === 'partial' || !(Number(item?.amount) > 0)).length
  const corruptedCount = items.filter((item) => isLikelyCorruptedDescription(item?.description)).length
  const parsedTotal = items.reduce((sum, item) => sum + Number(item?.amount || 0), 0)
  const totalDelta = Number(totalAmount) > 0 ? Math.abs(parsedTotal - Number(totalAmount)) : 0

  if (expectedCount > 0 && items.length < Math.max(8, Math.floor(expectedCount * 0.65))) return true
  if (items.length > 0 && partialCount / items.length >= 0.25) return true
  if (items.length > 0 && corruptedCount / items.length >= 0.3) return true
  if (Number(totalAmount) > 0 && totalDelta > Math.max(8, totalAmount * 0.18)) return true

  return false
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

function looksStructuredReceiptItemLine(line) {
  const structuredPattern = new RegExp(
    String.raw`^\d{1,3}\s+\d{2,}\s+.+?\s+\d+(?:[.,]\d{1,3})?\s*(?:un|und|kg|g|ml|lt|l)\s*[xX]\s*(?:${AMOUNT_PATTERN_SOURCE})\s+(?:${AMOUNT_PATTERN_SOURCE})$`,
    'i',
  )
  return structuredPattern.test(String(line || '').trim())
}

function parseStructuredReceiptItemLine(line) {
  const structuredPattern = new RegExp(
    String.raw`^(?:\d{1,3})\s+(?:\d{2,})\s+(?<description>.+?)\s+(?<quantity>\d+(?:[.,]\d{1,3})?)\s*(?:un|und|kg|g|ml|lt|l)\s*[xX]\s*(?<unitAmount>${AMOUNT_PATTERN_SOURCE})\s+(?<totalAmount>${AMOUNT_PATTERN_SOURCE})$`,
    'i',
  )

  const match = String(line || '').trim().match(structuredPattern)
  if (!match?.groups) return null

  const description = cleanItemDescription(match.groups.description)
  const amount = parseAmount(match.groups.totalAmount)
  const unitAmount = parseAmount(match.groups.unitAmount)
  const quantity = normalizeQuantityNumber(match.groups.quantity)

  if (!description || !(amount > 0)) return null

  return {
    description,
    amount,
    quantity,
    unitAmount: unitAmount > 0 ? unitAmount : null,
  }
}

function looksGenericReceiptItemLine(line) {
  const raw = String(line || '').trim()
  if (!raw) return false
  if (!lineHasAmount(raw)) return false

  const normalized = normalize(raw)
  if (isMetadataLine(raw) || hasSummaryKeyword(normalized)) return false

  const description = cleanItemDescription(raw.replace(/\bR\$\s*/gi, ' '))
  return description.length >= 3
}

function parseGenericReceiptItemLine(line) {
  if (!looksGenericReceiptItemLine(line)) return null

  const raw = String(line || '').trim()
  const amounts = extractLineAmounts(raw)
  if (amounts.length === 0) return null

  const quantity = normalizeQuantityNumber(extractQuantity(raw)) || null
  const totalAmount = amounts[amounts.length - 1]?.value || 0
  const unitAmount = amounts.length >= 2 ? amounts[amounts.length - 2]?.value || 0 : 0
  const descriptionSource = raw.slice(0, amounts[0].index)
  const description = cleanItemDescription(
    descriptionSource
      .replace(/^[#*\-–—•\s]*/, '')
      .replace(/^\d+[.)\-\s]+/, ''),
  )

  if (!description || !(totalAmount > 0)) return null

  return {
    description,
    amount: totalAmount,
    quantity,
    unitAmount: unitAmount > 0 ? unitAmount : null,
  }
}

function scoreReceiptOcrText(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(cleanLine)
    .filter(Boolean)

  if (lines.length === 0) return -Infinity

  const structuredCount = lines.filter((line) => looksStructuredReceiptItemLine(line)).length
  const amountCount = lines.filter((line) => extractLineAmounts(line).length > 0).length
  const itemCountHint = lines.reduce((max, line) => {
    const match = String(line || '').match(RECEIPT_ITEM_COUNT_PATTERN)
    return Math.max(max, Number(match?.[1] || 0))
  }, 0)
  const noisePenalty = lines.filter((line) => isLikelyCorruptedDescription(line)).length

  return (structuredCount * 10) + (amountCount * 2) + itemCountHint - noisePenalty
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
  const itemClass = classifyReceiptItemByTaxonomy(description)
  return {
    id: createId('receipt_item'),
    description,
    amount,
    quantity,
    detailCategoryKey: itemClass.detailCategoryKey,
    detailCategoryLabel: itemClass.detailCategoryLabel,
    detailSubcategoryKey: itemClass.detailSubcategoryKey,
    detailSubcategoryLabel: itemClass.detailSubcategoryLabel,
    budgetCategoryHints: itemClass.budgetCategoryHints,
    budgetCategoryId: '',
    budgetCategoryName: '',
    importance: itemClass.importance,
  }
}
void classifyReceiptItem
void categoryLabelFor
void subcategoryLabelFor

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
    itemCount: 0,
  }

  for (const line of lines) {
    const itemCountMatch = String(line || '').match(RECEIPT_ITEM_COUNT_PATTERN)
    if (itemCountMatch) {
      summary.itemCount = Number(itemCountMatch[1] || 0)
    }

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

function sliceReceiptDetailLines(lines) {
  const source = Array.isArray(lines) ? lines : []
  if (source.length === 0) return []

  let startIndex = source.findIndex((line) => /detalhe da venda/i.test(String(line || '')))
  if (startIndex < 0) startIndex = source.findIndex((line) => /item\s+cod/i.test(normalize(line)))
  if (startIndex < 0) startIndex = 0

  let endIndex = source.findIndex((line, index) => (
    index > startIndex
    && /(total de itens|valor total|forma de pagamento|valor a pagar)/i.test(normalize(line))
  ))
  if (endIndex < 0) endIndex = source.length

  return source.slice(startIndex + 1, endIndex)
}

function finalizeLocalReceiptItems(items, summary = {}) {
  const source = Array.isArray(items) ? items : []
  const expectedCount = Number(summary?.itemCount || 0)
  const withAmount = source.filter((item) => Number(item?.amount || 0) > 0 && String(item?.description || '').trim().length >= 2)

  if (expectedCount > 0 && withAmount.length > expectedCount * 1.5) {
    const deduped = []
    const seen = new Set()
    for (const item of withAmount) {
      const key = `${normalize(item.description)}|${Number(item.amount || 0).toFixed(2)}`
      if (seen.has(key)) continue
      seen.add(key)
      deduped.push(item)
    }
    return deduped
  }

  return withAmount
}

function parseReceiptItems(lines, expectedTotal = 0) {
  const items = []
  let carriedDiscountTotal = 0

  for (const rawLine of lines) {
    const line = cleanLine(rawLine)
    if (!line || isReceiptNoise(line)) continue

    if (isTotalLine(line) || isSubtotalLine(line)) continue

    if (isDiscountLine(line)) {
      const discountAmount = parseAmount(line)
      const applied = applyDiscountToItems(items, discountAmount)
      if (!applied) {
        carriedDiscountTotal += discountAmount
      }
      continue
    }

    const structuredItem = looksStructuredReceiptItemLine(line)
      ? parseStructuredReceiptItemLine(line)
      : null
    if (structuredItem) {
      const item = createReceiptItem(structuredItem.description, structuredItem.amount, structuredItem.quantity)
      item.status = 'identified'
      item.unitAmount = structuredItem.unitAmount
      items.push(item)
      continue
    }

    const amounts = extractLineAmounts(line)
    let finalAmount = 0
    if (amounts.length > 0) {
      finalAmount = amounts[amounts.length - 1]?.value || 0
    }

    // Melhor extração de descrição: se não houver valor, tenta pegar a linha toda
    let description = ''
    if (amounts.length > 0) {
      description = cleanItemDescription(line.slice(0, amounts[amounts.length - 1].index))
    } else {
      // Tenta extrair nome de produto mesmo sem valor
      description = cleanItemDescription(line)
    }
    if (!description || description.length < 2) continue

    const normalized = normalize(description)
    if (hasSummaryKeyword(normalized)) continue

    if (!(Number.isFinite(finalAmount) && finalAmount > 0)) continue

    const item = createReceiptItem(description, finalAmount, extractQuantity(line))
    item.status = 'identified'
    items.push(item)
  }

  if (carriedDiscountTotal > 0) {
    applyDiscountToItems(items, carriedDiscountTotal)
  }

  return trimLikelyOcrDuplicates(items, expectedTotal)
}

function parseGenericReceiptTextItems(lines, expectedTotal = 0) {
  const items = []

  for (const rawLine of Array.isArray(lines) ? lines : []) {
    const line = cleanLine(rawLine)
    if (!line) continue

    const genericItem = parseGenericReceiptItemLine(line)
    if (!genericItem) continue

    const item = createReceiptItem(genericItem.description, genericItem.amount, genericItem.quantity)
    item.status = 'identified'
    item.unitAmount = genericItem.unitAmount
    items.push(item)
  }

  return trimLikelyOcrDuplicates(items, expectedTotal)
}

async function extractTextWithOcr(file) {
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker('por')
  const input = await preprocessReceiptImage(file)

  try {
    const attempts = []

    for (const psm of ['4', '6', '11']) {
      await worker.setParameters({
        tessedit_pageseg_mode: psm,
        preserve_interword_spaces: '1',
      })
      const { data } = await worker.recognize(input)
      const text = String(data?.text || '')
      attempts.push({ text, score: scoreReceiptOcrText(text) })
    }

    attempts.sort((left, right) => right.score - left.score)
    return attempts[0]?.text || ''
  } finally {
    await worker.terminate()
  }
}

async function preprocessReceiptImage(file) {
  if (!file || typeof document === 'undefined' || !String(file.type || '').startsWith('image/')) return file

  const url = URL.createObjectURL(file)
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('Nao foi possivel abrir a imagem do cupom.'))
      img.src = url
    })

    const scale = Math.max(1.8, 1800 / Math.max(image.width || 1, 1))
    const width = Math.round(image.width * scale)
    const height = Math.round(image.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return file

    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    context.filter = 'grayscale(1) contrast(1.55) brightness(1.08) saturate(0)'
    context.drawImage(image, 0, 0, width, height)
    context.filter = 'none'

    const imageData = context.getImageData(0, 0, width, height)
    const { data } = imageData
    for (let index = 0; index < data.length; index += 4) {
      const luminance = (data[index] * 0.299) + (data[index + 1] * 0.587) + (data[index + 2] * 0.114)
      const pixel = luminance > 168 ? 255 : 0
      data[index] = pixel
      data[index + 1] = pixel
      data[index + 2] = pixel
    }
    context.putImageData(imageData, 0, 0)

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    return blob || file
  } catch {
    return file
  } finally {
    URL.revokeObjectURL(url)
  }
}

function groupReceiptPdfTextToLines(items) {
  const sorted = [...(items || [])]
    .map((item) => ({
      text: String(item.str || '').trim(),
      x: item.transform?.[4] || 0,
      y: item.transform?.[5] || 0,
    }))
    .filter((item) => item.text)
    .sort((left, right) => {
      const deltaY = Math.abs(right.y - left.y)
      if (deltaY > 2.5) return right.y - left.y
      return left.x - right.x
    })

  const rows = []
  for (const item of sorted) {
    const last = rows[rows.length - 1]
    if (!last || Math.abs(last.y - item.y) > 2.5) {
      rows.push({ y: item.y, parts: [item] })
      continue
    }
    last.parts.push(item)
  }

  return rows.map((row) => row.parts
    .sort((left, right) => left.x - right.x)
    .map((part) => part.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim())
}

async function extractTextFromReceiptPdf(file) {
  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist')
  GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

  const buffer = await file.arrayBuffer()
  const pdf = await getDocument({ data: new Uint8Array(buffer) }).promise
  const lines = []

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum)
    const content = await page.getTextContent()
    lines.push(...groupReceiptPdfTextToLines(content.items || []))
  }

  return lines.filter(Boolean).join('\n')
}

function buildReceiptResultFromText(rawText, file, aiWarningMessage = '') {
  const rawLines = String(rawText || '')
    .split(/\r?\n/)
    .map(cleanLine)
    .filter(Boolean)

  if (rawLines.length === 0) {
    throw new Error('Nao foi possivel extrair texto legivel do cupom.')
  }

  const lines = rebuildReceiptLines(rawLines)
  const merchantName = findMerchantName(lines, file)
  const purchaseDate = findReceiptDate(lines)
  const summary = parseReceiptSummary(lines)
  const detailLines = sliceReceiptDetailLines(lines)
  const expectedTotal = findTotalAmount(summary, 0)
  const receiptItems = hydrateReceiptItemsFromCache(
    finalizeLocalReceiptItems(parseReceiptItems(detailLines, expectedTotal), summary),
  )
  const itemTotal = receiptItems.reduce((sum, item) => sum + Number(item.amount || 0), 0)
  const totalAmount = findTotalAmount(summary, itemTotal)

  return [{
    date: purchaseDate,
    description: merchantName ? `Cupom ${merchantName}` : 'Cupom importado',
    amount: totalAmount > 0 ? totalAmount : itemTotal,
    type: 'expense',
    direction: 'debit',
    balance: null,
    rawLine: lines.slice(0, 12).join(' | ').slice(0, 600),
    source: 'pdf_receipt',
    categoryHints: [...new Set(receiptItems.flatMap((item) => item.budgetCategoryHints || []))].slice(0, 4),
    requiresReview: true,
    receiptDetailEnabled: receiptItems.length > 0,
    receiptItems,
    aiWarningMessage,
    ocrPreviewLines: lines.slice(0, 30),
  }]
}

function buildReceiptEnvelope({
  lines,
  file,
  merchantName,
  purchaseDate,
  totalAmount,
  receiptItems,
  source,
  aiWarningMessage = '',
}) {
  return [{
    date: purchaseDate,
    description: merchantName ? `Cupom ${merchantName}` : 'Cupom importado',
    amount: totalAmount,
    type: 'expense',
    direction: 'debit',
    balance: null,
    rawLine: lines.slice(0, 12).join(' | ').slice(0, 600),
    source,
    categoryHints: [...new Set((receiptItems || []).flatMap((item) => item.budgetCategoryHints || []))].slice(0, 4),
    requiresReview: true,
    receiptDetailEnabled: (receiptItems || []).length > 0,
    receiptItems,
    aiWarningMessage,
    ocrPreviewLines: lines.slice(0, 30),
  }]
}

export async function parseReceiptImageFile(file) {
  const ocrText = await extractTextWithOcr(file)
  const rawLines = ocrText.split(/\r?\n/).map(cleanLine).filter(Boolean)
  if (rawLines.length === 0) {
    throw new Error('Nao foi possivel extrair texto legivel da imagem do cupom.')
  }

  const lines = rebuildReceiptLines(rawLines)
  const merchantName = findMerchantName(lines, file)
  const purchaseDate = findReceiptDate(lines)
  const summary = parseReceiptSummary(lines)
  const detailLines = sliceReceiptDetailLines(lines)
  const expectedTotal = findTotalAmount(summary, 0)
  let receiptItems = hydrateReceiptItemsFromCache(finalizeLocalReceiptItems(parseReceiptItems(detailLines, expectedTotal), summary))
  let itemTotal = receiptItems.reduce((sum, item) => sum + Number(item.amount || 0), 0)
  let totalAmount = findTotalAmount(summary, itemTotal)
  let aiWarningMessage = ''
  const needsAdvancedRead = shouldUseAiFallback(receiptItems, totalAmount) || shouldForceAiFallback(receiptItems, summary, totalAmount)

  if (isReceiptAiFallbackConfigured()) {
    try {
      const aiFallback = await analyzeReceiptWithAiFallback({
        file,
        ocrText,
        fileName: file?.name,
        localSummary: {
          merchantName,
          purchaseDate,
          totalAmount,
          expectedItemCount: summary.itemCount || 0,
          localItemCount: receiptItems.length,
          localItems: receiptItems.slice(0, 25).map((item) => ({
            description: item.description,
            amount: item.amount,
            detailCategoryKey: item.detailCategoryKey,
            detailSubcategoryKey: item.detailSubcategoryKey,
          })),
        },
      })

      if (aiFallback?.items?.length) {
        receiptItems = aiFallback.items
        itemTotal = receiptItems.reduce((sum, item) => sum + Number(item.amount || 0), 0)
        totalAmount = Number(aiFallback.totalAmount || totalAmount || itemTotal)
        if (aiFallback.purchaseDate) {
          summary.purchaseDate = aiFallback.purchaseDate
        }
        if (aiFallback.merchantName) {
          summary.merchantName = aiFallback.merchantName
        }
      }
    } catch (error) {
      if (isGeminiRateLimitError(error)) {
        aiWarningMessage = error.message
      }
      console.warn('[ReceiptAI] AI fallback unavailable, keeping local OCR result:', error.message)
    }
  } else if (needsAdvancedRead) {
    throw new Error('Este cupom precisa do scanner inteligente para ser lido corretamente. Configure a chave Gemini no arquivo .env para importar cupons longos por foto.')
  }

  const topHints = [...new Set(receiptItems.flatMap((item) => item.budgetCategoryHints || []))].slice(0, 4)
  const finalMerchantName = summary.merchantName || merchantName
  const finalPurchaseDate = summary.purchaseDate || purchaseDate

  return [{
    date: finalPurchaseDate,
    description: finalMerchantName ? `Cupom ${finalMerchantName}` : 'Cupom importado por imagem',
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
    aiWarningMessage,
    ocrPreviewLines: lines.slice(0, 30),
  }]
}

export async function parseReceiptPdfFile(file) {
  const text = await extractTextFromReceiptPdf(file)
  const rawLines = String(text || '').split(/\r?\n/).map(cleanLine).filter(Boolean)
  if (rawLines.length === 0) {
    throw new Error('Nao foi possivel extrair texto legivel do PDF do cupom.')
  }

  const lines = rebuildReceiptLines(rawLines)
  const merchantName = findMerchantName(lines, file)
  const purchaseDate = findReceiptDate(lines)
  const summary = parseReceiptSummary(lines)
  const detailLines = sliceReceiptDetailLines(lines)
  const expectedTotal = findTotalAmount(summary, 0)
  const receiptLikeItems = finalizeLocalReceiptItems(parseReceiptItems(detailLines, expectedTotal), summary)
  const genericPdfItems = finalizeLocalReceiptItems(parseGenericReceiptTextItems(lines, expectedTotal), summary)
  let receiptItems = hydrateReceiptItemsFromCache(
    genericPdfItems.length > receiptLikeItems.length ? genericPdfItems : receiptLikeItems,
  )
  let itemTotal = receiptItems.reduce((sum, item) => sum + Number(item.amount || 0), 0)
  let totalAmount = findTotalAmount(summary, itemTotal)

  if (isReceiptAiFallbackConfigured()) {
    const aiResult = await analyzeReceiptTextWithAiFallback({
      extractedText: text,
      fileName: file?.name,
      localSummary: {
        merchantName,
        purchaseDate,
        totalAmount,
        expectedItemCount: summary.itemCount || 0,
        localItemCount: receiptItems.length,
      },
    }).catch(() => null)

    if (aiResult?.items?.length) {
      receiptItems = aiResult.items
      itemTotal = receiptItems.reduce((sum, item) => sum + Number(item.amount || 0), 0)
      totalAmount = Number(aiResult.totalAmount || totalAmount || itemTotal)
      return buildReceiptEnvelope({
        lines,
        file,
        merchantName: aiResult.merchantName || merchantName,
        purchaseDate: aiResult.purchaseDate || purchaseDate,
        totalAmount: totalAmount > 0 ? totalAmount : itemTotal,
        receiptItems,
        source: 'pdf_receipt',
      })
    }
  }

  const needsAdvancedRead = shouldUseAiFallback(receiptItems, totalAmount) || shouldForceAiFallback(receiptItems, summary, totalAmount)
  if (needsAdvancedRead && receiptItems.length > 0) {
    return buildReceiptEnvelope({
      lines,
      file,
      merchantName,
      purchaseDate,
      totalAmount: totalAmount > 0 ? totalAmount : itemTotal,
      receiptItems,
      source: 'pdf_receipt',
      aiWarningMessage: 'O PDF foi lido parcialmente. Revise os itens antes de lancar.',
    })
  }

  if (receiptItems.length === 0) {
    throw new Error('O PDF foi lido, mas os itens do cupom nao foram identificados.')
  }

  return buildReceiptEnvelope({
    lines,
    file,
    merchantName,
    purchaseDate,
    totalAmount: totalAmount > 0 ? totalAmount : itemTotal,
    receiptItems,
    source: 'pdf_receipt',
  })
}
