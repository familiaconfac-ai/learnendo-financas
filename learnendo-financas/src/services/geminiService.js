const GEMINI_MODEL = 'gemini-1.5-flash'
export const GEMINI_RATE_LIMIT_MESSAGE = 'Limite de processamento atingido. Por favor, categorize este item manualmente.'

function geminiApiKey() {
  return String(import.meta.env.VITE_GEMINI_API_KEY || '').trim()
}

function extractGeminiText(data) {
  return data?.candidates?.[0]?.content?.parts
    ?.map((part) => part?.text || '')
    .join('')
    .trim() || ''
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

function buildGeminiError(response, payload) {
  const rawMessage = String(
    payload?.error?.message
    || payload?.error?.status
    || response?.statusText
    || 'Gemini request failed',
  ).trim()
  const normalized = rawMessage.toLowerCase()
  const isRateLimit = response?.status === 429
    || normalized.includes('rate limit')
    || normalized.includes('quota')
    || normalized.includes('resource exhausted')

  const error = new Error(isRateLimit ? GEMINI_RATE_LIMIT_MESSAGE : rawMessage)
  error.code = isRateLimit ? 'rate_limit' : 'gemini_error'
  error.status = response?.status || 0
  error.rawMessage = rawMessage
  return error
}

export function isGeminiConfigured() {
  return Boolean(geminiApiKey())
}

export function isGeminiRateLimitError(error) {
  return error?.code === 'rate_limit'
}

export function geminiModelName() {
  return GEMINI_MODEL
}

async function callGeminiApi({ parts, responseMimeType = 'application/json', temperature = 0.1 }) {
  const apiKey = geminiApiKey()
  if (!apiKey) {
    const error = new Error('Chave Gemini nao configurada.')
    error.code = 'gemini_missing_key'
    throw error
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        generationConfig: {
          temperature,
          responseMimeType,
        },
        contents: [
          {
            role: 'user',
            parts,
          },
        ],
      }),
    },
  )

  const payload = await response.json().catch(() => null)
  if (!response.ok) throw buildGeminiError(response, payload)
  return payload
}

export async function callGeminiForJson(parts, options = {}) {
  const payload = await callGeminiApi({
    parts,
    responseMimeType: 'application/json',
    temperature: options.temperature ?? 0.1,
  })

  return safeJsonParse(extractGeminiText(payload))
}

export async function callGeminiForText(prompt, options = {}) {
  const payload = await callGeminiApi({
    parts: [{ text: prompt }],
    responseMimeType: 'text/plain',
    temperature: options.temperature ?? 0,
  })

  return extractGeminiText(payload)
}

export async function testGeminiConnectionRequest() {
  const text = await callGeminiForText('Teste de conexão EBD')
  return text ? 'OK' : 'OK'
}
