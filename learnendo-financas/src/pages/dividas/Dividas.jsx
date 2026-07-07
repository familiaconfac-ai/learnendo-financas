import { useMemo, useState } from 'react'
import Card, { CardHeader } from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import { useAuth } from '../../context/AuthContext'
import { useWorkspace } from '../../context/WorkspaceContext'
import { useDebts } from '../../hooks/useDebts'
import { getExternalDebtDirection, isFamilyInternalDebt } from '../../services/debtService'
import { formatCurrency } from '../../utils/formatCurrency'
import { formatDateBR } from '../../utils/formatDate'
import './Dividas.css'

const DEBT_TYPES = [
  { value: 'pessoa', label: 'Pessoa' },
  { value: 'banco', label: 'Banco' },
  { value: 'cartao', label: 'Cartao' },
  { value: 'empresa', label: 'Empresa' },
]

const EXTERNAL_DIRECTION_OPTIONS = [
  { value: 'i_owe_contact', label: 'Eu devo para essa pessoa' },
  { value: 'contact_owes_me', label: 'Essa pessoa me deve' },
]

function resolveDebtDirection(debt, currentUserId) {
  if (isFamilyInternalDebt(debt)) {
    if (debt.creditorMemberId === currentUserId) return 'receivable'
    if (debt.debtorMemberId === currentUserId) return 'payable'
    return 'neutral'
  }
  return getExternalDebtDirection(debt) === 'contact_owes_me' ? 'receivable' : 'payable'
}

function debtDirectionLabel(debt, currentUserId) {
  const direction = resolveDebtDirection(debt, currentUserId)
  if (direction === 'receivable') return 'A receber'
  if (direction === 'payable') return 'A pagar'
  return 'Compartilhada'
}

function debtTypeLabel(debtType) {
  return DEBT_TYPES.find((option) => option.value === debtType)?.label || debtType || 'Pessoa'
}

export default function Dividas() {
  const { user } = useAuth()
  const { contacts, addExternalContact } = useWorkspace()
  const { debts, paymentsByDebtId, loading, error, addDebt, removeDebt } = useDebts()
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name: '',
    type: 'pessoa',
    direction: 'i_owe_contact',
    totalAmount: '',
  })

  const totals = useMemo(() => {
    return debts.reduce(
      (acc, debt) => {
        const direction = resolveDebtDirection(debt, user?.uid)
        const remainingAmount = Number(debt.remainingAmount || 0)
        acc.total += Number(debt.totalAmount || 0)
        acc.paid += Number(debt.paidAmount || 0)
        if (direction === 'receivable') acc.receivable += remainingAmount
        if (direction === 'payable') acc.payable += remainingAmount
        return acc
      },
      { total: 0, paid: 0, payable: 0, receivable: 0 },
    )
  }, [debts, user?.uid])

  function handleChange(e) {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim() || !form.totalAmount) return

    setSaving(true)
    try {
      const normalizedName = form.name.trim()
      const existingContact = (Array.isArray(contacts) ? contacts : []).find(
        (contact) => String(contact?.name || '').trim().toLowerCase() === normalizedName.toLowerCase(),
      )
      const linkedContact = existingContact || await addExternalContact(normalizedName)

      await addDebt({
        name: normalizedName,
        type: form.type,
        relationshipKind: 'external_contact',
        contactId: linkedContact?.id || null,
        contactName: linkedContact?.name || normalizedName,
        externalDirection: form.direction,
        totalAmount: Number(form.totalAmount),
        paidAmount: 0,
      })
      setForm({ name: '', type: 'pessoa', direction: 'i_owe_contact', totalAmount: '' })
      setModalOpen(false)
    } catch (err) {
      alert('Erro ao criar divida: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteDebt(debt) {
    const confirmed = window.confirm(`Excluir a divida "${debt.name}"?`)
    if (!confirmed) return

    setSaving(true)
    try {
      await removeDebt(debt.id)
    } catch (err) {
      alert('Erro ao excluir divida: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="dividas-page">
      <Card className="dividas-summary-card">
        <CardHeader title="Controle de dividas" subtitle="Separado do orcamento mensal" />
        <div className="dividas-summary-grid">
          <div>
            <span className="summary-label">Valor total</span>
            <strong>{formatCurrency(totals.total)}</strong>
          </div>
          <div>
            <span className="summary-label">Total compensado</span>
            <strong className="summary-paid">{formatCurrency(totals.paid)}</strong>
          </div>
          <div>
            <span className="summary-label">A pagar</span>
            <strong className="summary-remaining">{formatCurrency(totals.payable)}</strong>
          </div>
          <div>
            <span className="summary-label">A receber</span>
            <strong className="summary-paid">{formatCurrency(totals.receivable)}</strong>
          </div>
        </div>
      </Card>

      {loading ? (
        <Card><p>Carregando dividas...</p></Card>
      ) : error ? (
        <Card><p>Erro ao carregar dividas: {error}</p></Card>
      ) : debts.length === 0 ? (
        <Card className="dividas-empty">
          <p>Nenhuma divida cadastrada.</p>
          <p className="empty-hint">Toque em Nova divida para comecar.</p>
        </Card>
      ) : (
        <div className="dividas-list">
          {debts.map((debt) => {
            const payments = paymentsByDebtId[debt.id] || []
            const direction = resolveDebtDirection(debt, user?.uid)
            return (
              <Card key={debt.id} className="debt-card">
                <div className="debt-header">
                  <div>
                    <h3 className="debt-name">{debt.name}</h3>
                    <p className="debt-type">
                      {debtDirectionLabel(debt, user?.uid)} · {debtTypeLabel(debt.type)}
                    </p>
                  </div>
                  <div className="debt-header-actions">
                    <span className="debt-badge">{payments.length} pagamento(s)</span>
                    <button type="button" className="debt-delete-btn" onClick={() => handleDeleteDebt(debt)}>
                      Excluir
                    </button>
                  </div>
                </div>

                <div className="debt-values">
                  <div className="debt-row">
                    <span>Total</span>
                    <strong>{formatCurrency(debt.totalAmount)}</strong>
                  </div>
                  <div className="debt-row">
                    <span>Compensado</span>
                    <strong className="summary-paid">{formatCurrency(debt.paidAmount)}</strong>
                  </div>
                  <div className="debt-row">
                    <span>{direction === 'receivable' ? 'A receber' : 'A pagar'}</span>
                    <strong className={direction === 'receivable' ? 'summary-paid' : 'summary-remaining'}>
                      {formatCurrency(debt.remainingAmount)}
                    </strong>
                  </div>
                </div>

                <div className="debt-history">
                  <span className="history-title">Historico</span>
                  {payments.length === 0 ? (
                    <p className="history-empty">Nenhum pagamento vinculado.</p>
                  ) : (
                    <ul className="history-list">
                      {payments.slice(0, 8).map((payment) => (
                        <li key={payment.id} className="history-item">
                          <span>{payment.description || 'Pagamento de divida'}</span>
                          <span>
                            {formatCurrency(payment.amount)} · {formatDateBR(payment.date)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <button className="fab" onClick={() => setModalOpen(true)} aria-label="Nova divida">
        +
      </button>

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Nova divida"
        footer={
          <>
            <Button variant="ghost" fullWidth onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button variant="primary" fullWidth onClick={handleSubmit} loading={saving}>Salvar</Button>
          </>
        }
      >
        <form className="launch-form" onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label>Nome</label>
            <input
              name="name"
              type="text"
              value={form.name}
              onChange={handleChange}
              placeholder="Pessoa ou instituicao"
              required
            />
          </div>
          <div className="form-group">
            <label>Tipo</label>
            <select name="type" value={form.type} onChange={handleChange}>
              {DEBT_TYPES.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Como essa relacao funciona</label>
            <select name="direction" value={form.direction} onChange={handleChange}>
              {EXTERNAL_DIRECTION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Valor total</label>
            <input
              name="totalAmount"
              type="number"
              min="0.01"
              step="0.01"
              value={form.totalAmount}
              onChange={handleChange}
              placeholder="0,00"
              required
            />
          </div>
        </form>
      </Modal>
    </div>
  )
}
