export const TRANSACTION_PAYMENT_METHODS = [
  { id: 'cash', label: 'Dinheiro' },
  { id: 'pix', label: 'Pix' },
  { id: 'debit', label: 'Débito' },
  { id: 'credit_card', label: 'Cartão de crédito' },
  { id: 'boleto', label: 'Boleto' },
  { id: 'transfer', label: 'Transferência' },
]

export function normalizePaymentMethodId(paymentMethod) {
  const normalized = String(paymentMethod || '').trim().toLowerCase()
  if (!normalized) return null

  const aliases = {
    debit_card: 'debit',
    credit: 'credit_card',
    cartao_credito: 'credit_card',
    cartao_de_credito: 'credit_card',
    transferencia: 'transfer',
  }

  return aliases[normalized] || normalized
}

export function getPaymentMethodLabel(paymentMethod) {
  const normalized = normalizePaymentMethodId(paymentMethod)
  return TRANSACTION_PAYMENT_METHODS.find((item) => item.id === normalized)?.label || 'Não informado'
}
