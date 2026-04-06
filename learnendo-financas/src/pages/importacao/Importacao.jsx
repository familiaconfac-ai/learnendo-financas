import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useFinance } from '../../context/FinanceContext'
import { useWorkspace } from '../../context/WorkspaceContext'
import { useAccounts } from '../../hooks/useAccounts'
import { useCards } from '../../hooks/useCards'
import { useCategories } from '../../hooks/useCategories'
import { addTransaction, fetchTransactions, updateTransaction } from '../../services/transactionService'
import { parseStatementFile } from '../../utils/statementParser'
import { classifyBatch } from '../../utils/transactionClassifier'
import { buildDuplicateSignature, findDuplicateMatches } from '../../utils/transactionDuplicates'
import { formatCurrency } from '../../utils/formatCurrency'
import { handleImport } from '../../utils/importRules'
import { normalizeReceiptItems } from '../../utils/receiptDetailCatalog'
import {
  buildCardCommitmentRecurringFields,
  computeCreditCardCompetencyMonth,
} from '../../utils/creditCardPlanning'
import { findReceiptInvoiceReconciliationCandidate } from '../../utils/receiptInvoiceReconciliation'
import Card, { CardHeader } from '../../components/ui/Card'
import './Importacao.css'

// ── Type display map ─────────────────────────────────────────────────────────

const TYPE_META = {
  income:            { label: 'Receita',   icon: '↑', cls: 'type-income'     },
  expense:           { label: 'Despesa',   icon: '↓', cls: 'type-expense'    },
  transfer_internal: { label: 'Transf.',   icon: '↔', cls: 'type-transfer'   },
  investment:        { label: 'Investim.', icon: '▲', cls: 'type-investment' },
}

const IMPORT_MODE_META = {
  bank: {
    title: 'Importar extrato',
    subtitle: 'OFX, CSV ou PDF de conta bancária. Tudo entra em Lançar como pendente.',
    icon: '🏦',
    accept: '.csv,.ofx,.qfx,.txt,.pdf',
    fileHint: 'Formatos suportados: OFX, QFX, CSV, TXT e PDF.',
    selectLabel: 'Selecionar extrato',
  },
  invoice: {
    title: 'Importar fatura',
    subtitle: 'Vincule a um cartão cadastrado e envie as compras para Lançar como pendentes.',
    icon: '💳',
    accept: '.csv,.pdf,.txt',
    fileHint: 'Formatos suportados: CSV, TXT e PDF da fatura.',
    selectLabel: 'Selecionar fatura',
  },
  receipt: {
    title: 'Importar nota/cupom',
    subtitle: 'OCR próprio para cupom, quebrando itens em linhas pendentes para revisão.',
    icon: '🧾',
    accept: '.pdf,.jpg,.jpeg,.png,.webp,image/*',
    fileHint: 'Formatos suportados: imagem e PDF do cupom/nota.',
    selectLabel: 'Selecionar nota/cupom',
  },
}

const RECEIPT_DOCUMENT_TYPES = [
  { value: 'supermercado', label: 'Supermercado' },
  { value: 'loja', label: 'Loja' },
  { value: 'farmacia', label: 'Farmácia' },
  { value: 'material_ferramentas', label: 'Material/Ferramentas' },
  { value: 'outros', label: 'Outros' },
]

const RECEIPT_PAYMENT_METHODS = [
  { value: 'account', label: 'Conta' },
  { value: 'card', label: 'Cartão' },
  { value: 'cash', label: 'Dinheiro' },
]

const CASH_ORIGIN_TYPES = [
  { value: 'caixa', label: 'Caixa' },
  { value: 'oferta', label: 'Oferta' },
  { value: 'ajuda_custo', label: 'Ajuda de custo' },
  { value: 'bico', label: 'Bico' },
  { value: 'outro', label: 'Outro' },
]

const RECEIPT_DOCUMENT_TYPE_HINTS = {
  supermercado: ['Alimentação', 'Supermercado', 'Mercado', 'Limpeza', 'Higiene'],
  loja: ['Vestuário', 'Utilidades', 'Eletrônicos', 'Pessoal', 'Casa'],
  farmacia: ['Saúde', 'Farmácia', 'Medicamentos', 'Higiene'],
  material_ferramentas: ['Manutenção', 'Ferramentas', 'Casa', 'Trabalho'],
  outros: [],
}

const RECEIPT_PARSE_TIMEOUT_MS = 45000

// ── Helpers ──────────────────────────────────────────────────────────────────

function isoToBR(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function buildMonthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`
}

function formatMonthLabel(year, month) {
  return new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month - 1, 1))
}

const ACCOUNT_TYPE_LABELS = {
  checking:   'Conta Corrente',
  savings:    'Conta Poupança',
  credit:     'Cartão de Crédito',
  investment: 'Investimentos',
  wallet:     'Carteira',
}

function accountLabel(a) {
  const type = ACCOUNT_TYPE_LABELS[a.type] ?? a.type ?? ''
  if (a.bank && a.bank.trim()) return `${a.bank} • ${type}`
  return type ? `${a.name} (${type})` : a.name
}

function cardLabel(card) {
  const parts = [
    card.name,
    card.holderName || '',
    card.flag ? String(card.flag).toUpperCase() : '',
  ].filter(Boolean)
  return parts.join(' • ')
}

function normalize(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function findCategoryByHints(categories, type, hints = []) {
  if (!Array.isArray(hints) || hints.length === 0) return null
  const typed = categories.filter((c) => c.type === type)
  const normalizedHints = hints.map((h) => normalize(h))

  for (const hint of normalizedHints) {
    const exact = typed.find((c) => normalize(c.name) === hint)
    if (exact) return exact
  }

  for (const hint of normalizedHints) {
    const partial = typed.find((c) => normalize(c.name).includes(hint) || hint.includes(normalize(c.name)))
    if (partial) return partial
  }

  return null
}

function buildReceiptDocumentTypeHints(receiptDocumentType) {
  return RECEIPT_DOCUMENT_TYPE_HINTS[receiptDocumentType] || []
}

function applyReceiptDocumentTypeContext(row, receiptDocumentType) {
  if (!receiptDocumentType) return row
  const documentTypeHints = buildReceiptDocumentTypeHints(receiptDocumentType)
  const mergedHints = [...new Set([...(Array.isArray(row?.categoryHints) ? row.categoryHints : []), ...documentTypeHints])]
  return {
    ...row,
    receiptDocumentType,
    categoryHints: mergedHints,
  }
}

function hydrateImportedReceiptItems(items, categories, receiptDocumentType = '') {
  const prepared = (Array.isArray(items) ? items : []).map((item) => {
    const documentTypeHints = buildReceiptDocumentTypeHints(receiptDocumentType)
    const combinedHints = [
      ...(Array.isArray(item.budgetCategoryHints) ? item.budgetCategoryHints : []),
      ...documentTypeHints,
      ...[item.budgetCategoryName].filter(Boolean),
    ]
    const hintedBudgetCategory = findCategoryByHints(
      categories,
      'expense',
      combinedHints,
    )

    return {
      ...item,
      receiptDocumentType,
      budgetCategoryId: hintedBudgetCategory?.id || item.budgetCategoryId || '',
      budgetCategoryName: hintedBudgetCategory?.name || item.budgetCategoryName || '',
      budgetCategoryHints: [...new Set(combinedHints)].filter(Boolean),
    }
  })

  return normalizeReceiptItems(prepared, categories.filter((category) => category.type === 'expense')).map((item) => ({
    ...item,
    receiptDocumentType,
  }))
}

function isReceiptImportSource(source) {
  return source === 'image_receipt' || source === 'image_receipt_item'
}

function expandReceiptImportRows(rows, categories, receiptDocumentType) {
  return (Array.isArray(rows) ? rows : []).flatMap((row) => {
    if (row?.source !== 'image_receipt') return [row]

    const contextualRow = applyReceiptDocumentTypeContext(row, receiptDocumentType)
    const receiptItems = hydrateImportedReceiptItems(contextualRow.receiptItems, categories, receiptDocumentType)
    if (receiptItems.length === 0) return [contextualRow]

    return receiptItems.map((item, index) => ({
      ...contextualRow,
      id: `${row.id || 'receipt'}-item-${item.id || index}`,
      description: item.description || row.description,
      amount: hasCurrencyValue(item.amount) ? Number(item.amount) : '',
      type: 'expense',
      direction: 'debit',
      status: item.status || 'partial',
      source: 'image_receipt_item',
      categoryName: item.budgetCategoryName || contextualRow.categoryName || '',
      categoryHints: Array.isArray(item.budgetCategoryHints) && item.budgetCategoryHints.length > 0
        ? item.budgetCategoryHints
        : contextualRow.categoryHints,
      receiptDetailEnabled: false,
      receiptItems: [],
      receiptItemStatus: item.status || 'partial',
      quantity: item.quantity || '',
      detailCategoryKey: item.detailCategoryKey,
      detailSubcategoryKey: item.detailSubcategoryKey,
      budgetCategoryHints: item.budgetCategoryHints,
      budgetCategoryId: item.budgetCategoryId || '',
      budgetCategoryName: item.budgetCategoryName || '',
      receiptDocumentType,
      parentReceiptDescription: row.description,
    }))
  })
}

function withTimeout(promise, timeoutMs, timeoutMessage) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
    }),
  ])
}

function detectImportMode(rawRows, summary) {
  if ((Array.isArray(rawRows) ? rawRows : []).some((row) => isReceiptImportSource(row?.source))) return 'receipt'
  if (summary?.kind === 'invoice') return 'invoice'
  return 'bank'
}

function getImportModeError(selectedMode, detectedMode) {
  if (!selectedMode || selectedMode === detectedMode) return ''
  if (selectedMode === 'bank') return 'Este arquivo parece ser uma fatura/cartão ou cupom. Use o fluxo correto de importação.'
  if (selectedMode === 'invoice') return 'Este arquivo não parece ser uma fatura de cartão. Use Importar extrato ou Importar nota/cupom.'
  return 'Este arquivo não parece ser uma nota/cupom OCR. Use um arquivo de cupom ou selecione o fluxo correto.'
}

function hasCurrencyValue(value) {
  if (value === null || value === undefined) return false
  if (typeof value === 'string' && value.trim() === '') return false
  return Number.isFinite(Number(value))
}

function firstName(value) {
  return String(value || '').trim().split(/\s+/)[0] || ''
}

function buildSuggestedAccountForm(summary) {
  return {
    name: summary?.suggestedAccountName || [summary?.institutionName || 'Conta', firstName(summary?.holderName)].filter(Boolean).join(' '),
    bank: summary?.institutionName || '',
    holderName: summary?.holderName || '',
    branchNumber: summary?.branchNumber || '',
    accountNumber: summary?.accountNumber || '',
    type: 'checking',
    balance: hasCurrencyValue(summary?.closingBalance) ? String(Number(summary.closingBalance)) : '',
  }
}

function buildSuggestedCardForm(summary) {
  return {
    name: summary?.suggestedCardName || [summary?.institutionName || 'Cartão', firstName(summary?.holderName)].filter(Boolean).join(' '),
    holderName: summary?.holderName || '',
    issuerBank: summary?.institutionName || '',
    flag: summary?.flag || '',
    closingDay: summary?.closingDay ? String(summary.closingDay) : '',
    dueDay: summary?.dueDay ? String(summary.dueDay) : '',
    currentInvoice: hasCurrencyValue(summary?.currentInvoice) ? String(Number(summary.currentInvoice)) : '',
    limit: '',
  }
}

function computeImportCompetencyMonth(row, { isInvoiceImport, isReceiptCardImport, selectedMonthKey, card }) {
  const rowMonth = String(row?.date || '').slice(0, 7)
  if (isInvoiceImport) return selectedMonthKey
  if (isReceiptCardImport) return computeCreditCardCompetencyMonth(row?.date, card) || rowMonth
  return rowMonth
}

function findMatchingAccountId(accounts, summary) {
  if (!Array.isArray(accounts) || !summary) return ''

  if (summary.accountNumber) {
    const byNumber = accounts.find((account) => normalize(account.accountNumber) === normalize(summary.accountNumber))
    if (byNumber) return byNumber.id
  }

  if (summary.suggestedAccountName) {
    const byName = accounts.find((account) => normalize(account.name) === normalize(summary.suggestedAccountName))
    if (byName) return byName.id
  }

  if (summary.institutionName && summary.holderName) {
    const byBankAndHolder = accounts.find((account) =>
      normalize(account.bank) === normalize(summary.institutionName)
      && normalize(account.holderName) === normalize(summary.holderName),
    )
    if (byBankAndHolder) return byBankAndHolder.id
  }

  return ''
}

function findMatchingCardId(cards, summary) {
  if (!Array.isArray(cards) || !summary) return ''

  if (summary.suggestedCardName) {
    const byName = cards.find((card) => normalize(card.name) === normalize(summary.suggestedCardName))
    if (byName) return byName.id
  }

  if (summary.institutionName && summary.holderName) {
    const byIssuerAndHolder = cards.find((card) =>
      normalize(card.issuerBank) === normalize(summary.institutionName)
      && normalize(card.holderName) === normalize(summary.holderName)
      && (!summary.flag || normalize(card.flag) === normalize(summary.flag))
    )
    if (byIssuerAndHolder) return byIssuerAndHolder.id
  }

  return ''
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Importacao() {
  const navigate                         = useNavigate()
  const [searchParams, setSearchParams]  = useSearchParams()
  const { user }                         = useAuth()
  const { selectedMonth, selectedYear }  = useFinance()
  const { activeWorkspaceId, myRole, permissions, transactionNatures } = useWorkspace()
  const { accounts, loading: loadingAccounts, update: updateAccount, add: addAccount } = useAccounts()
  const { cards: availableCards, add: addCard, update: updateCard } = useCards()
  const { categories } = useCategories()
  const selectedMonthKey = buildMonthKey(selectedYear, selectedMonth)
  const selectedMonthLabel = formatMonthLabel(selectedYear, selectedMonth)

  // ── State ────────────────────────────────────────────────────────────────

  const [step, setStep]                  = useState('idle')   // idle|parsing|preview|saving|done
  const [importMode, setImportMode]      = useState(searchParams.get('tipo') || '')
  const [parsedRows, setParsedRows]      = useState([])
  const [selectedIds, setSelectedIds]    = useState(new Set())
  const [accountId, setAccountId]        = useState('')
  const [cardId, setCardId]              = useState('')
  const [parseError, setParseError]      = useState(null)
  const [parsePreviewLines, setParsePreviewLines] = useState([])
  const [savedCount, setSavedCount]      = useState(0)
  const [skippedCount, setSkippedCount]  = useState(0)
  const [saveError, setSaveError]        = useState(null)
  const [dragOver, setDragOver]          = useState(false)
  const [fileName, setFileName]          = useState('')
  const [saveMessage, setSaveMessage]    = useState('')
  const [statementSummary, setStatementSummary] = useState(null)
  const [balanceAdjustmentRows, setBalanceAdjustmentRows] = useState([])
  const [balanceAuditEntries, setBalanceAuditEntries] = useState([])
  const [existingMonthTx, setExistingMonthTx] = useState([])
  const [duplicateAuditLoading, setDuplicateAuditLoading] = useState(false)
  const [importOnlyOpeningBalance, setImportOnlyOpeningBalance] = useState(false)
  const [balanceOnlyApplied, setBalanceOnlyApplied] = useState(false)
  const [suggestedAccountForm, setSuggestedAccountForm] = useState(buildSuggestedAccountForm(null))
  const [suggestedCardForm, setSuggestedCardForm] = useState(buildSuggestedCardForm(null))
  const [showCreateAccount, setShowCreateAccount] = useState(false)
  const [showCreateCard, setShowCreateCard] = useState(false)
  const [creatingTarget, setCreatingTarget] = useState(false)
  const [receiptPaymentMethod, setReceiptPaymentMethod] = useState('card')
  const [receiptDocumentType, setReceiptDocumentType] = useState('supermercado')
  const [cashOriginType, setCashOriginType] = useState('')
  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === accountId) || null,
    [accounts, accountId],
  )
  const selectedCard = useMemo(
    () => availableCards.find((card) => card.id === cardId) || null,
    [availableCards, cardId],
  )
  const aiWarnings = useMemo(
    () => [...new Set(
      parsedRows
        .map((row) => String(row?.aiWarningMessage || '').trim())
        .filter(Boolean),
    )],
    [parsedRows],
  )
  const isSavingImportRef = useRef(false)
  const isParsingImportRef = useRef(false)
  const importModeMeta = IMPORT_MODE_META[importMode] || null

  const isInvoiceImport = importMode === 'invoice'
  const isReceiptImport = importMode === 'receipt'
  const isReceiptCardImport = isReceiptImport && receiptPaymentMethod === 'card'
  const importUsesCard = isInvoiceImport || isReceiptCardImport
  const targetSelected = isReceiptImport
    ? (receiptPaymentMethod === 'card' ? !!cardId : receiptPaymentMethod === 'cash' ? !!cashOriginType : !!accountId)
    : (importUsesCard ? !!cardId : !!accountId)

  useEffect(() => {
    const queryMode = searchParams.get('tipo') || ''
    if (queryMode && IMPORT_MODE_META[queryMode]) {
      setImportMode(queryMode)
    }
  }, [searchParams])

  // ── File handling ─────────────────────────────────────────────────────────

  function handleSelectImportMode(mode) {
    setImportMode(mode)
    setSearchParams(mode ? { tipo: mode } : {})
    setParseError(null)
    setSaveError(null)
  }

  async function handleFile(file) {
    if (isParsingImportRef.current) return
    if (!importMode) {
      setParseError('Escolha primeiro qual fluxo deseja importar: extrato, fatura ou nota/cupom.')
      return
    }
    isParsingImportRef.current = true
    setParseError(null)
    setParsePreviewLines([])
    setSaveError(null)
    setSaveMessage('')
    setBalanceOnlyApplied(false)
    setImportOnlyOpeningBalance(false)
    setFileName(file.name)
    setAccountId('')
    setCardId('')
    setSuggestedAccountForm(buildSuggestedAccountForm(null))
    setSuggestedCardForm(buildSuggestedCardForm(null))
    setShowCreateAccount(false)
    setShowCreateCard(false)
    setBalanceAdjustmentRows([])
    setBalanceAuditEntries([])
    setStep('parsing')

    try {
      if (importMode === 'receipt') {
        console.log('[Importacao][receipt] parse start', {
          fileName: file.name,
          receiptDocumentType,
        })
      }
      const raw = await withTimeout(
        parseStatementFile(file),
        importMode === 'receipt' ? RECEIPT_PARSE_TIMEOUT_MS : 120000,
        importMode === 'receipt'
          ? 'A leitura do cupom demorou mais do que o esperado. Tente novamente com uma imagem mais nítida.'
          : 'A leitura do arquivo demorou mais do que o esperado.',
      )
      const parsedSummary = raw?.__summary || null
      const detectedMode = detectImportMode(raw, parsedSummary)
      const modeError = getImportModeError(importMode, detectedMode)
      if (modeError) {
        setParseError(modeError)
        setStatementSummary(null)
        setStep('idle')
        return
      }

      const hasImageRows = raw.some((row) => row.source === 'image_receipt')
      setReceiptPaymentMethod(hasImageRows && availableCards.length === 0 ? 'account' : 'card')
      const classifiedRows = ((importMode === 'receipt' || hasImageRows) ? raw : classifyBatch(raw)).map((row) => applyReceiptDocumentTypeContext({
        ...row,
        status: 'pending',
        classification: row.classification || { confidence: importMode === 'receipt' ? 'low' : 'medium', reason: `${importMode || 'import'}_import` },
      }, importMode === 'receipt' ? receiptDocumentType : ''))
      const handled = handleImport(classifiedRows, { statementSummary: parsedSummary })
      const summary = handled.summary || parsedSummary
      const classified = handled.rows.map((row, idx) => ({
        ...applyReceiptDocumentTypeContext(row, importMode === 'receipt' ? receiptDocumentType : ''),
        id: `r-${idx}`,
        receiptDocumentType: importMode === 'receipt' ? receiptDocumentType : null,
      }))
      const previewRows = importMode === 'receipt'
        ? expandReceiptImportRows(classified, categories, receiptDocumentType)
        : classified

      setStatementSummary(summary)
      setBalanceAdjustmentRows(handled.balanceAdjustments || [])
      setBalanceAuditEntries(handled.auditEntries || [])
      setSuggestedAccountForm(buildSuggestedAccountForm(summary))
      setSuggestedCardForm(buildSuggestedCardForm(summary))

      setParsedRows(previewRows)
      setSelectedIds(new Set(previewRows.map((r) => r.id)))   // all pre-selected
      setStep('preview')
      if (importMode === 'receipt') {
        console.log('[Importacao][receipt] parse finish', {
          receiptDocumentType,
          parsedRowsLength: previewRows.length,
          rows: previewRows.map((row) => ({
            id: row.id,
            description: row.description,
            receiptDocumentType: row.receiptDocumentType,
            categoryHints: row.categoryHints,
          })),
        })
      }
    } catch (err) {
      console.error('[Importacao] Parse error:', err)
      setStatementSummary(null)
      setBalanceAdjustmentRows([])
      setBalanceAuditEntries([])
      setParseError(err.message || 'Não foi possível processar o arquivo.')
      setParsePreviewLines(Array.isArray(err.previewLines) ? err.previewLines : [])
      setStep('idle')
    } finally {
      isParsingImportRef.current = false
      if (importMode === 'receipt') {
        console.log('[Importacao][receipt] parsing finally', {
          importMode,
          receiptDocumentType,
          receiptPaymentMethod,
          accountId,
          cardId,
          lockReleased: !isParsingImportRef.current,
        })
      }
    }
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  function handleFileInput(e) {
    const file = e.target.files[0]
    if (file) handleFile(file)
    // reset input so the same file can be re-selected after cancel
    e.target.value = ''
  }

  function handleReset() {
    isSavingImportRef.current = false
    isParsingImportRef.current = false
    setStep('idle')
    setParsedRows([])
    setSelectedIds(new Set())
    setAccountId('')
    setCardId('')
    setParseError(null)
    setParsePreviewLines([])
    setSavedCount(0)
    setSkippedCount(0)
    setSaveError(null)
    setSaveMessage('')
    setFileName('')
    setStatementSummary(null)
    setBalanceAdjustmentRows([])
    setBalanceAuditEntries([])
    setExistingMonthTx([])
    setImportOnlyOpeningBalance(false)
    setBalanceOnlyApplied(false)
    setSuggestedAccountForm(buildSuggestedAccountForm(null))
    setSuggestedCardForm(buildSuggestedCardForm(null))
    setShowCreateAccount(false)
    setShowCreateCard(false)
    setCreatingTarget(false)
    setReceiptPaymentMethod('card')
    setReceiptDocumentType('supermercado')
    setCashOriginType('')
    setDragOver(false)
    setImportMode('')
    setSearchParams({})
  }

  // ── Row selection ─────────────────────────────────────────────────────────

  function toggleRow(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function handleSuggestedAccountChange(event) {
    setSuggestedAccountForm((current) => ({ ...current, [event.target.name]: event.target.value }))
  }

  function handleSuggestedCardChange(event) {
    setSuggestedCardForm((current) => ({ ...current, [event.target.name]: event.target.value }))
  }

  async function handleCreateSuggestedAccount() {
    if (!suggestedAccountForm.name.trim()) {
      setSaveError('Informe um nome para criar a conta.')
      return
    }

    setCreatingTarget(true)
    setSaveError(null)
    try {
      const newId = await addAccount({
        name: suggestedAccountForm.name.trim(),
        bank: suggestedAccountForm.bank.trim(),
        holderName: suggestedAccountForm.holderName.trim(),
        branchNumber: suggestedAccountForm.branchNumber.trim(),
        accountNumber: suggestedAccountForm.accountNumber.trim(),
        type: suggestedAccountForm.type || 'checking',
        balance: suggestedAccountForm.balance || statementSummary?.closingBalance || 0,
      })
      setAccountId(newId)
      setShowCreateAccount(false)
    } catch (err) {
      setSaveError(err.message || 'Não foi possível criar a conta.')
    } finally {
      setCreatingTarget(false)
    }
  }

  async function handleCreateSuggestedCard() {
    if (!suggestedCardForm.name.trim()) {
      setSaveError('Informe um nome para criar o cartão.')
      return
    }

    setCreatingTarget(true)
    setSaveError(null)
    try {
      const newId = await addCard({
        name: suggestedCardForm.name.trim(),
        holderName: suggestedCardForm.holderName.trim(),
        issuerBank: suggestedCardForm.issuerBank.trim(),
        flag: suggestedCardForm.flag,
        closingDay: suggestedCardForm.closingDay || 0,
        dueDay: suggestedCardForm.dueDay || 0,
        currentInvoice: suggestedCardForm.currentInvoice || statementSummary?.currentInvoice || statementSummary?.netMovement || 0,
        usedLimit: suggestedCardForm.currentInvoice || statementSummary?.currentInvoice || statementSummary?.netMovement || 0,
        limit: suggestedCardForm.limit || 0,
        lastInvoiceImportedAt: new Date().toISOString(),
        lastInvoiceFileName: fileName || '',
      })
      setCardId(newId)
      setShowCreateCard(false)
    } catch (err) {
      setSaveError(err.message || 'Não foi possível criar o cartão.')
    } finally {
      setCreatingTarget(false)
    }
  }

  // ── Confirm & save ────────────────────────────────────────────────────────

  async function handleConfirmImport() {
    if (isSavingImportRef.current) return
    if (!user?.uid) return
    const isCreditAccountImport = !isReceiptImport && !importUsesCard && selectedAccount?.type === 'credit'
    const receiptOriginAccountId = receiptPaymentMethod === 'cash' ? null : accountId
    const canSaveBalanceOnly = !isInvoiceImport
      && !isReceiptImport
      && importOnlyOpeningBalance
      && hasCurrencyValue(statementSummary?.closingBalance)
    if (!permissions.canImport) {
      setSaveError('Seu papel atual não permite importação neste workspace.')
      return
    }
    if (importUsesCard ? !cardId : !accountId) {
      setSaveError(importUsesCard
        ? 'Selecione o cartao/fatura antes de continuar.'
        : 'Selecione uma conta antes de continuar.')
      return
    }

    // Log para depuração
    console.log('[Importacao] Itens a salvar:', parsedRows)
    if (isReceiptImport) {
      console.log('[Importacao][receipt] before save', {
        importMode,
        receiptPaymentMethod,
        accountId,
        cardId,
        cashOriginType,
        targetSelected,
        saveDisabledReason: null,
        selectedSize: selectedIds.size,
      })
    }
    isSavingImportRef.current = true

    setSaveError(null)
    setSaveMessage('')
    setBalanceOnlyApplied(false)
    setStep('saving')

    const statementSnapshotPayload = !isInvoiceImport && accountId && statementSummary?.hasBalanceInfo
      ? {
          lastStatementOpeningBalance: hasCurrencyValue(statementSummary.openingBalance) ? Number(statementSummary.openingBalance) : null,
          lastStatementClosingBalance: hasCurrencyValue(statementSummary.closingBalance) ? Number(statementSummary.closingBalance) : null,
          lastStatementNetMovement: Number(statementSummary.netMovement || 0),
          lastStatementImportedAt: new Date().toISOString(),
          lastStatementFileName: fileName || '',
          ...(hasCurrencyValue(statementSummary?.closingBalance)
            ? {
                current_balance: Number(statementSummary.closingBalance),
                balance: Number(statementSummary.closingBalance),
              }
            : {}),
          ...(balanceAuditEntries.length > 0
            ? { adjustmentAuditEntries: balanceAuditEntries }
            : {}),
          ...(selectedAccount?.bank ? {} : (statementSummary?.institutionName ? { bank: statementSummary.institutionName } : {})),
          ...(selectedAccount?.holderName ? {} : (statementSummary?.holderName ? { holderName: statementSummary.holderName } : {})),
          ...(selectedAccount?.branchNumber ? {} : (statementSummary?.branchNumber ? { branchNumber: statementSummary.branchNumber } : {})),
          ...(selectedAccount?.accountNumber ? {} : (statementSummary?.accountNumber ? { accountNumber: statementSummary.accountNumber } : {})),
        }
      : null
    const invoiceSnapshotPayload = isInvoiceImport && cardId
      ? {
          currentInvoice: hasCurrencyValue(statementSummary?.currentInvoice)
            ? Number(statementSummary.currentInvoice)
            : Number(statementSummary?.netMovement || 0),
          usedLimit: hasCurrencyValue(statementSummary?.currentInvoice)
            ? Number(statementSummary.currentInvoice)
            : Number(statementSummary?.netMovement || 0),
          lastInvoiceImportedAt: new Date().toISOString(),
          lastInvoiceFileName: fileName || '',
          ...(selectedCard?.issuerBank ? {} : (statementSummary?.institutionName ? { issuerBank: statementSummary.institutionName } : {})),
          ...(selectedCard?.holderName ? {} : (statementSummary?.holderName ? { holderName: statementSummary.holderName } : {})),
          ...(selectedCard?.flag ? {} : (statementSummary?.flag ? { flag: statementSummary.flag } : {})),
          ...(selectedCard?.closingDay ? {} : (statementSummary?.closingDay ? { closingDay: statementSummary.closingDay } : {})),
          ...(selectedCard?.dueDay ? {} : (statementSummary?.dueDay ? { dueDay: statementSummary.dueDay } : {})),
        }
      : null

    if (canSaveBalanceOnly) {
      try {
        const closingBalance = Number(statementSummary.closingBalance)
        const monthlyOpeningBalances = selectedAccount?.monthlyOpeningBalances
          && typeof selectedAccount.monthlyOpeningBalances === 'object'
          ? selectedAccount.monthlyOpeningBalances
          : {}
        const payload = {
          monthlyOpeningBalances: {
            ...monthlyOpeningBalances,
            [selectedMonthKey]: closingBalance,
          },
          monthlyOpeningBalanceMonth: selectedMonthKey,
          current_balance: closingBalance,
          balance: closingBalance,
          ...(statementSnapshotPayload || {}),
        }

        if (!hasCurrencyValue(selectedAccount?.initialBalance)) {
          payload.initialBalance = closingBalance
        }
        if (!hasCurrencyValue(selectedAccount?.balance)) {
          payload.balance = closingBalance
        }

        await updateAccount(accountId, payload)
        setSavedCount(0)
        setSkippedCount(0)
        setBalanceOnlyApplied(true)
        setSaveMessage(`Saldo inicial de ${selectedMonthLabel} configurado com ${formatCurrency(closingBalance)}.`)
        setStep('done')
      } catch (err) {
        console.error('[Importacao] Could not persist opening balance:', err.message)
        setSaveError(err.message || 'Nao foi possivel registrar o saldo inicial deste mes.')
        setStep('done')
      } finally {
        isSavingImportRef.current = false
      }
      return
    }

    const toSave = parsedRows.filter((r) => selectedIds.has(r.id))
    if (toSave.length === 0) {
      if (!isInvoiceImport && !isReceiptImport && statementSnapshotPayload) {
        try {
          await updateAccount(accountId, statementSnapshotPayload)
          setSavedCount(0)
          setSkippedCount(balanceAdjustmentRows.length)
          setBalanceOnlyApplied(true)
          setSaveMessage(balanceAdjustmentRows.length > 0
            ? `Saldo atual vinculado a conta e ${balanceAdjustmentRows.length} ajuste(s) de saldo foram ignorados na lista de despesas.`
            : 'Saldo atual vinculado a conta com sucesso.')
          setStep('done')
        } catch (err) {
          console.error('[Importacao] Could not persist balance snapshot:', err.message)
          setSaveError(err.message || 'Nao foi possivel atualizar o saldo atual desta conta.')
          setStep('done')
        } finally {
          isSavingImportRef.current = false
        }
        return
      }
      setSaveError('Selecione ao menos um lancamento para salvar.')
      setStep('preview')
      isSavingImportRef.current = false
      return
    }
    const batchId = Date.now().toString(36)
    let count = 0
    let reconciledCount = 0
    let skipped = 0
    const failed = []
    let accountSummaryError = null

    try {
      const monthKeys = [...new Set(
        toSave
          .map((row) => computeImportCompetencyMonth(row, {
            isInvoiceImport,
            isReceiptCardImport,
            selectedMonthKey,
            card: selectedCard,
          }))
          .filter(Boolean),
      )]

      const existingByMonth = await Promise.all(
        monthKeys.map((monthKey) => {
          const [year, month] = monthKey.split('-').map(Number)
          return fetchTransactions(user.uid, year, month, {
            workspaceId: activeWorkspaceId,
            viewerRole: myRole,
            viewerUid: user.uid,
          })
        }),
      )

      const existingTransactions = existingByMonth.flat()
      const duplicateOptions = importUsesCard
        ? { cardIdOverride: cardId }
        : { accountIdOverride: accountId }
      const knownSignatures = new Set(
        existingTransactions.map((tx) => buildDuplicateSignature(tx)),
      )
      const reconciledIds = new Set()
      const savedReceiptItemKeys = new Set()

      for (const row of toSave) {
        const rowAudit = duplicateMapByRowId[row.id]
        const resolvedCompetencyMonth = computeImportCompetencyMonth(row, {
          isInvoiceImport,
          isReceiptCardImport,
          selectedMonthKey,
          card: selectedCard,
        })
        const signature = buildDuplicateSignature(row, duplicateOptions)
        const hintedCategory = findCategoryByHints(categories, row.type, row.categoryHints)
        if (rowAudit?.exact) {
          skipped++
          continue
        }
        if (knownSignatures.has(signature)) {
          skipped++
          continue
        }

        try {
          const receiptItems = hydrateImportedReceiptItems(row.receiptItems, categories, row.receiptDocumentType || receiptDocumentType)
          const transactionNatureId = row.transactionNatureId || (row.type === 'income'
            ? 'nature_income'
            : row.type === 'investment'
              ? 'nature_investment'
              : row.type === 'transfer_internal'
                ? 'nature_internal_transfer'
                : 'nature_expense')
          const recurringSeed = importUsesCard
            ? buildCardCommitmentRecurringFields(row.description, resolvedCompetencyMonth)
            : null
          const receiptInvoiceMatch = isInvoiceImport
            ? findReceiptInvoiceReconciliationCandidate(
                row,
                existingTransactions.filter((tx) => !reconciledIds.has(tx.id)),
                { cardIdOverride: cardId },
              )
            : null
          if (receiptInvoiceMatch?.transaction) {
            const matchedTx = receiptInvoiceMatch.transaction
            await updateTransaction(user.uid, matchedTx.id, {
              paymentMethod: 'credit_card',
              cardId: cardId || null,
              cardName: selectedCard?.name || null,
              accountId: null,
              competencyMonth: resolvedCompetencyMonth,
              balanceImpact: typeof row.balanceImpact === 'boolean' ? row.balanceImpact : false,
              affectsBudget: typeof row.affectsBudget === 'boolean' ? row.affectsBudget : true,
              status: 'pending',
              reconciledWithInvoice: true,
              reconciledAt: new Date().toISOString(),
              reconciledImportBatchId: batchId,
              reconciledInvoiceDate: row.date,
              reconciledInvoiceDescription: row.description,
              reconciledInvoiceAmount: Number(row.amount || 0),
              recurring: recurringSeed?.recurring || matchedTx.recurring || false,
              recurrenceType: recurringSeed?.recurrenceType || matchedTx.recurrenceType || null,
              recurringStartDate: recurringSeed?.recurringStartDate || matchedTx.recurringStartDate || null,
              recurringEndDate: recurringSeed?.recurringEndDate || matchedTx.recurringEndDate || null,
              totalInstallments: recurringSeed?.totalInstallments ?? matchedTx.totalInstallments ?? null,
              currentInstallment: recurringSeed?.currentInstallment ?? matchedTx.currentInstallment ?? null,
              installmentNumber: recurringSeed?.installmentNumber ?? matchedTx.installmentNumber ?? null,
              ...(typeof row.affectsBudget === 'boolean' ? { affectsBudget: row.affectsBudget } : {}),
              ...(typeof row.balanceImpact === 'boolean' ? { balanceImpact: row.balanceImpact } : {}),
              ...(matchedTx.categoryId ? {} : {
                categoryId: hintedCategory?.id || null,
                categoryName: hintedCategory?.name || row.categoryName || null,
              }),
            }, { workspaceId: activeWorkspaceId })
            reconciledIds.add(matchedTx.id)
            reconciledCount += 1
            continue
          }
          if (row.source === 'image_receipt_item') {
            const receiptItemKey = `${row.id}::${row.description || 'item'}::${row.amount || ''}`
            if (savedReceiptItemKeys.has(receiptItemKey)) continue
            savedReceiptItemKeys.add(receiptItemKey)
          }
          await addTransaction(user.uid, {
            type:                     row.type,
            description:              row.description,
            amount:                   row.amount,
            date:                     row.date,
            competencyMonth:          resolvedCompetencyMonth,
            accountId:                importUsesCard ? null : (isReceiptImport ? receiptOriginAccountId : accountId),
            cardId:                   importUsesCard ? (cardId || null) : null,
            cardName:                 importUsesCard ? (selectedCard?.name || null) : null,
            categoryId:               hintedCategory?.id || null,
            categoryName:             hintedCategory?.name || row.categoryName || null,
            notes:                    '',
            paymentMethod:            isReceiptImport
              ? (receiptPaymentMethod === 'card' ? 'credit_card' : receiptPaymentMethod === 'cash' ? 'cash' : 'debit_card')
              : (row.paymentMethod || (importUsesCard || isCreditAccountImport ? 'credit_card' : null)),
            origin:                   isReceiptImportSource(row.source) ? 'manual' : (isInvoiceImport ? 'credit_card_import' : 'bank_import'),
            status:                   'pending',
            workspaceId:              activeWorkspaceId,
            createdBy:                user.uid,
            userId:                   user.uid,
            transactionNatureId,
            transactionNatureLabel:   transactionNatures.find((n) => n.id === transactionNatureId)?.label || null,
            affectsBudget:            typeof row.affectsBudget === 'boolean' ? row.affectsBudget : true,
            balanceImpact:            typeof row.balanceImpact === 'boolean' ? row.balanceImpact : (importUsesCard || isCreditAccountImport ? false : row.type !== 'transfer_internal'),
            importBatchId:            batchId,
            classificationConfidence: row.classification?.confidence ?? 'low',
            receiptDocumentType:      importMode === 'receipt' ? (row.receiptDocumentType || receiptDocumentType) : null,
            receiptPaymentMethod:     isReceiptImport ? receiptPaymentMethod : null,
            cashOriginType:           isReceiptImport && receiptPaymentMethod === 'cash' ? cashOriginType : null,
            receiptDetailEnabled:     row.receiptDetailEnabled && receiptItems.length > 0,
            receiptItems,
            recurring:                recurringSeed?.recurring || false,
            recurrenceType:           recurringSeed?.recurrenceType || null,
            recurringStartDate:       recurringSeed?.recurringStartDate || null,
            recurringEndDate:         recurringSeed?.recurringEndDate || null,
            totalInstallments:        recurringSeed?.totalInstallments ?? null,
            currentInstallment:       recurringSeed?.currentInstallment ?? null,
            installmentNumber:        recurringSeed?.installmentNumber ?? null,
          }, { workspaceId: activeWorkspaceId })
          knownSignatures.add(signature)
          count++
          if (isReceiptImport) {
            console.log('[Importacao][receipt] saved row', {
              description: row.description,
              amount: row.amount,
              accountId: importUsesCard ? null : receiptOriginAccountId,
              cardId: importUsesCard ? (cardId || null) : null,
              cashOriginType,
              receiptPaymentMethod,
              status: 'pending',
              receiptDocumentType: row.receiptDocumentType || receiptDocumentType,
            })
          }
        } catch (err) {
          console.error('[Importacao] Save failed for:', row.description, err.message)
          failed.push(row.description)
        }
      }

      if (!isInvoiceImport && !isReceiptImport && statementSnapshotPayload) {
        try {
          await updateAccount(accountId, statementSnapshotPayload)
        } catch (err) {
          console.error('[Importacao] Could not persist balance snapshot after import:', err.message)
          accountSummaryError = err.message || 'Nao foi possivel atualizar o saldo atual desta conta.'
        }
      }

      if (isInvoiceImport && invoiceSnapshotPayload) {
        try {
          await updateCard(cardId, invoiceSnapshotPayload)
        } catch (err) {
          console.error('[Importacao] Could not persist invoice snapshot after import:', err.message)
          accountSummaryError = err.message || 'Nao foi possivel atualizar os dados da fatura/cartao.'
        }
      }

      setSavedCount(count)
      setSkippedCount(skipped)
      setSaveMessage(reconciledCount > 0
        ? `${count} lancamento(s) enviados para Lançar e ${reconciledCount} compra(s) conciliada(s) com a fatura.`
        : `${count} lancamento(s) enviados para Lançar com sucesso.`)
      setSaveError(accountSummaryError)
      setStep('done')
    } catch (err) {
      console.error('[Importacao] Import save failed:', err)
      setSaveError(err.message || 'Nao foi possivel concluir a importacao.')
      setStep('done')
    } finally {
      isSavingImportRef.current = false
      if (isReceiptImport) {
        console.log('[Importacao][receipt] saving finally', {
          importMode,
          receiptPaymentMethod,
          accountId,
          cardId,
          targetSelected,
          selectedSize: selectedIds.size,
          lockReleased: !isSavingImportRef.current,
        })
      }
    }
  }

  useEffect(() => {
    let cancelled = false

    async function loadExistingTransactions() {
      if (step !== 'preview' || !user?.uid || parsedRows.length === 0) {
        setExistingMonthTx([])
        return
      }

      setDuplicateAuditLoading(true)
      try {
        const isReceiptImport = importMode === 'receipt'
        const isReceiptCardImport = isReceiptImport && receiptPaymentMethod === 'card'
        const monthKeys = [...new Set(
          parsedRows
            .map((row) => computeImportCompetencyMonth(row, {
              isInvoiceImport: statementSummary?.kind === 'invoice',
              isReceiptCardImport,
              selectedMonthKey,
              card: selectedCard,
            }))
            .filter(Boolean),
        )]

        const existingByMonth = await Promise.all(
          monthKeys.map((monthKey) => {
            const [year, month] = monthKey.split('-').map(Number)
            return fetchTransactions(user.uid, year, month, {
              workspaceId: activeWorkspaceId,
              viewerRole: myRole,
              viewerUid: user.uid,
            })
          }),
        )

        if (!cancelled) {
          setExistingMonthTx(existingByMonth.flat())
        }
      } catch (err) {
        console.error('[Importacao] Duplicate audit error:', err.message)
      } finally {
        if (!cancelled) setDuplicateAuditLoading(false)
      }
    }

    loadExistingTransactions()
    return () => { cancelled = true }
  }, [step, user?.uid, parsedRows, importMode, selectedMonthKey, activeWorkspaceId, myRole, receiptPaymentMethod, selectedCard])

  const canImportOpeningBalanceOnly = !isInvoiceImport && !isReceiptImport && hasCurrencyValue(statementSummary?.closingBalance)
  const matchedAccountId = useMemo(
    () => findMatchingAccountId(accounts, statementSummary),
    [accounts, statementSummary],
  )
  const matchedCardId = useMemo(
    () => findMatchingCardId(availableCards, statementSummary),
    [availableCards, statementSummary],
  )

  useEffect(() => {
    if (step !== 'preview' || !canImportOpeningBalanceOnly) {
      setImportOnlyOpeningBalance(false)
      return
    }

    const rowMonths = [...new Set(
      parsedRows
        .map((row) => row.date?.slice(0, 7))
        .filter(Boolean),
    )]
    const shouldSuggestBalanceOnly = rowMonths.length > 0
      && rowMonths.every((monthKey) => monthKey < selectedMonthKey)

    setImportOnlyOpeningBalance(shouldSuggestBalanceOnly)
  }, [step, canImportOpeningBalanceOnly, parsedRows, selectedMonthKey])

  useEffect(() => {
    if (step !== 'preview') return

    if (importUsesCard) {
      if (!cardId && matchedCardId) {
        setCardId(matchedCardId)
      } else if (!cardId && availableCards.length === 1) {
        setCardId(availableCards[0].id)
      }
      setShowCreateCard(isInvoiceImport && !matchedCardId)
      return
    }

    if (!accountId && matchedAccountId) {
      setAccountId(matchedAccountId)
    } else if (!accountId && accounts.length === 1) {
      setAccountId(accounts[0].id)
    }
    setShowCreateAccount(!isReceiptImport && !matchedAccountId)
  }, [step, importUsesCard, isInvoiceImport, isReceiptImport, accountId, cardId, accounts, availableCards, matchedAccountId, matchedCardId])

  const duplicateMapByRowId = useMemo(() => {
    if (!targetSelected || existingMonthTx.length === 0) return {}
    const map = {}
    parsedRows.forEach((row) => {
      const matches = findDuplicateMatches(row, existingMonthTx, importUsesCard
        ? { cardIdOverride: cardId }
        : { accountIdOverride: accountId })
      map[row.id] = {
        exact: matches.isExactDuplicate,
        possible: !matches.isExactDuplicate && matches.hasPossibleDuplicate,
        exactCount: matches.exact.length,
        possibleCount: matches.possible.length,
      }
    })
    return map
  }, [parsedRows, existingMonthTx, targetSelected, importUsesCard, accountId, cardId])

  useEffect(() => {
    if (!targetSelected) return
    setSelectedIds((prev) => {
      const next = new Set(prev)
      parsedRows.forEach((row) => {
        if (duplicateMapByRowId[row.id]?.exact) next.delete(row.id)
      })
      return next
    })
  }, [targetSelected, parsedRows, duplicateMapByRowId])

  // ── Derived values ────────────────────────────────────────────────────────

  const reviewCount   = parsedRows.filter((r) => r.status === 'pending').length
  const selectedCount = selectedIds.size
  const exactDupCount = parsedRows.filter((r) => duplicateMapByRowId[r.id]?.exact).length
  const possibleDupCount = parsedRows.filter((r) => duplicateMapByRowId[r.id]?.possible).length
  const selectedNonExactCount = parsedRows.filter((r) => selectedIds.has(r.id) && !duplicateMapByRowId[r.id]?.exact).length
  const selectedExpenseCount = parsedRows.filter((r) => selectedIds.has(r.id) && !duplicateMapByRowId[r.id]?.exact && r.type === 'expense').length
  const selectedControlCount = parsedRows.filter((r) => selectedIds.has(r.id) && !duplicateMapByRowId[r.id]?.exact && r.type !== 'expense').length
  const openingBalanceOnlySelected = canImportOpeningBalanceOnly && importOnlyOpeningBalance
  const netSelected   = parsedRows
    .filter((r) => selectedIds.has(r.id))
    .reduce((sum, r) => sum + (r.direction === 'credit' ? r.amount : -r.amount), 0)
  const saveDisabledReason = !targetSelected
    ? (isInvoiceImport
      ? 'Selecione ou crie o cartão da fatura para liberar o envio para Lançar.'
      : isReceiptImport
        ? 'Selecione a origem do pagamento do cupom para liberar o envio para Lançar.'
        : 'Selecione ou crie a conta do extrato para liberar o envio para Lançar.')
    : !openingBalanceOnlySelected
      && selectedNonExactCount === 0
      && !(balanceAdjustmentRows.length > 0 && hasCurrencyValue(statementSummary?.closingBalance))
      ? 'Nao ha lancamentos novos selecionados para enviar para Lançar.'
      : ''

  useEffect(() => {
    if (!isReceiptImport) return
    console.log('[Importacao][receipt] state', {
      importMode,
      receiptPaymentMethod,
      accountId,
      cardId,
      targetSelected,
      saveDisabledReason,
      selectedSize: selectedIds.size,
      receiptDocumentType,
      cashOriginType,
      step,
    })
  }, [isReceiptImport, importMode, receiptPaymentMethod, accountId, cardId, targetSelected, saveDisabledReason, selectedIds, receiptDocumentType, cashOriginType, step])

  // ── Step renders ──────────────────────────────────────────────────────────

  function renderIdle() {
    return (
      <>
        {parseError && (
          <div className="parse-error-box">
            <strong>Erro ao ler arquivo:</strong>
            <p>{parseError}</p>
            {parsePreviewLines.length > 0 && (
              <>
                <p className="parse-error-note">PDF lido, mas o layout ainda não foi reconhecido com segurança.</p>
                <div className="parse-preview-box">
                  <strong>Prévia do texto extraído</strong>
                  <pre>{parsePreviewLines.join('\n')}</pre>
                </div>
              </>
            )}
          </div>
        )}

        {!importMode && (
          <Card>
            <CardHeader title="Escolha o tipo de importação" subtitle="Cada fluxo usa validações e revisão próprias antes de enviar itens para Lançar." />
            <div className="import-mode-grid">
              {Object.entries(IMPORT_MODE_META).map(([mode, meta]) => (
                <button
                  key={mode}
                  type="button"
                  className="import-mode-card"
                  onClick={() => handleSelectImportMode(mode)}
                >
                  <span className="import-mode-icon">{meta.icon}</span>
                  <strong>{meta.title}</strong>
                  <span>{meta.subtitle}</span>
                </button>
              ))}
            </div>
          </Card>
        )}

        {importMode && (
          <div className="import-mode-header">
            <div>
              <span className="import-mode-kicker">Fluxo selecionado</span>
              <h2>{importModeMeta.title}</h2>
              <p>{importModeMeta.subtitle}</p>
            </div>
            <button type="button" className="btn-secondary" onClick={handleReset}>Trocar fluxo</button>
          </div>
        )}

        {importMode === 'receipt' && (
          <div className="account-select-row">
            <label className="account-select-label">Tipo da nota/cupom</label>
            <select
              className="account-select"
              value={receiptDocumentType}
              onChange={(e) => setReceiptDocumentType(e.target.value)}
            >
              {RECEIPT_DOCUMENT_TYPES.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <p className="import-target-hint">Esse tipo ajuda a organizar a revisão do cupom sem alterar o OCR.</p>
          </div>
        )}

        {importMode && (
          <div
            className={`dropzone${dragOver ? ' dragover' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <span className="dropzone-icon">{importModeMeta.icon}</span>
            <p className="dropzone-title">{importModeMeta.title}</p>
            <p className="dropzone-sub">{importModeMeta.fileHint}</p>
            <label className="dropzone-btn">
              {importModeMeta.selectLabel}
              <input
                type="file"
                accept={importModeMeta.accept}
                style={{ display: 'none' }}
                onChange={handleFileInput}
              />
            </label>
          </div>
        )}

        <Card>
          <CardHeader title="Como funciona" />
          <div className="how-list">
            <div className="how-item">
              <span className="how-icon">🏦</span>
              <div>
                <strong>Extrato bancário (OFX)</strong>
                <p>Selecione a conta antes de salvar. Tudo entra em Lançar como pendente para revisão.</p>
              </div>
            </div>
            <div className="how-item">
              <span className="how-icon">💳</span>
              <div>
                <strong>Fatura de cartão</strong>
                <p>Selecione o cartão antes de salvar. As compras respeitam a competência e vão primeiro para Lançar.</p>
              </div>
            </div>
            <div className="how-item">
              <span className="how-icon">🧾</span>
              <div>
                <strong>Nota/cupom OCR</strong>
                <p>Escolha o tipo da nota, a forma de pagamento e revise item por item antes de enviar para Lançar.</p>
              </div>
            </div>
            <div className="how-item">
              <span className="how-icon">🔍</span>
              <div>
                <strong>Revisão antes de salvar</strong>
                <p>Nenhuma importação cai direto em Lançamentos. Primeiro tudo fica pendente em Lançar.</p>
              </div>
            </div>
          </div>
        </Card>
      </>
    )
  }

  function renderParsing() {
    return (
      <div className="import-loading">
        <div className="import-spinner" />
        <p>Lendo <strong>{fileName}</strong>…</p>
      </div>
    )
  }

  function renderPreview() {
    return (
      <>
        {aiWarnings.length > 0 && (
          <div className="parse-warning-box">
            <strong>Scanner inteligente:</strong>
            {aiWarnings.map((warning) => <p key={warning}>{warning}</p>)}
          </div>
        )}
        {/* Top summary */}
        <div className="preview-summary-bar">
          <div className="psb-info">
            <span className="psb-file">{fileName}</span>
            <span className="psb-meta">
              {parsedRows.length} {importMode === 'receipt' ? 'itens' : 'transações'}
              {reviewCount > 0 && (
                <span className="badge badge-warn"> · {reviewCount} para revisar</span>
              )}
              {targetSelected && exactDupCount > 0 && (
                <span className="badge badge-danger"> · {exactDupCount} duplicadas</span>
              )}
              {targetSelected && possibleDupCount > 0 && (
                <span className="badge badge-info"> · {possibleDupCount} possivelmente duplicadas</span>
              )}
            </span>
          </div>
          <span className={`psb-net ${netSelected >= 0 ? 'pos' : 'neg'}`}>
            {netSelected >= 0 ? '+' : ''}{formatCurrency(Math.abs(netSelected))}
          </span>
        </div>

        {saveError && (
          <div className="parse-error-box import-inline-error">
            <strong>Importacao:</strong>
            <p>{saveError}</p>
          </div>
        )}

        {statementSummary?.hasBalanceInfo && (
          <Card className="statement-balance-card">
            <CardHeader
              title={isInvoiceImport ? 'Resumo da fatura' : 'Resumo do extrato'}
              subtitle={statementSummary.openingInferred || statementSummary.closingInferred
                ? 'Valores estimados a partir do arquivo importado'
                : 'Valores lidos do proprio arquivo'}
            />
            <div className="statement-balance-grid">
              <div className="statement-balance-item">
                <span className="statement-balance-label">
                  {statementSummary.openingInferred ? 'Saldo anterior (estimado)' : 'Saldo anterior'}
                </span>
                <strong>{formatCurrency(Number(statementSummary.openingBalance || 0))}</strong>
              </div>
              <div className="statement-balance-item">
                <span className="statement-balance-label">
                  {statementSummary.closingInferred ? 'Saldo atual (estimado)' : 'Saldo atual'}
                </span>
                <strong>{formatCurrency(Number(statementSummary.closingBalance || 0))}</strong>
              </div>
              <div className="statement-balance-item">
                <span className="statement-balance-label">Movimento do periodo</span>
                <strong className={statementSummary.netMovement >= 0 ? 'balance-pos' : 'balance-neg'}>
                  {statementSummary.netMovement >= 0 ? '+' : ''}{formatCurrency(Math.abs(Number(statementSummary.netMovement || 0)))}
                </strong>
              </div>
            </div>
          </Card>
        )}

        {balanceAdjustmentRows.length > 0 && (
          <Card>
            <CardHeader
              title="Ajustes de saldo detectados"
              subtitle={`${balanceAdjustmentRows.length} linha(s) foram separadas para atualizar apenas o saldo da conta.`}
            />
            <p className="import-target-hint">
              Esses valores nao entrarao na lista de despesas nem nos graficos do mes.
            </p>
          </Card>
        )}

        {(balanceAdjustmentRows.length > 0 || selectedNonExactCount > 0) && (
          <Card>
            <CardHeader
              title="Resultado da importacao"
              subtitle="Resumo do que sera usado para saldo e do que vira lancamento."
            />
            <div className="statement-balance-grid">
              <div className="statement-balance-item">
                <span className="statement-balance-label">Convertidos em saldo</span>
                <strong>{balanceAdjustmentRows.length}</strong>
              </div>
              <div className="statement-balance-item">
                <span className="statement-balance-label">Lancamentos de despesa</span>
                <strong>{selectedExpenseCount}</strong>
              </div>
              <div className="statement-balance-item">
                <span className="statement-balance-label">Lancamentos de controle</span>
                <strong>{selectedControlCount}</strong>
              </div>
            </div>
          </Card>
        )}

        {/* Payment selector */}
        {isReceiptImport && (
          <div className="account-select-row">
            <label className="account-select-label">Forma de pagamento</label>
            <select
              className="account-select"
              value={receiptPaymentMethod}
              onChange={(e) => setReceiptPaymentMethod(e.target.value)}
            >
              {RECEIPT_PAYMENT_METHODS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <p className="import-target-hint">Escolha como a nota foi paga. Isso não altera o tipo da nota/cupom.</p>
          </div>
        )}
        {importUsesCard && (
          <>
            <div className="account-select-row">
              <label className="account-select-label">{isInvoiceImport ? 'Cartão da fatura' : 'Cartão usado no pagamento'}</label>
              <select
                className="account-select"
                value={cardId}
                onChange={(e) => setCardId(e.target.value)}
              >
                <option value="">Selecione um cartao...</option>
                {availableCards.map((card) => (
                  <option key={card.id} value={card.id}>{cardLabel(card)}</option>
                ))}
              </select>
              <p className="import-target-hint">
                {isInvoiceImport
                  ? 'Escolha o cartao correto para que a fatura entre em Lançar sem afetar o saldo da conta.'
                  : 'Selecione o cartão usado no pagamento para vincular corretamente os itens importados do cupom.'}
              </p>
            </div>

            <div className="import-create-inline">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowCreateCard((current) => !current)}
              >
                {showCreateCard
                  ? 'Fechar criacao de cartao'
                  : (isInvoiceImport ? 'Criar novo cartao a partir desta fatura' : 'Criar cartao para este cupom')}
              </button>

              {showCreateCard && (
                <div className="import-create-card">
                  <div className="import-create-grid">
                    <div className="form-group">
                      <label>Nome do cartao</label>
                      <input name="name" value={suggestedCardForm.name} onChange={handleSuggestedCardChange} placeholder="Ex: Nubank Mastercard Marcio" />
                    </div>
                    <div className="form-group">
                      <label>Titular</label>
                      <input name="holderName" value={suggestedCardForm.holderName} onChange={handleSuggestedCardChange} placeholder="Ex: Marcio Martins" />
                    </div>
                    <div className="form-group">
                      <label>Banco / emissor</label>
                      <input name="issuerBank" value={suggestedCardForm.issuerBank} onChange={handleSuggestedCardChange} placeholder="Ex: Nubank" />
                    </div>
                    <div className="form-group">
                      <label>Bandeira</label>
                      <input name="flag" value={suggestedCardForm.flag} onChange={handleSuggestedCardChange} placeholder="Ex: mastercard" />
                    </div>
                    <div className="form-group">
                      <label>Fechamento</label>
                      <input name="closingDay" type="number" min="1" max="31" value={suggestedCardForm.closingDay} onChange={handleSuggestedCardChange} placeholder="27" />
                    </div>
                    <div className="form-group">
                      <label>Vencimento</label>
                      <input name="dueDay" type="number" min="1" max="31" value={suggestedCardForm.dueDay} onChange={handleSuggestedCardChange} placeholder="6" />
                    </div>
                    <div className="form-group">
                      <label>Fatura atual (R$)</label>
                      <input name="currentInvoice" type="number" step="0.01" value={suggestedCardForm.currentInvoice} onChange={handleSuggestedCardChange} placeholder="0,00" />
                    </div>
                    <div className="form-group">
                      <label>Limite total (R$)</label>
                      <input name="limit" type="number" step="0.01" value={suggestedCardForm.limit} onChange={handleSuggestedCardChange} placeholder="Opcional" />
                    </div>
                  </div>
                  <div className="import-create-actions">
                    <button type="button" className="btn-primary" onClick={handleCreateSuggestedCard} disabled={creatingTarget}>
                      {creatingTarget ? 'Criando...' : 'Criar e usar este cartao'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {!importUsesCard && !isReceiptImport && (
          <>
            <div className="account-select-row">
              <label className="account-select-label">{isReceiptImport ? 'Conta usada no pagamento' : 'Conta de importação'}</label>
              <select
                className="account-select"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                disabled={loadingAccounts}
              >
                <option value="">Selecione uma conta…</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>{accountLabel(account)}</option>
                ))}
              </select>
            </div>

            <p className="import-target-hint">
              {isReceiptImport
                ? 'Selecione a conta usada no pagamento para vincular corretamente os itens importados do cupom.'
                : 'Escolha a conta para enviar os lançamentos pendentes para Lançar e vincular o saldo anterior/atual deste extrato.'}
            </p>

            {selectedAccount?.type === 'credit' && (
              <p className="import-target-hint">
                Seguranca ativa: compras importadas em conta/cartao de credito entram para categoria e historico, mas nao abatem o saldo principal. Apenas o pagamento de fatura deve sair do caixa.
              </p>
            )}

            <div className="import-create-inline">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowCreateAccount((current) => !current)}
              >
                {showCreateAccount ? 'Fechar criação de conta' : 'Criar nova conta a partir deste extrato'}
              </button>

              {showCreateAccount && (
                <div className="import-create-card">
                  <div className="import-create-grid">
                    <div className="form-group">
                      <label>Nome da conta</label>
                      <input name="name" value={suggestedAccountForm.name} onChange={handleSuggestedAccountChange} placeholder="Ex: Nubank Márcio" />
                    </div>
                    <div className="form-group">
                      <label>Banco</label>
                      <input name="bank" value={suggestedAccountForm.bank} onChange={handleSuggestedAccountChange} placeholder="Ex: Nubank" />
                    </div>
                    <div className="form-group">
                      <label>Titular</label>
                      <input name="holderName" value={suggestedAccountForm.holderName} onChange={handleSuggestedAccountChange} placeholder="Ex: Márcio Martins" />
                    </div>
                    <div className="form-group">
                      <label>Agência</label>
                      <input name="branchNumber" value={suggestedAccountForm.branchNumber} onChange={handleSuggestedAccountChange} placeholder="0001" />
                    </div>
                    <div className="form-group">
                      <label>Conta</label>
                      <input name="accountNumber" value={suggestedAccountForm.accountNumber} onChange={handleSuggestedAccountChange} placeholder="123456-7" />
                    </div>
                    <div className="form-group">
                      <label>Saldo inicial (R$)</label>
                      <input name="balance" type="number" step="0.01" value={suggestedAccountForm.balance} onChange={handleSuggestedAccountChange} placeholder="0,00" />
                    </div>
                  </div>
                  <div className="import-create-actions">
                    <button type="button" className="btn-primary" onClick={handleCreateSuggestedAccount} disabled={creatingTarget}>
                      {creatingTarget ? 'Criando...' : 'Criar e usar esta conta'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {canImportOpeningBalanceOnly && (
              <label className="import-balance-only">
                <input
                  type="checkbox"
                  checked={importOnlyOpeningBalance}
                  onChange={(e) => setImportOnlyOpeningBalance(e.target.checked)}
                />
                <div>
                  <strong>Comecar {selectedMonthLabel} apenas com o saldo anterior</strong>
                  <p>
                    Usa o saldo atual deste extrato como saldo inicial de {selectedMonthLabel}
                    e nao importa os lancamentos do mes anterior.
                  </p>
                </div>
              </label>
            )}
          </>
        )}

        {isReceiptImport && receiptPaymentMethod === 'account' && (
          <div className="account-select-row">
            <label className="account-select-label">Conta usada no pagamento</label>
            <select
              className="account-select"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              disabled={loadingAccounts}
            >
              <option value="">Selecione uma conta…</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>{accountLabel(account)}</option>
              ))}
            </select>
            <p className="import-target-hint">Selecione a conta usada no pagamento desta nota/cupom.</p>
          </div>
        )}

        {isReceiptImport && receiptPaymentMethod === 'cash' && (
          <div className="account-select-row">
            <label className="account-select-label">Origem do dinheiro</label>
            <select
              className="account-select"
              value={cashOriginType}
              onChange={(e) => setCashOriginType(e.target.value)}
            >
              <option value="">Selecione a origem do dinheiro…</option>
              {CASH_ORIGIN_TYPES.map((origin) => (
                <option key={origin.value} value={origin.value}>{origin.label}</option>
              ))}
            </select>
            <p className="import-target-hint">Informe de onde veio o dinheiro usado no pagamento, sem vincular a contas bancárias.</p>
          </div>
        )}

        {/* Bulk controls */}
        <div className="preview-bulk-row">
          <span className="preview-bulk-info">{selectedCount} de {parsedRows.length} selecionados</span>
          {duplicateAuditLoading && <span className="preview-bulk-info">Auditando duplicidade…</span>}
          <button className="btn-link" onClick={() => setSelectedIds(new Set(parsedRows.map((r) => r.id)))}>Todos</button>
          <button className="btn-link" onClick={() => setSelectedIds(new Set())}>Nenhum</button>
        </div>

        {/* Row list */}
        <div className="preview-rows">
          {parsedRows.map((row) => {
            const meta    = TYPE_META[row.type] ?? { label: row.type, icon: '?', cls: '' }
            const checked = selectedIds.has(row.id)
            const review  = row.status === 'pending'
            const duplicateAudit = duplicateMapByRowId[row.id] ?? { exact: false, possible: false }

            return (
              <div
                key={row.id}
                className={[
                  'preview-row',
                  review   ? 'preview-row--review'    : '',
                  duplicateAudit.exact ? 'preview-row--review' : '',
                  !checked ? 'preview-row--unchecked' : '',
                ].join(' ')}
                onClick={() => toggleRow(row.id)}
              >
                <input
                  type="checkbox"
                  className="preview-check"
                  checked={checked}
                  onChange={() => toggleRow(row.id)}
                  onClick={(e) => e.stopPropagation()}
                />
                <div className="preview-row-body">
                  <div className="preview-row-top">
                    <span className={`preview-type ${meta.cls}`}>{meta.icon} {meta.label}</span>
                    <span className={`preview-amount ${row.direction === 'credit' ? 'pos' : 'neg'}`}>
                      {row.direction === 'credit' ? '+' : '−'}{formatCurrency(row.amount)}
                    </span>
                  </div>
                  <div className="preview-row-desc">{row.description}</div>
                  <div className="preview-row-footer">
                    <span className="preview-date">{isoToBR(row.date)}</span>
                    <span className="preview-confidence">
                      Confiança: {row.classification?.confidence ?? 'low'}
                    </span>
                    {Array.isArray(row.receiptItems) && row.receiptItems.length > 0 && (
                      <span className="preview-review-tag">🧾 {row.receiptItems.length} item(ns) do cupom</span>
                    )}
                    {review && <span className="preview-review-tag">⚠ Classificação incerta</span>}
                    {duplicateAudit.exact && (
                      <span className="preview-review-tag">⛔ Duplicado exato</span>
                    )}
                    {duplicateAudit.possible && (
                      <span className="preview-review-tag">⚠ Possível duplicado</span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {saveDisabledReason ? (
          <p className="import-action-hint import-action-hint--warn">{saveDisabledReason}</p>
        ) : openingBalanceOnlySelected ? (
          <p className="import-action-hint">
            Apenas o saldo inicial de {selectedMonthLabel} sera registrado para esta conta.
          </p>
        ) : (balanceAdjustmentRows.length > 0 && selectedNonExactCount === 0) ? (
          <p className="import-action-hint">
            Apenas o saldo atual da conta sera atualizado; nenhum gasto sera criado com esses ajustes.
          </p>
        ) : (
          <p className="import-action-hint">Os itens salvos entram em Lançar para revisão, em amarelo, antes de aparecerem em Lançamentos.</p>
        )}

        {/* Action bar */}
        <div className="import-step-actions">
          <button className="btn-secondary" onClick={handleReset}>Cancelar</button>
          <button
            className="btn-primary"
            onClick={handleConfirmImport}
            disabled={!!saveDisabledReason}
          >
            {openingBalanceOnlySelected
              ? `Salvar saldo inicial de ${selectedMonthLabel}`
              : (balanceAdjustmentRows.length > 0 && selectedNonExactCount === 0)
                ? 'Atualizar saldo da conta'
                : `Enviar para Lançar ${selectedNonExactCount > 0 ? `(${selectedNonExactCount})` : ''}`}
          </button>
        </div>
      </>
    )
  }

  function renderSaving() {
    return (
      <div className="import-loading">
        <div className="import-spinner" />
        <p>
          {openingBalanceOnlySelected
            ? `Registrando o saldo inicial de ${selectedMonthLabel}...`
            : <>Enviando <strong>{selectedIds.size}</strong> itens para Lançar…</>}
        </p>
      </div>
    )
  }

  function renderDone() {
    return (
      <div className="import-done">
        <span className="import-done-icon">✅</span>
        <p className="import-done-title">
          {balanceOnlyApplied
            ? `Saldo inicial de ${selectedMonthLabel} configurado!`
            : `${savedCount} lançamento${savedCount !== 1 ? 's' : ''} enviado${savedCount !== 1 ? 's' : ''} para Lançar!`}
        </p>
        {saveMessage && <p className="import-done-note">{saveMessage}</p>}
        {skippedCount > 0 && (
          <p className="import-done-note">
            {skippedCount} lançamento{skippedCount !== 1 ? 's' : ''} já existia{skippedCount !== 1 ? 'm' : ''}.
          </p>
        )}
        {saveError && <p className="import-done-error">{saveError}</p>}
        <div className="import-done-actions">
          <button className="btn-primary" onClick={handleReset}>Fazer nova importação</button>
          <button className="btn-secondary" onClick={() => navigate('/lancar')}>Ir para Lançar</button>
          <button className="btn-secondary" onClick={() => navigate('/dashboard')}>Voltar ao Dashboard</button>
        </div>
      </div>
    )
  }

  // ── Main render ───────────────────────────────────────────────────────────


  return (
    <div className="importacao-page">
      {step === 'idle'    && renderIdle()}
      {step === 'parsing' && renderParsing()}
      {step === 'preview' && renderPreview()}
      {step === 'saving'  && renderSaving()}
      {step === 'done'    && renderDone()}
    </div>
  )
  }
