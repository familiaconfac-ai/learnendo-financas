/**
 * transactionClassifier.js
 *
 * Utility for classifying imported bank statement lines into transaction types.
 * Called during PDF/OFX import parsing to make intelligent classification decisions.
 *
 * Transaction type output:
 *   'income'            – money received (salary, deposit, Pix received)
 *   'expense'           – money spent (purchase, bill, 3rd-party transfer)
 *   'transfer_internal' – neutral movement between OWN accounts (same owner)
 *   'investment'        – investment deposit / CDB / tesouro
 *
 * Confidence levels:
 *   'high'   – strong keyword match
 *   'medium' – partial match or heuristic
 *   'low'    – direction-only fallback (mark for review)
 */

// ── Keyword lists (case-insensitive match on lowercased description) ──────────

const INTERNAL_KEYWORDS = [
  'ted própria', 'ted para conta própria',
  'transferência entre contas', 'transferência para conta própria',
  'transferência interna', 'transf. própria', 'transf própria',
  'movimentação interna', 'resgate automático', 'aplicação automática',
  'resgate tesouro', 'resgate cdb', 'doe/transferência interna',
  'crédito de transferência entre contas',
]

const INVESTMENT_KEYWORDS = [
  'cdb', 'lci', 'lca', 'tesouro direto', 'tesouro selic', 'tesouro ipca',
  'fundo de investimento', 'fundo imobiliário', 'fii', 'ação', 'debenture',
  'aplicação renda fixa', 'aplicação fundos', 'corretora',
  'liquidação bovespa', 'liquidação b3',
]

const INCOME_KEYWORDS = [
  'salário', 'salario', 'holerite', 'folha de pagamento',
  'depósito em conta', 'deposito em conta',
  'pix recebido', 'pix de', 'ted recebida', 'doc recebido',
  'transferência recebida', 'transf. recebida',
  'crédito em conta', 'credito em conta',
  'reembolso', 'cashback', 'bônus', 'bonus', 'dividendo',
  'rendimento poupança', 'rend. poupança', 'juros sobre capital',
  'restituição ir', 'pgto.recebido', 'pagamento recebido',
]

const EXPENSE_KEYWORDS = [
  'compra no débito', 'compra débito', 'compra debito',
  'compra cartão', 'compra cartao',
  'débito automático', 'debito automatico',
  'boleto pago', 'pagamento boleto', 'pgto boleto',
  'pix para', 'pix enviado', 'pix pago',
  'ted enviada', 'doc enviado',
  'transferência para', 'transf. para',
  'tarifa bancária', 'tarifa bancaria', 'anuidade',
  'saque', 'saque atm', 'saque caixa',
  'energia', 'água', 'telefone', 'internet',
  'supermercado', 'mercado', 'combustível', 'combustivel',
  'farmácia', 'farmacia', 'restaurante',
]

// ── Types used in internal-transfer detection by description keywords ─────────

const TRANSFER_MARKERS = [
  // Pix to own CPF/account usually has the account number or "Cta. Própria"
  'cta. próp', 'conta própria', 'conta propria',
  'pix para cta.', 'pix para conta própria',
]

// ── Main classifier ───────────────────────────────────────────────────────────

/**
 * Classifies a single bank statement line.
 *
 * @param {string}           description  - Raw description from the bank statement
 * @param {number}           amount       - Absolute amount (always positive)
 * @param {'credit'|'debit'} direction    - Whether the amount is credit or debit on the account
 * @param {string[]}         [ownAccountNumbers] - Optional list of own account numbers for self-transfer detection
 * @returns {{ type: string, confidence: 'high'|'medium'|'low', reason: string }}
 */
export function classifyTransaction(description, amount, direction, ownAccountNumbers = []) {
  const desc = (description || '').toLowerCase().trim()
  console.log(`[Classifier] 🔍 "${description}" | ${direction} | R$ ${amount}`)

  // 1. Internal transfer — highest priority (neutral, not an expense)
  for (const kw of INTERNAL_KEYWORDS) {
    if (desc.includes(kw)) {
      console.log(`[Classifier] ✅ Internal transfer — keyword: "${kw}"`)
      return { type: 'transfer_internal', confidence: 'high', reason: `Keyword: "${kw}"` }
    }
  }
  for (const kw of TRANSFER_MARKERS) {
    if (desc.includes(kw)) {
      console.log(`[Classifier] ✅ Internal transfer marker — keyword: "${kw}"`)
      return { type: 'transfer_internal', confidence: 'medium', reason: `Marker: "${kw}"` }
    }
  }

  // 2. Own account number in description → likely internal transfer
  for (const accNum of ownAccountNumbers) {
    if (accNum && desc.includes(String(accNum))) {
      console.log(`[Classifier] ✅ Own account number in description: "${accNum}"`)
      return {
        type: 'transfer_internal',
        confidence: 'medium',
        reason: `Own account number match: ${accNum}`,
      }
    }
  }

  // 3. Investment keywords
  for (const kw of INVESTMENT_KEYWORDS) {
    if (desc.includes(kw)) {
      console.log(`[Classifier] ✅ Investment — keyword: "${kw}"`)
      // A debit to buy an investment, or a credit from redeeming = both investment type
      return { type: 'investment', confidence: 'high', reason: `Investment keyword: "${kw}"` }
    }
  }

  // 3.5 Description-only fallback when direction is unknown/missing
  if (direction !== 'credit' && direction !== 'debit') {
    for (const kw of INCOME_KEYWORDS) {
      if (desc.includes(kw)) {
        console.log(`[Classifier] ✅ Income by description (no direction) — keyword: "${kw}"`)
        return { type: 'income', confidence: 'medium', reason: `Income keyword without direction: "${kw}"` }
      }
    }
    for (const kw of EXPENSE_KEYWORDS) {
      if (desc.includes(kw)) {
        console.log(`[Classifier] ✅ Expense by description (no direction) — keyword: "${kw}"`)
        return { type: 'expense', confidence: 'medium', reason: `Expense keyword without direction: "${kw}"` }
      }
    }
  }

  // 4. Direction + keyword refinement
  if (direction === 'credit') {
    for (const kw of INCOME_KEYWORDS) {
      if (desc.includes(kw)) {
        console.log(`[Classifier] ✅ Income — keyword: "${kw}"`)
        return { type: 'income', confidence: 'high', reason: `Income keyword: "${kw}"` }
      }
    }
    console.log(`[Classifier] ℹ️ Generic credit → income (low confidence, needs review)`)
    return { type: 'income', confidence: 'low', reason: 'Generic credit — no keyword match' }
  }

  if (direction === 'debit') {
    for (const kw of EXPENSE_KEYWORDS) {
      if (desc.includes(kw)) {
        console.log(`[Classifier] ✅ Expense — keyword: "${kw}"`)
        return { type: 'expense', confidence: 'high', reason: `Expense keyword: "${kw}"` }
      }
    }
    console.log(`[Classifier] ℹ️ Generic debit → expense (low confidence, needs review)`)
    return { type: 'expense', confidence: 'low', reason: 'Generic debit — no keyword match' }
  }

  // 5. Fallback
  console.warn(`[Classifier] ⚠️ Could not classify "${description}" — no direction provided`)
  return { type: 'expense', confidence: 'low', reason: 'Fallback — direction unknown' }
}

/**
 * Returns true when a classification result should be flagged for user review.
 * Confidence 'low' means the system guessed, so the user should confirm.
 *
 * @param {{ confidence: string }} classification
 * @returns {boolean}
 */
export function needsReview(classification) {
  return classification.confidence === 'low'
}

/**
 * Batch-classifies a list of imported items.
 * Each item should have: { description, amount, direction }.
 * Optionally pass ownAccountNumbers for self-transfer detection.
 *
 * @param {Array<{description: string, amount: number, direction: 'credit'|'debit'}>} items
 * @param {string[]} [ownAccountNumbers]
 * @returns {Array<{...item, classification: object, status: string}>}
 */
export function classifyBatch(items, ownAccountNumbers = []) {
  console.log(`[Classifier] 📦 Batch classifying ${items.length} items…`)
  return items.map((item) => {
    const classification = classifyTransaction(
      item.description,
      item.amount,
      item.direction,
      ownAccountNumbers,
    )
    return {
      ...item,
      type:           classification.type,
      classification,
      status:         needsReview(classification) ? 'needs_review' : 'confirmed',
    }
  })
}
