import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const familyPage = await readFile(new URL('../src/pages/familia/Familia.jsx', import.meta.url), 'utf8')
const debtService = await readFile(new URL('../src/services/debtService.js', import.meta.url), 'utf8')
const workspaceService = await readFile(new URL('../src/services/workspaceService.js', import.meta.url), 'utf8')
const workspaceContext = await readFile(new URL('../src/context/WorkspaceContext.jsx', import.meta.url), 'utf8')
const invitePage = await readFile(new URL('../src/pages/auth/InviteAccept.jsx', import.meta.url), 'utf8')
const rules = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8')

test('credor pode abater recebimento sem criar divida inversa', () => {
  assert.match(familyPage, /Abater saldo/)
  assert.match(familyPage, /Confirmar abatimento/)
  assert.match(debtService, /export async function recordReceivedDebtSettlement/)
  assert.match(debtService, /Somente quem vai receber pode abater diretamente este saldo/)
  assert.doesNotMatch(debtService, /buildOverflowDebtRecord|Saldo invertido automaticamente/)
})

test('compensacao nao exige conta financeira', () => {
  assert.match(familyPage, /\['cash', 'compensation'\]\.includes/)
  assert.match(familyPage, /Pagou R\$ 500 da minha fatura do cartao/)
})

test('convite familiar e descoberto pelo email e identificado pelo workspace', () => {
  assert.match(workspaceService, /fetchPendingWorkspaceInvitesForEmail/)
  assert.match(workspaceService, /workspaceName/)
  assert.match(workspaceService, /normalized === 'admin'\) return 'gestor'/)
  assert.match(workspaceService, /canInvite: isFullManager \|\| isCoManager/)
  assert.match(invitePage, /Aceitar convite e pedir entrada/)
  assert.match(familyPage, /Convidar para esta fam.lia/)
  assert.match(familyPage, /activeWorkspace\.type === 'family' \|\| !activeWorkspace\.type/)
  assert.match(familyPage, /familyWorkspace\?\.id \|\| family\?\.workspaceId \|\| family\?\.id/)
  assert.match(workspaceContext, /profile\?\.role !== 'admin'/)
})

test('token de convite por email so pode ser lido pelo destinatario autenticado', () => {
  const tokenRules = rules.match(/match \/workspaceInviteTokens\/\{token\}[\s\S]*?match \/workspaces/)[0]
  assert.match(tokenRules, /resource\.data\.email == request\.auth\.token\.email/)
})
