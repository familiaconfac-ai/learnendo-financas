/**
 * statementParser.js
 *
 * Parses statement files into normalized raw rows for classification.
 * Supported: CSV, OFX/QFX, PDF (text PDFs).
 */

class ParseError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'ParseError'
    Object.assign(this, details)
  }
}

const MAX_REASON_LOGS = 40
const MAX_SANITY_AMOUNT = 10_000_000

// ---------------------------------------------------------------------------
// Amount normalization
// ---------------------------------------------------------------------------

/**
 * Convert BR/US formatted amount text into signed number.
 */
export function normaliseBRAmount(raw) {
  if (raw === null || raw === undefined) return NaN

  let s = String(raw).trim()
  if (!s) return NaN

  const isParenNegative = s.startsWith('(') && s.endsWith(')')
  if (isParenNegative) s = `-${s.slice(1, -1)}`

  const isNegative = s.startsWith('-')
  if (isNegative) s = s.slice(1).trim()

  // Keep only digits, separators, and remove currency/noise.
  s = s
    .replace(/[R$€£¥]|BRL|USD|US\$/gi, '')
    .replace(/\s+/g, '')
    .replace(/[^\d.,]/g, '')

  if (!s || s === '.' || s === ',') return NaN

  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  let normalized = s

  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) {
      // BR: 1.234,56
      normalized = s.replace(/\./g, '').replace(',', '.')
    } else {
      // US: 1,234.56
      normalized = s.replace(/,/g, '')
    }
  } else if (lastComma >= 0) {
    const tail = s.slice(lastComma + 1)
    normalized = tail.length === 3 ? s.replace(/,/g, '') : s.replace(',', '.')
  } else if (lastDot >= 0) {
    const tail = s.slice(lastDot + 1)
    normalized = tail.length === 3 ? s.replace(/\./g, '') : s
  }

  const value = Number.parseFloat(normalized)
  if (!Number.isFinite(value)) return NaN

  const result = isNegative ? -Math.abs(value) : value
  if (Math.abs(result) > 100_000_000) {
    console.warn(`[Parser] suspicious amount: raw="${raw}" normalized=${result}`)
  }

  return result
}

// ---------------------------------------------------------------------------
// Date parsing
// ---------------------------------------------------------------------------

const PT_MONTH_TO_NUM = {
  jan: '01',
  fev: '02',
  mar: '03',
  abr: '04',
  mai: '05',
  jun: '06',
  jul: '07',
  ago: '08',
  set: '09',
  out: '10',
  nov: '11',
  dez: '12',
}

function parseDateToISO(raw, defaultYear = new Date().getFullYear()) {
  if (!raw) return null

  const s = String(raw).trim()
  if (!s) return null

  // DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY
  const br = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})$/)
  if (br) {
    const day = br[1].padStart(2, '0')
    const month = br[2].padStart(2, '0')
    const year = br[3].length === 2 ? `20${br[3]}` : br[3]
    const iso = `${year}-${month}-${day}`
    return Number.isNaN(new Date(`${iso}T00:00:00`).getTime()) ? null : iso
  }

  // DD/MM or DD-MM without year -> assume current year
  const shortBr = s.match(/^(\d{1,2})[\/\-.](\d{1,2})$/)
  if (shortBr) {
    const day = shortBr[1].padStart(2, '0')
    const month = shortBr[2].padStart(2, '0')
    const iso = `${defaultYear}-${month}-${day}`
    return Number.isNaN(new Date(`${iso}T00:00:00`).getTime()) ? null : iso
  }

  // DD MON YYYY (pt-BR months), e.g. 02 MAR 2026
  const textual = s.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/i)
  if (textual) {
    const day = textual[1].padStart(2, '0')
    const month = PT_MONTH_TO_NUM[stripAccents(textual[2].toLowerCase())]
    const year = textual[3]
    if (month) {
      const iso = `${year}-${month}-${day}`
      return Number.isNaN(new Date(`${iso}T00:00:00`).getTime()) ? null : iso
    }
  }

  // DD MON (without year), assume current year
  const textualShort = s.match(/^(\d{1,2})\s+([A-Za-z]{3})$/i)
  if (textualShort) {
    const day = textualShort[1].padStart(2, '0')
    const month = PT_MONTH_TO_NUM[stripAccents(textualShort[2].toLowerCase())]
    if (month) {
      const iso = `${defaultYear}-${month}-${day}`
      return Number.isNaN(new Date(`${iso}T00:00:00`).getTime()) ? null : iso
    }
  }

  // YYYY-MM-DD
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoMatch) {
    return Number.isNaN(new Date(`${s}T00:00:00`).getTime()) ? null : s
  }

  // YYYYMMDD from OFX
  const compact = s.match(/^(\d{4})(\d{2})(\d{2})/)
  if (compact) {
    const iso = `${compact[1]}-${compact[2]}-${compact[3]}`
    return Number.isNaN(new Date(`${iso}T00:00:00`).getTime()) ? null : iso
  }

  return null
}

function inferDirectionFromText(text) {
  const s = stripAccents(String(text || '').toLowerCase())
  if (!s) return 'unknown'
  if (/\bcredito\b|\bentrada\b|\brecebido\b|\bestorno\b|\bpix recebido\b|\btransferencia recebida\b/.test(s)) return 'credit'
  if (/\bdebito\b|\bsaida\b|\bpagamento\b|\bcompra\b|\bjuros\b|\bencargo\b|\bfatura\b/.test(s)) return 'debit'
  return 'unknown'
}

// ---------------------------------------------------------------------------
// OFX parser
// ---------------------------------------------------------------------------

function parseOFX(text) {
  console.log('[Parser] format=OFX')

  const rows = []
  const blocks = text.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) || []
  if (blocks.length === 0) {
    // SGML fallback
    const parts = text.split(/<STMTTRN>/gi).slice(1)
    for (const part of parts) {
      const end = part.search(/<\/?[A-Z]{4,}(?:\s|>)/)
      const body = end >= 0 ? part.slice(0, end) : part
      blocks.push(`<STMTTRN>${body}`)
    }
  }

  if (blocks.length === 0) {
    throw new ParseError('Nenhuma transacao encontrada no arquivo OFX.')
  }

  for (const block of blocks) {
    const dateRaw = ofxField(block, 'DTPOSTED') || ofxField(block, 'DTUSER') || ''
    const amountRaw = ofxField(block, 'TRNAMT') || ''
    const memo = ofxField(block, 'MEMO') || ''
    const name = ofxField(block, 'NAME') || ''
    const typeRaw = ofxField(block, 'TRNTYPE') || ''
    const balanceRaw = ofxField(block, 'BALAMT')

    const date = parseDateToISO(dateRaw)
    const signed = normaliseBRAmount(amountRaw)
    if (!date || !Number.isFinite(signed) || signed === 0) continue

    const balance = normaliseBRAmount(balanceRaw)

    rows.push({
      date,
      description: [memo, name, typeRaw].filter(Boolean).join(' - ') || 'Sem descricao',
      amount: Math.abs(signed),
      direction: signed < 0 ? 'debit' : 'credit',
      balance: Number.isFinite(balance) ? balance : null,
      rawLine: block.replace(/\s+/g, ' ').slice(0, 180),
    })
  }

  if (rows.length === 0) {
    throw new ParseError('Arquivo OFX lido, mas nenhuma transacao valida foi identificada.')
  }

  return rows
}

function ofxField(block, field) {
  const re = new RegExp(`<${field}>([^<\r\n]+)`, 'i')
  const m = block.match(re)
  return m ? m[1].trim() : null
}

// ---------------------------------------------------------------------------
// CSV parser
// ---------------------------------------------------------------------------

function parseCSV(text) {
  console.log('[Parser] format=CSV/TXT')

  const normalizedText = String(text || '').replace(/\u0000/g, '')
  const lines = normalizedText
    .split(/\r?\n/)
    .map((line) => line.replace(/\r/g, '').trim())
    .filter((line) => line.length > 0)

  if (lines.length < 2) {
    throw new ParseError('Arquivo CSV parece vazio ou sem linhas suficientes.')
  }

  const delimiter = detectBestSeparator(lines)
  console.log(`[Parser] delimiter="${delimiter === '\t' ? 'TAB' : delimiter}"`)

  const table = lines.map((line) => splitDelimitedLine(line, delimiter))
  const headerIdx = findHeaderRowIndex(table)
  const firstDataIdx = findLikelyFirstDataIndex(table, headerIdx)
  const headers = headerIdx >= 0 ? table[headerIdx].map((c) => stripAccents(c.toLowerCase().trim())) : null
  const dataRows = table.slice(firstDataIdx)

  const columns = detectColumns(headers, dataRows)
  console.log('[Parser] columns:', columns)
  if (headers) {
    console.log('[Parser] headers:', headers)
  }

  const diagnostics = {
    rowsTotal: dataRows.length,
    rowsAccepted: 0,
    rowsSkipped: 0,
    reasons: {},
    anyDateDetected: false,
    anyAmountDetected: false,
  }

  const rows = []
  for (let i = 0; i < dataRows.length; i += 1) {
    const cells = dataRows[i]
    const parsed = parseCSVDataRow(cells, columns, i + 1, diagnostics)
    if (parsed) rows.push(parsed)
  }

  console.log('[Parser] first parsed rows:', rows.slice(0, 5))
  console.log('[Parser] skip reasons:', diagnostics.reasons)

  if (rows.length === 0) {
    if (!diagnostics.anyDateDetected) {
      throw new ParseError('Arquivo CSV lido, mas as datas nao foram identificadas.')
    }
    if (!diagnostics.anyAmountDetected) {
      throw new ParseError('Arquivo CSV lido, mas nenhuma coluna de valor foi reconhecida.')
    }
    throw new ParseError('Arquivo CSV lido, mas nenhuma transacao valida foi formada. Verifique datas, valores e delimitador.')
  }

  return rows
}

function detectBestSeparator(lines) {
  const sample = lines.slice(0, 60)
  const candidates = [',', ';', '\t', '|']

  let best = ';'
  let bestScore = -Infinity

  for (const sep of candidates) {
    const widths = []
    for (const line of sample) {
      const cells = splitDelimitedLine(line, sep)
      widths.push(cells.length)
    }

    const useful = widths.filter((n) => n > 1).length
    const mode = modeOf(widths)
    const stable = widths.filter((n) => n === mode).length
    const score = useful * 10 + stable + mode

    console.log(`[Parser] delimiter test sep="${sep === '\t' ? 'TAB' : sep}" useful=${useful}/${sample.length} mode=${mode} stable=${stable} score=${score}`)

    if (score > bestScore) {
      bestScore = score
      best = sep
    }
  }

  return best
}

function splitDelimitedLine(line, sep) {
  const out = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        field += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (ch === sep && !inQuotes) {
      out.push(field.trim())
      field = ''
    } else {
      field += ch
    }
  }

  out.push(field.trim())
  return out
}

function findHeaderRowIndex(table) {
  const maxScan = Math.min(table.length, 40)
  let bestIdx = -1
  let bestScore = 0

  for (let i = 0; i < maxScan; i += 1) {
    const row = table[i].map((c) => stripAccents(c.toLowerCase()))
    const hasDate = row.some((c) => /\bdata\b|\bdate\b|\bdt\b/.test(c))
    const hasValue = row.some((c) => /\bvalor\b|\bamount\b|\bvalue\b|\bvlr\b|\bdebito\b|\bcredito\b|\bsaida\b|\bentrada\b/.test(c))
    const hasDesc = row.some((c) => /\bdescricao\b|\bhistorico\b|\bmemo\b|\bdetalhe\b/.test(c))
    const score = (hasDate ? 2 : 0) + (hasValue ? 2 : 0) + (hasDesc ? 1 : 0)

    if (score > bestScore && row.length > 1) {
      bestScore = score
      bestIdx = i
    }
  }

  return bestScore >= 3 ? bestIdx : -1
}

function findLikelyFirstDataIndex(table, headerIdx) {
  if (headerIdx >= 0) return headerIdx + 1

  for (let i = 0; i < Math.min(table.length, 80); i += 1) {
    const row = table[i]
    const hasDate = row.some((cell) => parseDateToISO(cell) !== null)
    const hasAmount = row.some((cell) => {
      const n = normaliseBRAmount(cell)
      return Number.isFinite(n) && n !== 0
    })
    if (hasDate && hasAmount) return i
  }

  return 0
}

function detectColumns(headers, dataRows) {
  const columns = {
    dateIdx: -1,
    descIdx: -1,
    amountIdx: -1,
    debitIdx: -1,
    creditIdx: -1,
    directionIdx: -1,
    balanceIdx: -1,
  }

  if (headers && headers.length > 0) {
    columns.balanceIdx = headers.findIndex((h) => /\bsaldo\b|\bbalance\b/.test(h))
    columns.dateIdx = headers.findIndex((h) => /\bdata\b|\bdate\b|\bdt\b/.test(h))
    columns.descIdx = headers.findIndex((h) => /\bdescricao\b|\bhistorico\b|\bmemo\b|\bdetalhe\b|\blancamento\b/.test(h))
    columns.debitIdx = headers.findIndex((h, i) => i !== columns.balanceIdx && /\bdebito\b|\bdebit\b|\bsaida\b/.test(h))
    columns.creditIdx = headers.findIndex((h, i) => i !== columns.balanceIdx && /\bcredito\b|\bcredit\b|\bentrada\b/.test(h))
    columns.directionIdx = headers.findIndex((h) => /^d\s*\/\s*c$|^dc$|\btipo\b|\bnatureza\b/.test(h))
    if (columns.debitIdx < 0 || columns.creditIdx < 0) {
      columns.amountIdx = headers.findIndex((h, i) => i !== columns.balanceIdx && /\bvalor\b|\bamount\b|\bvalue\b|\bvlr\b|\bvl\.?\b/.test(h))
    }
  }

  const sample = dataRows.slice(0, 120)
  const scoreDate = {}
  const scoreAmount = {}
  const scoreText = {}

  for (const row of sample) {
    row.forEach((cell, idx) => {
      if (parseDateToISO(cell)) scoreDate[idx] = (scoreDate[idx] || 0) + 1
      const n = normaliseBRAmount(cell)
      if (Number.isFinite(n) && n !== 0 && Math.abs(n) < MAX_SANITY_AMOUNT) {
        scoreAmount[idx] = (scoreAmount[idx] || 0) + 1
      }
      if (/[A-Za-z\u00C0-\u00FF]/.test(cell)) {
        scoreText[idx] = (scoreText[idx] || 0) + 1
      }
    })
  }

  if (columns.dateIdx < 0) columns.dateIdx = maxKey(scoreDate)
  if (columns.descIdx < 0) columns.descIdx = maxKey(scoreText, [columns.dateIdx])

  if (columns.amountIdx < 0 && columns.debitIdx < 0 && columns.creditIdx < 0) {
    columns.amountIdx = maxKey(scoreAmount, [columns.dateIdx, columns.descIdx, columns.balanceIdx])
  }

  return columns
}

function parseCSVDataRow(cells, columns, rowNum, diagnostics) {
  const fail = (reason) => {
    diagnostics.rowsSkipped += 1
    diagnostics.reasons[reason] = (diagnostics.reasons[reason] || 0) + 1
    if (diagnostics.rowsSkipped <= MAX_REASON_LOGS) {
      console.log(`[Parser] skip row ${rowNum}: ${reason}`, cells)
    }
    return null
  }

  const dateCell = findDateCell(cells, columns.dateIdx)
  if (!dateCell.iso) return fail('date_not_found')
  diagnostics.anyDateDetected = true

  let amount = null
  let direction = 'unknown'
  let amountCellIdx = -1

  // Prefer split debit/credit columns when available.
  if (columns.debitIdx >= 0 || columns.creditIdx >= 0) {
    const debitRaw = columns.debitIdx >= 0 ? cells[columns.debitIdx] : ''
    const creditRaw = columns.creditIdx >= 0 ? cells[columns.creditIdx] : ''
    const debit = normaliseBRAmount(debitRaw)
    const credit = normaliseBRAmount(creditRaw)

    if (Number.isFinite(credit) && Math.abs(credit) > 0) {
      amount = Math.abs(credit)
      direction = 'credit'
      amountCellIdx = columns.creditIdx
    } else if (Number.isFinite(debit) && Math.abs(debit) > 0) {
      amount = Math.abs(debit)
      direction = 'debit'
      amountCellIdx = columns.debitIdx
    }
  }

  if (amount === null && columns.amountIdx >= 0) {
    const signed = normaliseBRAmount(cells[columns.amountIdx])
    if (Number.isFinite(signed) && signed !== 0) {
      amount = Math.abs(signed)
      direction = signed < 0 ? 'debit' : 'credit'
      amountCellIdx = columns.amountIdx
    }
  }

  // Salvage mode: scan row for any plausible amount if mapped columns fail.
  if (amount === null) {
    for (let i = 0; i < cells.length; i += 1) {
      if (i === columns.dateIdx || i === columns.descIdx || i === columns.balanceIdx) continue
      const n = normaliseBRAmount(cells[i])
      if (Number.isFinite(n) && n !== 0 && Math.abs(n) < MAX_SANITY_AMOUNT) {
        amount = Math.abs(n)
        direction = n < 0 ? 'debit' : 'credit'
        amountCellIdx = i
        break
      }
    }
  }

  if (amount === null || !Number.isFinite(amount) || amount <= 0) {
    return fail('amount_not_found')
  }
  diagnostics.anyAmountDetected = true

  if (amount > MAX_SANITY_AMOUNT) {
    return fail('amount_sanity_rejected')
  }

  if (columns.directionIdx >= 0) {
    const dc = stripAccents((cells[columns.directionIdx] || '').toLowerCase())
    if (/^c|\bcred/.test(dc)) direction = 'credit'
    if (/^d|\bdeb/.test(dc)) direction = 'debit'
  }

  const desc = buildDescription(cells, columns, amountCellIdx, dateCell.index)
  if (!desc) return fail('description_not_found')

  if (direction === 'unknown') {
    direction = inferDirectionFromText(desc)
    if (direction === 'unknown') direction = 'debit'
  }

  diagnostics.rowsAccepted += 1

  return {
    date: dateCell.iso,
    description: desc,
    amount,
    direction,
    balance: null,
    rawLine: cells.join(' | ').slice(0, 180),
  }
}

function findDateCell(cells, preferredIdx) {
  if (preferredIdx >= 0 && preferredIdx < cells.length) {
    const iso = parseDateToISO(cells[preferredIdx])
    if (iso) return { iso, index: preferredIdx }
  }

  for (let i = 0; i < cells.length; i += 1) {
    const iso = parseDateToISO(cells[i])
    if (iso) return { iso, index: i }
  }

  return { iso: null, index: -1 }
}

function buildDescription(cells, columns, amountIdx, dateIdx) {
  if (columns.descIdx >= 0 && cells[columns.descIdx]) {
    return String(cells[columns.descIdx]).trim()
  }

  const pieces = cells
    .map((cell, idx) => ({ cell, idx }))
    .filter(({ cell, idx }) => {
      if (!cell) return false
      if (idx === amountIdx || idx === dateIdx || idx === columns.balanceIdx) return false
      if (parseDateToISO(cell)) return false
      const n = normaliseBRAmount(cell)
      if (Number.isFinite(n) && n !== 0) return false
      return /[A-Za-z\u00C0-\u00FF]/.test(cell)
    })
    .map(({ cell }) => String(cell).trim())
    .filter(Boolean)

  return pieces.join(' - ').trim()
}

function stripAccents(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function modeOf(values) {
  const freq = {}
  let best = values[0] || 0
  let bestCount = 0
  for (const v of values) {
    freq[v] = (freq[v] || 0) + 1
    if (freq[v] > bestCount) {
      best = v
      bestCount = freq[v]
    }
  }
  return Number(best) || 0
}

function maxKey(scoreMap, exclude = []) {
  let bestKey = -1
  let bestVal = -1
  const blocked = new Set(exclude.filter((n) => Number.isInteger(n) && n >= 0))
  for (const [key, value] of Object.entries(scoreMap)) {
    const idx = Number(key)
    if (blocked.has(idx)) continue
    if (value > bestVal) {
      bestVal = value
      bestKey = idx
    }
  }
  return bestKey
}

// ---------------------------------------------------------------------------
// PDF parser (basic text PDFs)
// ---------------------------------------------------------------------------

let pdfWorkerConfigured = false

async function parsePDF(file) {
  console.log('[Parser] format=PDF')

  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist')
  if (!pdfWorkerConfigured) {
    GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
    pdfWorkerConfigured = true
  }

  const buffer = await file.arrayBuffer()
  const pdf = await getDocument({ data: new Uint8Array(buffer) }).promise

  const lines = []
  let totalTextLength = 0
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum)
    const content = await page.getTextContent()
    const grouped = groupPdfTextToLines(content.items || [])
    totalTextLength += grouped.join('\n').length
    lines.push(...grouped)
  }

  const previewLines = lines.slice(0, 30)
  console.log(`[PDF] pages: ${pdf.numPages}`)
  console.log(`[PDF] text length: ${totalTextLength}`)
  console.log('[PDF] preview:')
  previewLines.forEach((line) => console.log(line))

  if (lines.length === 0) {
    throw new ParseError('PDF sem texto selecionavel. Talvez seja necessario OCR ou outro formato.', {
      previewLines,
      pdfPages: pdf.numPages,
      extractedTextLength: totalTextLength,
    })
  }

  const kind = detectPdfKind(lines)
  const layout = detectPdfLayout(lines)
  const structure = analyzePdfLines(lines)
  console.log(`[Parser] PDF kind: ${kind}`)
  console.log(`[PDF] layout: ${layout}`)
  console.log('[PDF] structure:', structure)

  const rows = layout === 'nubank_statement'
    ? parseNubankPdf(lines)
    : parseGenericPdf(lines, kind)

  const lowConfidenceCount = rows.filter((row) => row.direction === 'unknown').length
  console.log(`[PDF] ignored lines: ${rows.__meta?.ignoredLines ?? 0}`)
  console.log(`[PDF] transactions recognized: ${rows.length}`)
  console.log(`[PDF] low confidence: ${lowConfidenceCount}`)

  if (rows.length === 0) {
    throw new ParseError('PDF lido, mas o layout ainda nao foi reconhecido com seguranca.', {
      previewLines,
      pdfPages: pdf.numPages,
      extractedTextLength: totalTextLength,
      pdfKind: kind,
      pdfLayout: layout,
      pdfStructure: structure,
    })
  }

  console.log('[Parser] PDF first parsed rows:', rows.slice(0, 5))
  return rows
}

function analyzePdfLines(lines) {
  const datePattern = /\b\d{1,2}[\/\-.]\d{1,2}(?:[\/\-.](?:\d{2}|\d{4}))?\b|\b\d{1,2}\s+[A-Za-z]{3}(?:\s+\d{4})?\b/
  const amountPattern = /[-+]?\s*R?\$?\s*\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})|[-+]?\s*R?\$?\s*\d+(?:,\d{2})/g

  let dateLines = 0
  let amountLines = 0
  let candidateLines = 0
  let signedLines = 0

  for (const line of lines) {
    const hasDate = datePattern.test(line)
    const amounts = line.match(amountPattern) || []
    const hasAmount = amounts.length > 0
    if (hasDate) dateLines += 1
    if (hasAmount) amountLines += 1
    if (hasDate && hasAmount) candidateLines += 1
    if (/[-+]\s*R?\$?\s*\d/.test(line)) signedLines += 1
  }

  return {
    lines: lines.length,
    dateLines,
    amountLines,
    candidateLines,
    signedLines,
  }
}

function groupPdfTextToLines(items) {
  const sorted = [...items]
    .map((item) => ({
      text: String(item.str || '').trim(),
      x: item.transform?.[4] || 0,
      y: item.transform?.[5] || 0,
    }))
    .filter((item) => item.text)
    .sort((a, b) => {
      if (Math.abs(b.y - a.y) > 1.5) return b.y - a.y
      return a.x - b.x
    })

  const lines = []
  let current = []
  let currentY = null

  for (const token of sorted) {
    if (currentY === null || Math.abs(token.y - currentY) <= 2) {
      current.push(token)
      currentY = currentY === null ? token.y : currentY
    } else {
      lines.push(current.map((t) => t.text).join(' ').replace(/\s+/g, ' ').trim())
      current = [token]
      currentY = token.y
    }
  }

  if (current.length > 0) {
    lines.push(current.map((t) => t.text).join(' ').replace(/\s+/g, ' ').trim())
  }

  return lines.filter(Boolean)
}

function detectPdfKind(lines) {
  const head = stripAccents(lines.slice(0, 120).join(' ').toLowerCase())
  if (/\bfatura\b|\bcartao\b|\bfechamento\b|\bvencimento\b/.test(head)) return 'invoice'
  if (/\bextrato\b|\bsaldo\b|\bconta corrente\b|\bmovimentacao\b/.test(head)) return 'statement'
  return 'unknown'
}

function detectPdfLayout(lines) {
  const head = stripAccents(lines.slice(0, 180).join(' ').toLowerCase())
  let nubankScore = 0

  if (/\bnubank\b|\bnu pagamentos\b/.test(head)) nubankScore += 3
  if (/\bcompra no debito\b/.test(head)) nubankScore += 2
  if (/\btransferencia recebida pelo pix\b|\bpix recebido\b/.test(head)) nubankScore += 2
  if (/\bpagamento de fatura\b/.test(head)) nubankScore += 1
  if (/\btotal de entradas\b|\btotal de saidas\b/.test(head)) nubankScore += 1
  if (/\bchat do app\b|\bligue\b|\bcapitais e regioes\b/.test(head)) nubankScore += 1

  if (nubankScore >= 3) return 'nubank_statement'
  return 'generic_statement'
}

function extractBrazilianAmounts(text) {
  const amountPattern = /[-+]?\s*R?\$?\s*\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})|[-+]?\s*R?\$?\s*\d+(?:,\d{2})/g
  return text.match(amountPattern) || []
}

function parseDateTextFromLine(line, defaultYear = new Date().getFullYear()) {
  const full = line.match(/\b(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})\b/i)
  if (full) return parseDateToISO(full[1], defaultYear)

  const short = line.match(/\b(\d{1,2}\s+[A-Za-z]{3})\b/i)
  if (short) return parseDateToISO(short[1], defaultYear)

  const numeric = line.match(/\b(\d{1,2}[\/\-.]\d{1,2}(?:[\/\-.](?:\d{2}|\d{4}))?)\b/)
  if (numeric) return parseDateToISO(numeric[1], defaultYear)

  return null
}

function parseNubankPdf(lines) {
  const rows = []
  const meta = { ignoredLines: 0 }
  const currentYear = new Date().getFullYear()
  const todayIso = new Date().toISOString().slice(0, 10)

  let lastDateIso = null
  let pending = null

  for (const raw of lines) {
    const line = String(raw || '').replace(/\s+/g, ' ').trim()
    if (!line) continue

    if (isNubankNoiseLine(line)) {
      meta.ignoredLines += 1
      continue
    }

    const lineDate = parseDateTextFromLine(line, currentYear)
    if (lineDate) lastDateIso = lineDate

    const amounts = extractBrazilianAmounts(line)
    const onlyAmountLine = isAmountOnlyLine(line)

    if (onlyAmountLine && pending && amounts.length > 0) {
      const row = buildNubankRowFromParts(pending.text, amounts[0], pending.date || lastDateIso || todayIso)
      if (row) rows.push(row)
      pending = null
      continue
    }

    if (amounts.length > 0 && looksLikeNubankTransactionLine(line)) {
      const pickedAmount = pickLikelyAmount(line, amounts)
      const dateForRow = lineDate || lastDateIso || todayIso
      const row = buildNubankRowFromParts(line, pickedAmount, dateForRow)
      if (row) rows.push(row)
      pending = null
      continue
    }

    if (looksLikeDescriptionContinuation(line)) {
      if (pending) {
        pending.text = `${pending.text} ${line}`.replace(/\s+/g, ' ').trim()
      } else {
        pending = { text: line, date: lineDate || lastDateIso || todayIso }
      }
      continue
    }

    meta.ignoredLines += 1
  }

  Object.defineProperty(rows, '__meta', {
    value: meta,
    enumerable: false,
    configurable: true,
  })

  return rows
}

function isNubankNoiseLine(line) {
  const s = stripAccents(line.toLowerCase())

  if (/\bsaldo\b|\btotal de entradas\b|\btotal de saidas\b|\bagencia\b|\bconta\b|\batendimento\b|\bchat do app\b|\bligue\b|\bcapitais e regioes\b|\bpagina\b|\bresumo\b/.test(s)) {
    if (!/pagamento de fatura/.test(s)) return true
  }

  if (/^\d{2}\s+[a-z]{3}\s+\d{4}\s+total\b/.test(s)) return true
  return false
}

function isAmountOnlyLine(line) {
  const compact = line.replace(/\s+/g, '')
  return /^[-+]?R?\$?\d{1,3}(?:\.\d{3})*,\d{2}$/.test(compact)
}

function looksLikeNubankTransactionLine(line) {
  const s = stripAccents(line.toLowerCase())
  return /compra no debito|compra|pagamento de fatura|transferencia recebida|pix recebido|pix|debito|credito/.test(s)
}

function looksLikeDescriptionContinuation(line) {
  const s = stripAccents(line.toLowerCase())
  if (isNubankNoiseLine(line)) return false
  if (isAmountOnlyLine(line)) return false
  if (!/[a-z]/i.test(s)) return false
  return true
}

function pickLikelyAmount(line, amounts) {
  if (amounts.length === 1) return amounts[0]

  const signed = amounts.filter((value) => /^[\s]*[-+]/.test(value))
  if (signed.length > 0) return signed[signed.length - 1]

  if (/total de entradas|total de saidas/i.test(stripAccents(line.toLowerCase()))) {
    return amounts[0]
  }

  return amounts[amounts.length - 1]
}

function buildNubankRowFromParts(sourceText, rawAmount, dateIso) {
  const signed = normaliseBRAmount(rawAmount)
  if (!Number.isFinite(signed) || signed === 0) return null

  let description = sourceText
    .replace(rawAmount, '')
    .replace(/\b\d{1,2}\s+[A-Za-z]{3}(?:\s+\d{4})?\b/i, '')
    .replace(/\b\d{1,2}[\/\-.]\d{1,2}(?:[\/\-.](?:\d{2}|\d{4}))?\b/, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!description) description = 'Lancamento importado de PDF Nubank'

  let direction = inferPdfDirection(rawAmount, description, 'statement')
  if (direction === 'unknown' && signed < 0) direction = 'debit'
  if (direction === 'unknown' && signed > 0 && /^[\s]*\+/.test(rawAmount)) direction = 'credit'

  return {
    date: dateIso,
    description,
    amount: Math.abs(signed),
    direction,
    balance: null,
    rawLine: sourceText.slice(0, 180),
  }
}

function parseGenericPdf(lines, kind) {
  const rows = []

  const currentYear = new Date().getFullYear()
  const datePattern = /\b(\d{1,2}[\/\-.]\d{1,2}(?:[\/\-.](?:\d{2}|\d{4}))?)\b/
  const amountPattern = /[-+]?\s*R?\$?\s*\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})|[-+]?\s*R?\$?\s*\d+(?:,\d{2})/g
  const skipLinePattern = /\bsaldo\b|\bsaldo anterior\b|\bsaldo final\b|\bsaldo do dia\b|\btotal\b|\bresumo\b|\bpagina\b|\bextrato\b/i

  for (const line of lines) {
    const compactLine = line.replace(/\s+/g, ' ').trim()
    if (!compactLine || skipLinePattern.test(compactLine)) continue

    const dateMatch = compactLine.match(datePattern)
    if (!dateMatch) continue

    const isoDate = parseDateToISO(dateMatch[1], currentYear)
    if (!isoDate) continue

    const amounts = compactLine.match(amountPattern)
    if (!amounts || amounts.length === 0) continue

    const rawAmount = choosePdfAmountCandidate(amounts, compactLine)
    if (!rawAmount) continue

    const signed = normaliseBRAmount(rawAmount)
    if (!Number.isFinite(signed) || signed === 0) continue

    let description = compactLine
      .replace(dateMatch[1], '')
      .replace(rawAmount, '')
      .replace(/\s+/g, ' ')
      .replace(/^[\-–—:+]+/, '')
      .replace(/[\-–—:+]+$/, '')
      .trim()

    if (!description) description = 'Lancamento importado de PDF'

    let direction = inferPdfDirection(rawAmount, description, kind)
    if (direction === 'unknown' && signed < 0) {
      direction = 'debit'
    }

    rows.push({
      date: isoDate,
      description,
      amount: Math.abs(signed),
      direction,
      balance: null,
      rawLine: line.slice(0, 180),
    })
  }

  return rows
}

function choosePdfAmountCandidate(amounts, line) {
  if (!amounts || amounts.length === 0) return null

  const signed = amounts.filter((value) => /^[\s]*[-+]/.test(value))
  if (signed.length > 0) return signed[signed.length - 1]

  const lineHint = inferDirectionFromText(line)
  if (amounts.length === 1) return amounts[0]

  if (lineHint !== 'unknown') return amounts[0]

  // Statement PDFs often end the line with running balance. Prefer the first amount.
  return amounts[0]
}

function inferPdfDirection(rawAmount, description, kind) {
  const token = String(rawAmount || '').trim()
  if (token.startsWith('-')) return 'debit'
  if (token.startsWith('+')) return 'credit'

  const hinted = inferDirectionFromText(description)
  if (hinted !== 'unknown') return hinted

  if (kind === 'invoice') return 'debit'
  return 'unknown'
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function parseStatement(text, fileName) {
  const ext = (fileName || '').toLowerCase().split('.').pop()
  const head = String(text || '').slice(0, 1000).toLowerCase()

  if (ext === 'ofx' || ext === 'qfx' || head.includes('<ofx>') || head.includes('<stmttrn>') || head.includes('ofxheader')) {
    return parseOFX(text)
  }

  if (ext === 'pdf' || head.startsWith('%pdf')) {
    throw new ParseError('PDF enviado, mas o fluxo de texto deve usar parseStatementFile(file).')
  }

  return parseCSV(text)
}

export async function parseStatementFile(file) {
  const ext = (file?.name || '').toLowerCase().split('.').pop()

  if (ext === 'pdf') {
    return parsePDF(file)
  }

  const { text } = await readStatementFile(file)
  return parseStatement(text, file.name)
}

/**
 * Reads as UTF-8, strips BOM, and retries as ISO-8859-1 when decoding is noisy.
 */
export async function readStatementFile(file) {
  const readAsText = (enc) => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(String(e.target?.result || ''))
    reader.onerror = () => reject(new Error('Erro ao ler arquivo.'))
    reader.readAsText(file, enc)
  })

  try {
    let utf8 = await readAsText('UTF-8')
    utf8 = utf8.replace(/^\uFEFF/, '')

    const replacementCount = (utf8.match(/\uFFFD/g) || []).length
    if (replacementCount > 3) {
      let latin = await readAsText('ISO-8859-1')
      latin = latin.replace(/^\uFEFF/, '')
      console.log('[Parser] encoding fallback: ISO-8859-1')
      return { text: latin, encoding: 'ISO-8859-1' }
    }

    return { text: utf8, encoding: 'UTF-8' }
  } catch (err) {
    throw new Error(`Nao foi possivel ler o arquivo: ${err.message}`)
  }
}

export { ParseError }
