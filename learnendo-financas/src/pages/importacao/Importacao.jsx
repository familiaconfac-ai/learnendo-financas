import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useFinance } from '../../context/FinanceContext'
import { useWorkspace } from '../../context/WorkspaceContext'
import { useAccounts } from '../../hooks/useAccounts'
import { useCards } from '../../hooks/useCards'
import { useCategories } from '../../hooks/useCategories'
import { addTransaction, fetchTransactions } from '../../services/transactionService'
import { parseStatementFile } from '../../utils/statementParser'
import { classifyBatch } from '../../utils/transactionClassifier'
import { buildDuplicateSignature, findDuplicateMatches } from '../../utils/transactionDuplicates'
import { formatCurrency } from '../../utils/formatCurrency'
import { normalizeReceiptItems } from '../../utils/receiptDetailCatalog'
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
  const [existingMonthTx, setExistingMonthTx] = useState([])
  const [duplicateAuditLoading, setDuplicateAuditLoading] = useState(false)
  const [importOnlyOpeningBalance, setImportOnlyOpeningBalance] = useState(false)
  const [balanceOnlyApplied, setBalanceOnlyApplied] = useState(false)
  const [suggestedAccountForm, setSuggestedAccountForm] = useState(buildSuggestedAccountForm(null))
  const [suggestedCardForm, setSuggestedCardForm] = useState(buildSuggestedCardForm(null))
  const [showCreateAccount, setShowCreateAccount] = useState(false)
  const [showCreateCard, setShowCreateCard] = useState(false)
  const [creatingTarget, setCreatingTarget] = useState(false)
  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === accountId) || null,
    [accounts, accountId],
  )
  const selectedCard = useMemo(
    () => availableCards.find((card) => card.id === cardId) || null,
    [availableCards, cardId],
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
    setStep('parsing')

    try {
      const raw = await parseStatementFile(file)
      const summary = raw?.__summary || null
      setStatementSummary(summary)
      setSuggestedAccountForm(buildSuggestedAccountForm(summary))
      setSuggestedCardForm(buildSuggestedCardForm(summary))

      const hasImageRows = raw.some((row) => row.source === 'image_receipt')
      const classified = (hasImageRows ? raw : classifyBatch(raw)).map((row, idx) => ({
        ...row,
        status: 'pending',
        classification: row.classification || { confidence: 'low', reason: 'image_receipt' },
        id: `r-${idx}`,
      }))

      setParsedRows(classified)
      setSelectedIds(new Set(classified.map((r) => r.id)))   // all pre-selected
      setStep('preview')
    } catch (err) {
      console.error('[Importacao] Parse error:', err)
      setStatementSummary(null)
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
    const canSaveBalanceOnly = !isInvoiceImport
      && importOnlyOpeningBalance
      && hasCurrencyValue(statementSummary?.closingBalance)
    if (!permissions.canImport) {
      setSaveError('Seu papel atual não permite importação neste workspace.')
      return
    }
    if (isInvoiceImport ? !cardId : !accountId) {
      setSaveError(isInvoiceImport
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
      setSaveError('Selecione ao menos um lancamento para salvar.')
      setStep('preview')
      return
    }
    const batchId = Date.now().toString(36)
    let count = 0
    let skipped = 0
    const failed = []
    let accountSummaryError = null

    try {
      const monthKeys = isInvoiceImport
        ? [selectedMonthKey]
        : [...new Set(
            toSave
              .map((row) => row.date?.slice(0, 7))
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

      const knownSignatures = new Set(
        existingByMonth
          .flat()
          .map((tx) => buildDuplicateSignature(tx)),
      )

      for (const row of toSave) {
        const rowAudit = duplicateMapByRowId[row.id]
        const signature = buildDuplicateSignature(row, isInvoiceImport
          ? { cardIdOverride: cardId }
          : { accountIdOverride: accountId })
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
          const transactionNatureId = row.type === 'income'
            ? 'nature_income'
            : row.type === 'investment'
              ? 'nature_investment'
              : row.type === 'transfer_internal'
                ? 'nature_internal_transfer'
                : 'nature_expense'
          await addTransaction(user.uid, {
            type:                     row.type,
            description:              row.description,
            amount:                   row.amount,
            date:                     row.date,
            competencyMonth:          isInvoiceImport ? selectedMonthKey : row.date.slice(0, 7),
            accountId:                isInvoiceImport ? null : accountId,
            cardId:                   isInvoiceImport ? (cardId || null) : null,
            cardName:                 isInvoiceImport ? (selectedCard?.name || null) : null,
            categoryId:               hintedCategory?.id || null,
            categoryName:             hintedCategory?.name || null,
            notes:                    '',
            paymentMethod:            isInvoiceImport ? 'credit_card' : null,
            origin:                   row.source === 'image_receipt' ? 'manual' : (isInvoiceImport ? 'credit_card_import' : 'bank_import'),
            status:                   'pending',
            workspaceId:              activeWorkspaceId,
            createdBy:                user.uid,
            userId:                   user.uid,
            transactionNatureId,
            transactionNatureLabel:   transactionNatures.find((n) => n.id === transactionNatureId)?.label || null,
            affectsBudget:            true,
            balanceImpact:            isInvoiceImport ? false : row.type !== 'transfer_internal',
            importBatchId:            batchId,
            classificationConfidence: row.classification?.confidence ?? 'low',
            receiptDetailEnabled:     row.receiptDetailEnabled && receiptItems.length > 0,
            receiptItems,
          }, { workspaceId: activeWorkspaceId })
          knownSignatures.add(signature)
          count++
        } catch (err) {
          console.error('[Importacao] Save failed for:', row.description, err.message)
          failed.push(row.description)
        }
      }

      if (!isInvoiceImport && count > 0 && statementSnapshotPayload) {
        try {
          await updateAccount(accountId, statementSnapshotPayload)
        } catch (err) {
          console.error('[Importacao] Could not persist statement summary on account:', err.message)
          accountSummaryError = 'Os lancamentos foram salvos, mas o resumo de saldo nao pode ser vinculado a conta.'
        }
      }

      if (isInvoiceImport && count > 0 && invoiceSnapshotPayload) {
        try {
          await updateCard(cardId, invoiceSnapshotPayload)
        } catch (err) {
          console.error('[Importacao] Could not persist invoice summary on card:', err.message)
          accountSummaryError = 'Os lançamentos foram salvos, mas a fatura não pôde ser vinculada ao cartão.'
        }
      }

      setSavedCount(count)
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

      if (count > 0 && failed.length === 0 && skipped === 0) {
        setSaveMessage(isInvoiceImport
          ? 'Lancamentos da fatura salvos com sucesso.'
          : 'Lancamentos do extrato salvos com sucesso.')
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
    setExistingMonthTx([])
    setImportOnlyOpeningBalance(false)
    setBalanceOnlyApplied(false)
    setSuggestedAccountForm(buildSuggestedAccountForm(null))
    setSuggestedCardForm(buildSuggestedCardForm(null))
    setShowCreateAccount(false)
    setShowCreateCard(false)
    setCreatingTarget(false)
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
        const monthKeys = statementSummary?.kind === 'invoice'
          ? [selectedMonthKey]
          : [...new Set(
              parsedRows
                .map((row) => row.date?.slice(0, 7))
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
  }, [step, user?.uid, parsedRows, statementSummary?.kind, selectedMonthKey, activeWorkspaceId, myRole])

  const isInvoiceImport = statementSummary?.kind === 'invoice'
  const targetSelected = isInvoiceImport ? !!cardId : !!accountId
  const canImportOpeningBalanceOnly = !isInvoiceImport && hasCurrencyValue(statementSummary?.closingBalance)
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

    if (isInvoiceImport) {
      if (!cardId && matchedCardId) {
        setCardId(matchedCardId)
      } else if (!cardId && availableCards.length === 1) {
        setCardId(availableCards[0].id)
      }
      setShowCreateCard(!matchedCardId)
      return
    }

    if (!accountId && matchedAccountId) {
      setAccountId(matchedAccountId)
    } else if (!accountId && accounts.length === 1) {
      setAccountId(accounts[0].id)
    }
    setShowCreateAccount(!matchedAccountId)
  }, [step, isInvoiceImport, accountId, cardId, accounts, availableCards, matchedAccountId, matchedCardId])

  const duplicateMapByRowId = useMemo(() => {
    if (!targetSelected || existingMonthTx.length === 0) return {}
    const map = {}
    parsedRows.forEach((row) => {
      const matches = findDuplicateMatches(row, existingMonthTx, isInvoiceImport
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
  }, [parsedRows, existingMonthTx, targetSelected, isInvoiceImport, accountId, cardId])

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
  const openingBalanceOnlySelected = canImportOpeningBalanceOnly && importOnlyOpeningBalance
  const netSelected   = parsedRows
    .filter((r) => selectedIds.has(r.id))
    .reduce((sum, r) => sum + (r.direction === 'credit' ? r.amount : -r.amount), 0)
  const saveDisabledReason = !targetSelected
    ? (isInvoiceImport ? 'Selecione ou crie o cartão da fatura para liberar o salvamento.' : 'Selecione ou crie a conta do extrato para liberar o salvamento.')
    : !openingBalanceOnlySelected && selectedNonExactCount === 0
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

        {/* Account selector */}
        {isInvoiceImport && (
          <>
            <div className="account-select-row">
              <label className="account-select-label">Cartao da fatura</label>
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
                Escolha o cartao correto para que a fatura entre nos Lancamentos sem afetar o saldo da conta.
              </p>
            </div>

            <div className="import-create-inline">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowCreateCard((current) => !current)}
              >
                {showCreateCard ? 'Fechar criacao de cartao' : 'Criar novo cartao a partir desta fatura'}
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

        {!isInvoiceImport && (
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
