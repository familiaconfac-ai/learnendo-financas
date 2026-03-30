import {
  addDoc,
  collection,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  doc,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { addTransaction, fetchTransactionsWithOptions } from './transactionService'

function recurrenceCol(uid) {
  return collection(db, 'users', uid, 'recurrences')
}

function toMonthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`
}

function monthKeyFromDate(date) {
  return String(date || '').slice(0, 7)
}

function parseMonthKey(monthKey) {
  const [year, month] = String(monthKey).split('-').map(Number)
  return { year, month }
}

function addMonths(monthKey, offset) {
  const { year, month } = parseMonthKey(monthKey)
  const date = new Date(year, month - 1 + offset, 1)
  return toMonthKey(date.getFullYear(), date.getMonth() + 1)
}

function compareMonthKey(a, b) {
  return a.localeCompare(b)
}

function clampDay(year, month, desiredDay) {
  const maxDay = new Date(year, month, 0).getDate()
  return Math.max(1, Math.min(desiredDay, maxDay))
}

function toDateForMonth(monthKey, preferredDate) {
  const { year, month } = parseMonthKey(monthKey)
  const fallbackDay = Number(String(preferredDate).slice(8, 10)) || 1
  const day = clampDay(year, month, fallbackDay)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function isFixedRecurrence(rule) {
  return rule.recurrenceType === 'fixed'
}

function normalizeRecurrencePayload(payload) {
  const recurrenceType = payload.recurrenceType === 'fixed' ? 'fixed' : 'indefinite'
  const startDate = payload.startDate || toDateForMonth(payload.lastGeneratedMonth || toMonthKey(new Date().getFullYear(), new Date().getMonth() + 1), `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`)
  const startMonth = monthKeyFromDate(startDate)
  const startInstallment = Math.max(1, Number(payload.startInstallment || 1))
  const totalInstallments = recurrenceType === 'fixed'
    ? Math.max(startInstallment, Number(payload.totalInstallments || startInstallment))
    : null

  let computedEndDate = payload.endDate || null
  if (!computedEndDate && recurrenceType === 'fixed') {
    const offset = (totalInstallments - startInstallment)
    const endMonth = addMonths(startMonth, offset)
    computedEndDate = toDateForMonth(endMonth, startDate)
  }

  return {
    recurrenceType,
    active: payload.active !== false,
    startDate,
    startMonth,
    endDate: computedEndDate,
    endMonth: computedEndDate ? monthKeyFromDate(computedEndDate) : null,
    totalInstallments,
    startInstallment,
  }
}

export async function createRecurrenceRule(uid, transactionData, recurrenceInput, options = {}) {
  const workspaceId = options.workspaceId || transactionData.workspaceId || null
  const recurrenceBase = normalizeRecurrencePayload(recurrenceInput)
  const rule = {
    type: transactionData.type,
    description: transactionData.description,
    amount: Number(transactionData.amount),
    accountId: transactionData.accountId || null,
    toAccountId: transactionData.toAccountId || null,
    categoryId: transactionData.categoryId || null,
    categoryName: transactionData.categoryName || null,
    notes: transactionData.notes || '',
    origin: 'manual',
    status: 'confirmed',
    balanceImpact: transactionData.type !== 'transfer_internal',
    workspaceId,
    ...recurrenceBase,
    currentInstallment: Number(recurrenceInput.currentInstallment || recurrenceBase.startInstallment),
    lastGeneratedMonth: monthKeyFromDate(transactionData.date),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }

  const ref = await addDoc(recurrenceCol(uid), rule)
  return {
    id: ref.id,
    ...rule,
    lastGeneratedMonth: monthKeyFromDate(transactionData.date),
  }
}

async function getActiveRecurrenceRules(uid) {
  const q = query(recurrenceCol(uid), where('active', '==', true))
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

async function updateRecurrenceRule(uid, recurrenceId, patch) {
  if (!patch || Object.keys(patch).length === 0) return
  await updateDoc(doc(db, 'users', uid, 'recurrences', recurrenceId), {
    ...patch,
    updatedAt: serverTimestamp(),
  })
}

export async function ensureMonthlyRecurringTransactions(uid, year, month, options = {}) {
  const workspaceId = options.workspaceId || null
  const targetMonth = toMonthKey(year, month)
  const rules = (await getActiveRecurrenceRules(uid)).filter((rule) => {
    const ruleWorkspaceId = rule.workspaceId || null
    return ruleWorkspaceId === workspaceId
  })
  if (rules.length === 0) return { generated: 0, skipped: 0, finished: 0 }

  let generated = 0
  let skipped = 0
  let finished = 0

  const txCacheByMonth = new Map()
  async function getMonthTransactions(monthKey) {
    if (txCacheByMonth.has(monthKey)) return txCacheByMonth.get(monthKey)
    const { year: y, month: m } = parseMonthKey(monthKey)
    const txList = await fetchTransactionsWithOptions(uid, y, m, {
      includeRecurringAuto: true,
      workspaceId,
    })
    txCacheByMonth.set(monthKey, txList)
    return txList
  }

  for (const rule of rules) {
    const normalized = normalizeRecurrencePayload(rule)
    const startMonth = normalized.startMonth
    const endMonth = normalized.endMonth

    if (compareMonthKey(targetMonth, startMonth) < 0) continue
    if (endMonth && compareMonthKey(targetMonth, endMonth) > 0) {
      await updateRecurrenceRule(uid, rule.id, { active: false })
      finished++
      continue
    }

    const lastGeneratedMonth = rule.lastGeneratedMonth || addMonths(startMonth, -1)
    let monthCursor = addMonths(lastGeneratedMonth, 1)
    let currentInstallment = Number(rule.currentInstallment || 0)

    while (compareMonthKey(monthCursor, targetMonth) <= 0) {
      if (compareMonthKey(monthCursor, startMonth) < 0) {
        monthCursor = addMonths(monthCursor, 1)
        continue
      }

      if (endMonth && compareMonthKey(monthCursor, endMonth) > 0) {
        await updateRecurrenceRule(uid, rule.id, {
          active: false,
          lastGeneratedMonth: addMonths(monthCursor, -1),
          currentInstallment,
        })
        finished++
        break
      }

      const installmentToGenerate = currentInstallment + 1
      if (isFixedRecurrence(normalized) && installmentToGenerate > Number(normalized.totalInstallments || 0)) {
        await updateRecurrenceRule(uid, rule.id, { active: false, currentInstallment })
        finished++
        break
      }

      const txForMonth = await getMonthTransactions(monthCursor)
      const duplicate = txForMonth.some((tx) => (
        tx.recurringId === rule.id && tx.recurringInstanceMonth === monthCursor
      ))

      if (!duplicate) {
        await addTransaction(uid, {
          type: rule.type,
          description: rule.description,
          amount: Number(rule.amount),
          date: toDateForMonth(monthCursor, rule.startDate),
          accountId: rule.accountId || null,
          toAccountId: rule.toAccountId || null,
          categoryId: rule.categoryId || null,
          categoryName: rule.categoryName || null,
          notes: rule.notes || '',
          origin: 'recurring_auto',
          status: 'confirmed',
          recurringId: rule.id,
          recurringType: normalized.recurrenceType,
          recurringInstanceMonth: monthCursor,
          installmentNumber: isFixedRecurrence(normalized) ? installmentToGenerate : null,
          balanceImpact: rule.type !== 'transfer_internal',
          workspaceId,
          createdBy: uid,
          userId: uid,
        }, { workspaceId })
        generated++
        txForMonth.push({ recurringId: rule.id, recurringInstanceMonth: monthCursor })
      } else {
        skipped++
      }

      currentInstallment = installmentToGenerate
      monthCursor = addMonths(monthCursor, 1)
    }

    const lastProcessedMonth = addMonths(monthCursor, -1)
    const endedByInstallments = (
      isFixedRecurrence(normalized) && currentInstallment >= Number(normalized.totalInstallments || 0)
    )

    await updateRecurrenceRule(uid, rule.id, {
      currentInstallment,
      lastGeneratedMonth: compareMonthKey(lastProcessedMonth, startMonth) >= 0 ? lastProcessedMonth : rule.lastGeneratedMonth,
      active: endedByInstallments ? false : true,
    })

    if (endedByInstallments) finished++
  }

  return { generated, skipped, finished }
}
