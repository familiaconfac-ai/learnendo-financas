import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeActiveFamilyMembers, selectableFamilyMembers } from '../src/utils/familyMembers.js'

test('combina membros modernos e legados sem descartar o espelho antigo', () => {
  const modern = [{ uid: 'me', displayName: 'Eu', status: 'active' }]
  const legacy = [{ memberId: 'eric', name: 'Eric', status: 'ativo' }]
  assert.deepEqual(mergeActiveFamilyMembers(modern, legacy).map((member) => member.id), ['eric', 'me'])
})

test('exclui o usuario atual, membros inativos e membros sem identificador', () => {
  const result = selectableFamilyMembers([[
    { uid: 'me', displayName: 'Eu', status: 'active' },
    { userId: 'eric', displayName: 'Eric', status: 'active' },
    { uid: 'old', displayName: 'Antigo', status: 'inactive' },
    { displayName: 'Orfao' },
  ]], 'me')
  assert.deepEqual(result.map((member) => member.id), ['eric'])
})

test('familia com apenas um membro nao oferece opcoes relacionadas', () => {
  assert.equal(selectableFamilyMembers([[{ uid: 'me', status: 'active' }]], 'me').length, 0)
})
