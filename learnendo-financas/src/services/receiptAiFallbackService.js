import {
  getReceiptAiTaxonomyPayload,
  normalizeTaxonomyText,
  resolveReceiptClassification,
} from '../utils/financeTaxonomy'

function configuredProvider() {
  return String(import.meta.env.VITE_RECEIPT_AI_PROVIDER || '').trim().toLowerCase()
}

function configuredModel() {
  return String(
    import.meta.env.VITE_RECEIPT_AI_MODEL
    || (configuredProvider() === 'gemini' ? 'gemini-1.5-flash' : 'gpt-4o-mini'),
  ).trim()
}

export function isReceiptAiFallbackConfigured() {
  const provider = configuredProvider()
  if (provider === 'openai') return Boolean(import.meta.env.VITE_OPENAI_API_KEY)
  if (provider === 'gemini') return Boolean(import.meta.env.VITE_GEMINI_API_KEY)
  return false
}

function safeJsonParse(value) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    const match = String(value).match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      return JSON.parse(match[0])
    } catch {
      return null
    }
  }
}

function buildPrompt({ ocrText, fileName, localSummary }) {
  const taxonomy = getReceiptAiTaxonomyPayload()
  return [
    'Você é um extrator de cupom fiscal.',
    'Use SOMENTE as categorias, subcategorias e níveis de importância do JSON abaixo.',
    'Não invente categorias, não traduza chaves, não crie nomes novos.',
    'Retorne JSON puro com este formato:',
    '{"merchantName":"string","purchaseDate":"YYYY-MM-DD|null","totalAmount":0,"items":[{"description":"string","amount":0,"quantity":null,"detailCategoryKey":"string","detailSubcategoryKey":"string","importance":"essential|necessary|superfluous"}]}',
    'Se alguma informação não estiver clara, use null ou omita quantidade.',
    '',
    `Arquivo: ${fileName || 'cupom'}`,
    `Resumo local: ${JSON.stringify(localSummary)}`,
    'Taxonomia permitida:',
    JSON.stringify(taxonomy),
    '',
    'Texto OCR do cupom:',
    ocrText,
  ].join('\n')
}

async function callOpenAi(prompt) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${import.meta.env.VITE_OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: configuredModel(),
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Responda apenas JSON válido.' },
        { role: 'user', content: prompt },
      ],
    }),
  })

  if (!response.ok) {
    throw new Error(`OpenAI fallback failed: ${response.status}`)
  }

  const data = await response.json()
  return safeJsonParse(data?.choices?.[0]?.message?.content)
}

async function callGemini(prompt) {
  const model = configuredModel()
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
    }),
  })

  if (!response.ok) {
    throw new Error(`Gemini fallback failed: ${response.status}`)
  }

  const data = await response.json()
  const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || ''
  return safeJsonParse(text)
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

function normalizeAiItems(items) {
  return (Array.isArray(items) ? items : [])
    .map((item, index) => {
      const classification = resolveReceiptClassification(
        item?.detailCategoryKey,
        item?.detailSubcategoryKey,
        { importance: item?.importance },
      )
      const amount = normalizeAmount(item?.amount)
      if (!amount) return null

      return {
        id: `receipt_ai_${Date.now()}_${index}`,
        description: String(item?.description || '').trim(),
        amount,
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

export async function analyzeReceiptWithAiFallback({ ocrText, fileName, localSummary = {} }) {
  if (!isReceiptAiFallbackConfigured()) return null
  if (!String(ocrText || '').trim()) return null

  const prompt = buildPrompt({ ocrText, fileName, localSummary })
  const provider = configuredProvider()

  let raw
  if (provider === 'gemini') raw = await callGemini(prompt)
  else if (provider === 'openai') raw = await callOpenAi(prompt)
  else return null

  const items = normalizeAiItems(raw?.items)
  if (items.length === 0) return null

  const merchantName = String(raw?.merchantName || '').trim()
  const topBudgetHints = [...new Set(items.flatMap((item) => item.budgetCategoryHints || []))]
  const totalAmount = normalizeAmount(raw?.totalAmount) || items.reduce((sum, item) => sum + item.amount, 0)

  return {
    merchantName: merchantName && normalizeTaxonomyText(merchantName) ? merchantName : '',
    purchaseDate: normalizeDate(raw?.purchaseDate),
    totalAmount,
    items,
    topBudgetHints,
  }
}
