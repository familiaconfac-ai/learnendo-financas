/**
 * transactionClassifier.js
 *
 * Utility for classifying imported bank statement lines into transaction types.
 */

const INTERNAL_KEYWORDS = [
  'ted propria', 'ted para conta propria',
  'transferencia entre contas', 'transferencia para conta propria',
  'transferencia interna', 'transf. propria', 'transf propria',
  'movimentacao interna', 'resgate automatico', 'aplicacao automatica',
  'resgate tesouro', 'resgate cdb', 'doe/transferencia interna',
  'credito de transferencia entre contas',
]

const INVESTMENT_KEYWORDS = [
  'cdb', 'lci', 'lca', 'tesouro direto', 'tesouro selic', 'tesouro ipca',
  'fundo de investimento', 'fundo imobiliario', 'fii', 'acao', 'debenture',
  'aplicacao renda fixa', 'aplicacao fundos', 'corretora',
  'liquidacao bovespa', 'liquidacao b3',
]

const INCOME_KEYWORDS = [
  'salario', 'holerite', 'folha de pagamento',
  'deposito em conta',
  'pix recebido', 'pix de', 'ted recebida', 'doc recebido',
  'transferencia recebida', 'transf. recebida',
  'credito em conta',
  'reembolso', 'cashback', 'bonus', 'dividendo',
  'rendimento poupanca', 'rend. poupanca', 'juros sobre capital',
  'restituicao ir', 'pgto.recebido', 'pagamento recebido',
]

const EXPENSE_KEYWORDS = [
  'compra no debito', 'compra debito',
  'compra cartao',
  'debito automatico',
  'boleto pago', 'pagamento boleto', 'pgto boleto',
  'pix para', 'pix enviado', 'pix pago',
  'ted enviada', 'doc enviado',
  'transferencia para', 'transf. para',
  'tarifa bancaria', 'anuidade',
  'saque', 'saque atm', 'saque caixa',
  'energia', 'agua', 'telefone', 'internet',
  'supermercado', 'mercado', 'combustivel',
  'farmacia', 'restaurante',
]

const TRANSFER_MARKERS = [
  'cta. prop', 'conta propria',
  'pix para cta.', 'pix para conta propria',
]

const CLASSIFIER_DEBUG_ENABLED = import.meta.env.DEV && import.meta.env.VITE_ENABLE_IMPORT_DEBUG === 'true'

function logClassifierDebug(message) {
  if (!CLASSIFIER_DEBUG_ENABLED) return
  console.log(message)
}

export function classifyTransaction(description, amount, direction, ownAccountNumbers = []) {
  const desc = (description || '').toLowerCase().trim()
  logClassifierDebug(`[Classifier] "${description}" | ${direction} | R$ ${amount}`)

  for (const kw of INTERNAL_KEYWORDS) {
    if (desc.includes(kw)) {
      logClassifierDebug(`[Classifier] Internal transfer keyword: "${kw}"`)
      return { type: 'transfer_internal', confidence: 'high', reason: `Keyword: "${kw}"` }
    }
  }

  for (const kw of TRANSFER_MARKERS) {
    if (desc.includes(kw)) {
      logClassifierDebug(`[Classifier] Internal transfer marker: "${kw}"`)
      return { type: 'transfer_internal', confidence: 'medium', reason: `Marker: "${kw}"` }
    }
  }

  for (const accNum of ownAccountNumbers) {
    if (accNum && desc.includes(String(accNum))) {
      logClassifierDebug(`[Classifier] Own account number match: "${accNum}"`)
      return {
        type: 'transfer_internal',
        confidence: 'medium',
        reason: `Own account number match: ${accNum}`,
      }
    }
  }

  for (const kw of INVESTMENT_KEYWORDS) {
    if (desc.includes(kw)) {
      logClassifierDebug(`[Classifier] Investment keyword: "${kw}"`)
      return { type: 'investment', confidence: 'high', reason: `Investment keyword: "${kw}"` }
    }
  }

  if (direction !== 'credit' && direction !== 'debit') {
    for (const kw of INCOME_KEYWORDS) {
      if (desc.includes(kw)) {
        logClassifierDebug(`[Classifier] Income without direction keyword: "${kw}"`)
        return { type: 'income', confidence: 'medium', reason: `Income keyword without direction: "${kw}"` }
      }
    }
    for (const kw of EXPENSE_KEYWORDS) {
      if (desc.includes(kw)) {
        logClassifierDebug(`[Classifier] Expense without direction keyword: "${kw}"`)
        return { type: 'expense', confidence: 'medium', reason: `Expense keyword without direction: "${kw}"` }
      }
    }
  }

  if (direction === 'credit') {
    for (const kw of INCOME_KEYWORDS) {
      if (desc.includes(kw)) {
        logClassifierDebug(`[Classifier] Income keyword: "${kw}"`)
        return { type: 'income', confidence: 'high', reason: `Income keyword: "${kw}"` }
      }
    }
    logClassifierDebug('[Classifier] Generic credit fallback -> income')
    return { type: 'income', confidence: 'low', reason: 'Generic credit - no keyword match' }
  }

  if (direction === 'debit') {
    for (const kw of EXPENSE_KEYWORDS) {
      if (desc.includes(kw)) {
        logClassifierDebug(`[Classifier] Expense keyword: "${kw}"`)
        return { type: 'expense', confidence: 'high', reason: `Expense keyword: "${kw}"` }
      }
    }
    logClassifierDebug('[Classifier] Generic debit fallback -> expense')
    return { type: 'expense', confidence: 'low', reason: 'Generic debit - no keyword match' }
  }

  return { type: 'expense', confidence: 'low', reason: 'Fallback - direction unknown' }
}

export function needsReview(classification) {
  return classification.confidence === 'low'
}

export function classifyBatch(items, ownAccountNumbers = []) {
  logClassifierDebug(`[Classifier] Batch classifying ${items.length} items`)
  return items.map((item) => {
    const classification = classifyTransaction(
      item.description,
      item.amount,
      item.direction,
      ownAccountNumbers,
    )
    return {
      ...item,
      type: classification.type,
      classification,
      status: needsReview(classification) ? 'pending' : 'confirmed',
    }
  })
}
