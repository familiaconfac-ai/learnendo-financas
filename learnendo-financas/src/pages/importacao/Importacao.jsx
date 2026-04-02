import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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

function hydrateImportedReceiptItems(items, categories) {
  const prepared = (Array.isArray(items) ? items : []).map((item) => {
    const hintedBudgetCategory = findCategoryByHints(
      categories,
      'expense',
      item.budgetCategoryHints || [item.budgetCategoryName].filter(Boolean),
    )

    return {
      ...item,
      budgetCategoryId: hintedBudgetCategory?.id || item.budgetCategoryId || '',
      budgetCategoryName: hintedBudgetCategory?.name || item.budgetCategoryName || '',
    }
  })

  return normalizeReceiptItems(prepared, categories.filter((category) => category.type === 'expense'))
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
  const [receiptPaymentTarget, setReceiptPaymentTarget] = useState('credit_card')
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

  // ── File handling ─────────────────────────────────────────────────────────

  async function handleFile(file) {
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
      const raw = await parseStatementFile(file)
      const parsedSummary = raw?.__summary || null

      const hasImageRows = raw.some((row) => row.source === 'image_receipt')
      setReceiptPaymentTarget(hasImageRows && availableCards.length === 0 ? 'account' : 'credit_card')
      const classifiedRows = (hasImageRows ? raw : classifyBatch(raw)).map((row) => ({
        ...row,
        status: row.status || 'pending',
        classification: row.classification || { confidence: 'low', reason: 'image_receipt' },
      }))
      const handled = handleImport(classifiedRows, { statementSummary: parsedSummary })
      const summary = handled.summary || parsedSummary
      const classified = handled.rows.map((row, idx) => ({
        ...row,
        id: `r-${idx}`,
      }))

      setStatementSummary(summary)
      setBalanceAdjustmentRows(handled.balanceAdjustments || [])
      setBalanceAuditEntries(handled.auditEntries || [])
      setSuggestedAccountForm(buildSuggestedAccountForm(summary))
      setSuggestedCardForm(buildSuggestedCardForm(summary))

      setParsedRows(classified)
      setSelectedIds(new Set(classified.map((r) => r.id)))   // all pre-selected
      setStep('preview')
    } catch (err) {
      console.error('[Importacao] Parse error:', err)
      setStatementSummary(null)
      setBalanceAdjustmentRows([])
      setBalanceAuditEntries([])
      setParseError(err.message || 'Não foi possível processar o arquivo.')
      setParsePreviewLines(Array.isArray(err.previewLines) ? err.previewLines : [])
      setStep('idle')
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
    if (!user?.uid) return
    const isInvoiceImport = statementSummary?.kind === 'invoice'
    const isReceiptImport = parsedRows.some((row) => row.source === 'image_receipt')
    const isReceiptCardImport = isReceiptImport && receiptPaymentTarget === 'credit_card'
    const importUsesCard = isInvoiceImport || isReceiptCardImport
    const isCreditAccountImport = !importUsesCard && selectedAccount?.type === 'credit'
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
        }
        return
      }
      setSaveError('Selecione ao menos um lancamento para salvar.')
      setStep('preview')
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
          const receiptItems = hydrateImportedReceiptItems(row.receiptItems, categories)
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
          await addTransaction(user.uid, {
            type:                     row.type,
            description:              row.description,
            amount:                   row.amount,
            date:                     row.date,
            competencyMonth:          resolvedCompetencyMonth,
            accountId:                importUsesCard ? null : accountId,
            cardId:                   importUsesCard ? (cardId || null) : null,
            cardName:                 importUsesCard ? (selectedCard?.name || null) : null,
            categoryId:               hintedCategory?.id || null,
            categoryName:             hintedCategory?.name || row.categoryName || null,
            notes:                    '',
            paymentMethod:            row.paymentMethod || (importUsesCard || isCreditAccountImport ? 'credit_card' : null),
            origin:                   row.source === 'image_receipt' ? 'manual' : (isInvoiceImport ? 'credit_card_import' : 'bank_import'),
            status:                   row.status || 'pending',
            workspaceId:              activeWorkspaceId,
            createdBy:                user.uid,
            userId:                   user.uid,
            transactionNatureId,
            transactionNatureLabel:   transactionNatures.find((n) => n.id === transactionNatureId)?.label || null,
            affectsBudget:            typeof row.affectsBudget === 'boolean' ? row.affectsBudget : true,
            balanceImpact:            typeof row.balanceImpact === 'boolean' ? row.balanceImpact : (importUsesCard || isCreditAccountImport ? false : row.type !== 'transfer_internal'),
            importBatchId:            batchId,
            classificationConfidence: row.classification?.confidence ?? 'low',
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
        } catch (err) {
          console.error('[Importacao] Save failed for:', row.description, err.message)
          failed.push(row.description)
        }
      }

      if (!isInvoiceImport && !isReceiptImport && count > 0 && statementSnapshotPayload) {
        try {
          await updateAccount(accountId, statementSnapshotPayload)
        } catch (err) {
          console.error('[Importacao] Could not persist statement summary on account:', err.message)
          accountSummaryError = 'Os lancamentos foram salvos, mas o resumo de saldo nao pode ser vinculado a conta.'
        }
      }

      if (isInvoiceImport && (count > 0 || reconciledCount > 0) && invoiceSnapshotPayload) {
        try {
          await updateCard(cardId, invoiceSnapshotPayload)
        } catch (err) {
          console.error('[Importacao] Could not persist invoice summary on card:', err.message)
          accountSummaryError = 'Os lançamentos foram salvos, mas a fatura não pôde ser vinculada ao cartão.'
        }
      }

      setSavedCount(count + reconciledCount)
      setSkippedCount(skipped)
      if (failed.length > 0) {
        setSaveError(`${failed.length} lançamento(s) não puderam ser salvos.`)
      }
      if (skipped > 0) {
        setSaveMessage(`${skipped} lançamento(s) duplicado(s) foram ignorados.`)
      } else if (count > 0) {
        setSaveMessage('Lançamentos salvos no Firestore com sucesso.')
      }
      if (failed.length > 0 && accountSummaryError) {
        setSaveError(`${failed.length} lancamento(s) nao puderam ser salvos. ${accountSummaryError}`)
      } else if (failed.length === 0 && accountSummaryError) {
        setSaveError(accountSummaryError)
      }

      if ((count > 0 || reconciledCount > 0) && failed.length === 0 && skipped === 0) {
        setSaveMessage(isInvoiceImport
          ? (reconciledCount > 0
              ? `Lancamentos da fatura conciliados com sucesso (${reconciledCount} cupom(ns) reaproveitado(s)).`
              : 'Lancamentos da fatura salvos com sucesso.')
          : (isReceiptImport
              ? 'Cupom salvo com sucesso em Lancamentos.'
              : 'Lancamentos do extrato salvos com sucesso.'))
      }

      setStep('done')
    } catch (err) {
      console.error('[Importacao] Unexpected save error:', err)
      setSaveError(err.message || 'Não foi possível concluir a importação.')
      setStep('done')
    }
  }

  function handleReset() {
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
    setReceiptPaymentTarget('credit_card')
    setStep('idle')
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
        const isReceiptImport = parsedRows.some((row) => row.source === 'image_receipt')
        const isReceiptCardImport = isReceiptImport && receiptPaymentTarget === 'credit_card'
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
  }, [step, user?.uid, parsedRows, statementSummary?.kind, selectedMonthKey, activeWorkspaceId, myRole, receiptPaymentTarget, selectedCard])

  const isInvoiceImport = statementSummary?.kind === 'invoice'
  const isReceiptImport = parsedRows.some((row) => row.source === 'image_receipt')
  const isReceiptCardImport = isReceiptImport && receiptPaymentTarget === 'credit_card'
  const importUsesCard = isInvoiceImport || isReceiptCardImport
  const targetSelected = importUsesCard ? !!cardId : !!accountId
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
    ? (isInvoiceImport ? 'Selecione ou crie o cartão da fatura para liberar o salvamento.' : 'Selecione ou crie a conta do extrato para liberar o salvamento.')
    : !openingBalanceOnlySelected
      && selectedNonExactCount === 0
      && !(balanceAdjustmentRows.length > 0 && hasCurrencyValue(statementSummary?.closingBalance))
      ? 'Nao ha lancamentos novos selecionados para salvar.'
      : ''

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

        <div
          className={`dropzone${dragOver ? ' dragover' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true)  }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <span className="dropzone-icon">📁</span>
          <p className="dropzone-title">Arraste o extrato ou clique para selecionar</p>
          <p className="dropzone-sub">Formatos suportados: <strong>CSV</strong>, <strong>OFX / QFX</strong>, <strong>PDF</strong> e <strong>JPG / PNG</strong></p>
          <label className="dropzone-btn">
            Selecionar arquivo
            <input
              type="file"
              accept=".csv,.ofx,.qfx,.txt,.pdf,.jpg,.jpeg,.png,.webp,image/*"
              style={{ display: 'none' }}
              onChange={handleFileInput}
            />
          </label>
        </div>

        <Card>
          <CardHeader title="Como funciona" />
          <div className="how-list">
            <div className="how-item">
              <span className="how-icon">🏦</span>
              <div>
                <strong>Extrato bancário (OFX)</strong>
                <p>Exporte no internet banking como OFX/QFX. Itaú, Bradesco, BB, Nubank e outros.</p>
              </div>
            </div>
            <div className="how-item">
              <span className="how-icon">📄</span>
              <div>
                <strong>Planilha CSV</strong>
                <p>Baixe o extrato como CSV. As colunas são detectadas automaticamente.</p>
              </div>
            </div>
            <div className="how-item">
              <span className="how-icon">🧾</span>
              <div>
                <strong>PDF e imagem com OCR</strong>
                <p>Extratos em PDF com texto são lidos automaticamente. Fotos de cupom tentam extrair itens e separar categorias para revisão.</p>
              </div>
            </div>
            <div className="how-item">
              <span className="how-icon">🔍</span>
              <div>
                <strong>Revisão antes de salvar</strong>
                <p>Lançamentos duvidosos ficam destacados. Você confirma ou desmarca antes de salvar.</p>
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
              {parsedRows.length} transações
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

        {/* Account selector */}
        {isReceiptImport && (
          <div className="import-target-mode">
            <button
              type="button"
              className={`import-target-pill${receiptPaymentTarget === 'credit_card' ? ' active' : ''}`}
              onClick={() => setReceiptPaymentTarget('credit_card')}
            >
              Cupom no cartao
            </button>
            <button
              type="button"
              className={`import-target-pill${receiptPaymentTarget === 'account' ? ' active' : ''}`}
              onClick={() => setReceiptPaymentTarget('account')}
            >
              Conta / debito / Pix
            </button>
          </div>
        )}
        {importUsesCard && (
          <>
            <div className="account-select-row">
              <label className="account-select-label">{isInvoiceImport ? 'Cartao da fatura' : 'Cartao usado no cupom'}</label>
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
                  ? 'Escolha o cartao correto para que a fatura entre nos Lancamentos sem afetar o saldo da conta.'
                  : 'Ao salvar este cupom no cartao, a fatura futura podera reaproveitar esse lancamento em vez de duplicar.'}
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

        {!importUsesCard && (
          <>
            <div className="account-select-row">
              <label className="account-select-label">Conta de importação</label>
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
              Escolha a conta para salvar os lancamentos e vincular o saldo anterior/atual deste extrato.
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
          <p className="import-action-hint">Os itens salvos entram em Lancamentos para revisao.</p>
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
                : `Salvar em Lancamentos ${selectedNonExactCount > 0 ? `(${selectedNonExactCount})` : ''}`}
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
            : <>Salvando <strong>{selectedIds.size}</strong> lançamentos…</>}
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
            : `${savedCount} lançamento${savedCount !== 1 ? 's' : ''} importado${savedCount !== 1 ? 's' : ''}!`}
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
