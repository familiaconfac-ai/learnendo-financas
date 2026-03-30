import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import MonthSelector from '../../components/ui/MonthSelector'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import ReceiptDetailEditor from '../../components/ui/ReceiptDetailEditor'
import { useFinance } from '../../context/FinanceContext'
import { useAuth } from '../../context/AuthContext'
import { useTransactions } from '../../hooks/useTransactions'
import { useCategories } from '../../hooks/useCategories'
import { useAccounts } from '../../hooks/useAccounts'
import { useWorkspace } from '../../context/WorkspaceContext'
import { useDebts } from '../../hooks/useDebts'
import { fetchTransactions } from '../../services/transactionService'
import { createRecurrenceRule } from '../../services/recurrenceService'
import { findDuplicateMatches } from '../../utils/transactionDuplicates'
import { formatCurrency } from '../../utils/formatCurrency'
import { formatDateBR, formatFriendlyDate } from '../../utils/formatDate'
import { suggestTypeAndCategory } from '../../utils/transactionAutoCategorizer'
import { resolveNatureAffectsBudget } from '../../constants/transactionNatures'
import { TRANSACTION_PAYMENT_METHODS, getPaymentMethodLabel } from '../../constants/transactionPaymentMethods'
import { normalizeReceiptItems, summarizeReceiptDetail } from '../../utils/receiptDetailCatalog'
import { MOCK_CARDS } from '../../utils/mockData'
import './Lancamentos.css'

// ── Type chip navigation ──────────────────────────────────────────────────────
const TYPE_CHIPS = [
  { value: '',           label: 'Tudo'             },
  { value: 'income',     label: '📈 Receitas'      },
  { value: 'expense',    label: '📉 Despesas'       },
  { value: 'investment', label: '📊 Invest.'        },
  { value: 'transfer',   label: '↔️ Transf.'        },
]

// ── Section metadata (order = rendering order) ───────────────────────────────
const SECTION_ORDER = ['income', 'expense', 'investment', 'transfer']
const SECTION_META = {
  income:     { label: 'Receitas',        icon: '📈', addLabel: '+ Receita',      valCls: 'pos', formType: 'income'            },
  expense:    { label: 'Despesas',        icon: '📉', addLabel: '+ Despesa',       valCls: 'neg', formType: 'expense'           },
  investment: { label: 'Investimentos',   icon: '📊', addLabel: '+ Investimento',  valCls: 'inv', formType: 'investment'        },
  transfer:   { label: 'Transferências',  icon: '↔️', addLabel: '+ Transferência', valCls: 'neu', formType: 'transfer_internal' },
}

// ── Advanced filter options ───────────────────────────────────────────────────
const ORIGIN_OPTS = [
  { value: '',                   label: 'Todas as origens'   },
  { value: 'manual',             label: 'Manual'             },
  { value: 'bank_import',        label: 'Banco (extrato)'    },
  { value: 'credit_card_import', label: 'Cartão (fatura)'    },
  { value: 'recurring_auto',     label: 'Recorrência auto'   },
]

const ORIGIN_META = {
  manual:             { label: 'manual',  bg: '#6b7280' },
  bank_import:        { label: 'banco',   bg: '#1a56db' },
  credit_card_import: { label: 'cartão',  bg: '#8b5cf6' },
  recurring_auto:     { label: 'auto',    bg: '#047857' },
}
const STATUS_META = {
  confirmed:    { label: 'OK',         cls: 'status-ok'     },
  pending:      { label: 'Pendente',   cls: 'status-pending' },
}

const PIX_TRANSFER_NATURE_IDS = [
  'nature_loan_received',
  'nature_loan_given',
  'nature_loan_repayment',
  'nature_restitution',
  'nature_allowance_received',
  'nature_allowance_sent',
  'nature_allowance',
  'nature_donation_received',
  'nature_donation_sent',
  'nature_offer_received',
  'nature_offer_sent',
  'nature_internal_transfer',
  'nature_reimbursement',
]

const TYPE_BY_NATURE_ID = {
  nature_loan_received: 'income',
  nature_loan_given: 'expense',
  nature_loan_repayment: 'income',
  nature_restitution: 'income',
  nature_allowance_received: 'income',
  nature_allowance_sent: 'expense',
  nature_allowance: 'expense',
  nature_donation_received: 'income',
  nature_donation_sent: 'expense',
  nature_offer_received: 'income',
  nature_offer_sent: 'expense',
  nature_internal_transfer: 'transfer_internal',
  nature_reimbursement: 'income',
  nature_debt_payment: 'expense',
  nature_invoice_payment: 'expense',
}

const DEBT_LINKABLE_NATURE_IDS = new Set([
  'nature_debt_payment',
  'nature_loan_given',
  'nature_loan_repayment',
  'nature_restitution',
])

// Natures that involve another person — shows the "Pessoa relacionada" field
const PERSON_LINKED_NATURE_IDS = new Set([
  'nature_loan_received',
  'nature_loan_given',
  'nature_loan_repayment',
  'nature_debt_payment',
  'nature_restitution',
  'nature_donation_received',
  'nature_donation_sent',
  'nature_allowance',
  'nature_allowance_received',
  'nature_allowance_sent',
  'nature_offer_received',
  'nature_offer_sent',
  'nature_reimbursement',
])

function normalizeStatus(status) {
  if (status === 'pending' || status === 'needs_review') return 'pending'
  return 'confirmed'
}

/**
 * Maps any transfer sub-type to the canonical section key 'transfer'.
 * Both 'transfer' (legacy/imported) and 'transfer_internal' (manual/own-account)
 * appear in the Transferências section.
 */
function sectionKey(type) {
  if (type === 'transfer_internal') return 'transfer'
  return type
}

function sectionSum(txList, key) {
  return txList
    .filter((t) => sectionKey(t.type) === key)
    .reduce((s, t) => s + Number(t.amount || 0), 0)
}

function addMonthsToDate(isoDate, offset) {
  const [year, month, day] = String(isoDate || '').split('-').map(Number)
  if (!year || !month || !day) return ''
  const target = new Date(year, month - 1 + offset, 1)
  const maxDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  const safeDay = Math.min(day, maxDay)
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`
}

function isPixOrTransferContext(formState) {
  const text = String(formState.description || '').toLowerCase()
  const byText = text.includes('pix') || text.includes('transfer')
  const byType = formState.type === 'transfer_internal'
  const byNature = PIX_TRANSFER_NATURE_IDS.includes(formState.transactionNatureId)
  return byText || byType || byNature
}

function requiresCardSelection(formState) {
  return formState.paymentMethod === 'credit_card' || formState.transactionNatureId === 'nature_invoice_payment'
}

function isInvoicePaymentNature(formState) {
  return formState.transactionNatureId === 'nature_invoice_payment'
}

function getTodayLocalISO() {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 10)
}

export default function Lancamentos({ view = 'confirmed' }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const {
    activeWorkspaceId,
    myRole,
    members,
    transactionNatures,
    contacts,
    permissions,
    renameNatureInline,
    addExternalContact,
  } = useWorkspace()
  const { selectedMonth, selectedYear } = useFinance()
  const isPendingView = view === 'pending'

  // Primary navigation: type chip
  const [activeType,   setActiveType]   = useState('')   // '' = show all sections
  // Secondary filters (hidden by default)
  const [filterOrigin, setFilterOrigin] = useState('')

  const [modalOpen,  setModalOpen]  = useState(false)
  const [editingTx,  setEditingTx]  = useState(null)
  const [form,       setForm]       = useState(defaultForm())
  const [saving,     setSaving]     = useState(false)
  const [editingNatureLabel, setEditingNatureLabel] = useState('')

  // Dados reais do Firestore — users/{uid}/transactions
  const { transactions: allTx, loading, error, add, update, remove } =
    useTransactions(selectedYear, selectedMonth)
  const { categories } = useCategories()
  const { accounts }   = useAccounts()
  const { debts } = useDebts()
  const availableCards = MOCK_CARDS

  const availableContacts = [
    ...members.map((m) => ({ id: `member:${m.uid || m.id}`, name: m.displayName || m.email || 'Membro', type: 'internal' })),
    ...contacts,
  ]

  const scopedTransactions = allTx.filter((t) => {
    const txStatus = normalizeStatus(t.status)
    const statusOk = isPendingView ? txStatus === 'pending' : txStatus === 'confirmed'
    const hasOwnership = !!(t.createdBy || t.userId)
    const roleOk = permissions.viewPrivateOthers
      || !hasOwnership
      || t.createdBy === user?.uid
      || t.userId === user?.uid
    return statusOk && roleOk
  })

  // Apply only secondary origin filter (type is handled by section logic)
  const transactions = scopedTransactions.filter((t) => {
    const matchOrigin = !filterOrigin || t.origin === filterOrigin
    return matchOrigin
  })

  const pendingCount = allTx.filter((t) => normalizeStatus(t.status) === 'pending').length

  // ── Event handlers ────────────────────────────────────────────────────────
  function handleChange(e) {
    const { name, value } = e.target

    if (name === 'type') {
      setForm((f) => ({
        ...f,
        type: value,
        paymentMethod: value === 'income' ? '' : f.paymentMethod,
        cardId: value === 'income' ? '' : f.cardId,
      }))
      return
    }

    if (name === 'transactionNatureId') {
      const selected = transactionNatures.find((nature) => nature.id === value)
      const forcedType = TYPE_BY_NATURE_ID[value]
      setForm((f) => ({
        ...f,
        transactionNatureId: value,
        transactionNatureLabel: selected?.label || '',
        type: forcedType || f.type,
        categoryId: value === 'nature_invoice_payment' || forcedType === 'transfer_internal' ? '' : f.categoryId,
        subcategoryId: value === 'nature_invoice_payment' || forcedType === 'transfer_internal' ? '' : f.subcategoryId,
        debtId: DEBT_LINKABLE_NATURE_IDS.has(value) ? f.debtId : '',
      }))
      setEditingNatureLabel(selected?.label || '')
      return
    }

    if (name === 'paymentMethod') {
      setForm((f) => ({
        ...f,
        paymentMethod: value,
        cardId: value === 'credit_card' || f.transactionNatureId === 'nature_invoice_payment' ? f.cardId : '',
      }))
      return
    }

    if (name === 'categoryId') {
      const selectedCategory = categories.find((category) => category.id === value)
      const firstSubcategory = selectedCategory?.subcategories?.[0] || null
      setForm((f) => ({
        ...f,
        categoryId: value,
        subcategoryId: firstSubcategory?.id || '',
      }))
      return
    }

    if (name === 'recurrenceType') {
      setForm((f) => ({
        ...f,
        recurrenceType: value,
        totalInstallments: value === 'fixed' ? (f.totalInstallments || '12') : '',
        currentInstallment: value === 'fixed' ? (f.currentInstallment || '1') : '',
        recurringEndDate: value === 'fixed' ? f.recurringEndDate : '',
      }))
      return
    }

    if (name === 'totalInstallments' || name === 'currentInstallment') {
      setForm((f) => {
        const next = { ...f, [name]: value }
        const total = Number(next.totalInstallments || 0)
        const current = Number(next.currentInstallment || 0)
        if (next.recurrenceType === 'fixed' && total > 0 && current > 0 && current <= total && next.recurringStartDate) {
          next.recurringEndDate = addMonthsToDate(next.recurringStartDate, total - current)
        }
        return next
      })
      return
    }

    if (name === 'recurringStartDate') {
      setForm((f) => {
        const next = { ...f, recurringStartDate: value }
        const total = Number(next.totalInstallments || 0)
        const current = Number(next.currentInstallment || 0)
        if (next.recurrenceType === 'fixed' && total > 0 && current > 0 && current <= total) {
          next.recurringEndDate = addMonthsToDate(value, total - current)
        }
        return next
      })
      return
    }

    if (name === 'description') {
      setForm((f) => {
        const text = value
        const suggestion = suggestTypeAndCategory(text, categories, f.type)
        const natureLockedType = TYPE_BY_NATURE_ID[f.transactionNatureId]
        const keepType = natureLockedType || (f.type === 'transfer_internal' ? f.type : suggestion.suggestedType)
        const nextCategoryId = keepType === 'transfer_internal'
          ? ''
          : (f.categoryId || suggestion.suggestedCategoryId || '')

        return {
          ...f,
          description: text,
          type: keepType,
          categoryId: nextCategoryId,
        }
      })
      return
    }

    setForm((f) => ({ ...f, [name]: value }))
  }

  async function handleNatureLabelBlur() {
    const nextLabel = editingNatureLabel.trim()
    if (!form.transactionNatureId || !nextLabel) return
    const current = transactionNatures.find((nature) => nature.id === form.transactionNatureId)
    if (current?.label === nextLabel) return

    try {
      await renameNatureInline(form.transactionNatureId, nextLabel)
      setForm((f) => ({ ...f, transactionNatureLabel: nextLabel }))
    } catch (err) {
      alert('Erro ao atualizar natureza: ' + err.message)
    }
  }

  async function handleCreateContactFromInput() {
    const name = form.newContactName.trim()
    if (!name) return
    try {
      const created = await addExternalContact(name)
      if (created?.id) {
        setForm((f) => ({ ...f, contactId: created.id, newContactName: '' }))
      }
    } catch (err) {
      alert('Erro ao criar contato: ' + err.message)
    }
  }

  function handleSelectNatureChip(natureId) {
    const selected = transactionNatures.find((nature) => nature.id === natureId)
    if (!selected) return
    const suggestedType = TYPE_BY_NATURE_ID[natureId]
    setForm((f) => ({
      ...f,
      transactionNatureId: natureId,
      transactionNatureLabel: selected.label,
      type: suggestedType || f.type,
      categoryId: suggestedType === 'transfer_internal' ? '' : f.categoryId,
      subcategoryId: suggestedType === 'transfer_internal' ? '' : f.subcategoryId,
      debtId: DEBT_LINKABLE_NATURE_IDS.has(natureId) ? f.debtId : '',
    }))
    setEditingNatureLabel(selected.label)
  }
  function handleCheck(e) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.checked }))
  }

  function openNewModal(typeValue) {
    setEditingTx(null)
    const base = { ...defaultForm(), type: typeValue || 'expense' }
    const defaultNature = transactionNatures.find((nature) => nature.direction === (base.type === 'income' ? 'income' : 'expense'))
    if (defaultNature) {
      base.transactionNatureId = defaultNature.id
      base.transactionNatureLabel = defaultNature.label
    }
    setForm(base)
    setEditingNatureLabel(base.transactionNatureLabel || '')
    setModalOpen(true)
  }

  function openEditModal(tx) {
    const suggestion = suggestTypeAndCategory(tx.description || '', categories, tx.type || 'expense')
    const typeFromNature = TYPE_BY_NATURE_ID[tx.transactionNatureId]
    const suggestedType = typeFromNature || (tx.type === 'transfer_internal' ? 'transfer_internal' : suggestion.suggestedType)

    setEditingTx(tx)
    setForm({
      type:        suggestedType,
      description: tx.description || '',
      amount:      tx.amount      || '',
      date:        tx.date        || '',
      accountId:   tx.accountId   || '',
      toAccountId: tx.toAccountId || '',
      categoryId:  tx.categoryId || (tx.type === 'transfer_internal' ? '' : suggestion.suggestedCategoryId || ''),
      subcategoryId: tx.subcategoryId || '',
      notes:       tx.notes       || '',
      recurring:   tx.recurring   || !!tx.recurringId,
      recurrenceType: tx.recurringType || 'indefinite',
      recurringStartDate: tx.date || '',
      recurringEndDate: tx.recurringEndDate || '',
      totalInstallments: tx.totalInstallments ? String(tx.totalInstallments) : '12',
      currentInstallment: tx.currentInstallment ? String(tx.currentInstallment) : (tx.installmentNumber ? String(tx.installmentNumber) : '1'),
      transactionNatureId: tx.transactionNatureId || '',
      transactionNatureLabel: tx.transactionNatureLabel || '',
      contactId: tx.contactId || '',
      newContactName: '',
      debtId: tx.debtId || '',
      paymentMethod: tx.paymentMethod || '',
      cardId: tx.cardId || '',
      receiptDetailEnabled: !!tx.receiptDetailEnabled,
      receiptItems: Array.isArray(tx.receiptItems) ? tx.receiptItems : [],
    })
    setEditingNatureLabel(tx.transactionNatureLabel || '')
    setModalOpen(true)
  }

  async function handleQuickConfirm(tx) {
    try {
      const natureDrivenType = TYPE_BY_NATURE_ID[tx.transactionNatureId]
      const isInternal = (natureDrivenType || tx.type) === 'transfer_internal'
      const inferred = suggestTypeAndCategory(tx.description, categories, tx.type)
      const resolvedType = natureDrivenType || (isInternal ? 'transfer_internal' : (inferred.suggestedType || tx.type))
      const isInvoicePayment = tx.transactionNatureId === 'nature_invoice_payment'
      const resolvedCategoryId = isInternal || isInvoicePayment
        ? null
        : (tx.categoryId || inferred.suggestedCategoryId || null)
      const resolvedCategoryName = isInternal
        ? null
        : (categories.find((c) => c.id === resolvedCategoryId)?.name || null)

      await update(tx.id, {
        type: resolvedType,
        accountId: tx.accountId || accounts[0]?.id || null,
        categoryId: resolvedCategoryId,
        categoryName: resolvedCategoryName,
        subcategoryId: isInvoicePayment ? null : tx.subcategoryId || null,
        subcategoryName: isInvoicePayment ? null : tx.subcategoryName || null,
        status: 'confirmed',
      })
    } catch (err) {
      alert('Erro ao confirmar: ' + err.message)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.description || !form.amount || !form.date) return

    if (form.transactionNatureId === 'nature_debt_payment' && !form.debtId) {
      alert('Selecione a dívida para vincular o pagamento.')
      return
    }

    if (requiresCardSelection(form) && !form.cardId) {
      alert('Selecione o cartão vinculado.')
      return
    }

    if (!editingTx && !permissions.canLaunch) {
      alert('Seu papel não permite lançar movimentações neste workspace.')
      return
    }

    if (form.recurring && form.recurrenceType === 'fixed') {
      const total = Number(form.totalInstallments)
      const current = Number(form.currentInstallment)
      if (!total || !current || current > total || total < 1 || current < 1) {
        alert('Preencha parcelas corretamente: parcela atual deve estar entre 1 e o total.')
        return
      }
    }

    if (!user?.uid) {
      alert('Usuário não autenticado.')
      return
    }

    const normalizedAmount = Number(form.amount || 0)
    const receiptSummary = summarizeReceiptDetail(form.receiptItems, normalizedAmount)
    const expenseCategories = categories.filter((category) => category.type === 'expense')
    if (form.receiptDetailEnabled) {
      if (!receiptSummary.allRequiredComplete) {
        alert('Preencha todos os itens do cupom com descrição, valor, categoria analítica, subcategoria, marcação e categoria real do orçamento.')
        return
      }
      if (!receiptSummary.isBalanced) {
        alert(`A soma dos itens detalhados precisa bater com o valor total do lançamento. Diferença atual: ${formatCurrency(receiptSummary.difference)}.`)
        return
      }
    }

    setSaving(true)
    const typeFromNature = TYPE_BY_NATURE_ID[form.transactionNatureId]
    const effectiveType = typeFromNature || form.type
    const isInternal = effectiveType === 'transfer_internal'
    const invoicePayment = isInvoicePaymentNature(form)
    const inferred = suggestTypeAndCategory(form.description, categories, form.type)
    const resolvedType = isInternal
      ? 'transfer_internal'
      : (typeFromNature || inferred.suggestedType || form.type)
    const resolvedCategoryId = isInternal
      ? null
      : (invoicePayment ? null : (form.categoryId || inferred.suggestedCategoryId || null))
    const resolvedCategoryName = isInternal
      ? null
      : (invoicePayment ? null : (categories.find((c) => c.id === resolvedCategoryId)?.name || null))
    const resolvedSubcategoryName = invoicePayment
      ? null
      : (categories
        .find((category) => category.id === resolvedCategoryId)
        ?.subcategories
        ?.find((subcategory) => subcategory.id === form.subcategoryId)
        ?.name || null)
    const resolvedAccountId = isInternal
      ? (form.accountId || editingTx?.accountId || null)
      : (form.accountId || editingTx?.accountId || accounts[0]?.id || null)

    const payload = {
      type:        resolvedType,
      description: form.description,
      amount:      form.amount,
      date:        form.date,
      accountId:   resolvedAccountId,
      toAccountId: isInternal ? (form.toAccountId || null) : null,
      categoryId:  resolvedCategoryId,
      categoryName: resolvedCategoryName,
      subcategoryId: invoicePayment || isInternal ? null : (form.subcategoryId || null),
      subcategoryName: invoicePayment || isInternal ? null : resolvedSubcategoryName,
      notes:       form.notes || '',
      recurring:   !!form.recurring,
      recurrenceType: form.recurring ? form.recurrenceType : null,
      recurringStartDate: form.recurring ? (form.recurringStartDate || form.date) : null,
      recurringEndDate: form.recurring && form.recurrenceType === 'fixed' ? (form.recurringEndDate || null) : null,
      totalInstallments: form.recurring && form.recurrenceType === 'fixed' ? Number(form.totalInstallments || 0) : null,
      currentInstallment: form.recurring && form.recurrenceType === 'fixed' ? Number(form.currentInstallment || 0) : null,
      transactionNatureId: form.transactionNatureId || null,
      transactionNatureLabel: (editingNatureLabel || form.transactionNatureLabel || '').trim() || null,
      contactId: form.contactId || null,
      contactName: availableContacts.find((c) => c.id === form.contactId)?.name || null,
      debtId: DEBT_LINKABLE_NATURE_IDS.has(form.transactionNatureId) ? (form.debtId || null) : null,
      debtName: DEBT_LINKABLE_NATURE_IDS.has(form.transactionNatureId)
        ? (debts.find((debt) => debt.id === form.debtId)?.name || null)
        : null,
      paymentMethod: form.paymentMethod || null,
      cardId: requiresCardSelection(form) ? (form.cardId || null) : null,
      cardName: requiresCardSelection(form)
        ? (availableCards.find((card) => card.id === form.cardId)?.name || null)
        : null,
      receiptDetailEnabled: !!form.receiptDetailEnabled,
      receiptDetailStatus: form.receiptDetailEnabled
        ? (receiptSummary.isBalanced ? 'balanced' : 'mismatch')
        : null,
      receiptDetailTotal: form.receiptDetailEnabled ? receiptSummary.detailedTotal : 0,
      receiptItems: form.receiptDetailEnabled ? normalizeReceiptItems(form.receiptItems, expenseCategories) : [],
      workspaceId: activeWorkspaceId,
      createdBy: user.uid,
      userId: user.uid,
      affectsBudget: resolveNatureAffectsBudget(transactionNatures, form.transactionNatureId, resolvedType !== 'transfer_internal'),
      status:      editingTx
        ? (normalizeStatus(editingTx.status) === 'pending' ? 'confirmed' : normalizeStatus(editingTx.status))
        : 'confirmed',
    }

    const [txYear, txMonth] = String(payload.date || '')
      .slice(0, 7)
      .split('-')
      .map((n) => Number(n))

    const monthTransactions =
      txYear === selectedYear && txMonth === selectedMonth
        ? allTx
        : await fetchTransactions(user.uid, txYear, txMonth, {
          workspaceId: activeWorkspaceId,
          viewerRole: myRole,
          viewerUid: user.uid,
        })

    const duplicates = findDuplicateMatches(payload, monthTransactions, {
      ignoreId: editingTx?.id ?? null,
    })

    if (duplicates.isExactDuplicate) {
      setSaving(false)
      alert('Lançamento duplicado detectado. Revise data, valor, descrição e conta antes de salvar.')
      return
    }

    if (duplicates.hasPossibleDuplicate) {
      const proceed = window.confirm(
        `Encontramos ${duplicates.possible.length} lançamento(s) parecido(s). Deseja salvar mesmo assim?`,
      )
      if (!proceed) {
        setSaving(false)
        return
      }
    }

    try {
      if (editingTx) {
        await update(editingTx.id, payload)
      } else {
        const txId = await add(payload)

        if (form.recurring) {
          const recurrenceType = form.recurrenceType === 'fixed' ? 'fixed' : 'indefinite'
          const recurringStartDate = form.recurringStartDate || payload.date
          const currentInstallment = recurrenceType === 'fixed' ? Number(form.currentInstallment || 1) : 1
          const totalInstallments = recurrenceType === 'fixed' ? Number(form.totalInstallments || 1) : null
          const recurrence = await createRecurrenceRule(user.uid, payload, {
            recurrenceType,
            startDate: recurringStartDate,
            endDate: recurrenceType === 'fixed' ? (form.recurringEndDate || null) : null,
            totalInstallments,
            startInstallment: currentInstallment,
            currentInstallment,
            active: true,
          }, { workspaceId: activeWorkspaceId })

          await update(txId, {
            recurringId: recurrence.id,
            recurringType: recurrenceType,
            recurringStartDate,
            recurringEndDate: recurrenceType === 'fixed' ? (form.recurringEndDate || null) : null,
            totalInstallments,
            currentInstallment,
            recurringInstanceMonth: String(payload.date).slice(0, 7),
            installmentNumber: recurrenceType === 'fixed' ? currentInstallment : null,
          })
        }
      }
      setModalOpen(false)
      setEditingTx(null)
      setForm(defaultForm())
    } catch (err) {
      alert('Erro ao salvar lançamento: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(tx) {
    if (!window.confirm(`Excluir "${tx.description}"?`)) return
    try {
      await remove(tx.id)
      setModalOpen(false)
      setEditingTx(null)
    } catch (err) {
      alert('Erro ao excluir: ' + err.message)
    }
  }

  // ── Render helpers ────────────────────────────────────────────────────────
  function renderTx(t) {
    const originMeta = ORIGIN_META[t.origin] ?? null
    const normalizedTxStatus = normalizeStatus(t.status)
    const statusMeta = STATUS_META[normalizedTxStatus] ?? { label: normalizedTxStatus, cls: '' }
    const canQuickConfirm = isPendingView && normalizedTxStatus === 'pending'
    const isCredit   = t.type === 'income'
    const catName    = categories.find((c) => c.id === t.categoryId)?.name ?? null
    const subcategoryLabel = t.subcategoryName || categories.find((c) => c.id === t.categoryId)?.subcategories?.find((s) => s.id === t.subcategoryId)?.name
    const natureLabel = t.transactionNatureLabel || transactionNatures.find((nature) => nature.id === t.transactionNatureId)?.label
    const contactLabel = t.contactName || contacts.find((c) => c.id === t.contactId)?.name
    const debtLabel = t.debtName || debts.find((debt) => debt.id === t.debtId)?.name
    const paymentMethodLabel = getPaymentMethodLabel(t.paymentMethod)
    const cardLabel = t.cardName || availableCards.find((card) => card.id === t.cardId)?.name
    return (
      <div key={t.id} className={`transaction-item${normalizedTxStatus === 'pending' ? ' tx-pending' : ''}`}>
        <div className="tx-info">
          <span className="tx-desc">
            {t.description}
            {normalizedTxStatus !== 'confirmed' && (
              <span className={`tx-status ${statusMeta.cls}`}>{statusMeta.label}</span>
            )}
          </span>
          <span className="tx-meta">
            <span className="tx-date">
              {catName ? `${catName} • ` : ''}{formatFriendlyDate(t.date)}
            </span>
          </span>
        </div>
        <span className={`tx-value tx-value--${t.type}`}>
          {isCredit ? '+' : ''}{formatCurrency(t.amount)}
        </span>
        <div className="tx-actions">
          <button className="tx-action-btn" onClick={() => openEditModal(t)} title="Editar">✏️</button>
          <button
            className={`tx-action-btn tx-action-confirm${canQuickConfirm ? '' : ' is-confirmed'}`}
            onClick={() => canQuickConfirm && handleQuickConfirm(t)}
            title={canQuickConfirm ? 'Confirmar' : 'Confirmado'}
            disabled={!canQuickConfirm}
          >
            ✅
          </button>
        </div>
      </div>
    )
  }

  function renderSection(key) {
    const meta  = SECTION_META[key]
    const group = transactions.filter((t) => sectionKey(t.type) === key)
    // In "Tudo" view, hide empty sections; in focused view always show (to display empty state)
    if (activeType === '' && group.length === 0) return null
    const total = sectionSum(transactions, key)
    return (
      <div key={key} className="type-section">
        <div className="section-header">
          <div className="section-header-left">
            <span className="section-icon">{meta.icon}</span>
            <span className="section-label">{meta.label}</span>
            <span className={`section-total section-total--${meta.valCls}`}>
              {formatCurrency(total)}
            </span>
          </div>
          <button
            className="section-add-btn"
            onClick={() => openNewModal(meta.formType)}
            title={meta.addLabel}
          >
            {meta.addLabel}
          </button>
        </div>
        <div className="section-items">
          {group.length === 0 ? (
            <p className="section-empty">
              {isPendingView ? 'Nenhuma pendência neste mês' : 'Nenhum lançamento confirmado neste mês'}
            </p>
          ) : (
            group.map(renderTx)
          )}
        </div>
      </div>
    )
  }

  // FAB pre-selects type based on active chip
  const fabType =
    activeType === '' ? 'expense' : (SECTION_META[activeType]?.formType ?? 'expense')

  const pixTransferNatureOptions = transactionNatures.filter((nature) =>
    PIX_TRANSFER_NATURE_IDS.includes(nature.id),
  )

  // ── JSX ───────────────────────────────────────────────────────────────────
  return (
    <div className="lancamentos-page">
      <MonthSelector />

      {/* Type chip navigation — primary filter */}
      <div className="type-filter">
        {TYPE_CHIPS.map((chip) => (
          <button
            key={chip.value}
            className={`type-chip${activeType === chip.value ? ' active' : ''}`}
            onClick={() => setActiveType(chip.value)}
          >
            {chip.label}
          </button>
        ))}
        <button
          className="filter-toggle-btn import-btn"
          onClick={() => navigate('/importacao')}
          title="Importar extrato"
        >
          📥 Importar
        </button>
      </div>

      <div className="advanced-filters">
        <select
          value={filterOrigin}
          onChange={(e) => setFilterOrigin(e.target.value)}
          className="filter-select"
        >
          {ORIGIN_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {filterOrigin && (
          <button
            className="clear-filters-btn"
            onClick={() => setFilterOrigin('')}
          >
            Limpar
          </button>
        )}
      </div>

      {/* Review banner */}
      {!isPendingView && pendingCount > 0 && (
        <div className="review-banner">
          ⚠️ <strong>{pendingCount}</strong> lançamento(s) pendente(s)
          <button
            className="review-banner-btn"
            onClick={() => navigate('/lancar')}
          >
            Ver
          </button>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="empty-state"><p>Carregando lançamentos…</p></div>
      ) : error ? (
        <div className="empty-state">
          <span className="empty-icon">⚠️</span>
          <p>Erro ao carregar: {error}</p>
        </div>
      ) : (
        <div className="transaction-list">
          {activeType === '' ? (
            // ─ "Tudo" view: sections grouped by type ────────────────────────
            transactions.length === 0 ? (
              <div className="empty-state">
                <img src="/logo.jpg" alt="Learnendo Finanças" className="empty-logo" />
                <p className="empty-title">
                  {isPendingView ? 'Nenhuma pendência encontrada' : 'Nenhum lançamento confirmado encontrado'}
                </p>
                <p className="empty-hint">
                  {isPendingView ? 'Importe um extrato para revisar novos lançamentos' : 'Toque em ➕ para adicionar um lançamento'}
                </p>
              </div>
            ) : (
              SECTION_ORDER.map(renderSection)
            )
          ) : (
            // ─ Focused view: single section ─────────────────────────────────
            renderSection(activeType)
          )}
        </div>
      )}

      {/* FAB */}
      <button
        className="fab"
        onClick={() => openNewModal(fabType)}
        aria-label="Novo lançamento"
      >
        +
      </button>

      {/* Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => { setModalOpen(false); setEditingTx(null) }}
        title={editingTx ? 'Editar lançamento' : 'Novo lançamento'}
        footer={
          <>
            {editingTx && (
              <Button variant="danger" fullWidth onClick={() => handleDelete(editingTx)}>
                Excluir
              </Button>
            )}
            <Button variant="ghost" fullWidth onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button variant="primary" fullWidth onClick={handleSubmit} loading={saving}>Salvar</Button>
          </>
        }
      >
        <form className="launch-form" onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label>Data</label>
            <input name="date" type="date" value={form.date} onChange={handleChange} required />
          </div>
          <div className="form-group">
            <label>Tipo</label>
            <select name="type" value={form.type} onChange={handleChange} required>
              <option value="income">Receita</option>
              <option value="expense">Despesa</option>
              <option value="investment">Investimento</option>
              <option value="transfer_internal">Transferência entre contas</option>
            </select>
          </div>
          {form.type !== 'income' && (
            <div className="form-group">
              <label>Forma de pagamento</label>
              <select name="paymentMethod" value={form.paymentMethod} onChange={handleChange}>
                <option value="">Selecione…</option>
                {TRANSACTION_PAYMENT_METHODS.map((method) => (
                  <option key={method.id} value={method.id}>{method.label}</option>
                ))}
              </select>
            </div>
          )}
          <div className="form-group">
            <label>Descrição</label>
            <input name="description" type="text" value={form.description} onChange={handleChange}
              placeholder="Ex: Supermercado" required />
          </div>
          <div className="form-group">
            <label>Valor (R$)</label>
            <input name="amount" type="number" inputMode="decimal" min="0.01" step="0.01"
              value={form.amount} onChange={handleChange} placeholder="0,00" required />
          </div>
          {form.type !== 'transfer_internal' && !isInvoicePaymentNature(form) ? (
            <div className="form-group">
              <label>Categoria</label>
              <select name="categoryId" value={form.categoryId} onChange={handleChange}>
                <option value="">Selecione…</option>
                {categories
                  .filter((c) => c.type === form.type)
                  .map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
              </select>
            </div>
          ) : form.type !== 'transfer_internal' && isInvoicePaymentNature(form) ? (
            <div className="form-help-block invoice-help-block">
              Pagamento de fatura é passivo financeiro. A categoria de consumo já foi registrada na compra e não será lançada de novo no orçamento.
            </div>
          ) : (
            <>
              <div className="form-group">
                <label>Conta de origem</label>
                <select name="accountId" value={form.accountId} onChange={handleChange}>
                  <option value="">Selecione…</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Conta de destino</label>
                <select name="toAccountId" value={form.toAccountId} onChange={handleChange}>
                  <option value="">Selecione…</option>
                  {accounts
                    .filter((a) => a.id !== form.accountId)
                    .map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            </>
          )}
          {form.categoryId && !isInvoicePaymentNature(form) && categories.find((category) => category.id === form.categoryId)?.subcategories?.length > 0 && (
            <div className="form-group">
              <label>Subcategoria</label>
              <select name="subcategoryId" value={form.subcategoryId} onChange={handleChange}>
                <option value="">Selecione…</option>
                {categories
                  .find((category) => category.id === form.categoryId)
                  ?.subcategories
                  ?.map((subcategory) => (
                    <option key={subcategory.id} value={subcategory.id}>{subcategory.name}</option>
                  ))}
              </select>
            </div>
          )}
          {requiresCardSelection(form) && (
            <div className="form-group">
              <label>{isInvoicePaymentNature(form) ? 'Cartão / fatura vinculada' : 'Cartão usado na compra'}</label>
              <select name="cardId" value={form.cardId} onChange={handleChange}>
                <option value="">Selecione…</option>
                {availableCards.map((card) => (
                  <option key={card.id} value={card.id}>{card.name}</option>
                ))}
              </select>
            </div>
          )}
          {transactionNatures.length > 0 && (
            <div className="form-group">
              <label>Natureza da movimentação</label>
              <select
                name="transactionNatureId"
                value={form.transactionNatureId}
                onChange={handleChange}
              >
                <option value="">Selecione…</option>
                {transactionNatures.map((nature) => (
                  <option key={nature.id} value={nature.id}>{nature.label}</option>
                ))}
              </select>
            </div>
          )}
          {transactionNatures.length > 0 && isPixOrTransferContext(form) && pixTransferNatureOptions.length > 0 && (
            <div className="form-group">
              <label>Seleção rápida para Pix/transferência</label>
              <p className="form-help-text">Escolha a intenção do Pix/transferência para não depender apenas da descrição.</p>
              <div className="nature-chip-row">
                {pixTransferNatureOptions.map((nature) => (
                  <button
                    key={nature.id}
                    type="button"
                    className={`nature-chip-btn${form.transactionNatureId === nature.id ? ' active' : ''}`}
                    onClick={() => handleSelectNatureChip(nature.id)}
                  >
                    {nature.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* Personalização de rótulo ocultada temporariamente para reduzir complexidade no formulário */}
          {DEBT_LINKABLE_NATURE_IDS.has(form.transactionNatureId) && (
            <div className="form-group">
              <label>Dívida vinculada (opcional)</label>
              <select
                name="debtId"
                value={form.debtId}
                onChange={handleChange}
                required={form.transactionNatureId === 'nature_debt_payment'}
              >
                <option value="">Nenhuma</option>
                {debts.map((debt) => (
                  <option key={debt.id} value={debt.id}>
                    {debt.name} · restante {formatCurrency(debt.remainingAmount)}
                  </option>
                ))}
              </select>
            </div>
          )}
          {PERSON_LINKED_NATURE_IDS.has(form.transactionNatureId) && (
            <>
              <div className="form-group">
                <label>Pessoa relacionada (opcional)</label>
                <select name="contactId" value={form.contactId} onChange={handleChange}>
                  <option value="">Nenhuma</option>
                  {availableContacts.map((contact) => (
                    <option key={contact.id} value={contact.id}>{contact.name}</option>
                  ))}
                </select>
              </div>
              <div className="form-group contact-inline-row">
                <input
                  name="newContactName"
                  type="text"
                  value={form.newContactName}
                  onChange={handleChange}
                  placeholder="Novo contato externo"
                />
                <button type="button" className="inline-add-btn" onClick={handleCreateContactFromInput}>Adicionar</button>
              </div>
            </>
          )}
          <div className="form-group">
            <label>Observação</label>
            <textarea name="notes" value={form.notes} onChange={handleChange} rows={2} placeholder="Opcional" />
          </div>
          {form.type === 'expense' && !isInvoicePaymentNature(form) && (
            <ReceiptDetailEditor
              enabled={form.receiptDetailEnabled}
              onToggle={(enabled) => setForm((f) => ({
                ...f,
                receiptDetailEnabled: enabled,
                receiptItems: enabled ? f.receiptItems : [],
              }))}
              items={form.receiptItems}
              onChange={(items) => setForm((f) => ({ ...f, receiptItems: items }))}
              totalAmount={form.amount}
              expenseCategories={categories.filter((category) => category.type === 'expense')}
            />
          )}
          <div className="form-check">
            <input id="recurring" name="recurring" type="checkbox"
              checked={form.recurring} onChange={handleCheck} />
            <label htmlFor="recurring">Lançamento recorrente</label>
          </div>
          {form.recurring && (
            <div className="recurrence-panel">
              <div className="form-group">
                <label>Tipo da recorrência</label>
                <select name="recurrenceType" value={form.recurrenceType} onChange={handleChange}>
                  <option value="indefinite">Tempo indeterminado</option>
                  <option value="fixed">Prazo definido</option>
                </select>
              </div>
              <div className="recurrence-grid">
                <div className="form-group">
                  <label>Data de início</label>
                  <input
                    name="recurringStartDate"
                    type="date"
                    value={form.recurringStartDate}
                    onChange={handleChange}
                    required
                  />
                </div>
                {form.recurrenceType === 'fixed' && (
                  <>
                    <div className="form-group">
                      <label>Total de parcelas/meses</label>
                      <input
                        name="totalInstallments"
                        type="number"
                        min="1"
                        step="1"
                        value={form.totalInstallments}
                        onChange={handleChange}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>Parcela atual</label>
                      <input
                        name="currentInstallment"
                        type="number"
                        min="1"
                        step="1"
                        value={form.currentInstallment}
                        onChange={handleChange}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>Data final</label>
                      <input
                        name="recurringEndDate"
                        type="date"
                        value={form.recurringEndDate}
                        onChange={handleChange}
                      />
                    </div>
                  </>
                )}
              </div>
              {form.recurrenceType === 'fixed' && form.totalInstallments && form.currentInstallment && (
                <p className="recurrence-progress">
                  Progresso atual: {form.currentInstallment} de {form.totalInstallments}
                </p>
              )}
            </div>
          )}
          <p className="form-help-text">
            Use para contas que se repetem com frequência, como aluguel, salário, internet ou mensalidades.
          </p>
        </form>
      </Modal>
    </div>
  )
}

function defaultForm() {
  const today = getTodayLocalISO()
  return {
    type: 'expense', description: '', amount: '', date: today,
    accountId: '', toAccountId: '', categoryId: '', notes: '', recurring: false,
    recurrenceType: 'indefinite', recurringStartDate: today, recurringEndDate: '',
    totalInstallments: '12', currentInstallment: '1',
    transactionNatureId: '', transactionNatureLabel: '',
    paymentMethod: '', cardId: '',
    contactId: '', newContactName: '',
    debtId: '', subcategoryId: '',
    receiptDetailEnabled: false,
    receiptItems: [],
  }
}

