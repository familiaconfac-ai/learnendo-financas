export function memberStableId(member) {
  return String(
    member?.uid
    || member?.memberId
    || member?.userId
    || member?.familyMemberId
    || member?.id
    || '',
  ).trim()
}

export function memberDisplayName(member) {
  return String(member?.displayName || member?.name || member?.email || 'Membro').trim()
}

export function isActiveFamilyMember(member) {
  const status = String(member?.status || '').trim().toLowerCase()
  return !status || ['active', 'ativo', 'accepted'].includes(status)
}

export function mergeActiveFamilyMembers(...memberLists) {
  const byId = new Map()

  memberLists.flat().filter(Boolean).forEach((member) => {
    const id = memberStableId(member)
    if (!id || !isActiveFamilyMember(member)) return
    const previous = byId.get(id) || {}
    byId.set(id, {
      ...previous,
      ...member,
      id,
      uid: member?.uid || previous?.uid || id,
      displayName: memberDisplayName({ ...previous, ...member }),
    })
  })

  return [...byId.values()].sort((a, b) => (
    memberDisplayName(a).localeCompare(memberDisplayName(b), 'pt-BR')
  ))
}

export function selectableFamilyMembers(memberLists, currentUserId) {
  const currentId = String(currentUserId || '').trim()
  return mergeActiveFamilyMembers(...memberLists)
    .filter((member) => memberStableId(member) !== currentId)
}
