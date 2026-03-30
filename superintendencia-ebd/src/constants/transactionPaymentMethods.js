export const TRANSACTION_PAYMENT_METHODS = [
  { id: 'cash', label: 'Dinheiro' },
  { id: 'pix', label: 'Pix' },
  { id: 'debit', label: 'Débito' },
  { id: 'credit_card', label: 'Cartão de crédito' },
  { id: 'boleto', label: 'Boleto' },
  { id: 'transfer', label: 'Transferência' },
]

export function getPaymentMethodLabel(paymentMethod) {
  return TRANSACTION_PAYMENT_METHODS.find((item) => item.id === paymentMethod)?.label || 'Não informado'
}
