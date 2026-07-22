import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const rules = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8')

test('regras bloqueiam exclusao definitiva de dividas e transacoes', () => {
  const debtBlock = rules.match(/match \/debts\/\{docId\}[\s\S]*?match \/financialAuditLogs/)[0]
  const txBlock = rules.match(/match \/transactions\/\{docId\}[\s\S]*?match \/debts/)[0]
  assert.match(debtBlock, /allow delete: if false/)
  assert.match(txBlock, /allow delete: if false/)
})

test('logs sao imutaveis e ajustes sao restritos a administradores', () => {
  const logBlock = rules.match(/match \/financialAuditLogs[\s\S]*?match \/auditAdjustments/)[0]
  const adjustmentBlock = rules.match(/match \/auditAdjustments[\s\S]*?match \/financialSessions/)[0]
  assert.match(logBlock, /allow update, delete: if false/)
  assert.match(adjustmentBlock, /allow create: if isAdminUser/)
  assert.match(adjustmentBlock, /allow update, delete: if false/)
})

test('divida familiar valida credor e devedor dentro do workspace', () => {
  assert.match(rules, /validFamilyDebtMembers/)
  assert.match(rules, /members\/\$\(data\.creditorMemberId\)/)
  assert.match(rules, /members\/\$\(data\.debtorMemberId\)/)
})

test('administrador pode ler convites para diagnostico sem poder altera-los', () => {
  assert.match(rules, /match \/invitations\/\{inviteId\}[\s\S]*?allow read: if isWorkspaceMember\(workspaceId\) \|\| isAdminUser\(\)/)
  assert.match(rules, /allow read: if isAdminUser\(\) \|\| isFamilyOwner\(familyId\) \|\| isFamilyMember\(familyId\)/)
})
