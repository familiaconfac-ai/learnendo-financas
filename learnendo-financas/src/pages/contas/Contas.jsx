import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFinance } from '../../context/FinanceContext'
import Card, { CardHeader } from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import { useAccounts } from '../../hooks/useAccounts'
import { useCards } from '../../hooks/useCards'
import { formatCurrency } from '../../utils/formatCurrency'
import { buildCardPlanningSnapshot, monthKeyLabel } from '../../utils/creditCardPlanning'
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

function formatImportDateTime(value) {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toLocaleString('pt-BR')
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

function getCurrentBalance(account) {
  const value = account?.current_balance ?? account?.balance
  return Number.isFinite(Number(value)) ? Number(value) : 0
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

const CARD_FLAGS = [
  { value: 'mastercard', label: 'Mastercard' },
  { value: 'visa', label: 'Visa' },
  { value: 'elo', label: 'Elo' },
  { value: 'amex', label: 'Amex' },
  { value: 'hipercard', label: 'Hipercard' },
]

const TYPE_LABEL = {
  checking: 'Conta Corrente',
  savings: 'Poupança',
  investment: 'Investimento',
}

const CARD_FLAG_LABEL = {
  mastercard: 'Mastercard',
  visa: 'Visa',
  elo: 'Elo',
  amex: 'Amex',
  hipercard: 'Hipercard',
}

function defaultAccountForm() {
  return {
    name: '',
    bank: '',
    holderName: '',
    branchNumber: '',
    accountNumber: '',
    type: 'checking',
    balance: '',
  }
}

function defaultCardForm() {
  return {
    name: '',
    holderName: '',
    issuerBank: '',
    flag: '',
    limit: '',
    currentInvoice: '',
    closingDay: '',
    dueDay: '',
  }
}

export default function Contas() {
  const navigate = useNavigate()
  const [tab, setTab] = useState('contas')
  const { selectedMonth, selectedYear } = useFinance()
  const { accounts, add: addAccount, remove: removeAccount, update: updateAccount } = useAccounts()
  const { cards, add: addCard, remove: removeCard, update: updateCard } = useCards()

  const [accountModalOpen, setAccountModalOpen] = useState(false)
  const [cardModalOpen, setCardModalOpen] = useState(false)
  const [editingAccount, setEditingAccount] = useState(null)
  const [editingCard, setEditingCard] = useState(null)
  const [accountForm, setAccountForm] = useState(defaultAccountForm())
  const [cardForm, setCardForm] = useState(defaultCardForm())
  const [savingAccount, setSavingAccount] = useState(false)
  const [savingCard, setSavingCard] = useState(false)

  const selectedMonthKey = buildMonthKey(selectedYear, selectedMonth)
  const selectedMonthLabel = formatMonthLabel(selectedYear, selectedMonth)

  const totalAccountsBalance = useMemo(
    () => accounts.reduce((sum, account) => sum + getCurrentBalance(account), 0),
    [accounts],
  )
  const totalCardInvoices = useMemo(
    () => cards.reduce((sum, card) => sum + Number(card.currentInvoice || 0), 0),
    [cards],
  )

  function handleAccountChange(event) {
    setAccountForm((current) => ({ ...current, [event.target.name]: event.target.value }))
  }

  function handleCardChange(event) {
    setCardForm((current) => ({ ...current, [event.target.name]: event.target.value }))
  }

  function openNewAccountModal() {
    setEditingAccount(null)
    setAccountForm(defaultAccountForm())
    setAccountModalOpen(true)
  }

  function openEditAccountModal(account) {
    setEditingAccount(account)
    setAccountForm({
      name: account.name || '',
      bank: account.bank || '',
      holderName: account.holderName || '',
      branchNumber: account.branchNumber || '',
      accountNumber: account.accountNumber || '',
      type: account.type || 'checking',
      balance: String(Number(account.initialBalance ?? account.balance ?? 0) || 0),
    })
    setAccountModalOpen(true)
  }

  function openNewCardModal() {
    setEditingCard(null)
    setCardForm(defaultCardForm())
    setCardModalOpen(true)
  }

  function openEditCardModal(card) {
    setEditingCard(card)
    setCardForm({
      name: card.name || '',
      holderName: card.holderName || '',
      issuerBank: card.issuerBank || '',
      flag: card.flag || '',
      limit: String(Number(card.limit || 0) || ''),
      currentInvoice: String(Number(card.currentInvoice || 0) || ''),
      closingDay: String(Number(card.closingDay || 0) || ''),
      dueDay: String(Number(card.dueDay || 0) || ''),
    })
    setCardModalOpen(true)
  }

  async function handleSubmitAccount(event) {
    event?.preventDefault?.()
    if (!accountForm.name.trim()) return

    setSavingAccount(true)
    try {
      const payload = {
        name: accountForm.name.trim(),
        bank: accountForm.bank.trim(),
        holderName: accountForm.holderName.trim(),
        branchNumber: accountForm.branchNumber.trim(),
        accountNumber: accountForm.accountNumber.trim(),
        type: accountForm.type,
      }

      if (!editingAccount) {
        payload.balance = accountForm.balance || 0
        await addAccount(payload)
      } else {
        payload.initialBalance = accountForm.balance || editingAccount.initialBalance || editingAccount.balance || 0
        await updateAccount(editingAccount.id, payload)
      }

      setAccountModalOpen(false)
      setEditingAccount(null)
      setAccountForm(defaultAccountForm())
    } catch (err) {
      alert('Erro ao salvar conta: ' + err.message)
    } finally {
      setSavingAccount(false)
    }
  }

  async function handleSubmitCard(event) {
    event?.preventDefault?.()
    if (!cardForm.name.trim()) return

    setSavingCard(true)
    try {
      const payload = {
        name: cardForm.name.trim(),
        holderName: cardForm.holderName.trim(),
        issuerBank: cardForm.issuerBank.trim(),
        flag: cardForm.flag,
        limit: cardForm.limit || 0,
        currentInvoice: cardForm.currentInvoice || 0,
        usedLimit: cardForm.currentInvoice || 0,
        closingDay: cardForm.closingDay || 0,
        dueDay: cardForm.dueDay || 0,
      }

      if (!editingCard) {
        await addCard(payload)
      } else {
        await updateCard(editingCard.id, payload)
      }

      setCardModalOpen(false)
      setEditingCard(null)
      setCardForm(defaultCardForm())
    } catch (err) {
      alert('Erro ao salvar cartão: ' + err.message)
    } finally {
      setSavingCard(false)
    }
  }

  async function handleDeleteAccount(account) {
    if (!window.confirm(`Excluir a conta "${account.name}"?`)) return
    try {
      await removeAccount(account.id)
    } catch (err) {
      alert('Erro ao excluir conta: ' + err.message)
    }
  }

  async function handleDeleteCard(card) {
    if (!window.confirm(`Excluir o cartão "${card.name}"?`)) return
    try {
      await removeCard(card.id)
    } catch (err) {
      alert('Erro ao excluir cartão: ' + err.message)
    }
  }

  return (
    <div className="contas-page">
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

      <div className="contas-toolbar">
        <div className="contas-toolbar-copy">
          <strong>{tab === 'contas' ? 'Importe extratos das suas contas' : 'Importe as faturas dos seus cartões'}</strong>
          <span>
            {tab === 'contas'
              ? 'Cadastre cada banco e concentre aqui os extratos das suas contas para revisar depois em Lançar.'
              : 'Cadastre cada cartão com o nome certo, vencimento e fechamento para vincular as faturas importadas.'}
          </span>
        </div>
        <button
          type="button"
          className="contas-import-btn"
          onClick={() => navigate('/importacao')}
        >
          {tab === 'contas' ? 'Importar extrato' : 'Importar fatura'}
        </button>
      </div>

      <div className="contas-content">
        {tab === 'contas' && (
          <>
            {accounts.length === 0 ? (
              <Card className="contas-empty">
                <p>Nenhuma conta cadastrada.</p>
                <p className="contas-empty-hint">Importe um extrato ou toque em “+ Nova conta” para criar uma conta manualmente.</p>
              </Card>
            ) : (
              accounts.map((account) => {
                const monthOpeningBalance = getMonthOpeningBalance(account, selectedMonthKey)
                const baselineBalance = monthOpeningBalance ?? Number(account.initialBalance || 0)
                const currentBalance = getCurrentBalance(account)
                const balanceDiff = currentBalance - baselineBalance
                const currentBalanceUpdatedAt = account.lastBalanceAdjustmentAt || account.lastStatementImportedAt

                return (
                  <Card key={account.id} className="account-card">
                    <div className="acc-header">
                      <div className="acc-icon" style={{ background: account.color || '#1a56db' }}>
                        {account.icon || '🏦'}
                      </div>
                      <div className="acc-info">
                        <span className="acc-name">{account.name}</span>
                        <span className="acc-bank">{[account.bank, TYPE_LABEL[account.type] || account.type].filter(Boolean).join(' · ')}</span>
                        {(account.holderName || account.branchNumber || account.accountNumber) && (
                          <span className="acc-detail">
                            {[account.holderName, account.branchNumber ? `Ag ${account.branchNumber}` : '', account.accountNumber ? `Conta ${account.accountNumber}` : '']
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        )}
                      </div>
                      <div className="item-actions">
                        <button className="item-action-btn" onClick={() => openEditAccountModal(account)} title="Editar conta">✏️</button>
                        <button className="item-action-btn item-action-btn--danger" onClick={() => handleDeleteAccount(account)} title="Excluir conta">🗑️</button>
                      </div>
                    </div>

                    <div className="acc-balance">
                      <span className="acc-balance-label">Saldo atual</span>
                      <span className={`acc-balance-value ${currentBalance >= 0 ? 'positive' : 'negative'}`}>
                        {formatCurrency(currentBalance)}
                      </span>
                    </div>

                    {formatImportDateTime(currentBalanceUpdatedAt) && (
                      <div className="acc-meta">
                        <span>Ultima atualizacao do saldo: {formatImportDateTime(currentBalanceUpdatedAt)}</span>
                      </div>
                    )}

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

                    {hasStatementSnapshot(account) && (
                      <div className="acc-statement">
                        <div className="acc-statement-header">
                          <span>Último extrato importado</span>
                          {formatImportDate(account.lastStatementImportedAt) && (
                            <span>{formatImportDate(account.lastStatementImportedAt)}</span>
                          )}
                        </div>
                        <div className="acc-statement-grid">
                          <div className="acc-statement-item">
                            <span>Saldo anterior</span>
                            <strong>{formatCurrency(Number(account.lastStatementOpeningBalance || 0))}</strong>
                          </div>
                          <div className="acc-statement-item">
                            <span>Saldo atual</span>
                            <strong>{formatCurrency(Number(account.lastStatementClosingBalance || 0))}</strong>
                          </div>
                          <div className="acc-statement-item">
                            <span>Movimento</span>
                            <strong className={(account.lastStatementNetMovement || 0) >= 0 ? 'acc-diff pos' : 'acc-diff neg'}>
                              {(account.lastStatementNetMovement || 0) >= 0 ? '+' : ''}
                              {formatCurrency(Math.abs(Number(account.lastStatementNetMovement || 0)))}
                            </strong>
                          </div>
                        </div>
                        {account.lastStatementFileName && (
                          <span className="acc-statement-file">{account.lastStatementFileName}</span>
                        )}
                      </div>
                    )}
                  </Card>
                )
              })
            )}

            <Card className="total-card">
              <div className="total-row">
                <span>Total em contas</span>
                <strong>{formatCurrency(totalAccountsBalance)}</strong>
              </div>
            </Card>
          </>
        )}

        {tab === 'cartoes' && (
          <>
            {cards.length === 0 ? (
              <Card className="contas-empty">
                <p>Nenhum cartão cadastrado.</p>
                <p className="contas-empty-hint">Importe uma fatura ou toque em “+ Novo cartão” para criar o cartão real da família.</p>
              </Card>
            ) : (
              cards.map((card) => {
                const limit = Number(card.limit || 0)
                const usedLimit = Number(card.usedLimit || card.currentInvoice || 0)
                const currentInvoice = Number(card.currentInvoice || 0)
                const available = Math.max(limit - usedLimit, 0)
                const usagePct = limit > 0 ? Math.min((usedLimit / limit) * 100, 100) : 0
                const planning = buildCardPlanningSnapshot(card)

                return (
                  <Card key={card.id} className="card-card">
                    <div className="cc-header">
                      <div className="cc-icon" style={{ background: card.color || '#8b5cf6' }}>
                        {card.icon || '💳'}
                      </div>
                      <div className="cc-info">
                        <span className="cc-name">{card.name}</span>
                        <span className="cc-flag">
                          {[CARD_FLAG_LABEL[card.flag] || card.flag || 'Cartão', card.holderName].filter(Boolean).join(' · ')}
                        </span>
                        {card.issuerBank && <span className="cc-issuer">{card.issuerBank}</span>}
                      </div>
                      <div className="item-actions">
                        <button className="item-action-btn" onClick={() => openEditCardModal(card)} title="Editar cartão">✏️</button>
                        <button className="item-action-btn item-action-btn--danger" onClick={() => handleDeleteCard(card)} title="Excluir cartão">🗑️</button>
                      </div>
                    </div>

                    <div className="cc-limit-row">
                      <span>Limite usado</span>
                      <span>{formatCurrency(usedLimit)} / {formatCurrency(limit)}</span>
                    </div>
                    <div className="cc-bar-track">
                      <div
                        className={`cc-bar-fill${usagePct > 80 ? ' warn' : ''}`}
                        style={{ width: `${usagePct}%` }}
                      />
                    </div>
                    <div className="cc-bar-label">{usagePct.toFixed(0)}% utilizado · disponível: {formatCurrency(available)}</div>

                    <div className="cc-dates">
                      <div className="cc-date-item">
                        <span className="cc-date-label">Fechamento</span>
                        <span className="cc-date-value">{card.closingDay ? `Dia ${card.closingDay}` : '—'}</span>
                      </div>
                      <div className="cc-date-item">
                        <span className="cc-date-label">Vencimento</span>
                        <span className="cc-date-value">{card.dueDay ? `Dia ${card.dueDay}` : '—'}</span>
                      </div>
                      <div className="cc-date-item">
                        <span className="cc-date-label">Fatura atual</span>
                        <span className="cc-date-value invoice">{formatCurrency(currentInvoice)}</span>
                      </div>
                    </div>

                    {planning && (
                      <div className="cc-planning-box">
                        <strong>Planejamento do crédito</strong>
                        <p>Melhor dia de compra: dia {planning.bestPurchaseDay}.</p>
                        <p>
                          Próxima fatura tende a vencer em {planning.nextDueDate ? new Date(`${planning.nextDueDate}T12:00:00`).toLocaleDateString('pt-BR') : 'data não informada'}.
                        </p>
                        <p>
                          Compras antes do fechamento costumam comprometer o orçamento de {monthKeyLabel(String(planning.nextDueDate || '').slice(0, 7)) || 'mês seguinte'}.
                        </p>
                      </div>
                    )}

                    {(card.lastInvoiceFileName || card.lastInvoiceImportedAt) && (
                      <div className="cc-import-meta">
                        <span>{card.lastInvoiceFileName || 'Última fatura importada'}</span>
                        {formatImportDate(card.lastInvoiceImportedAt) && (
                          <span>{formatImportDate(card.lastInvoiceImportedAt)}</span>
                        )}
                      </div>
                    )}
                  </Card>
                )
              })
            )}

            <Card className="total-card">
              <div className="total-row">
                <span>Total de faturas</span>
                <strong className="negative">{formatCurrency(totalCardInvoices)}</strong>
              </div>
            </Card>
          </>
        )}
      </div>

      <button
        className="fab"
        onClick={tab === 'contas' ? openNewAccountModal : openNewCardModal}
        aria-label={tab === 'contas' ? 'Nova conta' : 'Novo cartão'}
      >
        +
      </button>

      <Modal
        isOpen={accountModalOpen}
        onClose={() => setAccountModalOpen(false)}
        title={editingAccount ? 'Editar conta' : 'Nova conta'}
        footer={(
          <>
            <Button variant="ghost" fullWidth onClick={() => setAccountModalOpen(false)}>Cancelar</Button>
            <Button variant="primary" fullWidth onClick={handleSubmitAccount} loading={savingAccount}>Salvar</Button>
          </>
        )}
      >
        <form className="launch-form" onSubmit={handleSubmitAccount} noValidate>
          <div className="form-group">
            <label>Nome da conta</label>
            <input name="name" type="text" value={accountForm.name} onChange={handleAccountChange} placeholder="Ex: Nubank Márcio" required />
          </div>
          <div className="form-group">
            <label>Banco</label>
            <input name="bank" type="text" list="bank-suggestions" value={accountForm.bank} onChange={handleAccountChange} placeholder="Ex: Nubank" />
            <datalist id="bank-suggestions">
              {COMMON_BRAZILIAN_BANKS.map((bankName) => (
                <option key={bankName} value={bankName} />
              ))}
            </datalist>
          </div>
          <div className="form-group">
            <label>Titular</label>
            <input name="holderName" type="text" value={accountForm.holderName} onChange={handleAccountChange} placeholder="Ex: Márcio Martins" />
          </div>
          <div className="form-grid-two">
            <div className="form-group">
              <label>Agência</label>
              <input name="branchNumber" type="text" value={accountForm.branchNumber} onChange={handleAccountChange} placeholder="0001" />
            </div>
            <div className="form-group">
              <label>Conta</label>
              <input name="accountNumber" type="text" value={accountForm.accountNumber} onChange={handleAccountChange} placeholder="123456-7" />
            </div>
          </div>
          <div className="form-group">
            <label>Tipo</label>
            <select name="type" value={accountForm.type} onChange={handleAccountChange}>
              <option value="checking">Conta Corrente</option>
              <option value="savings">Poupança</option>
              <option value="investment">Investimento</option>
            </select>
          </div>
          <div className="form-group">
            <label>{editingAccount ? 'Saldo base (R$)' : 'Saldo inicial (R$)'}</label>
            <input name="balance" type="number" inputMode="decimal" step="0.01" value={accountForm.balance} onChange={handleAccountChange} placeholder="0,00" />
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={cardModalOpen}
        onClose={() => setCardModalOpen(false)}
        title={editingCard ? 'Editar cartão' : 'Novo cartão'}
        footer={(
          <>
            <Button variant="ghost" fullWidth onClick={() => setCardModalOpen(false)}>Cancelar</Button>
            <Button variant="primary" fullWidth onClick={handleSubmitCard} loading={savingCard}>Salvar</Button>
          </>
        )}
      >
        <form className="launch-form" onSubmit={handleSubmitCard} noValidate>
          <div className="form-group">
            <label>Nome do cartão</label>
            <input name="name" type="text" value={cardForm.name} onChange={handleCardChange} placeholder="Ex: Nubank Mastercard Márcio" required />
          </div>
          <div className="form-group">
            <label>Titular</label>
            <input name="holderName" type="text" value={cardForm.holderName} onChange={handleCardChange} placeholder="Ex: Márcio Martins" />
          </div>
          <div className="form-group">
            <label>Banco / emissor</label>
            <input name="issuerBank" type="text" list="bank-suggestions" value={cardForm.issuerBank} onChange={handleCardChange} placeholder="Ex: Nubank" />
          </div>
          <div className="form-group">
            <label>Bandeira</label>
            <select name="flag" value={cardForm.flag} onChange={handleCardChange}>
              <option value="">Selecione…</option>
              {CARD_FLAGS.map((flag) => (
                <option key={flag.value} value={flag.value}>{flag.label}</option>
              ))}
            </select>
          </div>
          <div className="form-grid-two">
            <div className="form-group">
              <label>Fechamento</label>
              <input name="closingDay" type="number" min="1" max="31" value={cardForm.closingDay} onChange={handleCardChange} placeholder="27" />
            </div>
            <div className="form-group">
              <label>Vencimento</label>
              <input name="dueDay" type="number" min="1" max="31" value={cardForm.dueDay} onChange={handleCardChange} placeholder="6" />
            </div>
          </div>
          <div className="form-grid-two">
            <div className="form-group">
              <label>Limite total (R$)</label>
              <input name="limit" type="number" inputMode="decimal" step="0.01" value={cardForm.limit} onChange={handleCardChange} placeholder="0,00" />
            </div>
            <div className="form-group">
              <label>Fatura atual (R$)</label>
              <input name="currentInvoice" type="number" inputMode="decimal" step="0.01" value={cardForm.currentInvoice} onChange={handleCardChange} placeholder="0,00" />
            </div>
          </div>
        </form>
      </Modal>
    </div>
  )
}
