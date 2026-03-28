function normalize(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function categoryHintsFromText(text) {
  const s = normalize(text)

  if (/cabo|carregador|fone|teclado|mouse|adaptador|usb|hdmi/.test(s)) {
    return ['Equipamentos', 'Eletrônicos', 'Eletronicos']
  }

  if (/mercado|supermercado|atacadao|muffato|carrefour|assai/.test(s)) {
    return ['Mercado', 'Supermercado', 'Alimentação', 'Alimentacao']
  }

  if (/farmacia|droga|drogaria/.test(s)) {
    return ['Farmácia', 'Farmacia', 'Saúde', 'Saude']
  }

  return ['Outros', 'Despesas diversas']
}

function parseAmountFromText(text) {
  const normalized = String(text || '').replace(/_/g, ' ')

  const br = normalized.match(/(\d{1,3}(?:\.\d{3})*,\d{2})/)
  if (br) {
    const value = Number(br[1].replace(/\./g, '').replace(',', '.'))
    if (Number.isFinite(value) && value > 0) return value
  }

  const us = normalized.match(/(\d{1,3}(?:,\d{3})*\.\d{2})/)
  if (us) {
    const value = Number(us[1].replace(/,/g, ''))
    if (Number.isFinite(value) && value > 0) return value
  }

  return 0
}

export async function parseReceiptImageFile(file) {
  const baseName = String(file?.name || 'comprovante')
    .replace(/\.[^.]+$/, '')
    .replace(/[\-_]+/g, ' ')
    .trim()

  const amount = parseAmountFromText(baseName)
  const hints = categoryHintsFromText(baseName)

  // Base preparada para OCR no futuro: hoje usamos heurísticas de nome do arquivo.
  return [{
    date: new Date().toISOString().slice(0, 10),
    description: baseName || 'Comprovante importado por imagem',
    amount,
    type: 'expense',
    direction: 'debit',
    balance: null,
    rawLine: `image:${file?.name || ''}`,
    source: 'image_receipt',
    categoryHints: hints,
    requiresReview: true,
  }]
}
