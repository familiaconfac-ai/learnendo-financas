import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useWorkspace } from '../../context/WorkspaceContext'
import { useAccounts } from '../../hooks/useAccounts'
import { useCategories } from '../../hooks/useCategories'
import { addTransaction, fetchTransactions } from '../../services/transactionService'
import { parseStatementFile } from '../../utils/statementParser'
import { classifyBatch } from '../../utils/transactionClassifier'
import { buildDuplicateSignature, findDuplicateMatches } from '../../utils/transactionDuplicates'
import { formatCurrency } from '../../utils/formatCurrency'
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

// ── Component ─────────────────────────────────────────────────────────────────

export default function Importacao() {
  const navigate                         = useNavigate()
  const { user }                         = useAuth()
  const { activeWorkspaceId, myRole, permissions, transactionNatures } = useWorkspace()
  const { accounts, loading: loadingAccounts } = useAccounts()
  const { categories } = useCategories()

  // ── State ────────────────────────────────────────────────────────────────

  const [step, setStep]                  = useState('idle')   // idle|parsing|preview|saving|done
  const [parsedRows, setParsedRows]      = useState([])
  const [selectedIds, setSelectedIds]    = useState(new Set())
  const [accountId, setAccountId]        = useState('')
  const [parseError, setParseError]      = useState(null)
  const [parsePreviewLines, setParsePreviewLines] = useState([])
  const [savedCount, setSavedCount]      = useState(0)
  const [skippedCount, setSkippedCount]  = useState(0)
  const [saveError, setSaveError]        = useState(null)
  const [dragOver, setDragOver]          = useState(false)
  const [fileName, setFileName]          = useState('')
  const [saveMessage, setSaveMessage]    = useState('')
  const [existingMonthTx, setExistingMonthTx] = useState([])
  const [duplicateAuditLoading, setDuplicateAuditLoading] = useState(false)

  // ── File handling ─────────────────────────────────────────────────────────

  async function handleFile(file) {
    setParseError(null)
    setParsePreviewLines([])
    setFileName(file.name)
    setStep('parsing')

    try {
      const raw = await parseStatementFile(file)

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

  // ── Confirm & save ────────────────────────────────────────────────────────

  async function handleConfirmImport() {
    if (!user?.uid) return
    if (!permissions.canImport) {
      setSaveError('Seu papel atual não permite importação neste workspace.')
      return
    }
    if (!accountId) {
      setSaveError('Selecione uma conta antes de continuar.')
      return
    }

    setSaveError(null)
    setSaveMessage('')
    setStep('saving')

    const toSave = parsedRows.filter((r) => selectedIds.has(r.id))
    const batchId = Date.now().toString(36)
    let count = 0
    let skipped = 0
    const failed = []

    try {
      const monthKeys = [...new Set(
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
        const signature = buildDuplicateSignature(row, accountId)
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
          await addTransaction(user.uid, {
            type:                     row.type,
            description:              row.description,
            amount:                   row.amount,
            date:                     row.date,
            accountId,
            categoryId:               hintedCategory?.id || null,
            categoryName:             hintedCategory?.name || null,
            notes:                    '',
            origin:                   row.source === 'image_receipt' ? 'manual' : 'bank_import',
            status:                   'pending',
            workspaceId:              activeWorkspaceId,
            createdBy:                user.uid,
            userId:                   user.uid,
            transactionNatureId:      row.type === 'income' ? 'nature_income' : 'nature_expense',
            transactionNatureLabel:   transactionNatures.find((n) => n.id === (row.type === 'income' ? 'nature_income' : 'nature_expense'))?.label || null,
            affectsBudget:            true,
            balanceImpact:            row.type !== 'transfer_internal',
            importBatchId:            batchId,
            classificationConfidence: row.classification?.confidence ?? 'low',
          }, { workspaceId: activeWorkspaceId })
          knownSignatures.add(signature)
          count++
        } catch (err) {
          console.error('[Importacao] Save failed for:', row.description, err.message)
          failed.push(row.description)
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
    setParseError(null)
    setParsePreviewLines([])
    setSavedCount(0)
    setSkippedCount(0)
    setSaveError(null)
    setSaveMessage('')
    setFileName('')
    setExistingMonthTx([])
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
        const monthKeys = [...new Set(
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
  }, [step, user?.uid, parsedRows])

  const duplicateMapByRowId = useMemo(() => {
    if (!accountId || existingMonthTx.length === 0) return {}
    const map = {}
    parsedRows.forEach((row) => {
      const matches = findDuplicateMatches(row, existingMonthTx, { accountIdOverride: accountId })
      map[row.id] = {
        exact: matches.isExactDuplicate,
        possible: !matches.isExactDuplicate && matches.hasPossibleDuplicate,
        exactCount: matches.exact.length,
        possibleCount: matches.possible.length,
      }
    })
    return map
  }, [parsedRows, existingMonthTx, accountId])

  useEffect(() => {
    if (!accountId) return
    setSelectedIds((prev) => {
      const next = new Set(prev)
      parsedRows.forEach((row) => {
        if (duplicateMapByRowId[row.id]?.exact) next.delete(row.id)
      })
      return next
    })
  }, [accountId, parsedRows, duplicateMapByRowId])

  // ── Derived values ────────────────────────────────────────────────────────

  const reviewCount   = parsedRows.filter((r) => r.status === 'pending').length
  const selectedCount = selectedIds.size
  const exactDupCount = parsedRows.filter((r) => duplicateMapByRowId[r.id]?.exact).length
  const possibleDupCount = parsedRows.filter((r) => duplicateMapByRowId[r.id]?.possible).length
  const selectedNonExactCount = parsedRows.filter((r) => selectedIds.has(r.id) && !duplicateMapByRowId[r.id]?.exact).length
  const netSelected   = parsedRows
    .filter((r) => selectedIds.has(r.id))
    .reduce((sum, r) => sum + (r.direction === 'credit' ? r.amount : -r.amount), 0)

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
                <strong>PDF e imagem (básico)</strong>
                <p>Você pode enviar extrato em PDF e imagens (cupom/comprovante) para entrar na fila de revisão.</p>
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
              {accountId && exactDupCount > 0 && (
                <span className="badge badge-danger"> · {exactDupCount} duplicadas</span>
              )}
              {accountId && possibleDupCount > 0 && (
                <span className="badge badge-info"> · {possibleDupCount} possivelmente duplicadas</span>
              )}
            </span>
          </div>
          <span className={`psb-net ${netSelected >= 0 ? 'pos' : 'neg'}`}>
            {netSelected >= 0 ? '+' : ''}{formatCurrency(Math.abs(netSelected))}
          </span>
        </div>

        {/* Account selector */}
        <div className="account-select-row">
          <label className="account-select-label">Conta de importação</label>
          <select
            className="account-select"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            disabled={loadingAccounts}
          >
            <option value="">Selecione uma conta…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{accountLabel(a)}</option>
            ))}
          </select>
        </div>

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

        {/* Action bar */}
        <div className="import-step-actions">
          <button className="btn-secondary" onClick={handleReset}>Cancelar</button>
          <button
            className="btn-primary"
            onClick={handleConfirmImport}
            disabled={selectedNonExactCount === 0 || !accountId}
          >
            Salvar {selectedNonExactCount} lançamento{selectedNonExactCount !== 1 ? 's' : ''}
          </button>
        </div>
      </>
    )
  }

  function renderSaving() {
    return (
      <div className="import-loading">
        <div className="import-spinner" />
        <p>Salvando <strong>{selectedIds.size}</strong> lançamentos…</p>
      </div>
    )
  }

  function renderDone() {
    return (
      <div className="import-done">
        <span className="import-done-icon">✅</span>
        <p className="import-done-title">
          {savedCount} lançamento{savedCount !== 1 ? 's' : ''} importado{savedCount !== 1 ? 's' : ''}!
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
