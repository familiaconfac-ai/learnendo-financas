export const DEFAULT_TRANSACTION_NATURES = [
  { id: 'nature_income', key: 'renda', label: 'Renda', direction: 'income', affectsBudget: true, editable: true },
  { id: 'nature_salary', key: 'salario', label: 'Salário', direction: 'income', affectsBudget: true, editable: true },
  { id: 'nature_salary_advance', key: 'vale_adiantamento', label: 'Vale / Adiantamento salarial', direction: 'income', affectsBudget: true, editable: true },
  { id: 'nature_expense', key: 'despesa', label: 'Despesa', direction: 'expense', affectsBudget: true, editable: true },
  { id: 'nature_debt_payment', key: 'pagamento_divida', label: 'Pagamento de dívida', direction: 'expense', affectsBudget: false, editable: true },
  { id: 'nature_invoice_payment', key: 'pagamento_fatura', label: 'Pagamento de fatura', direction: 'expense', affectsBudget: false, editable: true },
  { id: 'nature_loan_received', key: 'emprestimo_recebido', label: 'Empréstimo recebido', direction: 'income', affectsBudget: false, editable: true },
  { id: 'nature_loan_given', key: 'emprestimo_concedido', label: 'Empréstimo concedido', direction: 'expense', affectsBudget: false, editable: true },
  { id: 'nature_loan_repayment', key: 'devolucao_emprestimo', label: 'Devolução de empréstimo', direction: 'income', affectsBudget: false, editable: true },
  { id: 'nature_restitution', key: 'restituicao', label: 'Restituição', direction: 'income', affectsBudget: false, editable: true },
  { id: 'nature_allowance_received', key: 'ajuda_custo_recebida', label: 'Ajuda de custo recebida', direction: 'income', affectsBudget: true, editable: true },
  { id: 'nature_allowance_sent', key: 'ajuda_custo_enviada', label: 'Ajuda de custo enviada', direction: 'expense', affectsBudget: true, editable: true },
  { id: 'nature_allowance', key: 'mesada', label: 'Mesada', direction: 'expense', affectsBudget: true, editable: true },
  { id: 'nature_donation_received', key: 'doacao_recebida', label: 'Doação recebida', direction: 'income', affectsBudget: true, editable: true },
  { id: 'nature_donation_sent', key: 'doacao_enviada', label: 'Doação enviada', direction: 'expense', affectsBudget: true, editable: true },
  { id: 'nature_offer_received', key: 'oferta_recebida', label: 'Oferta recebida', direction: 'income', affectsBudget: true, editable: true },
  { id: 'nature_offer_sent', key: 'oferta_enviada', label: 'Oferta enviada', direction: 'expense', affectsBudget: true, editable: true },
  { id: 'nature_reimbursement', key: 'reembolso', label: 'Reembolso', direction: 'income', affectsBudget: true, editable: true },
  { id: 'nature_internal_transfer', key: 'transferencia_interna', label: 'Transferência interna', direction: 'transfer', affectsBudget: false, editable: true },
]

export const NATURE_DEFAULT_BY_TYPE = {
  income: 'nature_income',
  expense: 'nature_expense',
  investment: 'nature_expense',
  transfer_internal: 'nature_internal_transfer',
}

export function getNatureById(natures, natureId) {
  const list = Array.isArray(natures) && natures.length > 0 ? natures : DEFAULT_TRANSACTION_NATURES
  return list.find((nature) => nature.id === natureId) || null
}

export function resolveNatureAffectsBudget(natures, natureId, fallback = true) {
  const nature = getNatureById(natures, natureId)
  if (!nature) return fallback
  return nature.affectsBudget !== false
}
