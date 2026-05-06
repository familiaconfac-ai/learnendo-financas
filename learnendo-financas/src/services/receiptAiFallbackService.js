import {
  classifyReceiptItemByTaxonomy,
  normalizeTaxonomyText,
} from '../utils/financeTaxonomy'
import {
  callGeminiForJson,
  isGeminiConfigured,
  isGeminiRateLimitError,
} from './geminiService'

const RECEIPT_ANALYSIS_CACHE_KEY = 'learnendo.receipt.analysis.v3'
const RECEIPT_ITEM_CACHE_KEY = 'learnendo.receipt.items.v3'

function readLocalCache(key) {
  if (typeof window === 'undefined' || !window.localStorage) return {}

  try {
    const raw = window.localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeLocalCache(key, value) {
  if (typeof window === 'undefined' || !window.localStorage) return

  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch (error) {
    console.warn('[ReceiptAI] Nao foi possivel persistir cache local:', error?.message || error)
  }
}

function mimeTypeFromFile(file) {
  const explicitType = String(file?.type || '').trim().toLowerCase()
  if (explicitType) return explicitType

  const extension = String(file?.name || '').split('.').pop()?.toLowerCase()
  if (extension === 'png') return 'image/png'
  if (extension === 'webp') return 'image/webp'
  return 'image/jpeg'
}

function encodeBase64(bytes) {
  let binary = ''
  const chunkSize = 0x8000

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize)
    binary += String.fromCharCode(...chunk)
  }

  return btoa(binary)
}

async function toFileFingerprint(file) {
  const buffer = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function toGeminiImagePart(file) {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)

  return {
    inlineData: {
      mimeType: mimeTypeFromFile(file),
      data: encodeBase64(bytes),
    },
  }
}

function buildPrompt({ fileName, ocrText, localSummary }) {
  const expectedCount = Number(localSummary?.expectedItemCount || 0)

  return [
    'Analise esta imagem de cupom fiscal.',
    'Extraia os itens do cupom linha por linha, sem resumir.',
    'Seu trabalho principal e OCR estruturado: identificar descricao do produto, quantidade, valor unitario e valor total de cada linha.',
    'Nao junte linhas diferentes em um item so.',
    'Nao repita item. Nao invente item. Nao devolva item com valor zero.',
    expectedCount > 0 ? `O cupom indica ${expectedCount} itens. Tente retornar exatamente essa quantidade se a imagem permitir.` : 'O cupom pode ter muitos itens; mantenha a lista completa.',
    'Se uma descricao estiver abreviada no cupom, preserve a abreviacao original em vez de inventar nome novo.',
    'Se uma linha estiver parcialmente ilegivel, mantenha a melhor descricao bruta possivel, mas nao descarte o item.',
    'Responda apenas JSON valido neste formato:',
    '{"merchantName":"string","purchaseDate":"YYYY-MM-DD|null","totalAmount":0,"items":[{"description":"string","amount":0,"unitAmount":0,"quantity":null}]}',
    'Use "amount" como valor final do item na nota. Use "unitAmount" quando conseguir identificar o valor unitario.',
    '',
    `Arquivo: ${fileName || 'cupom'}`,
    `Resumo OCR local: ${JSON.stringify(localSummary || {})}`,
    'Texto OCR de apoio:',
    String(ocrText || '').slice(0, 6000),
  ].join('\n')
}

function buildTextOnlyPrompt({ fileName, extractedText, localSummary }) {
  const expectedCount = Number(localSummary?.expectedItemCount || 0)

  return [
    'Analise este texto extraido de um cupom fiscal ou nota.',
    'Extraia os itens linha por linha, sem resumir.',
    'Seu trabalho principal e estruturar descricao do produto, quantidade, valor unitario e valor total de cada linha.',
    'Nao junte linhas diferentes em um item so.',
    'Nao repita item. Nao invente item. Nao devolva item com valor zero.',
    expectedCount > 0 ? `O cupom indica ${expectedCount} itens. Tente retornar exatamente essa quantidade se o texto permitir.` : 'Mantenha a lista completa de itens.',
    'Se uma descricao estiver abreviada, preserve a abreviacao original em vez de inventar nome novo.',
    'Responda apenas JSON valido neste formato:',
    '{"merchantName":"string","purchaseDate":"YYYY-MM-DD|null","totalAmount":0,"items":[{"description":"string","amount":0,"unitAmount":0,"quantity":null}]}',
    '',
    `Arquivo: ${fileName || 'cupom'}`,
    `Resumo local: ${JSON.stringify(localSummary || {})}`,
    'Texto extraido:',
    String(extractedText || '').slice(0, 12000),
  ].join('\n')
}

function normalizeAmount(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Number(parsed.toFixed(2)) : 0
}

function normalizeQuantity(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Number(parsed) : null
}

function normalizeDate(value) {
  const normalized = String(value || '').trim().slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null
}

function normalizeItemCacheKey(description) {
  return normalizeTaxonomyText(description)
}

function normalizeAiItems(items) {
  return (Array.isArray(items) ? items : [])
    .map((item, index) => {
      const description = String(item?.description || '').trim()
      const amount = normalizeAmount(item?.amount)
      if (!description || !amount) return null

      const classification = classifyReceiptItemByTaxonomy(description)

      return {
        id: `receipt_ai_${Date.now()}_${index}`,
        description,
        amount,
        unitAmount: normalizeAmount(item?.unitAmount) || null,
        quantity: normalizeQuantity(item?.quantity),
        detailCategoryKey: classification.detailCategoryKey,
        detailCategoryLabel: classification.detailCategoryLabel,
        detailSubcategoryKey: classification.detailSubcategoryKey,
        detailSubcategoryLabel: classification.detailSubcategoryLabel,
        budgetCategoryHints: classification.budgetCategoryHints,
        budgetCategoryId: '',
        budgetCategoryName: '',
        importance: classification.importance,
      }
    })
    .filter(Boolean)
}

function storeReceiptAnalysisCache(fingerprint, result) {
  if (!fingerprint || !result) return

  const cache = readLocalCache(RECEIPT_ANALYSIS_CACHE_KEY)
  cache[fingerprint] = {
    merchantName: result.merchantName || '',
    purchaseDate: result.purchaseDate || null,
    totalAmount: normalizeAmount(result.totalAmount),
    topBudgetHints: Array.isArray(result.topBudgetHints) ? result.topBudgetHints.slice(0, 8) : [],
    items: (Array.isArray(result.items) ? result.items : []).map((item) => ({
      description: item.description,
      amount: normalizeAmount(item.amount),
      unitAmount: normalizeAmount(item.unitAmount) || null,
      quantity: normalizeQuantity(item.quantity),
      detailCategoryKey: item.detailCategoryKey,
      detailSubcategoryKey: item.detailSubcategoryKey,
      importance: item.importance || 'essential',
    })),
    cachedAt: new Date().toISOString(),
  }
  writeLocalCache(RECEIPT_ANALYSIS_CACHE_KEY, cache)
}

function readReceiptAnalysisCache(fingerprint) {
  if (!fingerprint) return null

  const cache = readLocalCache(RECEIPT_ANALYSIS_CACHE_KEY)
  const cached = cache[fingerprint]
  if (!cached) return null

  const items = normalizeAiItems(cached.items)
  if (items.length === 0) return null

  return {
    merchantName: String(cached.merchantName || '').trim(),
    purchaseDate: normalizeDate(cached.purchaseDate),
    totalAmount: normalizeAmount(cached.totalAmount) || items.reduce((sum, item) => sum + item.amount, 0),
    items,
    topBudgetHints: [...new Set(items.flatMap((item) => item.budgetCategoryHints || []))],
    source: 'cache',
  }
}

function storeItemClassificationCache(items) {
  if (!Array.isArray(items) || items.length === 0) return

  const cache = readLocalCache(RECEIPT_ITEM_CACHE_KEY)
  items.forEach((item) => {
    const key = normalizeItemCacheKey(item?.description)
    if (!key) return

    cache[key] = {
      detailCategoryKey: item.detailCategoryKey,
      detailSubcategoryKey: item.detailSubcategoryKey,
      importance: item.importance || 'essential',
      updatedAt: new Date().toISOString(),
    }
  })
  writeLocalCache(RECEIPT_ITEM_CACHE_KEY, cache)
}

export function hydrateReceiptItemsFromCache(items = []) {
  const itemCache = readLocalCache(RECEIPT_ITEM_CACHE_KEY)

  return (Array.isArray(items) ? items : []).map((item) => {
    const cached = itemCache[normalizeItemCacheKey(item?.description)]
    if (!cached) return item

    const classification = resolveReceiptClassification(
      cached.detailCategoryKey,
      cached.detailSubcategoryKey,
      { importance: cached.importance },
    )

    return {
      ...item,
      detailCategoryKey: classification.detailCategoryKey,
      detailCategoryLabel: classification.detailCategoryLabel,
      detailSubcategoryKey: classification.detailSubcategoryKey,
      detailSubcategoryLabel: classification.detailSubcategoryLabel,
      budgetCategoryHints: classification.budgetCategoryHints,
      importance: classification.importance,
    }
  })
}

export function isReceiptAiFallbackConfigured() {
  return isGeminiConfigured()
}

export { isGeminiRateLimitError }

export async function analyzeReceiptWithAiFallback({
  file,
  ocrText,
  fileName,
  localSummary = {},
}) {
  if (!isReceiptAiFallbackConfigured()) return null
  if (!file) return null

  const fingerprint = await toFileFingerprint(file)
  const cachedReceipt = readReceiptAnalysisCache(fingerprint)
  if (cachedReceipt) return cachedReceipt

  const prompt = buildPrompt({ fileName, ocrText, localSummary })
  const imagePart = await toGeminiImagePart(file)
  const raw = await callGeminiForJson([
    { text: prompt },
    imagePart,
  ], {
    temperature: 0,
    maxOutputTokens: 8192,
  })

  const items = normalizeAiItems(raw?.items)
  if (items.length === 0) return null

  const merchantName = String(raw?.merchantName || '').trim()
  const totalAmount = normalizeAmount(raw?.totalAmount) || items.reduce((sum, item) => sum + item.amount, 0)
  const result = {
    merchantName: merchantName && normalizeTaxonomyText(merchantName) ? merchantName : '',
    purchaseDate: normalizeDate(raw?.purchaseDate),
    totalAmount,
    items,
    topBudgetHints: [...new Set(items.flatMap((item) => item.budgetCategoryHints || []))],
    source: 'gemini',
  }

  storeReceiptAnalysisCache(fingerprint, result)
  storeItemClassificationCache(items)
  return result
}

export async function analyzeReceiptTextWithAiFallback({
  extractedText,
  fileName,
  localSummary = {},
}) {
  if (!isReceiptAiFallbackConfigured()) return null
  if (!String(extractedText || '').trim()) return null

  const prompt = buildTextOnlyPrompt({ fileName, extractedText, localSummary })
  const raw = await callGeminiForJson([
    { text: prompt },
  ], {
    temperature: 0,
    maxOutputTokens: 8192,
  })

  const items = normalizeAiItems(raw?.items)
  if (items.length === 0) return null

  const merchantName = String(raw?.merchantName || '').trim()
  const totalAmount = normalizeAmount(raw?.totalAmount) || items.reduce((sum, item) => sum + item.amount, 0)
  const result = {
    merchantName: merchantName && normalizeTaxonomyText(merchantName) ? merchantName : '',
    purchaseDate: normalizeDate(raw?.purchaseDate),
    totalAmount,
    items,
    topBudgetHints: [...new Set(items.flatMap((item) => item.budgetCategoryHints || []))],
    source: 'gemini_text',
  }

  storeItemClassificationCache(items)
  return result
}
