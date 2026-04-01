import { useState } from 'react'
import { useFinance } from '../../context/FinanceContext'
import Card, { CardHeader } from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import { useAccounts } from '../../hooks/useAccounts'
import { formatCurrency } from '../../utils/formatCurrency'
import { MOCK_CARDS } from '../../utils/mockData'
import './Contas.css'

function hasStatementSnapshot(account) {
  return Number.isFinite(Number(account?.lastStatementOpeningBalance))
    || Number.isFinite(Number(account?.lastStatementClosingBalance))
}

function formatImportDate(value) {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toLocaleDateString('pt-BR')
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

function getMonthOpeningBalance(account, monthKey) {
  const value = account?.monthlyOpeningBalances?.[monthKey]
  return Number.isFinite(Number(value)) ? Number(value) : null
}

const COMMON_BRAZILIAN_BANKS = [
  'Nubank',
  'Caixa Econômica Federal',
  'Banco do Brasil',
  'Itaú',
  'Bradesco',
  'Santander',
  'Inter',
  'C6 Bank',
  'Sicredi',
  'Sicoob',
  'Mercado Pago',
  'PicPay',
  'PagBank',
]

export default function Contas() {
  const [tab, setTab] = useState('contas') // 'contas' | 'cartoes'
  const { selectedMonth, selectedYear } = useFinance()
  const { accounts, add, remove } = useAccounts()
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm]           = useState({ name: '', bank: '', type: 'checking', balance: '' })
  const [saving, setSaving]       = useState(false)
  const selectedMonthKey = buildMonthKey(selectedYear, selectedMonth)
  const selectedMonthLabel = formatMonthLabel(selectedYear, selectedMonth)

  function handleChange(e) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name) return
    setSaving(true)
    try {
      await add({ name: form.name, bank: form.bank, type: form.type, balance: form.balance || 0 })
      setModalOpen(false)
      setForm({ name: '', bank: '', type: 'checking', balance: '' })
    } catch (err) {
      alert('Erro ao salvar conta: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(acc) {
    if (!window.confirm(`Excluir a conta "${acc.name}"?`)) return
    try {
      await remove(acc.id)
    } catch (err) {
      alert('Erro ao excluir: ' + err.message)
    }
  }

  return (
    <div className="contas-page">
      {/* Tabs */}
      <div className="tabs-row">
        <button
          className={`tab-btn${tab === 'contas' ? ' active' : ''}`}
          onClick={() => setTab('contas')}
        >
          🏦 Contas
        </button>
        <button
          className={`tab-btn${tab === 'cartoes' ? ' active' : ''}`}
          onClick={() => setTab('cartoes')}
        >
          💳 Cartões
        </button>
      </div>

      <div className="contas-content">
        {tab === 'contas' && (
          <>
            {accounts.length === 0 ? (
              <Card className="contas-empty">
                <p>Nenhuma conta cadastrada.</p>
                <p className="contas-empty-hint">Toque em “+ Nova Conta” para adicionar.</p>
              </Card>
            ) : (
              accounts.map((acc) => {
                const monthOpeningBalance = getMonthOpeningBalance(acc, selectedMonthKey)
                const baselineBalance = monthOpeningBalance ?? Number(acc.initialBalance || 0)
                const balanceDiff = Number(acc.balance || 0) - baselineBalance

                return (
                <Card key={acc.id} className="account-card">
                  <div className="acc-header">
                    <div className="acc-icon" style={{ background: acc.color || '#1a56db' }}>
                      {acc.icon || '🏦'}
                    </div>
                    <div className="acc-info">
                      <span className="acc-name">{acc.name}</span>
                      <span className="acc-bank">{acc.bank}{acc.bank && ' · '}{TYPE_LABEL[acc.type] || acc.type}</span>
                    </div>
                    <button className="acc-del-btn" onClick={() => handleDelete(acc)} title="Excluir">🗑️</button>
                  </div>
                  <div className="acc-balance">
                    <span className="acc-balance-label">Saldo atual</span>
                    <span className={`acc-balance-value ${acc.balance >= 0 ? 'positive' : 'negative'}`}>
                      {formatCurrency(acc.balance)}
                    </span>
                  </div>
                  <div className="acc-meta">
                    <span>
                      {monthOpeningBalance !== null ? `Saldo inicial de ${selectedMonthLabel}` : 'Saldo inicial'}: {formatCurrency(baselineBalance)}
                    </span>
                    <span className={`acc-diff ${balanceDiff >= 0 ? 'pos' : 'neg'}`}>
                      {balanceDiff >= 0 ? '+' : ''}{formatCurrency(balanceDiff)}
                    </span>
                  </div>
                  {monthOpeningBalance !== null && (
                    <p className="acc-month-opening-note">
                      Este valor veio do saldo anterior importado para {selectedMonthLabel}.
                    </p>
                  )}
                  {hasStatementSnapshot(acc) && (
                    <div className="acc-statement">
                      <div className="acc-statement-header">
                        <span>Ultimo extrato importado</span>
                        {formatImportDate(acc.lastStatementImportedAt) && (
                          <span>{formatImportDate(acc.lastStatementImportedAt)}</span>
                        )}
                      </div>
                      <div className="acc-statement-grid">
                        <div className="acc-statement-item">
                          <span>Saldo anterior</span>
                          <strong>{formatCurrency(Number(acc.lastStatementOpeningBalance || 0))}</strong>
                        </div>
                        <div className="acc-statement-item">
                          <span>Saldo atual</span>
                          <strong>{formatCurrency(Number(acc.lastStatementClosingBalance || 0))}</strong>
                        </div>
                        <div className="acc-statement-item">
                          <span>Movimento</span>
                          <strong className={(acc.lastStatementNetMovement || 0) >= 0 ? 'acc-diff pos' : 'acc-diff neg'}>
                            {(acc.lastStatementNetMovement || 0) >= 0 ? '+' : ''}{formatCurrency(Math.abs(Number(acc.lastStatementNetMovement || 0)))}
                          </strong>
                        </div>
                      </div>
                      {acc.lastStatementFileName && (
                        <span className="acc-statement-file">{acc.lastStatementFileName}</span>
                      )}
                    </div>
                  )}
                </Card>
                )
              })
            )}

            {/* Resumo total */}
            <Card className="total-card">
              <div className="total-row">
                <span>Total em contas</span>
                <strong>{formatCurrency(accounts.reduce((s, a) => s + (a.balance || 0), 0))}</strong>
              </div>
            </Card>

            {/* FAB Nova Conta */}
            <button className="fab" onClick={() => setModalOpen(true)} aria-label="Nova conta">+</button>

            {/* Modal Nova Conta */}
            <Modal
              isOpen={modalOpen}
              onClose={() => setModalOpen(false)}
              title="Nova conta"
              footer={
                <>
                  <Button variant="ghost" fullWidth onClick={() => setModalOpen(false)}>Cancelar</Button>
                  <Button variant="primary" fullWidth onClick={handleSubmit} loading={saving}>Salvar</Button>
                </>
              }
            >
              <form className="launch-form" onSubmit={handleSubmit} noValidate>
                <div className="form-group">
                  <label>Nome da conta</label>
                  <input name="name" type="text" value={form.name} onChange={handleChange}
                    placeholder="Ex: Itaú Corrente" required />
                </div>
                <div className="form-group">
                  <label>Banco</label>
                  <input name="bank" type="text" list="bank-suggestions" value={form.bank} onChange={handleChange}
                    placeholder="Ex: Itaú" />
                  <datalist id="bank-suggestions">
                    {COMMON_BRAZILIAN_BANKS.map((bankName) => (
                      <option key={bankName} value={bankName} />
                    ))}
                  </datalist>
                </div>
                <div className="form-group">
                  <label>Tipo</label>
                  <select name="type" value={form.type} onChange={handleChange}>
                    <option value="checking">Conta Corrente</option>
                    <option value="savings">Poupança</option>
                    <option value="investment">Investimento</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Saldo inicial (R$)</label>
                  <input name="balance" type="number" inputMode="decimal" step="0.01"
                    value={form.balance} onChange={handleChange} placeholder="0,00" />
                </div>
              </form>
            </Modal>
          </>
        )}

        {tab === 'cartoes' && (
          <>
            {MOCK_CARDS.map((card) => {
              const available = card.limit - card.usedLimit
              const usagePct  = (card.usedLimit / card.limit) * 100
              return (
                <Card key={card.id} className="card-card">
                  <div className="cc-header">
                    <div className="cc-icon" style={{ background: card.color }}>
                      {card.icon}
                    </div>
                    <div className="cc-info">
                      <span className="cc-name">{card.name}</span>
                      <span className="cc-flag">{card.flag.toUpperCase()}</span>
                    </div>
                  </div>

                  {/* Barra de limite */}
                  <div className="cc-limit-row">
                    <span>Limite usado</span>
                    <span>{formatCurrency(card.usedLimit)} / {formatCurrency(card.limit)}</span>
                  </div>
                  <div className="cc-bar-track">
                    <div
                      className={`cc-bar-fill${usagePct > 80 ? ' warn' : ''}`}
                      style={{ width: `${usagePct}%` }}
                    />
                  </div>
                  <div className="cc-bar-label">{usagePct.toFixed(0)}% utilizado · disponível: {formatCurrency(available)}</div>

                  {/* Datas */}
                  <div className="cc-dates">
                    <div className="cc-date-item">
                      <span className="cc-date-label">Fechamento</span>
                      <span className="cc-date-value">Dia {card.closingDay}</span>
                    </div>
                    <div className="cc-date-item">
                      <span className="cc-date-label">Vencimento</span>
                      <span className="cc-date-value">Dia {card.dueDay}</span>
                    </div>
                    <div className="cc-date-item">
                      <span className="cc-date-label">Fatura atual</span>
                      <span className="cc-date-value invoice">{formatCurrency(card.currentInvoice)}</span>
                    </div>
                  </div>
                </Card>
              )
            })}

            {/* Total faturas */}
            <Card className="total-card">
              <div className="total-row">
                <span>Total de faturas</span>
                <strong className="negative">{formatCurrency(MOCK_CARDS.reduce((s, c) => s + c.currentInvoice, 0))}</strong>
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}

const TYPE_LABEL = {
  checking:   'Conta Corrente',
  savings:    'Poupança',
  investment: 'Investimento',
}
