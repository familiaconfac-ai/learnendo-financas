import { jsPDF } from 'jspdf'
import autoTableModule from 'jspdf-autotable'
import { formatCurrency } from '../utils/formatCurrency.js'

const autoTable = typeof autoTableModule === 'function' ? autoTableModule : autoTableModule.default

const MONTH_NAMES = [
  'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro',
]

/**
 * Gera PDF do relatório mensal.
 * @param {Object} params
 * @param {Object} params.summary  - dados de resumo do mês
 * @param {Object} params.budget   - dados de orçamento
 * @param {number} [params.month]  - mês (1–12)
 * @param {number} [params.year]
 * @param {boolean} [params.isAdmin]
 * @param {Array}  [params.users]  - lista de usuários (admin)
 */
export async function generateMonthlyPDF({ summary, budget, month, year, isAdmin = false, users = [] }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const now = new Date()
  const m = month ?? now.getMonth() + 1
  const y = year  ?? now.getFullYear()

  const primaryColor = [26, 86, 219]   // #1a56db
  const successColor = [22, 163, 74]   // green-600
  const dangerColor  = [220, 38, 38]   // red-600

  // ── Cabeçalho ──────────────────────────────────────────────────────────────
  doc.setFillColor(...primaryColor)
  doc.rect(0, 0, 210, 28, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text('Learnendo Finanças', 14, 11)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text(
    isAdmin
      ? `Relatório Consolidado – ${MONTH_NAMES[m - 1]} ${y}`
      : `Relatório Mensal – ${MONTH_NAMES[m - 1]} ${y}`,
    14, 19
  )
  doc.text(`Gerado em: ${now.toLocaleDateString('pt-BR')}`, 14, 24)

  let cursor = 36

  if (!isAdmin && summary) {
    // ── Resumo financeiro ────────────────────────────────────────────────────
    doc.setTextColor(0, 0, 0)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text('Resumo do Mês', 14, cursor)
    cursor += 6

    autoTable(doc, {
      startY: cursor,
      head: [['Item', 'Valor']],
      body: [
        ['Receitas',     formatCurrency(summary.receitas)],
        ['Despesas',     formatCurrency(summary.despesas)],
        ['Investimentos',formatCurrency(summary.investimentos)],
        ['Saldo',        formatCurrency(summary.saldo)],
      ],
      headStyles: { fillColor: primaryColor },
      bodyStyles: { fontSize: 10 },
      margin: { left: 14 },
    })
    cursor = doc.lastAutoTable.finalY + 8
  }

  if (!isAdmin && budget) {
    // ── Orçado x Realizado ───────────────────────────────────────────────────
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text('Orçado x Realizado por Categoria', 14, cursor)
    cursor += 6

    autoTable(doc, {
      startY: cursor,
      head: [['Categoria', 'Orçado', 'Realizado', 'Diferença']],
      body: budget.categories.map((c) => [
        c.name,
        formatCurrency(c.budgeted),
        formatCurrency(c.spent),
        formatCurrency(c.budgeted - c.spent),
      ]),
      headStyles: { fillColor: primaryColor },
      bodyStyles: { fontSize: 9 },
      margin: { left: 14 },
    })
    cursor = doc.lastAutoTable.finalY + 8
  }

  if (isAdmin && users.length > 0) {
    // ── Relatório admin consolidado ──────────────────────────────────────────
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text('Usuários – Resumo Mensal', 14, cursor)
    cursor += 6

    autoTable(doc, {
      startY: cursor,
      head: [['Usuário', 'E-mail', 'Receitas', 'Despesas', 'Saldo']],
      body: users.map((u) => [
        u.displayName,
        u.email,
        formatCurrency(u.monthlyReceitas),
        formatCurrency(u.monthlyDespesas),
        formatCurrency(u.monthlyReceitas - u.monthlyDespesas),
      ]),
      headStyles: { fillColor: primaryColor },
      bodyStyles: { fontSize: 9 },
      margin: { left: 14 },
    })
  }

  // ── Rodapé ─────────────────────────────────────────────────────────────────
  const pageCount = doc.internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(160, 160, 160)
    doc.text(
      `Learnendo Finanças  |  Página ${i} de ${pageCount}`,
      105,
      doc.internal.pageSize.height - 8,
      { align: 'center' }
    )
  }

  const fileName = isAdmin
    ? `learnendo-financas-admin-${y}-${String(m).padStart(2, '0')}.pdf`
    : `learnendo-financas-${y}-${String(m).padStart(2, '0')}.pdf`

  doc.save(fileName)
}

function statementFilePart(value) {
  return String(value || 'membro')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'membro'
}

function statementDate(value, includeTime = false) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return includeTime
    ? date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    : date.toLocaleDateString('pt-BR')
}

export async function generateMemberStatementPDF(statement) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
  const blue = [19, 78, 136]
  const lightBlue = [232, 241, 250]
  const green = [22, 130, 80]
  const red = [190, 55, 55]
  const summary = statement?.summary || {}
  const periodLabel = `${statementDate(statement?.period?.start)} a ${statementDate(statement?.period?.end)}`

  doc.setFillColor(...blue)
  doc.rect(0, 0, 297, 30, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(17)
  doc.text('Learnendo Financas', 14, 11)
  doc.setFontSize(12)
  doc.text(`Extrato financeiro - ${statement?.target?.displayName || 'Membro'}`, 14, 19)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(`Periodo: ${periodLabel} | Gerado em ${statementDate(statement?.generatedAt, true)}`, 14, 26)

  autoTable(doc, {
    startY: 36,
    theme: 'plain',
    body: [
      ['Saldo anterior', formatCurrency(summary.openingBalance), 'Creditos', formatCurrency(summary.totalCredits), 'Debitos', formatCurrency(summary.totalDebits), 'Juros liquidos', formatCurrency(summary.netInterest)],
      ['Saldo do periodo', formatCurrency(summary.periodBalance), 'Saldo final', formatCurrency(summary.closingBalance), 'Saldo atual', formatCurrency(summary.currentBalance), 'Pendencias', String(statement?.pendingAll?.length || 0)],
    ],
    styles: { fontSize: 9, cellPadding: 2.5 },
    columnStyles: {
      0: { fontStyle: 'bold', fillColor: lightBlue },
      2: { fontStyle: 'bold', fillColor: lightBlue },
      4: { fontStyle: 'bold', fillColor: lightBlue },
      6: { fontStyle: 'bold', fillColor: lightBlue },
    },
    margin: { left: 14, right: 14 },
  })

  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 7,
    head: [['Data', 'Hora', 'Tipo', 'Descricao', 'Credor', 'Devedor', 'Principal', 'Juros', 'Total', 'Situacao', 'Saldo']],
    body: (statement?.rows || []).map((row) => {
      const date = new Date(row.date)
      return [
        date.toLocaleDateString('pt-BR'),
        date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        row.type,
        row.description,
        row.creditor,
        row.debtor,
        formatCurrency(row.principalAmount),
        formatCurrency(row.interestAmount),
        formatCurrency(row.totalAmount),
        row.statusLabel,
        formatCurrency(row.balanceAfter),
      ]
    }),
    headStyles: { fillColor: blue, fontSize: 7.5 },
    bodyStyles: { fontSize: 7, cellPadding: 1.6, valign: 'middle' },
    alternateRowStyles: { fillColor: [247, 249, 252] },
    columnStyles: {
      0: { cellWidth: 17 }, 1: { cellWidth: 13 }, 2: { cellWidth: 27 }, 3: { cellWidth: 46 },
      4: { cellWidth: 28 }, 5: { cellWidth: 28 }, 6: { cellWidth: 22, halign: 'right' },
      7: { cellWidth: 20, halign: 'right' }, 8: { cellWidth: 22, halign: 'right' },
      9: { cellWidth: 19 }, 10: { cellWidth: 22, halign: 'right' },
    },
    didParseCell(data) {
      if (data.section !== 'body') return
      if ([6, 7, 8, 10].includes(data.column.index)) {
        const raw = statement?.rows?.[data.row.index]?.[data.column.index === 10 ? 'balanceAfter' : data.column.index === 7 ? 'interestAmount' : data.column.index === 6 ? 'principalAmount' : 'totalAmount']
        data.cell.styles.textColor = Number(raw || 0) < 0 ? red : green
      }
    },
    margin: { left: 14, right: 14, bottom: 16 },
  })

  if ((statement?.pending || []).length > 0) {
    const nextY = doc.lastAutoTable.finalY + 8
    if (nextY > 180) doc.addPage()
    const startY = nextY > 180 ? 18 : nextY
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...blue)
    doc.setFontSize(11)
    doc.text('Movimentacoes pendentes - aguardando confirmacao', 14, startY)
    autoTable(doc, {
      startY: startY + 4,
      head: [['Data', 'Descricao', 'Credor', 'Devedor', 'Valor', 'Situacao']],
      body: statement.pending.map((row) => [
        statementDate(row.date, true), row.description, row.creditor, row.debtor,
        formatCurrency(row.totalAmount), 'Aguardando confirmacao.',
      ]),
      headStyles: { fillColor: [191, 121, 22] },
      bodyStyles: { fontSize: 8 },
      margin: { left: 14, right: 14, bottom: 16 },
    })
  }

  const pageCount = doc.internal.getNumberOfPages()
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page)
    doc.setDrawColor(210, 218, 228)
    doc.line(14, 199, 283, 199)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(105, 115, 125)
    doc.text('Extrato reconstruido pelas movimentacoes. Nenhum snapshot mensal foi criado.', 14, 204)
    doc.text(`Pagina ${page} de ${pageCount}`, 283, 204, { align: 'right' })
  }

  const period = statement?.period?.start?.slice(0, 7) || 'periodo'
  doc.save(`extrato-${statementFilePart(statement?.target?.displayName)}-${period}.pdf`)
}
