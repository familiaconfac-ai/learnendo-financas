import { useEffect, useMemo, useState } from 'react'
import { useFinance } from '../../context/FinanceContext'
import { useBudget } from '../../hooks/useBudget'
import { formatCurrency } from '../../utils/formatCurrency'
import './Orcamento.css'

const INITIAL_INCOME_ITEMS = ['Salário', 'Renda extra']

const PRESET_EXPENSE_CATEGORIES = [
  {
    name: 'Moradia',
    items: ['Aluguel / Financiamento', 'Energia', 'Água', 'Internet', 'Gás', 'Condomínio', 'IPTU'],
  },
  {
    name: 'Alimentação',
    items: ['Supermercado', 'Padaria', 'Restaurante', 'Delivery'],
  },
  {
    name: 'Transporte',
    items: ['Combustível', 'Manutenção', 'Seguro', 'IPVA', 'Estacionamento', 'Transporte público', 'Apps (Uber)'],
  },
  {
    name: 'Saúde',
    items: ['Plano de saúde', 'Consultas', 'Exames', 'Medicamentos'],
  },
  {
    name: 'Educação',
    items: ['Escola', 'Cursos', 'Material'],
  },
  {
    name: 'Pessoal',
    items: ['Roupas', 'Beleza', 'Higiene'],
  },
  {
    name: 'Lazer',
    items: ['Viagens', 'Cinema', 'Assinaturas'],
  },
  {
    name: 'Financeiro',
    items: ['Juros', 'Tarifas', 'Multas'],
  },
  {
    name: 'Doações',
    items: ['Igreja', 'Doações'],
  },
]

function toAmount(value) {
  const normalized = String(value ?? '')
    .replace(/\s+/g, '')
    .replace(',', '.')
  const parsed = Number.parseFloat(normalized)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase()
}

function duplicateLabel(baseName, existingNames) {
  const base = String(baseName || '').trim() || 'Item'
  const used = new Set(existingNames.map((name) => normalizeKey(name)))
  let index = 2
  let candidate = `${base} (${index})`
  while (used.has(normalizeKey(candidate))) {
    index += 1
    candidate = `${base} (${index})`
  }
  return candidate
}

function monthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`
}

function buildStructuredModel(budgetItems) {
  const income = []
  const expenseByCategory = new Map()

  for (const item of budgetItems) {
    const type = item.type || 'expense'
    if (type === 'income') {
      income.push({
        id: item.id,
        name: item.itemName || item.subcategoryName || item.categoryName || 'Receita',
        amount: String(item.plannedAmount ?? 0),
      })
      continue
    }

    if (type !== 'expense') continue

    const categoryName = item.parentCategoryName || item.categoryName || 'Outros'
    const itemName = item.itemName || item.subcategoryName || item.categoryName || 'Subcategoria'

    if (!expenseByCategory.has(categoryName)) {
      expenseByCategory.set(categoryName, { name: categoryName, items: [] })
    }

    expenseByCategory.get(categoryName).items.push({
      id: item.id,
      name: itemName,
      amount: String(item.plannedAmount ?? 0),
    })
  }

  for (const defaultName of INITIAL_INCOME_ITEMS) {
    const exists = income.some((row) => normalizeKey(row.name) === normalizeKey(defaultName))
    if (!exists) income.push({ id: null, name: defaultName, amount: '0' })
  }

  const expenses = PRESET_EXPENSE_CATEGORIES.map((preset) => {
    const existing = expenseByCategory.get(preset.name)
    const mergedItems = []

    for (const subName of preset.items) {
      const match = existing?.items.find((row) => normalizeKey(row.name) === normalizeKey(subName))
      mergedItems.push(match || { id: null, name: subName, amount: '0' })
    }

    if (existing) {
      for (const row of existing.items) {
        const alreadyIncluded = mergedItems.some((itemRow) => normalizeKey(itemRow.name) === normalizeKey(row.name))
        if (!alreadyIncluded) mergedItems.push(row)
      }
      expenseByCategory.delete(preset.name)
    }

    return { name: preset.name, items: mergedItems }
  })

  for (const extraCategory of expenseByCategory.values()) {
    expenses.push(extraCategory)
  }

  return { income, expenses }
}

export default function Orcamento() {
  const { selectedMonth, selectedYear } = useFinance()
  const { budgetItems, loading, error, add, update, remove } = useBudget(selectedYear, selectedMonth, {
    forceEdit: true,
  })
  const canEditBudget = true

  const [model, setModel] = useState({ income: [], expenses: [] })
  const [collapsed, setCollapsed] = useState({})
  const [savingKey, setSavingKey] = useState('')
  const [toast, setToast] = useState(null)

  const competencyMonth = monthKey(selectedYear, selectedMonth)

  useEffect(() => {
    const nextModel = buildStructuredModel(budgetItems)
    setModel(nextModel)
    setCollapsed((current) => {
      const merged = { ...current }
      for (let index = 0; index < nextModel.expenses.length; index += 1) {
        const key = String(index)
        if (merged[key] === undefined) merged[key] = false
      }
      return merged
    })
  }, [budgetItems])

  const totalIncome = useMemo(
    () => model.income.reduce((sum, row) => sum + toAmount(row.amount), 0),
    [model.income],
  )

  const totalExpenses = useMemo(
    () => model.expenses.reduce((sum, category) => {
      return sum + category.items.reduce((catSum, row) => catSum + toAmount(row.amount), 0)
    }, 0),
    [model.expenses],
  )

  const balance = totalIncome - totalExpenses

  function showToast(message, type = 'ok') {
    setToast({ message, type })
    setTimeout(() => setToast(null), 2800)
  }

  function setIncomeField(index, field, value) {
    setModel((current) => {
      const income = current.income.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: value } : row,
      )
      return { ...current, income }
    })
  }

  function setExpenseCategoryName(categoryIndex, nextName) {
    setModel((current) => {
      const expenses = current.expenses.map((category, idx) =>
        idx === categoryIndex ? { ...category, name: nextName } : category,
      )
      return { ...current, expenses }
    })
  }

  function setExpenseField(categoryIndex, itemIndex, field, value) {
    setModel((current) => {
      const expenses = current.expenses.map((category, idx) => {
        if (idx !== categoryIndex) return category
        const items = category.items.map((item, itemIdx) =>
          itemIdx === itemIndex ? { ...item, [field]: value } : item,
        )
        return { ...category, items }
      })
      return { ...current, expenses }
    })
  }

  function shouldSkipBlurPersist(event) {
    const nextFocused = event?.relatedTarget
    return Boolean(nextFocused?.dataset?.skipBlurPersist === '1')
  }

  async function persistIncome(index) {
    if (!canEditBudget) return
    const row = model.income[index]
    if (!row) return

    const name = row.name.trim() || 'Receita'
    const amount = toAmount(row.amount)
    const payload = {
      type: 'income',
      categoryId: null,
      categoryName: name,
      itemName: name,
      subcategoryName: null,
      parentCategoryName: null,
      plannedAmount: amount,
      competencyMonth,
      structureModel: 'hierarchical_v1',
    }

    const rowKey = `income-${index}`
    setSavingKey(rowKey)

    try {
      if (row.id) {
        await update(row.id, payload)
      } else {
        await add(payload)
      }
    } catch (err) {
      showToast(`Erro ao salvar receita: ${err.message}`, 'err')
    } finally {
      setSavingKey('')
    }
  }

  async function persistExpense(categoryIndex, itemIndex) {
    if (!canEditBudget) return
    const category = model.expenses[categoryIndex]
    const row = category?.items[itemIndex]
    if (!category || !row) return

    const categoryName = category.name.trim() || 'Categoria'
    const itemName = row.name.trim() || 'Subcategoria'
    const amount = toAmount(row.amount)
    const payload = {
      type: 'expense',
      categoryId: null,
      categoryName,
      parentCategoryName: categoryName,
      itemName,
      subcategoryName: itemName,
      plannedAmount: amount,
      competencyMonth,
      structureModel: 'hierarchical_v1',
    }

    const rowKey = `expense-${categoryIndex}-${itemIndex}`
    setSavingKey(rowKey)

    try {
      if (row.id) {
        await update(row.id, payload)
      } else {
        await add(payload)
      }
    } catch (err) {
      showToast(`Erro ao salvar despesa: ${err.message}`, 'err')
    } finally {
      setSavingKey('')
    }
  }

  async function persistCategoryRename(categoryIndex) {
    if (!canEditBudget) return
    const category = model.expenses[categoryIndex]
    if (!category) return
    const categoryName = category.name.trim() || 'Categoria'

    setSavingKey(`category-${categoryIndex}`)

    try {
      const updates = category.items
        .filter((item) => item.id)
        .map((item) => update(item.id, {
          categoryName,
          parentCategoryName: categoryName,
          itemName: item.name.trim() || 'Subcategoria',
          subcategoryName: item.name.trim() || 'Subcategoria',
          plannedAmount: toAmount(item.amount),
        }))

      await Promise.all(updates)
      if (updates.length > 0) showToast('Categoria renomeada com sucesso.')
    } catch (err) {
      showToast(`Erro ao renomear categoria: ${err.message}`, 'err')
    } finally {
      setSavingKey('')
    }
  }

  function addIncome() {
    if (!canEditBudget) return
    setModel((current) => ({
      ...current,
      income: [...current.income, { id: null, name: 'Nova receita', amount: '0' }],
    }))
  }

  async function duplicateIncome(index) {
    if (!canEditBudget) return
    const row = model.income[index]
    if (!row) return

    const names = model.income.map((item) => item.name)
    const newName = duplicateLabel(row.name, names)

    setSavingKey(`income-dup-${index}`)
    try {
      await add({
        type: 'income',
        categoryId: null,
        categoryName: newName,
        itemName: newName,
        subcategoryName: null,
        parentCategoryName: null,
        plannedAmount: toAmount(row.amount),
        competencyMonth,
        structureModel: 'hierarchical_v1',
      })
    } catch (err) {
      showToast(`Erro ao duplicar receita: ${err.message}`, 'err')
    } finally {
      setSavingKey('')
    }
  }

  async function deleteIncome(index) {
    if (!canEditBudget) return
    const row = model.income[index]
    if (!row) return

    setModel((current) => ({
      ...current,
      income: current.income.filter((_, rowIndex) => rowIndex !== index),
    }))

    if (!row.id) return

    setSavingKey(`income-del-${index}`)
    try {
      await remove(row.id)
    } catch (err) {
      showToast(`Erro ao excluir receita: ${err.message}`, 'err')
    } finally {
      setSavingKey('')
    }
  }

  function addExpenseItem(categoryIndex) {
    if (!canEditBudget) return
    setModel((current) => {
      const expenses = current.expenses.map((category, idx) => {
        if (idx !== categoryIndex) return category
        return {
          ...category,
          items: [...category.items, { id: null, name: 'Nova subcategoria', amount: '0' }],
        }
      })
      return { ...current, expenses }
    })
  }

  async function duplicateExpenseItem(categoryIndex, itemIndex) {
    if (!canEditBudget) return
    const category = model.expenses[categoryIndex]
    const row = category?.items[itemIndex]
    if (!category || !row) return

    const names = category.items.map((item) => item.name)
    const newName = duplicateLabel(row.name, names)

    setSavingKey(`expense-dup-${categoryIndex}-${itemIndex}`)
    try {
      await add({
        type: 'expense',
        categoryId: null,
        categoryName: category.name.trim() || 'Categoria',
        parentCategoryName: category.name.trim() || 'Categoria',
        itemName: newName,
        subcategoryName: newName,
        plannedAmount: toAmount(row.amount),
        competencyMonth,
        structureModel: 'hierarchical_v1',
      })
    } catch (err) {
      showToast(`Erro ao duplicar despesa: ${err.message}`, 'err')
    } finally {
      setSavingKey('')
    }
  }

  async function deleteExpenseItem(categoryIndex, itemIndex) {
    if (!canEditBudget) return
    const category = model.expenses[categoryIndex]
    const row = category?.items[itemIndex]
    if (!category || !row) return

    setModel((current) => {
      const expenses = current.expenses.map((cat, idx) => {
        if (idx !== categoryIndex) return cat
        return {
          ...cat,
          items: cat.items.filter((_, idxItem) => idxItem !== itemIndex),
        }
      })
      return { ...current, expenses }
    })

    if (!row.id) return

    setSavingKey(`expense-del-${categoryIndex}-${itemIndex}`)
    try {
      await remove(row.id)
    } catch (err) {
      showToast(`Erro ao excluir despesa: ${err.message}`, 'err')
    } finally {
      setSavingKey('')
    }
  }

  function toggleCategory(categoryIndex) {
    const key = String(categoryIndex)
    setCollapsed((current) => ({
      ...current,
      [key]: !current[key],
    }))
  }

  return (
    <div className="orcamento-page">
      <div className="budget-layout">
        <header className="budget-header">
          <h2>Orçamento</h2>
          <p>Preencha rapidamente suas receitas e despesas do mês.</p>
        </header>

        <section className="budget-summary">
          <div className="summary-box summary-income">
            <span>Total receitas</span>
            <strong>{formatCurrency(totalIncome)}</strong>
          </div>
          <div className="summary-box summary-expense">
            <span>Total despesas</span>
            <strong>{formatCurrency(totalExpenses)}</strong>
          </div>
          <div className={`summary-box ${balance >= 0 ? 'summary-balance-positive' : 'summary-balance-negative'}`}>
            <span>Saldo</span>
            <strong>{formatCurrency(balance)}</strong>
          </div>
        </section>

        {loading && <p className="budget-info">Carregando orçamento...</p>}
        {error && <p className="budget-error">Erro: {error}</p>}

        {!loading && (
          <>
            <section className="budget-block income-block">
              <div className="budget-block-header">
                <h3>Receitas</h3>
                <button type="button" className="add-btn" onClick={addIncome} disabled={!canEditBudget}>
                  + adicionar receita
                </button>
              </div>

              <div className="line-list">
                {model.income.map((row, index) => (
                  <div key={row.id || `income-${index}`} className="budget-line">
                    <input
                      className="name-input"
                      type="text"
                      value={row.name}
                      onChange={(e) => setIncomeField(index, 'name', e.target.value)}
                      onBlur={(e) => {
                        if (shouldSkipBlurPersist(e)) return
                        persistIncome(index)
                      }}
                      maxLength={60}
                      placeholder="Nome da receita"
                      disabled={!canEditBudget}
                    />
                    <input
                      className="amount-input"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={row.amount}
                      onChange={(e) => setIncomeField(index, 'amount', e.target.value)}
                      onBlur={(e) => {
                        if (shouldSkipBlurPersist(e)) return
                        persistIncome(index)
                      }}
                      placeholder="0,00"
                      disabled={!canEditBudget}
                    />
                    <button
                      type="button"
                      className="line-action"
                      title="Duplicar"
                      data-skip-blur-persist="1"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => duplicateIncome(index)}
                      disabled={!canEditBudget}
                    >
                      Duplicar
                    </button>
                    <button
                      type="button"
                      className="line-action danger"
                      title="Excluir"
                      data-skip-blur-persist="1"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => deleteIncome(index)}
                      disabled={!canEditBudget}
                    >
                      Excluir
                    </button>
                  </div>
                ))}
              </div>
            </section>

            <section className="budget-block expense-block">
              <div className="budget-block-header">
                <h3>Despesas</h3>
              </div>

              {model.expenses.map((category, categoryIndex) => {
                const collapseKey = String(categoryIndex)
                const isCollapsed = Boolean(collapsed[collapseKey])
                const categoryTotal = category.items.reduce((sum, item) => sum + toAmount(item.amount), 0)

                return (
                  <article key={`expense-category-${categoryIndex}`} className="expense-category">
                    <div className="expense-category-header">
                      <button
                        type="button"
                        className="collapse-btn"
                        onClick={() => toggleCategory(categoryIndex)}
                        aria-label={isCollapsed ? 'Expandir categoria' : 'Recolher categoria'}
                      >
                        {isCollapsed ? '+' : '-'}
                      </button>
                      <input
                        className="category-name-input"
                        type="text"
                        value={category.name}
                        onChange={(e) => setExpenseCategoryName(categoryIndex, e.target.value)}
                        onBlur={(e) => {
                          if (shouldSkipBlurPersist(e)) return
                          persistCategoryRename(categoryIndex)
                        }}
                        maxLength={60}
                        placeholder="Nome da categoria"
                        disabled={!canEditBudget}
                      />
                      <strong className="category-total">{formatCurrency(categoryTotal)}</strong>
                    </div>

                    {!isCollapsed && (
                      <>
                        <div className="line-list">
                          {category.items.map((item, itemIndex) => (
                            <div key={item.id || `expense-${categoryIndex}-${itemIndex}`} className="budget-line">
                              <input
                                className="name-input"
                                type="text"
                                value={item.name}
                                onChange={(e) => setExpenseField(categoryIndex, itemIndex, 'name', e.target.value)}
                                onBlur={(e) => {
                                  if (shouldSkipBlurPersist(e)) return
                                  persistExpense(categoryIndex, itemIndex)
                                }}
                                maxLength={60}
                                placeholder="Nome da subcategoria"
                                disabled={!canEditBudget}
                              />
                              <input
                                className="amount-input"
                                type="text"
                                inputMode="decimal"
                                autoComplete="off"
                                value={item.amount}
                                onChange={(e) => setExpenseField(categoryIndex, itemIndex, 'amount', e.target.value)}
                                onBlur={(e) => {
                                  if (shouldSkipBlurPersist(e)) return
                                  persistExpense(categoryIndex, itemIndex)
                                }}
                                placeholder="0,00"
                                disabled={!canEditBudget}
                              />
                              <button
                                type="button"
                                className="line-action"
                                title="Duplicar"
                                data-skip-blur-persist="1"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => duplicateExpenseItem(categoryIndex, itemIndex)}
                                disabled={!canEditBudget}
                              >
                                Duplicar
                              </button>
                              <button
                                type="button"
                                className="line-action danger"
                                title="Excluir"
                                data-skip-blur-persist="1"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => deleteExpenseItem(categoryIndex, itemIndex)}
                                disabled={!canEditBudget}
                              >
                                Excluir
                              </button>
                            </div>
                          ))}
                        </div>
                        <button
                          type="button"
                          className="add-inline-btn"
                          onClick={() => addExpenseItem(categoryIndex)}
                          disabled={!canEditBudget}
                        >
                          + adicionar
                        </button>
                      </>
                    )}
                  </article>
                )
              })}
            </section>
          </>
        )}
      </div>

      {savingKey && <div className="saving-indicator">Salvando alterações...</div>}

      {toast && (
        <div className={`orcamento-toast${toast.type === 'err' ? ' toast-err' : ''}`}>
          {toast.message}
        </div>
      )}
    </div>
  )
}
