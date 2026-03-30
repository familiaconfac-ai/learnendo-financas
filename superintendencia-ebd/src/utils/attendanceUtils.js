const STATUS_ORDER = ['', 'PP', 'P', 'A']
const WEIGHTS = {
  PP: 100,
  P: 90,
  A: 0,
  '': 0,
}

export function getSundaysByMonthYear(month, year) {
  const date = new Date(year, month - 1, 1)
  const sundays = []

  while (date.getMonth() === month - 1) {
    if (date.getDay() === 0) {
      sundays.push(date.toISOString().slice(0, 10))
    }
    date.setDate(date.getDate() + 1)
  }

  return sundays
}

export function cycleAttendanceStatus(currentStatus = '') {
  const index = STATUS_ORDER.indexOf(currentStatus)
  const next = STATUS_ORDER[(index + 1) % STATUS_ORDER.length]
  return next
}

export function calculateStudentAttendance(sundayDates, studentAttendance = {}) {
  let totalPP = 0
  let totalP = 0
  let totalA = 0
  let weightedTotal = 0

  sundayDates.forEach((date) => {
    const status = studentAttendance[date] || ''
    if (status === 'PP') totalPP += 1
    if (status === 'P') totalP += 1
    if (status === 'A') totalA += 1
    weightedTotal += WEIGHTS[status] ?? 0
  })

  const divisor = sundayDates.length || 1
  const percentualFinal = weightedTotal / divisor

  return {
    totalPP,
    totalP,
    totalA,
    percentualFinal,
  }
}

export function calculateClassSummary(register, students) {
  const sundayDates = register?.sundayDates || []
  const attendanceByStudent = register?.attendanceByStudent || {}

  let totalGeralPP = 0
  let totalGeralP = 0
  let totalGeralA = 0
  let sumPercent = 0

  students.forEach((student) => {
    const studentData = calculateStudentAttendance(sundayDates, attendanceByStudent[student.id])
    totalGeralPP += studentData.totalPP
    totalGeralP += studentData.totalP
    totalGeralA += studentData.totalA
    sumPercent += studentData.percentualFinal
  })

  const totalMatriculados = students.length
  const mediaGeralTurma = totalMatriculados ? sumPercent / totalMatriculados : 0

  return {
    totalMatriculados,
    totalGeralPP,
    totalGeralP,
    totalGeralA,
    totalPresencas: totalGeralPP + totalGeralP,
    totalAusencias: totalGeralA,
    mediaGeralTurma,
  }
}

export function formatSundayLabel(isoDate) {
  const date = new Date(`${isoDate}T00:00:00`)
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

export function formatMonthYear(month, year) {
  return new Date(year, month - 1, 1).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
  })
}
