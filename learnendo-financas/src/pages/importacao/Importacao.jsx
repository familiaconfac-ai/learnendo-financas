import { useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useWorkspace } from '../../context/WorkspaceContext'
import { useAccounts } from '../../hooks/useAccounts'
import { useCards } from '../../hooks/useCards'
import { useCategories } from '../../hooks/useCategories'
import { addTransaction } from '../../services/transactionService'
import { parseStatementFile } from '../../utils/statementParser'
import { handleImport } from '../../utils/importRules'
import { normalizeReceiptItems } from '../../utils/receiptDetailCatalog'
import { formatCurrency } from '../../utils/formatCurrency'
import { addMonthsToMonthKey, buildCardCommitmentRecurringFields, computeCreditCardCompetencyMonth } from '../../utils/creditCardPlanning'
import Card from '../../components/ui/Card'
import './Importacao.css'

const IMPORT_CONFIG = {
  receipt: {
    title: 'Cupom e nota',
    kicker: 'OCR',
    description: 'Fotografe ou envie um documento escaneado. O app separa os itens e você escolhe se foi pago em dinheiro, conta ou cartão.',
    accept: 'image/*,.pdf',
    cta: 'Selecionar cupom ou nota',
    loading: 'Lendo cupom e separando os itens...',
    launch: 'Enviar itens para conferência',
  },
  bank: {
    title: 'Extrato bancário',
    kicker: 'Contas',
    description: 'Importe CSV, OFX, QFX ou PDF do banco para revisar os lançamentos e atualizar o resumo da conta.',
    accept: '.csv,.ofx,.qfx,.pdf',
    cta: 'Selecionar extrato',
    loading: 'Lendo extrato e organizando as movimentações...',
    launch: 'Enviar extrato para conferência',
  },
  invoice: {
    title: 'Fatura do cartão',
    kicker: 'Cartões',
    description: 'Importe a fatura vinculando ao cartão certo para respeitar fechamento, vencimento e competência de cada compra.',
    accept: '.csv,.ofx,.qfx,.pdf',
    cta: 'Selecionar fatura',
    loading: 'Lendo a fatura e distribuindo as compras...',
    launch: 'Enviar fatura para conferência',
  },
}

const CASH_ORIGIN_OPTIONS = [
  { value: 'caixa', label: 'Caixa' },
  { value: 'oferta', label: 'Oferta' },
  { value: 'ajuda_custo', label: 'Ajuda de custo' },
  { value: 'bico', label: 'Bico' },
  { value: 'outro', label: 'Outro' },
]

const RECEIPT_DOCUMENT_TYPE_OPTIONS = [
  { value: 'supermercado', label: 'Supermercado' },
  { value: 'loja', label: 'Loja' },
  { value: 'farmacia', label: 'Farmácia' },
  { value: 'material_ferramentas', label: 'Material/Ferramentas' },
  { value: 'outros', label: 'Outros' },
]

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function inferImportType(rawValue) {
  const normalized = String(rawValue || '').trim().toLowerCase()
  if (normalized === 'bank') return 'bank'
  if (normalized === 'invoice') return 'invoice'
  return 'receipt'
}

function inferRowType(row, importType) {
  if (importType === 'invoice') return 'expense'
  if (row?.type === 'income' || row?.type === 'expense' || row?.type === 'investment' || row?.type === 'transfer_internal') {
    return row.type
  }
  return row?.direction === 'credit' ? 'income' : 'expense'
}

function monthKeyFromRows(rows = []) {
  const dates = rows
    .map((row) => String(row?.date || '').slice(0, 7))
    .filter((value) => /^\d{4}-\d{2}$/.test(value))
    .sort()
  return dates[0] || ''
}

function buildCategoryLookup(categories = []) {
  const byId = new Map()
  const byName = new Map()
  const expenseCategories = categories.filter((category) => category.type === 'expense')

  expenseCategories.forEach((category) => {
    byId.set(category.id, category)
    byName.set(String(category.name || '').trim().toLowerCase(), category)
  })

  return { byId, byName, expenseCategories }
}

function resolveCategoryForReceiptRow(row, lookup) {
  if (row?.budgetCategoryId && lookup.byId.has(row.budgetCategoryId)) {
    return lookup.byId.get(row.budgetCategoryId)
  }

  if (row?.budgetCategoryName) {
    const matchedByName = lookup.byName.get(String(row.budgetCategoryName).trim().toLowerCase())
    if (matchedByName) return matchedByName
  }

  if (Array.isArray(row?.budgetCategoryHints)) {
    const matchedHint = row.budgetCategoryHints
      .map((hint) => lookup.byName.get(String(hint || '').trim().toLowerCase()))
      .find(Boolean)
    if (matchedHint) return matchedHint
  }

  return null
}

function normalizeAmount(value) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? Math.abs(parsed) : 0
}

export default function Importacao() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()
  const { activeWorkspaceId } = useWorkspace()
  const { accounts, update: updateAccount } = useAccounts()
  const { cards, update: updateCard } = useCards()
  const { categories } = useCategories()

  const importType = inferImportType(searchParams.get('tipo'))
  const config = IMPORT_CONFIG[importType]
  const expenseLookup = useMemo(() => buildCategoryLookup(categories), [categories])
  const fileInputRef = useRef(null)
  const isSavingRef = useRef(false)

  const [step, setStep] = useState('idle')
  const [parsedRows, setParsedRows] = useState([])
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [summary, setSummary] = useState(null)
  const [fileName, setFileName] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [receiptMeta, setReceiptMeta] = useState({
    merchantName: '',
    totalAmount: 0,
    purchaseDate: '',
  })
  const [paymentOrigin, setPaymentOrigin] = useState(
    importType === 'invoice' ? 'card' : importType === 'bank' ? 'account' : 'cash',
  )
  const [accountId, setAccountId] = useState(searchParams.get('accountId') || '')
  const [cardId, setCardId] = useState(searchParams.get('cardId') || '')
  const [cashOriginType, setCashOriginType] = useState('caixa')
  const [receiptDocumentType, setReceiptDocumentType] = useState('outros')

  const selectedAccount = accounts.find((account) => account.id === accountId) || null
  const selectedCard = cards.find((card) => card.id === cardId) || null
  const selectedRows = parsedRows.filter((row) => selectedIds.has(row.id))
  const selectedCount = selectedRows.length
  const selectedTotal = selectedRows.reduce((sum, row) => sum + normalizeAmount(row.amount), 0)

  function resetPreview() {
    setParsedRows([])
    setSelectedIds(new Set())
    setSummary(null)
    setFileName('')
    setReceiptMeta({ merchantName: '', totalAmount: 0, purchaseDate: '' })
    setErrorMessage('')
    setStep('idle')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function handleSelectAllNew() {
    const onlyFreshRows = parsedRows
      .filter((row) => !row.isDuplicate && row.status !== 'duplicate')
      .map((row) => row.id)
    setSelectedIds(new Set(onlyFreshRows))
  }

  function toggleRow(row) {
    if (row.isDuplicate) return
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(row.id)) next.delete(row.id)
      else next.add(row.id)
      return next
    })
  }

  async function handleFile(file) {
    if (!file) return

    setStep('parsing')
    setErrorMessage('')
    setParsedRows([])
    setSelectedIds(new Set())
    setSummary(null)
    setFileName(file.name || '')

    try {
      const raw = await parseStatementFile(file)

      if (importType === 'receipt') {
        const outerRow = Array.isArray(raw) && raw.length === 1 ? raw[0] : null
        const isReceiptImage = outerRow?.source === 'image_receipt'
          && Array.isArray(outerRow.receiptItems)
          && outerRow.receiptItems.length > 0

        if (!isReceiptImage) {
          throw new Error('Este arquivo não foi reconhecido como cupom ou nota fiscal por imagem.')
        }

        const normalizedItems = normalizeReceiptItems(
          outerRow.receiptItems.map((item) => ({
            ...item,
            date: item.date || outerRow.date || todayIso(),
          })),
          expenseLookup.expenseCategories,
        )

        const rowsWithId = normalizedItems.map((item, index) => ({
          ...item,
          id: item.id || `receipt-${index}-${Date.now()}`,
          date: item.date || outerRow.date || todayIso(),
          amount: normalizeAmount(item.amount),
          status: 'pending',
          isDuplicate: false,
        }))

        setReceiptMeta({
          merchantName: outerRow.merchantName || '',
          totalAmount: normalizeAmount(outerRow.totalAmount),
          purchaseDate: outerRow.date || todayIso(),
        })
        setParsedRows(rowsWithId)
        setSelectedIds(new Set(rowsWithId.map((row) => row.id)))
        setStep('preview')
        return
      }

      const handled = handleImport(raw, {
        statementSummary: raw?.__summary,
        holderName: importType === 'bank' ? selectedAccount?.holderName : selectedCard?.holderName,
      })

      const rowsWithId = handled.rows.map((row, index) => ({
        ...row,
        id: row.id || `${importType}-${index}-${Date.now()}`,
        date: row.date || todayIso(),
        amount: normalizeAmount(row.amount),
        isDuplicate: row.isDuplicate || row.status === 'duplicate',
      }))

      setParsedRows(rowsWithId)
      setSummary(handled.summary || raw?.__summary || null)
      setSelectedIds(new Set(rowsWithId.filter((row) => !row.isDuplicate).map((row) => row.id)))
      setStep('preview')
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Não foi possível processar o arquivo.')
      setStep('idle')
    }
  }

  async function handleLaunch() {
    if (!user?.uid || !activeWorkspaceId || isSavingRef.current || selectedCount === 0) return

    if (importType === 'receipt') {
      if (paymentOrigin === 'card' && !cardId) {
        alert('Selecione o cartão usado na compra.')
        return
      }
      if (paymentOrigin === 'account' && !accountId) {
        alert('Selecione a conta usada na compra.')
        return
      }
    }

    if (importType === 'bank' && !accountId) {
      alert('Selecione a conta que receberá este extrato.')
      return
    }

    if (importType === 'invoice' && !cardId) {
      alert('Selecione o cartão que receberá esta fatura.')
      return
    }

    isSavingRef.current = true
    setStep('saving')

    try {
      if (importType === 'receipt') {
        for (const row of selectedRows) {
          const category = resolveCategoryForReceiptRow(row, expenseLookup)
          const transactionDate = row.date || receiptMeta.purchaseDate || todayIso()
          const competencyMonth = paymentOrigin === 'card'
            ? computeCreditCardCompetencyMonth(transactionDate, selectedCard)
            : transactionDate.slice(0, 7)

          const recurringFields = paymentOrigin === 'card'
            ? buildCardCommitmentRecurringFields(row.description, competencyMonth)
            : {}

          await addTransaction(user.uid, {
            workspaceId: activeWorkspaceId,
            userId: user.uid,
            createdBy: user.uid,
            type: 'expense',
            description: row.description || receiptMeta.merchantName || 'Cupom importado',
            amount: normalizeAmount(row.amount),
            date: transactionDate,
            competencyMonth,
            status: 'pending',
            origin: paymentOrigin === 'card' ? 'credit_card_import' : 'manual',
            paymentMethod: paymentOrigin === 'card'
              ? 'credit_card'
              : paymentOrigin === 'account'
                ? 'pix'
                : 'cash',
            accountId: paymentOrigin === 'account' ? accountId : null,
            cardId: paymentOrigin === 'card' ? cardId : null,
            categoryId: category?.id || row.budgetCategoryId || null,
            categoryName: category?.name || row.budgetCategoryName || row.detailCategoryLabel || 'Outros',
            subcategoryId: null,
            subcategoryName: row.detailSubcategoryLabel || null,
            receiptDetailEnabled: false,
            receiptItems: [],
            receiptDocumentType,
            receiptPaymentMethod: paymentOrigin,
            cashOriginType: paymentOrigin === 'cash' ? cashOriginType : null,
            notes: receiptMeta.merchantName ? `Origem: ${receiptMeta.merchantName}` : '',
            ...recurringFields,
          }, { workspaceId: activeWorkspaceId })
        }
      }

      if (importType === 'bank') {
        for (const row of selectedRows) {
          await addTransaction(user.uid, {
            workspaceId: activeWorkspaceId,
            userId: user.uid,
            createdBy: user.uid,
            type: inferRowType(row, importType),
            description: row.description || 'Lançamento importado',
            amount: normalizeAmount(row.amount),
            date: row.date || todayIso(),
            competencyMonth: String(row.date || todayIso()).slice(0, 7),
            status: row.status === 'confirmed' ? 'confirmed' : 'pending',
            origin: 'bank_import',
            paymentMethod: row.direction === 'credit' ? null : 'pix',
            accountId,
            categoryId: null,
            categoryName: row.categoryName || null,
            transactionNatureId: row.transactionNatureId || null,
            transactionNatureKey: row.transactionNatureKey || null,
            affectsBudget: typeof row.affectsBudget === 'boolean' ? row.affectsBudget : undefined,
            balanceImpact: typeof row.balanceImpact === 'boolean' ? row.balanceImpact : undefined,
            classificationConfidence: row.classification?.confidence || null,
            notes: row.rawLine || '',
          }, { workspaceId: activeWorkspaceId })
        }

        if (selectedAccount) {
          const baseMonth = monthKeyFromRows(selectedRows)
          const monthlyOpeningBalances = { ...(selectedAccount.monthlyOpeningBalances || {}) }
          if (baseMonth && Number.isFinite(Number(summary?.openingBalance))) {
            monthlyOpeningBalances[baseMonth] = Number(summary.openingBalance)
          }
          if (baseMonth && Number.isFinite(Number(summary?.closingBalance))) {
            monthlyOpeningBalances[addMonthsToMonthKey(baseMonth, 1)] = Number(summary.closingBalance)
          }

          await updateAccount(accountId, {
            current_balance: Number.isFinite(Number(summary?.closingBalance))
              ? Number(summary.closingBalance)
              : selectedAccount.current_balance ?? selectedAccount.balance ?? 0,
            lastStatementImportedAt: new Date().toISOString(),
            lastStatementFileName: fileName,
            lastStatementOpeningBalance: Number.isFinite(Number(summary?.openingBalance)) ? Number(summary.openingBalance) : null,
            lastStatementClosingBalance: Number.isFinite(Number(summary?.closingBalance)) ? Number(summary.closingBalance) : null,
            lastStatementNetMovement: Number.isFinite(Number(summary?.netMovement)) ? Number(summary.netMovement) : null,
            monthlyOpeningBalances,
          })
        }
      }

      if (importType === 'invoice') {
        for (const row of selectedRows) {
          const transactionDate = row.date || todayIso()
          const competencyMonth = computeCreditCardCompetencyMonth(transactionDate, selectedCard)
          const recurringFields = buildCardCommitmentRecurringFields(row.description, competencyMonth)

          await addTransaction(user.uid, {
            workspaceId: activeWorkspaceId,
            userId: user.uid,
            createdBy: user.uid,
            type: 'expense',
            description: row.description || 'Compra importada da fatura',
            amount: normalizeAmount(row.amount),
            date: transactionDate,
            competencyMonth,
            status: row.status === 'confirmed' ? 'confirmed' : 'pending',
            origin: 'credit_card_import',
            paymentMethod: 'credit_card',
            cardId,
            categoryId: null,
            categoryName: row.categoryName || null,
            transactionNatureId: row.transactionNatureId || null,
            transactionNatureKey: row.transactionNatureKey || null,
            affectsBudget: typeof row.affectsBudget === 'boolean' ? row.affectsBudget : true,
            balanceImpact: typeof row.balanceImpact === 'boolean' ? row.balanceImpact : true,
            classificationConfidence: row.classification?.confidence || null,
            notes: row.rawLine || '',
            ...recurringFields,
          }, { workspaceId: activeWorkspaceId })
        }

        if (selectedCard) {
          await updateCard(cardId, {
            currentInvoice: Number.isFinite(Number(summary?.currentInvoice))
              ? Number(summary.currentInvoice)
              : Number(selectedTotal || selectedCard.currentInvoice || 0),
            usedLimit: Number.isFinite(Number(summary?.currentInvoice))
              ? Number(summary.currentInvoice)
              : Number(selectedTotal || selectedCard.usedLimit || selectedCard.currentInvoice || 0),
            dueDay: Number(summary?.dueDay || selectedCard.dueDay || 0),
            closingDay: Number(summary?.closingDay || selectedCard.closingDay || 0),
            lastInvoiceImportedAt: new Date().toISOString(),
            lastInvoiceFileName: fileName,
          })
        }
      }

      navigate('/lancar')
    } catch (error) {
      console.error(error)
      alert(error.message || 'Não foi possível salvar os lançamentos importados.')
      setStep('preview')
    } finally {
      isSavingRef.current = false
    }
  }

  function renderTargetSelector() {
    if (importType === 'bank') {
      return (
        <div className="account-select-row">
          <label className="account-select-label">Conta de destino</label>
          <select className="account-select" value={accountId} onChange={(event) => setAccountId(event.target.value)}>
            <option value="">Selecione a conta</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>{account.name}</option>
            ))}
          </select>
          <p className="import-target-hint">
            O extrato será vinculado à conta escolhida e os lançamentos irão para a conferência em amarelo.
          </p>
        </div>
      )
    }

    if (importType === 'invoice') {
      return (
        <div className="account-select-row">
          <label className="account-select-label">Cartão da fatura</label>
          <select className="account-select" value={cardId} onChange={(event) => setCardId(event.target.value)}>
            <option value="">Selecione o cartão</option>
            {cards.map((card) => (
              <option key={card.id} value={card.id}>{card.name}</option>
            ))}
          </select>
          <p className="import-target-hint">
            A competência de cada compra será calculada conforme o fechamento e o vencimento deste cartão.
          </p>
        </div>
      )
    }

    return (
      <div className="account-select-row">
        <label className="account-select-label">Origem do pagamento</label>
        <div className="import-target-mode">
          <button
            type="button"
            className={`import-target-pill${paymentOrigin === 'cash' ? ' active' : ''}`}
            onClick={() => setPaymentOrigin('cash')}
          >
            Dinheiro
          </button>
          <button
            type="button"
            className={`import-target-pill${paymentOrigin === 'account' ? ' active' : ''}`}
            onClick={() => setPaymentOrigin('account')}
          >
            Conta / Pix
          </button>
          <button
            type="button"
            className={`import-target-pill${paymentOrigin === 'card' ? ' active' : ''}`}
            onClick={() => setPaymentOrigin('card')}
          >
            Cartão
          </button>
        </div>

        {paymentOrigin === 'account' && (
          <select className="account-select" value={accountId} onChange={(event) => setAccountId(event.target.value)}>
            <option value="">Selecione a conta</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>{account.name}</option>
            ))}
          </select>
        )}

        {paymentOrigin === 'card' && (
          <select className="account-select" value={cardId} onChange={(event) => setCardId(event.target.value)}>
            <option value="">Selecione o cartão</option>
            {cards.map((card) => (
              <option key={card.id} value={card.id}>{card.name}</option>
            ))}
          </select>
        )}

        {paymentOrigin === 'cash' && (
          <select className="account-select" value={cashOriginType} onChange={(event) => setCashOriginType(event.target.value)}>
            {CASH_ORIGIN_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        )}

        <select className="account-select" value={receiptDocumentType} onChange={(event) => setReceiptDocumentType(event.target.value)}>
          {RECEIPT_DOCUMENT_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>

        <p className="import-target-hint">
          O cupom vira itens separados por categoria, já preparados para revisão em Lançar.
        </p>
      </div>
    )
  }

  return (
    <div className="importacao-page">
      <div className="import-mode-header">
        <div>
          <span className="import-mode-kicker">{config.kicker}</span>
          <h2>{config.title}</h2>
          <p>{config.description}</p>
        </div>
      </div>

      {step === 'idle' && (
        <Card>
          <label className="dropzone" htmlFor="import-file-input">
            <span className="dropzone-icon">{importType === 'receipt' ? '🧾' : importType === 'bank' ? '🏦' : '💳'}</span>
            <p className="dropzone-title">{config.cta}</p>
            <p className="dropzone-sub">{config.accept.replaceAll(',', ' • ')}</p>
            <span className="dropzone-btn">Escolher arquivo</span>
            <input
              id="import-file-input"
              ref={fileInputRef}
              type="file"
              accept={config.accept}
              onChange={(event) => handleFile(event.target.files?.[0])}
              hidden
            />
          </label>
        </Card>
      )}

      {errorMessage && step === 'idle' && (
        <div className="parse-error-box">
          <strong>Não foi possível importar</strong>
          <p>{errorMessage}</p>
        </div>
      )}

      {step === 'parsing' && (
        <div className="import-loading">
          <div className="import-spinner" />
          <p>{config.loading}</p>
        </div>
      )}

      {step === 'saving' && (
        <div className="import-loading">
          <div className="import-spinner" />
          <p>Enviando os lançamentos para a fila de conferência...</p>
        </div>
      )}

      {step === 'preview' && (
        <>
          <div className="preview-summary-bar">
            <div className="psb-info">
              <span className="psb-file">{fileName}</span>
              <span className="psb-meta">
                {importType === 'receipt' && (
                  <>
                    {receiptMeta.merchantName || 'Cupom importado'}
                    {receiptMeta.purchaseDate ? ` • ${receiptMeta.purchaseDate}` : ''}
                    {receiptMeta.totalAmount > 0 ? ` • Total ${formatCurrency(receiptMeta.totalAmount)}` : ''}
                  </>
                )}
                {importType !== 'receipt' && (
                  <>
                    {selectedCount} item(ns) selecionado(s)
                    {summary?.hasBalanceInfo && Number.isFinite(Number(summary?.closingBalance))
                      ? ` • Saldo final ${formatCurrency(Number(summary.closingBalance))}`
                      : ''}
                  </>
                )}
              </span>
            </div>
            <div className={`psb-net ${selectedTotal >= 0 ? 'pos' : 'neg'}`}>
              {formatCurrency(selectedTotal)}
            </div>
          </div>

          <Card>
            {renderTargetSelector()}

            <div className="preview-bulk-row">
              <span className="preview-bulk-info">{selectedCount} item(ns) selecionado(s)</span>
              <button type="button" className="btn-link" onClick={handleSelectAllNew}>Selecionar novos</button>
              <button type="button" className="btn-link" onClick={() => setSelectedIds(new Set())}>Limpar</button>
            </div>

            <div className="preview-rows">
              {parsedRows.map((row) => {
                const checked = selectedIds.has(row.id)
                const category = resolveCategoryForReceiptRow(row, expenseLookup)
                const footerPieces = [
                  row.date,
                  importType === 'receipt'
                    ? (category?.name || row.budgetCategoryName || row.detailCategoryLabel || '')
                    : (row.categoryName || ''),
                  row.detailSubcategoryLabel || '',
                ].filter(Boolean)

                return (
                  <label
                    key={row.id}
                    className={`preview-row${!checked ? ' preview-row--unchecked' : ''}${row.isDuplicate ? ' preview-row--review' : ''}`}
                  >
                    <input
                      className="preview-check"
                      type="checkbox"
                      checked={checked}
                      disabled={row.isDuplicate}
                      onChange={() => toggleRow(row)}
                    />
                    <div className="preview-row-body">
                      <div className="preview-row-top">
                        <span className="preview-row-desc">{row.description || 'Sem descrição'}</span>
                        <span className={`preview-amount ${Number(row.amount || 0) >= 0 ? 'pos' : 'neg'}`}>
                          {formatCurrency(row.amount)}
                        </span>
                      </div>
                      <div className="preview-row-footer">
                        {footerPieces.map((piece) => (
                          <span key={`${row.id}-${piece}`} className="preview-date">{piece}</span>
                        ))}
                        {row.isDuplicate && <span className="preview-review-tag">Duplicado</span>}
                        {importType !== 'receipt' && row.status === 'confirmed' && (
                          <span className="preview-review-tag preview-review-tag--info">Auto confirmado</span>
                        )}
                      </div>
                    </div>
                  </label>
                )
              })}
            </div>

            <div className="import-step-actions">
              <button type="button" className="btn-secondary" onClick={resetPreview}>Trocar arquivo</button>
              <button type="button" className="btn-primary" onClick={handleLaunch} disabled={selectedCount === 0}>
                {config.launch}
              </button>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
