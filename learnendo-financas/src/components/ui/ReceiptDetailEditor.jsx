import { useMemo, useState } from 'react'
import {
  createEmptyReceiptItem,
  getReceiptSubcategories,
  RECEIPT_DETAIL_CATALOG,
  RECEIPT_ITEM_IMPORTANCE_OPTIONS,
  suggestBudgetCategoryForReceiptItem,
  summarizeReceiptDetail,
} from '../../utils/receiptDetailCatalog'
import { formatCurrency } from '../../utils/formatCurrency'
import './ReceiptDetailEditor.css'

export default function ReceiptDetailEditor({
  enabled,
  onToggle,
  items,
  onChange,
  totalAmount,
  expenseCategories,
}) {
  const [expandedId, setExpandedId] = useState(null)
  const summary = useMemo(() => summarizeReceiptDetail(items, totalAmount), [items, totalAmount])

  function importanceLabel(value) {
    if (value === 'superfluous') return 'Supérfluo'
    if (value === 'necessary') return 'Necessário'
    return 'Essencial'
  }

  function updateItems(nextItems) {
    onChange(nextItems)
  }

  function handleAddItem() {
    const nextItem = createEmptyReceiptItem(expenseCategories)
    updateItems([...(items || []), nextItem])
    setExpandedId(nextItem.id)
  }

  function handleRemoveItem(itemId) {
    updateItems((items || []).filter((item) => item.id !== itemId))
    if (expandedId === itemId) setExpandedId(null)
  }

  function handleItemChange(itemId, patch) {
    const nextItems = (items || []).map((item) => {
      if (item.id !== itemId) return item
      const nextItem = { ...item, ...patch }

      if (patch.detailCategoryKey) {
        const category = RECEIPT_DETAIL_CATALOG.find((entry) => entry.key === patch.detailCategoryKey)
        const subcategory = getReceiptSubcategories(patch.detailCategoryKey)[0]
        const suggestedBudgetCategoryId = suggestBudgetCategoryForReceiptItem(
          expenseCategories,
          patch.detailCategoryKey,
          subcategory?.key,
        )
        nextItem.detailCategoryLabel = category?.label || nextItem.detailCategoryLabel
        nextItem.detailSubcategoryKey = subcategory?.key || ''
        nextItem.detailSubcategoryLabel = subcategory?.label || ''
        nextItem.budgetCategoryId = nextItem.budgetCategoryId || suggestedBudgetCategoryId
      }

      if (patch.detailSubcategoryKey) {
        const subcategory = getReceiptSubcategories(nextItem.detailCategoryKey)
          .find((entry) => entry.key === patch.detailSubcategoryKey)
        nextItem.detailSubcategoryLabel = subcategory?.label || nextItem.detailSubcategoryLabel
      }

      if (patch.budgetCategoryId !== undefined) {
        const budgetCategory = (expenseCategories || []).find((category) => category.id === patch.budgetCategoryId)
        nextItem.budgetCategoryName = budgetCategory?.name || ''
      }

      return nextItem
    })

    updateItems(nextItems)
  }

  return (
    <div className="receipt-detail-box">
      <div className="receipt-detail-toggle-row">
        <div>
          <strong>Detalhar cupom</strong>
          <p className="receipt-detail-hint">Quebra a compra por item real para orçamento e análise.</p>
        </div>
        <button
          type="button"
          className={`receipt-detail-toggle${enabled ? ' active' : ''}`}
          onClick={() => onToggle(!enabled)}
        >
          {enabled ? 'Ativo' : 'Ativar'}
        </button>
      </div>

      {enabled && (
        <div className="receipt-detail-content">
          <div className={`receipt-detail-summary${summary.isBalanced ? ' ok' : ' warn'}`}>
            <div>
              <span className="receipt-summary-label">Total do cupom</span>
              <strong>{formatCurrency(totalAmount || 0)}</strong>
            </div>
            <div>
              <span className="receipt-summary-label">Total detalhado</span>
              <strong>{formatCurrency(summary.detailedTotal)}</strong>
            </div>
            <div>
              <span className="receipt-summary-label">Diferença</span>
              <strong>{formatCurrency(summary.difference)}</strong>
            </div>
          </div>

          <p className="receipt-detail-hint">
            Cada item precisa de categoria analítica, subcategoria, marcação essencial/necessário/supérfluo e categoria real de orçamento.
          </p>

          <div className="receipt-item-list">
            {(items || []).length === 0 ? (
              <div className="receipt-empty-state">Nenhum item detalhado ainda.</div>
            ) : (
              (items || []).map((item, index) => {
                const isExpanded = expandedId === item.id
                const subcategories = getReceiptSubcategories(item.detailCategoryKey)
                return (
                  <div key={item.id} className="receipt-item-card">
                    <button
                      type="button"
                      className="receipt-item-header"
                      onClick={() => setExpandedId(isExpanded ? null : item.id)}
                    >
                      <div>
                        <strong>{item.description || `Item ${index + 1}`}</strong>
                        <span className="receipt-item-meta">
                          {item.detailCategoryLabel || 'Categoria'}
                          {item.detailSubcategoryLabel ? ` · ${item.detailSubcategoryLabel}` : ''}
                          {` · ${importanceLabel(item.importance)}`}
                        </span>
                      </div>
                      <span>{formatCurrency(item.amount || 0)}</span>
                    </button>

                    {isExpanded && (
                      <div className="receipt-item-fields">
                        <div className="form-group">
                          <label>Descrição</label>
                          <input
                            type="text"
                            value={item.description}
                            onChange={(e) => handleItemChange(item.id, { description: e.target.value })}
                            placeholder="Ex: arroz, detergente, chocolate"
                          />
                        </div>

                        <div className="receipt-inline-grid">
                          <div className="form-group">
                            <label>Valor</label>
                            <input
                              type="number"
                              min="0.01"
                              step="0.01"
                              value={item.amount}
                              onChange={(e) => handleItemChange(item.id, { amount: e.target.value })}
                            />
                          </div>
                          <div className="form-group">
                            <label>Quantidade</label>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={item.quantity}
                              onChange={(e) => handleItemChange(item.id, { quantity: e.target.value })}
                              placeholder="Opcional"
                            />
                          </div>
                        </div>

                        <div className="form-group">
                          <label>Categoria analítica</label>
                          <select
                            value={item.detailCategoryKey}
                            onChange={(e) => handleItemChange(item.id, { detailCategoryKey: e.target.value })}
                          >
                            {RECEIPT_DETAIL_CATALOG.map((category) => (
                              <option key={category.key} value={category.key}>{category.label}</option>
                            ))}
                          </select>
                        </div>

                        <div className="form-group">
                          <label>Subcategoria</label>
                          <select
                            value={item.detailSubcategoryKey}
                            onChange={(e) => handleItemChange(item.id, { detailSubcategoryKey: e.target.value })}
                          >
                            {subcategories.map((subcategory) => (
                              <option key={subcategory.key} value={subcategory.key}>{subcategory.label}</option>
                            ))}
                          </select>
                        </div>

                        <div className="form-group">
                          <label>Categoria real do orçamento</label>
                          <select
                            value={item.budgetCategoryId || ''}
                            onChange={(e) => handleItemChange(item.id, { budgetCategoryId: e.target.value })}
                          >
                            <option value="">Selecione…</option>
                            {(expenseCategories || []).map((category) => (
                              <option key={category.id} value={category.id}>{category.name}</option>
                            ))}
                          </select>
                        </div>

                        <div className="form-group">
                          <label>Marcação analítica</label>
                          <div className="receipt-importance-row">
                            {RECEIPT_ITEM_IMPORTANCE_OPTIONS.map((option) => (
                              <button
                                key={option.key}
                                type="button"
                                className={`receipt-importance-btn${item.importance === option.key ? ' active' : ''}`}
                                onClick={() => handleItemChange(item.id, { importance: option.key })}
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <button
                          type="button"
                          className="receipt-remove-btn"
                          onClick={() => handleRemoveItem(item.id)}
                        >
                          Remover item
                        </button>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>

          <button type="button" className="receipt-add-btn" onClick={handleAddItem}>
            + Adicionar item
          </button>
        </div>
      )}
    </div>
  )
}
