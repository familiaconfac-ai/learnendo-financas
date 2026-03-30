import { useMemo, useState } from 'react'
import Card, { CardHeader } from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import { useDebts } from '../../hooks/useDebts'
import { formatCurrency } from '../../utils/formatCurrency'
import { formatDateBR } from '../../utils/formatDate'
import './Dividas.css'

const DEBT_TYPES = [
  { value: 'pessoa', label: 'Pessoa' },
  { value: 'banco', label: 'Banco' },
  { value: 'cartao', label: 'Cartão' },
  { value: 'empresa', label: 'Empresa' },
]

export default function Dividas() {
  const { debts, paymentsByDebtId, loading, error, addDebt } = useDebts()
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', type: 'pessoa', totalAmount: '' })

  const totals = useMemo(() => {
    return debts.reduce(
      (acc, debt) => {
        acc.total += Number(debt.totalAmount || 0)
        acc.paid += Number(debt.paidAmount || 0)
        acc.remaining += Number(debt.remainingAmount || 0)
        return acc
      },
      { total: 0, paid: 0, remaining: 0 },
    )
  }, [debts])

  function handleChange(e) {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim() || !form.totalAmount) return

    setSaving(true)
    try {
      await addDebt({
        name: form.name.trim(),
        type: form.type,
        totalAmount: Number(form.totalAmount),
        paidAmount: 0,
      })
      setForm({ name: '', type: 'pessoa', totalAmount: '' })
      setModalOpen(false)
    } catch (err) {
      alert('Erro ao criar dívida: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="dividas-page">
      <Card className="dividas-summary-card">
        <CardHeader title="Controle de dívidas" subtitle="Separado do orçamento mensal" />
        <div className="dividas-summary-grid">
          <div>
            <span className="summary-label">Valor total</span>
            <strong>{formatCurrency(totals.total)}</strong>
          </div>
          <div>
            <span className="summary-label">Total pago</span>
            <strong className="summary-paid">{formatCurrency(totals.paid)}</strong>
          </div>
          <div>
            <span className="summary-label">Saldo restante</span>
            <strong className="summary-remaining">{formatCurrency(totals.remaining)}</strong>
          </div>
        </div>
      </Card>

      {loading ? (
        <Card><p>Carregando dívidas...</p></Card>
      ) : error ? (
        <Card><p>Erro ao carregar dívidas: {error}</p></Card>
      ) : debts.length === 0 ? (
        <Card className="dividas-empty">
          <p>Nenhuma dívida cadastrada.</p>
          <p className="empty-hint">Toque em Nova dívida para começar.</p>
        </Card>
      ) : (
        <div className="dividas-list">
          {debts.map((debt) => {
            const payments = paymentsByDebtId[debt.id] || []
            return (
              <Card key={debt.id} className="debt-card">
                <div className="debt-header">
                  <div>
                    <h3 className="debt-name">{debt.name}</h3>
                    <p className="debt-type">{debt.type}</p>
                  </div>
                  <span className="debt-badge">{payments.length} pagamento(s)</span>
                </div>

                <div className="debt-values">
                  <div className="debt-row">
                    <span>Total</span>
                    <strong>{formatCurrency(debt.totalAmount)}</strong>
                  </div>
                  <div className="debt-row">
                    <span>Pago</span>
                    <strong className="summary-paid">{formatCurrency(debt.paidAmount)}</strong>
                  </div>
                  <div className="debt-row">
                    <span>Restante</span>
                    <strong className="summary-remaining">{formatCurrency(debt.remainingAmount)}</strong>
                  </div>
                </div>

                <div className="debt-history">
                  <span className="history-title">Histórico</span>
                  {payments.length === 0 ? (
                    <p className="history-empty">Nenhum pagamento vinculado.</p>
                  ) : (
                    <ul className="history-list">
                      {payments.slice(0, 8).map((payment) => (
                        <li key={payment.id} className="history-item">
                          <span>{payment.description || 'Pagamento de dívida'}</span>
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

      <button className="fab" onClick={() => setModalOpen(true)} aria-label="Nova dívida">
        +
      </button>

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Nova dívida"
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
              placeholder="Pessoa ou instituição"
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
