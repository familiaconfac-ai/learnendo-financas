import { createContext, useContext, useState } from 'react'

// Contexto leve para estado de UI do app financeiro
// (mês selecionado, modais abertos, etc.)

const FinanceContext = createContext(null)

export function FinanceProvider({ children }) {
  const today = new Date()
  const [selectedMonth, setSelectedMonth] = useState(today.getMonth() + 1) // 1–12
  const [selectedYear, setSelectedYear] = useState(today.getFullYear())

  function goToPreviousMonth() {
    if (selectedMonth === 1) {
      setSelectedMonth(12)
      setSelectedYear((y) => y - 1)
    } else {
      setSelectedMonth((m) => m - 1)
    }
  }

  function goToNextMonth() {
    if (selectedMonth === 12) {
      setSelectedMonth(1)
      setSelectedYear((y) => y + 1)
    } else {
      setSelectedMonth((m) => m + 1)
    }
  }

  return (
    <FinanceContext.Provider
      value={{
        selectedMonth,
        selectedYear,
        setSelectedMonth,
        setSelectedYear,
        goToPreviousMonth,
        goToNextMonth,
      }}
    >
      {children}
    </FinanceContext.Provider>
  )
}

export function useFinance() {
  const ctx = useContext(FinanceContext)
  if (!ctx) throw new Error('useFinance deve ser usado dentro de <FinanceProvider>')
  return ctx
}
