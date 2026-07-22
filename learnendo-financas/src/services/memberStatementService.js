import { fetchDebtsForStatement, getDebtBalanceSnapshot } from './debtService'
import { buildMemberStatement, statementToCsv } from '../utils/memberStatement'

function download(content, filename, type) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function safeFilename(value) {
  return String(value || 'membro')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'membro'
}

export async function loadMemberStatement({ workspaceId, target, members, start, end, now, filters }) {
  if (!workspaceId) throw new Error('Workspace nao selecionado.')
  if (!target?.id && !target?.uid && !target?.userId) throw new Error('Membro nao identificado.')
  const debts = await fetchDebtsForStatement(workspaceId)
  return buildMemberStatement({
    workspaceId,
    target,
    members,
    debts,
    start,
    end,
    now,
    filters,
    snapshotBuilder: getDebtBalanceSnapshot,
  })
}

export function exportMemberStatementCsv(statement) {
  const period = statement?.period?.start?.slice(0, 7) || 'periodo'
  download(
    `\uFEFF${statementToCsv(statement)}`,
    `extrato-${safeFilename(statement?.target?.displayName)}-${period}.csv`,
    'text/csv;charset=utf-8',
  )
}

export async function exportMemberStatementPdf(statement) {
  const { generateMemberStatementPDF } = await import('./pdfService')
  await generateMemberStatementPDF(statement)
}
