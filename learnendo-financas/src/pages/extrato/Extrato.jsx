import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useWorkspace } from '../../context/WorkspaceContext'
import Card, { CardHeader } from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import { InlineLoading as Loading } from '../../components/ui/Loading'
import Modal from '../../components/ui/Modal'
import { formatCurrency } from '../../utils/formatCurrency'
import { statementRange } from '../../utils/memberStatement'
import {
  exportMemberStatementCsv,
  exportMemberStatementPdf,
  loadMemberStatement,
} from '../../services/memberStatementService'
import './Extrato.css'

const PERIODS = [
  ['today', 'Hoje'],
  ['7days', 'Últimos 7 dias'],
  ['month', 'Este mês'],
  ['previousMonth', 'Mês anterior'],
  ['year', 'Ano'],
  ['custom', 'Personalizado'],
]

function memberIdentity(member) {
  return String(member?.uid || member?.userId || member?.id || '').trim()
}

function dateInputValue(date) {
  const value = new Date(date)
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dateParts(value) {
  const date = new Date(value)
  return {
    date: date.toLocaleDateString('pt-BR'),
    time: date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    full: date.toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'medium' }),
  }
}

function signedCurrency(value) {
  const numeric = Number(value || 0)
  if (!numeric) return formatCurrency(0)
  return `${numeric > 0 ? '+' : '-'} ${formatCurrency(Math.abs(numeric))}`
}

function Summary({ summary }) {
  const items = [
    ['Saldo anterior', summary.openingBalance],
    ['Total de créditos', summary.totalCredits],
    ['Total de débitos', summary.totalDebits ? -summary.totalDebits : 0],
    ['Juros positivos', summary.positiveInterest],
    ['Juros negativos', summary.negativeInterest ? -summary.negativeInterest : 0],
    ['Juros líquidos', summary.netInterest],
    ['Saldo do período', summary.periodBalance],
    ['Saldo atual', summary.currentBalance],
  ]
  return (
    <div className="statement-summary-grid">
      {items.map(([label, value]) => (
        <div key={label} className="statement-summary-item">
          <span>{label}</span>
          <strong className={Number(value) < 0 ? 'negative' : Number(value) > 0 ? 'positive' : ''}>{formatCurrency(value)}</strong>
        </div>
      ))}
    </div>
  )
}

function MovementDetails({ row, onClose }) {
  if (!row) return null
  const parts = dateParts(row.date)
  return (
    <Modal isOpen={Boolean(row)} onClose={onClose} title="Detalhes da movimentação">
      <div className="statement-detail-grid">
        <div><span>Documento de origem</span><strong>{row.details?.sourceDocument || 'Não informado'}</strong></div>
        <div><span>Data completa</span><strong>{parts.full}</strong></div>
        <div><span>Quem criou</span><strong>{row.details?.createdBy || 'Não informado'}</strong></div>
        <div><span>Quem confirmou</span><strong>{row.details?.confirmedBy || 'Não informado'}</strong></div>
        <div><span>Juros acumulados</span><strong>{formatCurrency(row.details?.accruedInterest)}</strong></div>
        <div><span>Situação</span><strong>{row.statusLabel}</strong></div>
        <div className="wide"><span>Observações</span><strong>{row.details?.notes || 'Sem observações.'}</strong></div>
      </div>
      <div className="statement-history">
        <h3>Histórico de alterações</h3>
        {(row.details?.history || []).length === 0 ? <p>Nenhuma alteração registrada.</p> : (
          <ol>
            {row.details.history.map((item, index) => (
              <li key={`${item.date}:${index}`}>
                <strong>{item.label}</strong>
                <span>{new Date(item.date).toLocaleString('pt-BR')}</span>
                {item.actor && <span>Responsável: {item.actor}</span>}
                {item.amount != null && <span>Valor: {formatCurrency(item.amount)}</span>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </Modal>
  )
}

function StatementTable({ rows, onSelect }) {
  if (rows.length === 0) return <div className="statement-empty">Nenhuma movimentação encontrada para estes filtros.</div>
  return (
    <div className="statement-table-wrap">
      <table className="statement-table">
        <thead>
          <tr>
            <th>Data</th><th>Hora</th><th>Tipo</th><th>Descrição</th><th>Credor</th><th>Devedor</th>
            <th>Valor principal</th><th>Juros gerados até a data</th><th>Valor total</th><th>Situação</th><th>Saldo após a movimentação</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const parts = dateParts(row.date)
            return (
              <tr key={row.id} onClick={() => onSelect(row)} tabIndex="0" onKeyDown={(event) => event.key === 'Enter' && onSelect(row)}>
                <td>{parts.date}</td><td>{parts.time}</td><td>{row.type}</td><td>{row.description}</td>
                <td>{row.creditor}</td><td>{row.debtor}</td>
                <td className={row.principalAmount < 0 ? 'negative' : row.principalAmount > 0 ? 'positive' : ''}>{signedCurrency(row.principalAmount)}</td>
                <td className={row.interestAmount < 0 ? 'negative' : row.interestAmount > 0 ? 'positive' : ''}>{signedCurrency(row.interestAmount)}</td>
                <td className={row.totalAmount < 0 ? 'negative' : row.totalAmount > 0 ? 'positive' : ''}>{signedCurrency(row.totalAmount)}</td>
                <td><span className={`statement-status ${row.status}`}>{row.statusLabel}</span></td>
                <td className={row.balanceAfter < 0 ? 'negative' : row.balanceAfter > 0 ? 'positive' : ''}>{row.balanceAfter == null ? '—' : formatCurrency(row.balanceAfter)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function Extrato() {
  const { user, profile, isAdmin } = useAuth()
  const { activeWorkspaceId, activeWorkspace, members, loading: workspaceLoading } = useWorkspace()
  const [periodPreset, setPeriodPreset] = useState('month')
  const initialRange = useMemo(() => statementRange('month'), [])
  const [customStart, setCustomStart] = useState(dateInputValue(initialRange.start))
  const [customEnd, setCustomEnd] = useState(dateInputValue(initialRange.end))
  const [direction, setDirection] = useState('all')
  const [status, setStatus] = useState('all')
  const [onlyInterest, setOnlyInterest] = useState(false)
  const [selectedMemberId, setSelectedMemberId] = useState('')
  const [statement, setStatement] = useState(null)
  const [selectedRow, setSelectedRow] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const availableMembers = useMemo(() => members.filter((member) => (
    !member.status || ['active', 'ativo', 'accepted'].includes(String(member.status).toLowerCase())
  )), [members])
  const ownMember = useMemo(() => availableMembers.find((member) => memberIdentity(member) === user?.uid), [availableMembers, user?.uid])

  useEffect(() => {
    if (!user?.uid) return
    if (!isAdmin) {
      setSelectedMemberId(user.uid)
      return
    }
    if (!selectedMemberId) setSelectedMemberId(memberIdentity(ownMember || availableMembers[0]))
  }, [availableMembers, isAdmin, ownMember, selectedMemberId, user?.uid])

  const target = useMemo(() => {
    if (!isAdmin) return ownMember || { id: user?.uid, uid: user?.uid, email: user?.email || profile?.email, displayName: profile?.displayName || user?.displayName || 'Minha conta' }
    return availableMembers.find((member) => memberIdentity(member) === selectedMemberId) || null
  }, [availableMembers, isAdmin, ownMember, profile, selectedMemberId, user])

  useEffect(() => {
    let active = true
    async function load() {
      if (!activeWorkspaceId || !target) return
      setLoading(true)
      setError('')
      try {
        const range = statementRange(periodPreset, new Date(), { start: customStart, end: customEnd })
        const result = await loadMemberStatement({
          workspaceId: activeWorkspaceId,
          target,
          members: availableMembers,
          start: range.start,
          end: range.end,
          now: new Date(),
          filters: { direction, status, onlyInterest },
        })
        if (active) setStatement(result)
      } catch (loadError) {
        if (active) setError(loadError?.message || 'Não foi possível carregar o extrato.')
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [activeWorkspaceId, availableMembers, customEnd, customStart, direction, onlyInterest, periodPreset, status, target])

  if (workspaceLoading) return <Loading text="Carregando extrato..." />

  return (
    <div className="statement-page">
      <div className="statement-heading">
        <div>
          <span className="statement-eyebrow">Visão oficial do saldo familiar</span>
          <h1>Extrato Financeiro</h1>
          <p>{activeWorkspace?.name || 'Workspace familiar'} · saldo reconstruído automaticamente pelas movimentações</p>
        </div>
        {statement && (
          <div className="statement-actions">
            <Button variant="secondary" onClick={() => exportMemberStatementCsv(statement)}>Exportar CSV</Button>
            <Button onClick={() => exportMemberStatementPdf(statement)}>Exportar PDF</Button>
          </div>
        )}
      </div>

      <Card className="statement-filter-card">
        <CardHeader title="Período e filtros" subtitle="Os filtros não alteram o saldo oficial mostrado em cada linha." />
        {isAdmin && (
          <label className="statement-field admin-member-field">
            <span>Extrato do membro</span>
            <select value={selectedMemberId} onChange={(event) => setSelectedMemberId(event.target.value)}>
              {availableMembers.map((member) => <option key={memberIdentity(member)} value={memberIdentity(member)}>{member.displayName || member.name || member.email}</option>)}
            </select>
            <small>Acesso administrativo: visualização permitida para qualquer membro deste workspace.</small>
          </label>
        )}
        <div className="statement-periods" role="group" aria-label="Período do extrato">
          {PERIODS.map(([value, label]) => (
            <button key={value} type="button" className={periodPreset === value ? 'active' : ''} onClick={() => setPeriodPreset(value)}>{label}</button>
          ))}
        </div>
        {periodPreset === 'custom' && (
          <div className="statement-custom-range">
            <label className="statement-field"><span>Data inicial</span><input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} /></label>
            <label className="statement-field"><span>Data final</span><input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} /></label>
          </div>
        )}
        <div className="statement-secondary-filters">
          <label className="statement-field"><span>Movimentações</span><select value={direction} onChange={(event) => setDirection(event.target.value)}><option value="all">Créditos e débitos</option><option value="credits">Apenas créditos</option><option value="debits">Apenas débitos</option></select></label>
          <label className="statement-field"><span>Situação</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Todas as situações</option><option value="pending">Apenas pendentes</option><option value="confirmed">Apenas confirmados</option></select></label>
          <label className="statement-interest-toggle"><input type="checkbox" checked={onlyInterest} onChange={(event) => setOnlyInterest(event.target.checked)} /><span>Apenas juros</span></label>
        </div>
      </Card>

      {error && <div className="statement-error">{error}</div>}
      {loading && <Loading text="Reconstruindo saldo linha a linha..." />}
      {!loading && statement && (
        <>
          <Card className="statement-summary-card">
            <CardHeader title={`Resumo do período · ${statement.target.displayName}`} subtitle={`${new Date(statement.period.start).toLocaleDateString('pt-BR')} a ${new Date(statement.period.end).toLocaleDateString('pt-BR')}`} />
            <Summary summary={statement.summary} />
            <div className="statement-equation">
              <span>Saldo anterior <strong>{formatCurrency(statement.summary.openingBalance)}</strong></span><b>+</b>
              <span>Créditos <strong>{formatCurrency(statement.summary.totalCredits)}</strong></span><b>−</b>
              <span>Débitos <strong>{formatCurrency(statement.summary.totalDebits)}</strong></span><b>+</b>
              <span>Juros líquidos <strong>{formatCurrency(statement.summary.netInterest)}</strong></span><b>=</b>
              <span>Saldo final <strong>{formatCurrency(statement.summary.closingBalance)}</strong></span>
            </div>
          </Card>

          <Card className="statement-ledger-card">
            <CardHeader title="Movimentações confirmadas" subtitle="Clique em uma linha para consultar documento, responsáveis, histórico e observações." />
            <StatementTable rows={statement.rows} onSelect={setSelectedRow} />
          </Card>

          <Card className="statement-pending-card">
            <CardHeader title="Pendências" subtitle="Estas movimentações não entram no saldo confirmado." />
            {statement.pending.length === 0 ? <div className="statement-empty">Nenhuma pendência encontrada para estes filtros.</div> : (
              <div className="statement-pending-list">
                {statement.pending.map((row) => (
                  <button type="button" key={row.id} onClick={() => setSelectedRow(row)}>
                    <div><strong>{row.description}</strong><span>{dateParts(row.date).full}</span><span>{row.creditor} → {row.debtor}</span></div>
                    <div><strong>{signedCurrency(row.totalAmount)}</strong><span>Aguardando confirmação.</span></div>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
      <MovementDetails row={selectedRow} onClose={() => setSelectedRow(null)} />
    </div>
  )
}
