import { useState, useEffect, useMemo } from 'react'
import Card, { CardHeader } from '../../components/ui/Card'
import { formatCurrency } from '../../utils/formatCurrency'
import { formatDateBR } from '../../utils/formatDate'
import { useFamilia } from '../../hooks/useFamilia'
import { useAccounts } from '../../hooks/useAccounts'
import { useCards } from '../../hooks/useCards'
import { useDebts } from '../../hooks/useDebts'
import { useAuth } from '../../context/AuthContext'
import { useFinance } from '../../context/FinanceContext'
import { useWorkspace } from '../../context/WorkspaceContext'
import { buildFamilyDebtLedger, getExternalDebtDirection, isFamilyInternalDebt } from '../../services/debtService'
import { fetchAllTransactionsForWorkspace } from '../../services/transactionService'
import { calculateMonthlySummary } from '../../utils/financeCalculations'
import { getPermissionsByRole, getWorkspaceInviteByToken } from '../../services/workspaceService'
import { TRANSACTION_PAYMENT_METHODS, normalizePaymentMethodId } from '../../constants/transactionPaymentMethods'
import './Familia.css'

const PENDING_WORKSPACE_INVITE_KEY = 'lf:pending-workspace-invite-token'

function readPendingWorkspaceInviteToken() {
  try {
    return localStorage.getItem(PENDING_WORKSPACE_INVITE_KEY) || ''
  } catch (_) {
    return ''
  }
}

function clearPendingWorkspaceInviteToken(token = '') {
  try {
    const currentToken = localStorage.getItem(PENDING_WORKSPACE_INVITE_KEY)
    if (!token || !currentToken || currentToken === token) {
      localStorage.removeItem(PENDING_WORKSPACE_INVITE_KEY)
    }
  } catch (_) {
    // Ignore storage cleanup failures.
  }
}

// ── Role metadata (new canonical names) ────────────────────────────────────

const ROLE_META = {
  'planejador-master': { label: 'Planejador master', cls: 'role-planejador-master', icon: 'PM' },
  'planejador-plus': { label: 'Planejador plus', cls: 'role-planejador-plus', icon: 'P+' },
  'planejador-blind': { label: 'Planejador blind', cls: 'role-planejador-blind', icon: 'PB' },
  'gestor':     { label: 'Gestor',     cls: 'role-gestor',     icon: '👑' },
  'co-gestor':  { label: 'Co-gestor',  cls: 'role-cogestor',   icon: '🛡️' },
  'membro':     { label: 'Membro',     cls: 'role-membro',     icon: '👤' },
  'planejador': { label: 'Planejador', cls: 'role-planejador',  icon: '👁️' },
}

const ROLE_DESC = {
  'planejador-master': 'Apoio completo de configuracao. Atua como gestor no app, sem ser o dono principal da familia.',
  'planejador-plus': 'Apoio operacional amplo. Atua como co-gestor para ajudar no dia a dia financeiro.',
  'planejador-blind': 'Pode ajudar na configuracao e no acompanhamento, mas sem enxergar valores financeiros.',
  'gestor':     'Controle total. Pode editar a família, adicionar/remover membros e transferir liderança.',
  'co-gestor':  'Quase controle total. Pode gerenciar membros e editar dados de todos.',
  'membro':     'Pode criar e editar as próprias transações. Não gerencia membros.',
  'planejador': 'Apenas visualiza o consolidado familiar. Não pode editar nada.',
}

const INV_STATUS_META = {
  pending:   { label: 'Aguardando', cls: 'inv-pending'  },
  awaiting_confirmation: { label: 'Aguardando sua confirmacao', cls: 'inv-pending' },
  accepted:  { label: 'Aceito',     cls: 'inv-accepted' },
  declined:  { label: 'Recusado',   cls: 'inv-declined' },
  expired:   { label: 'Expirado',   cls: 'inv-expired'  },
  cancelled: { label: 'Cancelado',  cls: 'inv-expired'  },
}

const MANAGEABLE_ROLES = [
  { value: 'gestor', label: 'Gestor' },
  { value: 'co-gestor',  label: 'Co-gestor'  },
  { value: 'membro',     label: 'Membro'     },
  { value: 'planejador-master', label: 'Planejador master' },
  { value: 'planejador-plus', label: 'Planejador plus' },
  { value: 'planejador-blind', label: 'Planejador blind' },
  { value: 'planejador', label: 'Planejador' },
]

const INTERNAL_DEBT_DIRECTION_OPTIONS = [
  { value: 'member_owes_me', label: 'O membro me deve' },
  { value: 'i_owe_member', label: 'Eu devo para o membro' },
]

const INTERNAL_DEBT_REASON_OPTIONS = [
  { value: 'emprestimo', label: 'Emprestimo' },
  { value: 'troca_operacional', label: 'Troca operacional' },
  { value: 'cartao_familia', label: 'Compra no meu cartao' },
  { value: 'ajuste', label: 'Ajuste entre contas' },
]

const EXTERNAL_DEBT_TYPE_OPTIONS = [
  { value: 'pessoa', label: 'Pessoa de fora do app' },
  { value: 'banco', label: 'Banco' },
  { value: 'cartao', label: 'Cartao' },
  { value: 'empresa', label: 'Empresa' },
]

const EXTERNAL_DEBT_DIRECTION_OPTIONS = [
  { value: 'i_owe_contact', label: 'Eu devo para essa pessoa' },
  { value: 'contact_owes_me', label: 'Essa pessoa me deve' },
]

function memberStableId(member) {
  return member?.uid || member?.id || ''
}
function debtReasonLabel(reasonType) {
  return INTERNAL_DEBT_REASON_OPTIONS.find((option) => option.value === reasonType)?.label || 'Emprestimo'
}

function buildInternalDebtTitle(reasonType, memberName) {
  return `${debtReasonLabel(reasonType)} · ${memberName || 'Membro'}`
}

function defaultInternalDebtForm() {
  return {
    memberId: '',
    direction: 'member_owes_me',
    reasonType: 'emprestimo',
    title: '',
    totalAmount: '',
    paidAmount: '',
    notes: '',
  }
}

function defaultSettlementForm() {
  return {
    debtId: '',
    amount: '',
    notes: '',
    paymentMethod: 'pix',
    accountId: '',
    cardId: '',
  }
}

function defaultMemberSettlementDraft(debts = []) {
  return {
    open: false,
    debtId: debts[0]?.id || '',
    amount: '',
    notes: '',
    paymentMethod: 'pix',
    accountId: '',
    cardId: '',
  }
}

function defaultQuickSettlementDraft() {
  return {
    amount: '',
    notes: '',
    paymentMethod: 'pix',
    accountId: '',
    cardId: '',
  }
}

function defaultExternalDebtForm() {
  return {
    name: '',
    type: 'pessoa',
    direction: 'i_owe_contact',
    totalAmount: '',
    paidAmount: '',
    monthlyAmount: '',
    notes: '',
  }
}

function membersLabel(count) {
  if (count === 1) return '1 pessoa'
  return `${count} pessoas`
}

function counterpartMemberIdForDebt(debt, currentUserId) {
  if (!debt) return ''
  if (debt.creditorMemberId === currentUserId) return debt.debtorMemberId || debt.counterpartyMemberId || ''
  if (debt.debtorMemberId === currentUserId) return debt.creditorMemberId || debt.counterpartyMemberId || ''
  return debt.counterpartyMemberId || debt.creditorMemberId || debt.debtorMemberId || ''
}

function debtSettlementStatusLabel(status) {
  if (status === 'confirmed') return 'Confirmado'
  if (status === 'cancelled') return 'Cancelado'
  return 'Aguardando confirmacao'
}

function memberInviteStatusLabel(status) {
  if (status === 'pending_confirmation') return 'Aguardando confirmacao'
  if (status === 'pending') return 'Pendente'
  return ''
}

function memberSettlementDebtLabel(debt) {
  if (!debt) return ''
  const reason = debt.reasonLabel || debtReasonLabel(debt.reasonType)
  const customName = String(debt.name || '').trim()
  if (customName && customName !== reason) {
    return `${reason} · ${customName} · restante ${formatCurrency(debt.remainingAmount)}`
  }
  return `${reason} · restante ${formatCurrency(debt.remainingAmount)}`
}

function externalDebtRelationLabel(debt) {
  if (getExternalDebtDirection(debt) === 'contact_owes_me') {
    return `${debt.contactName || debt.name || 'Contato'} te deve`
  }
  return `Voce deve para ${debt.contactName || debt.name || 'Contato'}`
}

function accountOptionLabel(account) {
  if (!account) return ''
  return [account.name, account.bank].filter(Boolean).join(' · ')
}

function cardOptionLabel(card) {
  if (!card) return ''
  return [card.name, card.flag ? String(card.flag).toUpperCase() : '', card.holderName].filter(Boolean).join(' · ')
}

function dateValueFromFirestoreLike(value) {
  if (!value) return 0
  if (typeof value?.toDate === 'function') return value.toDate().getTime()
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? parsed : 0
}

function sortDebtsByOldestFirst(debts = []) {
  return [...debts].sort((a, b) => {
    const diff = (
      dateValueFromFirestoreLike(a?.loanConfirmedAt || a?.receiptConfirmedAt || a?.createdAt)
      - dateValueFromFirestoreLike(b?.loanConfirmedAt || b?.receiptConfirmedAt || b?.createdAt)
    )
    if (diff !== 0) return diff
    return String(a?.id || '').localeCompare(String(b?.id || ''))
  })
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function useToast() {
  const [toast, setToast] = useState(null)
  function show(msg, type = 'ok') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }
  return { toast, show }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Familia() {
  const { user } = useAuth()
  const { selectedMonth, selectedYear } = useFinance()
  const { accounts } = useAccounts()
  const { cards } = useCards()
  const {
    workspaces,
    changeWorkspace,
    createInviteLink,
    cancelInvite: cancelWorkspaceInvite,
    approveInvite,
    activeWorkspace,
    activeWorkspaceId,
    permissions,
    debtLedger,
    contacts,
    projects,
    members: workspaceMembers,
    invitations: workspaceInvitations,
    myRole: workspaceRole,
    addExternalContact,
    addProject,
    editProject,
  } = useWorkspace()
  const {
    debts,
    paymentsByDebtId,
    addDebt,
    addSettlement,
    confirmReceipt,
    confirmSettlement,
    cancelSettlement,
    removeDebt,
    removeSettlement,
  } = useDebts()
  const {
    family, members, invitations, loading, error,
    myRole, canManage, reload,
    create, editName, deleteFamily,
    removeMember, changeRole, addMember: addFamilyMember, cancelInvite: cancelLegacyInvite,
  } = useFamilia()
  const { toast, show: showToast } = useToast()

  // ── Modal state ────────────────────────────────────────────────────────────

  const [editFamilyOpen,     setEditFamilyOpen]     = useState(false)
  const [editName_value,     setEditNameValue]       = useState('')
  const [deleteFamilyOpen,   setDeleteFamilyOpen]    = useState(false)
  const [deleteConfirmText,  setDeleteConfirmText]   = useState('')
  const [removeMemberTarget, setRemoveMemberTarget]  = useState(null)
  const [inviteOpen,         setInviteOpen]          = useState(false)
  const [inviteTab,          setInviteTab]           = useState('whatsapp')  // 'whatsapp' | 'email'
  const [invitePhone,        setInvitePhone]         = useState('')
  const [inviteEmail,        setInviteEmail]         = useState('')
  const [inviteRole,         setInviteRole]          = useState('membro')
  const [createFamilyOpen,   setCreateFamilyOpen]    = useState(false)
  const [createName,         setCreateName]          = useState('')
  const [saving,             setSaving]              = useState(false)
  const [addMemberOpen,      setAddMemberOpen]       = useState(false)
  const [addMemberName,      setAddMemberName]       = useState('')
  const [addMemberEmail,     setAddMemberEmail]      = useState('')
  const [addMemberNote,      setAddMemberNote]       = useState('')
  const [addMemberRole,      setAddMemberRole]       = useState('membro')
  const [projectOpen,        setProjectOpen]         = useState(false)
  const [editingProjectId,   setEditingProjectId]    = useState(null)
  const [projectName,        setProjectName]         = useState('')
  const [projectTarget,      setProjectTarget]       = useState('')
  const [projectCurrent,     setProjectCurrent]      = useState('')
  const [projectOwnerId,     setProjectOwnerId]      = useState('')
  const [projectOwnerName,   setProjectOwnerName]    = useState('')
  const [projectAccount,     setProjectAccount]      = useState('')
  const [projectAccountId,   setProjectAccountId]    = useState('')
  const [projectMatchText,   setProjectMatchText]    = useState('')
  const [projectNotes,       setProjectNotes]        = useState('')
  const [memberDebtOpen,     setMemberDebtOpen]      = useState(false)
  const [memberDebtForm,     setMemberDebtForm]      = useState(defaultInternalDebtForm())
  const [externalDebtOpen,   setExternalDebtOpen]    = useState(false)
  const [externalDebtForm,   setExternalDebtForm]    = useState(defaultExternalDebtForm())
  const [settlementOpen,     setSettlementOpen]      = useState(false)
  const [settlementForm,     setSettlementForm]      = useState(defaultSettlementForm())
  const [quickSettlementDrafts, setQuickSettlementDrafts] = useState({})
  const [memberSettlementDrafts, setMemberSettlementDrafts] = useState({})
  const [activeMemberLedgerId, setActiveMemberLedgerId] = useState('')
  const [rolesExpanded,      setRolesExpanded]       = useState(false)
  const [generalLedgerExpanded, setGeneralLedgerExpanded] = useState(false)
  const [workspaceTransactions, setWorkspaceTransactions] = useState([])
  const [summaryLoading,     setSummaryLoading]      = useState(false)
  const [summaryMode,        setSummaryMode]         = useState('month')
  const [pendingInviteResume, setPendingInviteResume] = useState(null)
  const [pendingInviteLoading, setPendingInviteLoading] = useState(false)

  // ── Load consolidated workspace transactions for summary ───────────────────

  useEffect(() => {
    if (!user?.uid || !activeWorkspaceId) {
      setWorkspaceTransactions([])
      return
    }
    let cancelled = false
    setSummaryLoading(true)
    ;(async () => {
      try {
        const tx = await fetchAllTransactionsForWorkspace(user.uid, {
          workspaceId: activeWorkspaceId,
          viewerRole: workspaceRole,
          viewerUid: user.uid,
          includeRecurringAuto: true,
          includeLegacyPersonal: false,
        })
        if (!cancelled) setWorkspaceTransactions(tx)
      } catch (err) {
        console.error('[Familia] Resumo financeiro:', err.message)
        if (!cancelled) setWorkspaceTransactions([])
      } finally {
        if (!cancelled) setSummaryLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [user?.uid, activeWorkspaceId, workspaceRole])

  useEffect(() => {
    if (!user?.uid) {
      setPendingInviteResume(null)
      setPendingInviteLoading(false)
      return
    }

    const storedToken = readPendingWorkspaceInviteToken()
    if (!storedToken) {
      setPendingInviteResume(null)
      setPendingInviteLoading(false)
      return
    }

    let cancelled = false
    setPendingInviteLoading(true)

    ;(async () => {
      try {
        const invite = await getWorkspaceInviteByToken(storedToken)
        if (cancelled) return

        const isStillUseful = invite
          && !invite.expired
          && (
            invite.status === 'pending'
            || (invite.status === 'awaiting_confirmation' && invite.acceptedBy === user.uid)
          )

        if (!isStillUseful) {
          clearPendingWorkspaceInviteToken(storedToken)
          setPendingInviteResume(null)
          return
        }

        setPendingInviteResume({ token: storedToken, invite, error: '' })
      } catch (err) {
        if (cancelled) return
        setPendingInviteResume({
          token: storedToken,
          invite: null,
          error: err?.message || 'Nao foi possivel validar o convite salvo.',
        })
      } finally {
        if (!cancelled) setPendingInviteLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [user?.uid])

  // ── Derived ────────────────────────────────────────────────────────────────

  const familyWorkspace = useMemo(() => {
    if (activeWorkspace?.type === 'family') return activeWorkspace
    if (family?.id) {
      const matchingFamily = (workspaces || []).find((workspace) => workspace.id === family.id)
      if (matchingFamily) return matchingFamily
    }
    return (workspaces || []).find((workspace) => workspace.type === 'family') || null
  }, [activeWorkspace, family?.id, workspaces])

  useEffect(() => {
    if (!familyWorkspace?.id) return
    if (activeWorkspace?.id === familyWorkspace.id) return
    void changeWorkspace(familyWorkspace.id)
  }, [activeWorkspace?.id, changeWorkspace, familyWorkspace?.id])

  const familyWorkspaceReady = activeWorkspace?.type === 'family' && activeWorkspace?.id === familyWorkspace?.id
  const myMember   = members.find((m) => m.uid === user?.uid || m.id === user?.uid)
  const familyName = familyWorkspace?.name || family?.name || 'Familia'
  const familyMembers = workspaceMembers?.length > 0 ? workspaceMembers : members
  const currentMemberLabel = myMember?.displayName || user?.displayName || user?.email || 'Voce'
  const canInviteMembers = Boolean((familyWorkspaceReady && permissions?.canInvite) || (!activeWorkspace && canManage))
  const canChangeMemberRoles = Boolean(permissions?.canChangeRoles || (!activeWorkspace && canManage))
  const canRemoveMembers = Boolean(permissions?.canRemoveMember || (!activeWorkspace && canManage))
  const canManageProjects = Boolean(permissions?.canEditBudget || (!activeWorkspace && canManage))
  const canRegisterInternalDebt = Boolean(permissions?.canLaunch || (!activeWorkspace && canManage))
  const visibleInvitations = useMemo(() => {
    const modern = (workspaceInvitations || []).map((item) => ({ ...item, _source: 'workspace' }))
    const legacy = (invitations || []).map((item) => ({ ...item, _source: 'legacy-family' }))
    const merged = modern.length > 0 ? [...modern, ...legacy] : legacy
    return merged.filter((item) => item.status === 'pending' || item.status === 'awaiting_confirmation')
  }, [workspaceInvitations, invitations])
  const pendingInviteDestination = pendingInviteResume?.invite?.email || pendingInviteResume?.invite?.phone || ''
  const pendingInviteAlreadyRequested = pendingInviteResume?.invite?.status === 'awaiting_confirmation'
    && pendingInviteResume?.invite?.acceptedBy === user?.uid
  const pendingInviteCard = (pendingInviteLoading || pendingInviteResume) ? (
    <Card>
      <CardHeader
        title="Convite pendente"
        subtitle={pendingInviteLoading ? 'Verificando convite salvo...' : 'Retome o convite recebido para entrar na familia'}
      />
      {pendingInviteLoading ? (
        <p className="member-email">Estamos conferindo o convite salvo neste aparelho.</p>
      ) : (
        <>
          <p className="member-email">
            {pendingInviteAlreadyRequested
              ? 'Seu pedido de entrada ja foi enviado. Agora a familia precisa confirmar sua entrada.'
              : pendingInviteResume?.error
                ? 'Existe um convite salvo neste aparelho. Abra o link novamente para continuar.'
                : pendingInviteDestination
                  ? `Encontramos um convite salvo para ${pendingInviteDestination}.`
                  : 'Encontramos um convite salvo neste aparelho.'}
          </p>
          <div className="member-actions-row">
            {!pendingInviteAlreadyRequested && (
              <button
                type="button"
                className="member-inline-btn"
                onClick={() => window.location.assign(`/convite/${pendingInviteResume.token}`)}
              >
                Continuar convite
              </button>
            )}
            <button
              type="button"
              className="member-inline-btn member-inline-btn--ghost"
              onClick={() => {
                clearPendingWorkspaceInviteToken(pendingInviteResume?.token)
                setPendingInviteResume(null)
              }}
            >
              Dispensar
            </button>
          </div>
        </>
      )}
    </Card>
  ) : null
  const activeProjects = Array.isArray(projects) ? projects.filter((project) => project.status !== 'archived') : []
  const leadProject = activeProjects[0] || null
  const projectLabel = leadProject ? leadProject.name : 'Projetos'
  const projectHighlight = leadProject ? formatCurrency(Number(leadProject.effectiveCurrentAmount || 0)) : String(activeProjects.length)
  const selectedMonthKey = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`
  const familyInternalDebts = useMemo(
    () => (Array.isArray(debts) ? debts : []).filter((debt) => isFamilyInternalDebt(debt)),
    [debts],
  )
  const externalDebts = useMemo(
    () => (Array.isArray(debts) ? debts : []).filter((debt) => !isFamilyInternalDebt(debt)),
    [debts],
  )
  const openExternalPayableDebts = useMemo(
    () => externalDebts
      .filter((debt) => Number(debt.remainingAmount || 0) > 0 && getExternalDebtDirection(debt) !== 'contact_owes_me')
      .sort((a, b) => Number(b.remainingAmount || 0) - Number(a.remainingAmount || 0)),
    [externalDebts],
  )
  const openExternalReceivableDebts = useMemo(
    () => externalDebts
      .filter((debt) => Number(debt.remainingAmount || 0) > 0 && getExternalDebtDirection(debt) === 'contact_owes_me')
      .sort((a, b) => Number(b.remainingAmount || 0) - Number(a.remainingAmount || 0)),
    [externalDebts],
  )
  const familyDebtLedger = useMemo(
    () => buildFamilyDebtLedger(familyInternalDebts, user?.uid, familyMembers),
    [familyInternalDebts, familyMembers, user?.uid],
  )
  const memberDebtSummaryById = useMemo(
    () => new Map(familyDebtLedger.map((entry) => [entry.memberId, entry])),
    [familyDebtLedger],
  )
  const memberDebtDetailsById = useMemo(
    () => {
      const grouped = new Map()
      for (const debt of familyInternalDebts) {
        const counterpartId = counterpartMemberIdForDebt(debt, user?.uid)
        if (!counterpartId) continue
        const current = grouped.get(counterpartId) || []
        current.push(debt)
        grouped.set(counterpartId, current)
      }

      return new Map(
        [...grouped.entries()].map(([memberId, memberDebts]) => [
          memberId,
          sortDebtsByOldestFirst(memberDebts),
        ]),
      )
    },
    [familyInternalDebts, user?.uid],
  )
  const openFamilyInternalDebts = useMemo(
    () => familyDebtLedger
      .flatMap((entry) => entry.debts || [])
      .filter((debt) => Number(debt.remainingAmount || 0) > 0)
      .sort((a, b) => Number(b.remainingAmount || 0) - Number(a.remainingAmount || 0)),
    [familyDebtLedger],
  )
  const familyDebtOverview = useMemo(
    () => familyDebtLedger.reduce((acc, entry) => {
      acc.owesToMe += Number(entry.owesToMe || 0)
      acc.iOwe += Number(entry.iOwe || 0)
      acc.openDebtsCount += Number(entry.openDebtsCount || 0)
      return acc
    }, { owesToMe: 0, iOwe: 0, openDebtsCount: 0 }),
    [familyDebtLedger],
  )
  const pendingSettlementCount = useMemo(
    () => familyDebtLedger.reduce((acc, entry) => (
      acc + (entry.debts || []).reduce((debtSum, debt) => (
        debtSum + (Array.isArray(debt.settlements)
          ? debt.settlements.filter((settlement) => settlement.status === 'pending').length
          : 0)
      ), 0)
    ), 0),
    [familyDebtLedger],
  )
  const externalDebtSummary = useMemo(
    () => externalDebts.reduce((acc, debt) => {
      acc.total += Number(debt.totalAmount || 0)
      acc.paid += Number(debt.paidAmount || 0)
      const remainingAmount = Number(debt.remainingAmount || 0)
      if (getExternalDebtDirection(debt) === 'contact_owes_me') {
        acc.receivable += remainingAmount
      } else {
        acc.payable += remainingAmount
      }
      return acc
    }, { total: 0, paid: 0, payable: 0, receivable: 0 }),
    [externalDebts],
  )
  const combinedDebtTotal = Number(familyDebtOverview.iOwe || 0) + Number(externalDebtSummary.payable || 0)
  const legacyContactLedger = useMemo(
    () => (Array.isArray(debtLedger) ? debtLedger : []).filter((item) => !String(item.contactId || '').startsWith('member:')),
    [debtLedger],
  )

  const summaryTransactions = useMemo(() => {
    const source = Array.isArray(workspaceTransactions) ? workspaceTransactions : []
    if (summaryMode === 'year') {
      return source.filter((tx) => String(tx.competencyMonth || tx.recurringInstanceMonth || tx.salaryReferenceMonth || tx.date || '').startsWith(String(selectedYear)))
    }
    return source.filter((tx) => String(tx.competencyMonth || tx.recurringInstanceMonth || tx.salaryReferenceMonth || tx.date || '').startsWith(selectedMonthKey))
  }, [workspaceTransactions, summaryMode, selectedYear, selectedMonthKey])

  const summarySnapshot = useMemo(
    () => calculateMonthlySummary(summaryTransactions),
    [summaryTransactions],
  )
  const totalReceitas = Number(summarySnapshot?.receitas || 0)
  const totalDespesas = Number((summarySnapshot?.despesas || 0) + (summarySnapshot?.investimentos || 0))
  const totalSaldo = Number(summarySnapshot?.saldo || 0)
  const selectedSettlementPaymentMethod = normalizePaymentMethodId(settlementForm.paymentMethod) || 'pix'
  const settlementRequiresCard = selectedSettlementPaymentMethod === 'credit_card'
  const settlementRequiresAccount = !settlementRequiresCard && selectedSettlementPaymentMethod !== 'cash'
  const summarySubtitle = summaryLoading
    ? 'Carregando…'
    : summaryMode === 'year'
      ? `Visão anual de ${selectedYear}`
      : `Visão mensal de ${selectedMonthKey}`

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleEditFamilyOpen() {
    setEditNameValue(family?.name ?? '')
    setEditFamilyOpen(true)
  }

  async function handleEditFamilySave() {
    if (!editName_value.trim()) return
    setSaving(true)
    try {
      await editName(editName_value.trim())
      setEditFamilyOpen(false)
      showToast('Nome da família atualizado ✅')
    } catch (err) {
      showToast('Erro ao atualizar: ' + err.message, 'err')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteFamily() {
    if (deleteConfirmText.toLowerCase() !== 'excluir') return
    setSaving(true)
    try {
      await deleteFamily()
      setDeleteFamilyOpen(false)
      setDeleteConfirmText('')
      showToast('Família excluída.')
    } catch (err) {
      showToast('Erro ao excluir: ' + err.message, 'err')
    } finally {
      setSaving(false)
    }
  }

  async function handleRemoveMember() {
    if (!removeMemberTarget) return
    setSaving(true)
    try {
      await removeMember(removeMemberTarget.id ?? removeMemberTarget.uid)
      setRemoveMemberTarget(null)
      showToast(`${removeMemberTarget.displayName} removido(a) ✅`)
    } catch (err) {
      showToast('Erro ao remover: ' + err.message, 'err')
    } finally {
      setSaving(false)
    }
  }

  async function handleRoleChange(member, newRole) {
    try {
      await changeRole(member.id ?? member.uid, newRole)
      showToast(`Papel de ${member.displayName} alterado ✅`)
    } catch (err) {
      showToast('Erro ao alterar papel: ' + err.message, 'err')
    }
  }

  async function ensureFamilyWorkspaceSelected() {
    if (familyWorkspaceReady) return familyWorkspace?.id || activeWorkspaceId
    if (!familyWorkspace?.id) {
      showToast('Nenhuma familia ativa foi encontrada para este convite.', 'err')
      return ''
    }
    await changeWorkspace(familyWorkspace.id)
    return familyWorkspace.id
  }

  async function handleInviteWhatsApp(e) {
    e.preventDefault()
    const phone = invitePhone.replace(/\D/g, '')
    if (phone.length < 10) {
      showToast('Informe um numero de WhatsApp valido com DDD e codigo do pais.', 'err')
      return
    }

    const famName = familyName || 'nossa familia'
    const inviteWindow = window.open('', '_blank', 'noopener,noreferrer')
    setSaving(true)
    try {
      const workspaceId = await ensureFamilyWorkspaceSelected()
      if (!workspaceId) return
      const invite = await createInviteLink(inviteRole || 'membro', { phone, method: 'whatsapp' }, workspaceId)
      const message = 'Ola! Voce foi convidado(a) para entrar na familia "' + famName + '" no Learnendo Financas.\n\nSe ainda nao tiver conta, instale o app e crie seu cadastro. Depois, toque neste link para entrar na familia:\n' + invite.link
      const waUrl = 'https://wa.me/' + phone + '?text=' + encodeURIComponent(message)

      if (inviteWindow) {
        inviteWindow.location.href = waUrl
      } else {
        window.location.href = waUrl
      }

      setInviteOpen(false)
      setInvitePhone('')
      showToast('WhatsApp aberto com o convite.')
    } catch (err) {
      if (inviteWindow && !inviteWindow.closed) inviteWindow.close()
      showToast('Erro ao convidar: ' + err.message, 'err')
    } finally {
      setSaving(false)
    }
  }

  async function handleInviteEmail(e) {
    e.preventDefault()
    if (!inviteEmail.trim()) return
    setSaving(true)
    try {
      const workspaceId = await ensureFamilyWorkspaceSelected()
      if (!workspaceId) return
      const invite = await createInviteLink(inviteRole || 'membro', {
        email: inviteEmail.trim(),
        method: 'email',
      }, workspaceId)
      const subject = encodeURIComponent(`Convite para ${familyName}`)
      const body = encodeURIComponent(
        `Ola!\n\nVoce foi convidado(a) para entrar na familia "${familyName}" no Learnendo Financas.\n\nSe ainda nao tiver conta, instale o app e crie seu cadastro. Depois, toque neste link para entrar na familia:\n${invite.link}`,
      )
      window.open(`mailto:${inviteEmail.trim()}?subject=${subject}&body=${body}`, '_blank', 'noopener,noreferrer')
      setInviteOpen(false)
      setInviteEmail('')
      showToast('Convite preparado ✅')
    } catch (err) {
      showToast('Erro ao convidar: ' + err.message, 'err')
    } finally {
      setSaving(false)
    }
  }

  async function handleAddMember(e) {
    e.preventDefault()
    const name = addMemberName.trim()
    if (!name) {
      showToast('Informe o nome do membro.', 'err')
      return
    }

    const email = addMemberEmail.trim().toLowerCase()
    const duplicateByName = members.some((m) => (m.displayName || '').trim().toLowerCase() === name.toLowerCase())
    const duplicateByEmail = email && members.some((m) => (m.email || '').trim().toLowerCase() === email)
    if (duplicateByName || duplicateByEmail) {
      showToast('Já existe um membro com estes dados.', 'err')
      return
    }

    setSaving(true)
    try {
      await addFamilyMember({
        uid: null,
        displayName: name,
        name,
        email: email || '',
        role: addMemberRole,
        note: addMemberNote.trim() || '',
        status: 'active',
        avatarInitial: name.charAt(0).toUpperCase(),
      })
      setAddMemberOpen(false)
      setAddMemberName('')
      setAddMemberEmail('')
      setAddMemberNote('')
      setAddMemberRole('membro')
      await reload()
      showToast('Membro adicionado ✅')
    } catch (err) {
      showToast('Erro ao adicionar membro: ' + err.message, 'err')
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateFamily(e) {
    e.preventDefault()
    if (!createName.trim()) return
    setSaving(true)
    try {
      await create(createName.trim())
      setCreateFamilyOpen(false)
      setCreateName('')
      showToast('Família criada ✅')
    } catch (err) {
      showToast('Erro ao criar: ' + err.message, 'err')
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateProject(e) {
    e.preventDefault()
    if (!projectName.trim()) {
      showToast('Informe o nome do projeto.', 'err')
      return
    }

    setSaving(true)
    try {
      const payload = {
        name: projectName.trim(),
        targetAmount: projectTarget,
        currentAmount: projectCurrent,
        ownerMemberId: projectOwnerId,
        ownerMemberName: projectOwnerName.trim(),
        linkedAccountId: projectAccountId,
        linkedAccountLabel: projectAccount.trim(),
        matchText: projectMatchText.trim(),
        notes: projectNotes.trim(),
      }

      if (editingProjectId) {
        await editProject(editingProjectId, payload)
      } else {
        await addProject(payload)
      }
      setProjectOpen(false)
      setEditingProjectId(null)
      setProjectName('')
      setProjectTarget('')
      setProjectCurrent('')
      setProjectOwnerId('')
      setProjectOwnerName('')
      setProjectAccount('')
      setProjectAccountId('')
      setProjectMatchText('')
      setProjectNotes('')
      showToast(editingProjectId ? 'Projeto familiar atualizado ✅' : 'Projeto familiar criado ✅')
    } catch (err) {
      showToast('Erro ao salvar projeto: ' + err.message, 'err')
    } finally {
      setSaving(false)
    }
  }

  function handleMemberDebtModalClose() {
    setMemberDebtOpen(false)
    setMemberDebtForm(defaultInternalDebtForm())
  }

  function handleMemberDebtOpen(member = null) {
    const nextMemberId = member ? memberStableId(member) : ''
    setMemberDebtForm({
      ...defaultInternalDebtForm(),
      memberId: nextMemberId,
    })
    setMemberDebtOpen(true)
  }

  async function handleCreateMemberDebt(e) {
    e.preventDefault()
    const selectedMember = familyMembers.find((member) => memberStableId(member) === memberDebtForm.memberId)
    const totalAmount = Number(memberDebtForm.totalAmount || 0)
    const paidAmount = Number(memberDebtForm.paidAmount || 0)

    if (!selectedMember) {
      showToast('Selecione o membro relacionado.', 'err')
      return
    }
    if (!totalAmount || totalAmount <= 0) {
      showToast('Informe o valor total da pendencia.', 'err')
      return
    }
    if (paidAmount < 0 || paidAmount > totalAmount) {
      showToast('O valor ja compensado precisa ficar entre zero e o total.', 'err')
      return
    }

    const selectedMemberId = memberStableId(selectedMember)
    const selectedMemberName = selectedMember.displayName || selectedMember.name || selectedMember.email || 'Membro'
    const memberOwesMe = memberDebtForm.direction === 'member_owes_me'

    setSaving(true)
    try {
      await addDebt({
        name: memberDebtForm.title.trim() || buildInternalDebtTitle(memberDebtForm.reasonType, selectedMemberName),
        type: `familia_${memberDebtForm.reasonType}`,
        totalAmount,
        paidAmount,
        relationshipKind: 'family_member',
        reasonType: memberDebtForm.reasonType,
        reasonLabel: debtReasonLabel(memberDebtForm.reasonType),
        creditorMemberId: memberOwesMe ? user?.uid : selectedMemberId,
        creditorMemberName: memberOwesMe ? currentMemberLabel : selectedMemberName,
        debtorMemberId: memberOwesMe ? selectedMemberId : user?.uid,
        debtorMemberName: memberOwesMe ? selectedMemberName : currentMemberLabel,
        counterpartyMemberId: selectedMemberId,
        counterpartyMemberName: selectedMemberName,
        contactId: `member:${selectedMemberId}`,
        contactName: selectedMemberName,
        interestRate: memberDebtForm.reasonType === 'emprestimo' ? 1.5 : null,
        notes: memberDebtForm.notes.trim(),
      })
      handleMemberDebtModalClose()
      showToast(
        memberDebtForm.reasonType === 'emprestimo'
          ? 'Emprestimo registrado. Agora quem recebeu precisa confirmar o recebimento.'
          : 'Pendencia interna registrada ✅',
      )
    } catch (err) {
      showToast('Erro ao registrar pendencia: ' + err.message, 'err')
    } finally {
      setSaving(false)
    }
  }

  function handleSettlementModalClose() {
    setSettlementOpen(false)
    setSettlementForm(defaultSettlementForm())
  }

  function handleSettlementOpen(debt) {
    setSettlementForm({
      ...defaultSettlementForm(),
      debtId: debt?.id || '',
    })
    setSettlementOpen(true)
  }

  function updateQuickSettlementDraft(debtId, patch) {
    setQuickSettlementDrafts((current) => ({
      ...current,
      [debtId]: {
        ...defaultQuickSettlementDraft(),
        ...(current[debtId] || {}),
        ...patch,
      },
    }))
  }

  function toggleMemberSettlementDraft(memberId, debts = []) {
    setMemberSettlementDrafts((current) => {
      const existing = current[memberId] || defaultMemberSettlementDraft(debts)
      return {
        ...current,
        [memberId]: {
          ...existing,
          debtId: existing.debtId || debts[0]?.id || '',
          open: !existing.open,
        },
      }
    })
  }

  function updateMemberSettlementDraft(memberId, debts = [], patch = {}) {
    setMemberSettlementDrafts((current) => ({
      ...current,
      [memberId]: {
        ...(current[memberId] || defaultMemberSettlementDraft(debts)),
        ...patch,
      },
    }))
  }

  function validateSettlementSourceDraft(draft = {}) {
    const paymentMethod = normalizePaymentMethodId(draft.paymentMethod) || 'pix'
    if (paymentMethod === 'credit_card' && !draft.cardId) {
      throw new Error('Selecione o cartao usado neste envio.')
    }
    if (paymentMethod !== 'credit_card' && paymentMethod !== 'cash' && !draft.accountId) {
      throw new Error('Selecione a conta usada neste envio.')
    }
    return paymentMethod
  }

  async function createMemberPaymentRequests(orderedDebts = [], amount, note = '', paymentMeta = {}) {
    const activeDebts = sortDebtsByOldestFirst(
      (Array.isArray(orderedDebts) ? orderedDebts : []).filter((debt) => Number(debt.remainingAmount || 0) > 0),
    )
    const anchorDebt = activeDebts[0] || null
    let lastAllocatedDebt = anchorDebt
    let remainingToAllocate = Number(amount || 0)
    const normalizedPaymentMethod = normalizePaymentMethodId(paymentMeta.paymentMethod) || 'pix'
    const selectedCard = normalizedPaymentMethod === 'credit_card'
      ? (Array.isArray(cards) ? cards.find((card) => card.id === paymentMeta.cardId) : null)
      : null

    if (!anchorDebt?.id) {
      throw new Error('Nenhuma conta em aberto foi encontrada para este membro.')
    }

    for (const debt of activeDebts) {
      if (remainingToAllocate <= 0) break
      const currentDebtRemaining = Number(debt.remainingAmount || 0)
      if (currentDebtRemaining <= 0) continue
      const amountForDebt = Math.min(currentDebtRemaining, remainingToAllocate)
      await addSettlement(debt.id, {
        amount: amountForDebt,
        note,
        createdByName: currentMemberLabel,
        paymentMethod: normalizedPaymentMethod,
        accountId: normalizedPaymentMethod === 'credit_card' || normalizedPaymentMethod === 'cash'
          ? null
          : (paymentMeta.accountId || null),
        cardId: normalizedPaymentMethod === 'credit_card' ? (paymentMeta.cardId || null) : null,
        cardName: normalizedPaymentMethod === 'credit_card' ? (selectedCard?.name || null) : null,
      })
      lastAllocatedDebt = debt
      remainingToAllocate = Number((remainingToAllocate - amountForDebt).toFixed(2))
    }

    if (remainingToAllocate > 0) {
      await addSettlement((lastAllocatedDebt || anchorDebt).id, {
        amount: remainingToAllocate,
        note,
        createdByName: currentMemberLabel,
        paymentMethod: normalizedPaymentMethod,
        accountId: normalizedPaymentMethod === 'credit_card' || normalizedPaymentMethod === 'cash'
          ? null
          : (paymentMeta.accountId || null),
        cardId: normalizedPaymentMethod === 'credit_card' ? (paymentMeta.cardId || null) : null,
        cardName: normalizedPaymentMethod === 'credit_card' ? (selectedCard?.name || null) : null,
      })
    }

    return anchorDebt
  }

  async function handleMemberSettlementSubmit(memberId, debts = []) {
    const draft = memberSettlementDrafts[memberId] || defaultMemberSettlementDraft(debts)
    const orderedDebts = sortDebtsByOldestFirst((Array.isArray(debts) ? debts : []))
    const targetDebt = orderedDebts[0] || null
    const amount = Number(draft.amount || 0)

    if (!targetDebt?.id) {
      showToast('Nenhuma conta em aberto foi encontrada para este membro.', 'err')
      return
    }
    if (targetDebt.debtorMemberId !== user?.uid) {
      showToast('Somente quem deve pode marcar um envio.', 'err')
      return
    }
    if (!amount || amount <= 0) {
      showToast('Informe o novo valor enviado.', 'err')
      return
    }
    try {
      validateSettlementSourceDraft(draft)
    } catch (err) {
      showToast(err.message, 'err')
      return
    }

    setSaving(true)
    try {
      const anchorDebt = await createMemberPaymentRequests(orderedDebts, amount, String(draft.notes || '').trim(), draft)
      setMemberSettlementDrafts((current) => ({
        ...current,
        [memberId]: {
          ...(current[memberId] || defaultMemberSettlementDraft(debts)),
          open: false,
          debtId: anchorDebt.id,
          amount: '',
          notes: '',
          paymentMethod: draft.paymentMethod || 'pix',
          accountId: draft.accountId || '',
          cardId: draft.cardId || '',
        },
      }))
      showToast('Envio registrado. Ele vai abater primeiro as contas mais antigas, depois o outro membro confirma o recebimento.')
    } catch (err) {
      showToast('Erro ao registrar envio: ' + err.message, 'err')
    } finally {
      setSaving(false)
    }
  }

  async function handleQuickSettlementSubmit(debt) {
    if (!debt?.id) return
    const draft = quickSettlementDrafts[debt.id] || defaultQuickSettlementDraft()
    const amount = Number(draft.amount || 0)
    const relatedDebts = sortDebtsByOldestFirst(
      familyInternalDebts.filter((item) => (
        item.debtorMemberId === debt.debtorMemberId
        && item.creditorMemberId === debt.creditorMemberId
        && item.status !== 'pending_confirmation'
      )),
    )

    if (debt.debtorMemberId !== user?.uid) {
      showToast('Somente quem deve pode marcar um envio.', 'err')
      return
    }
    if (!amount || amount <= 0) {
      showToast('Informe o valor enviado.', 'err')
      return
    }
    try {
      validateSettlementSourceDraft(draft)
    } catch (err) {
      showToast(err.message, 'err')
      return
    }

    setSaving(true)
    try {
      await createMemberPaymentRequests(relatedDebts, amount, String(draft.notes || '').trim(), draft)
      setQuickSettlementDrafts((current) => ({
        ...current,
        [debt.id]: {
          ...defaultQuickSettlementDraft(),
          paymentMethod: draft.paymentMethod || 'pix',
          accountId: draft.accountId || '',
          cardId: draft.cardId || '',
        },
      }))
      showToast('Envio registrado. Agora falta a confirmacao do recebedor.')
    } catch (err) {
      showToast('Erro ao registrar envio: ' + err.message, 'err')
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateSettlement(e) {
    e.preventDefault()

    const debt = familyInternalDebts.find((item) => item.id === settlementForm.debtId)
    const amount = Number(settlementForm.amount || 0)
    const relatedDebts = sortDebtsByOldestFirst(
      familyInternalDebts.filter((item) => (
        item.debtorMemberId === debt?.debtorMemberId
        && item.creditorMemberId === debt?.creditorMemberId
        && item.status !== 'pending_confirmation'
      )),
    )

    if (!debt) {
      showToast('Selecione uma pendencia valida.', 'err')
      return
    }
    if (debt.debtorMemberId !== user?.uid) {
      showToast('Somente quem deve pode informar uma restituição.', 'err')
      return
    }
    if (!amount || amount <= 0) {
      showToast('Informe o valor enviado.', 'err')
      return
    }
    try {
      validateSettlementSourceDraft(settlementForm)
    } catch (err) {
      showToast(err.message, 'err')
      return
    }
    setSaving(true)
    try {
      await createMemberPaymentRequests(relatedDebts, amount, settlementForm.notes.trim(), settlementForm)
      handleSettlementModalClose()
      showToast('Restituicao registrada. Agora falta a confirmacao do recebedor. ✅')
    } catch (err) {
      showToast('Erro ao registrar restituição: ' + err.message, 'err')
    } finally {
      setSaving(false)
    }
  }

  async function handleConfirmDebtSettlement(debt, settlement) {
    if (!debt?.id || !settlement?.id) return
    setSaving(true)
    try {
      await confirmSettlement(debt.id, settlement.id)
      showToast('Recebimento confirmado. Se passou do valor devido, o saldo virou credito automaticamente. ✅')
    } catch (err) {
      showToast('Erro ao confirmar recebimento: ' + err.message, 'err')
    } finally {
      setSaving(false)
    }
  }

  async function handleConfirmDebtReceipt(debt) {
    if (!debt?.id) return
    setSaving(true)
    try {
      await confirmReceipt(debt.id)
      showToast('Emprestimo confirmado. Agora ele entrou no saldo e comeca a contar juros.')
    } catch (err) {
      showToast('Erro ao confirmar recebimento do emprestimo: ' + err.message, 'err')
    } finally {
      setSaving(false)
    }
  }

  async function handleCancelDebtSettlement(debt, settlement) {
    if (!debt?.id || !settlement?.id) return
    setSaving(true)
    try {
      await cancelSettlement(debt.id, settlement.id)
      showToast('Restituicao pendente cancelada.')
    } catch (err) {
      showToast('Erro ao cancelar restituição: ' + err.message, 'err')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteDebt(debt) {
    if (!debt?.id) return
    const confirmDelete = window.confirm(`Excluir a pendencia "${debt.name}"?`)
    if (!confirmDelete) return

    setSaving(true)
    try {
      await removeDebt(debt.id)
      showToast('Pendencia excluida com sucesso.')
    } catch (err) {
      showToast('Erro ao excluir pendencia: ' + err.message, 'err')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteDebtSettlement(debt, settlement) {
    if (!debt?.id || !settlement?.id) return
    const confirmDelete = window.confirm(`Excluir o registro de ${formatCurrency(settlement.amount)}?`)
    if (!confirmDelete) return

    setSaving(true)
    try {
      await removeSettlement(debt.id, settlement.id)
      showToast('Registro removido com sucesso.')
    } catch (err) {
      showToast('Erro ao excluir registro: ' + err.message, 'err')
    } finally {
      setSaving(false)
    }
  }

  function handleExternalDebtModalClose() {
    setExternalDebtOpen(false)
    setExternalDebtForm(defaultExternalDebtForm())
  }

  async function handleCreateExternalDebt(e) {
    e.preventDefault()

    const normalizedName = externalDebtForm.name.trim()
    const totalAmount = Number(externalDebtForm.totalAmount || 0)
    const paidAmount = Number(externalDebtForm.paidAmount || 0)
    const monthlyAmount = Number(externalDebtForm.monthlyAmount || 0)

    if (!normalizedName) {
      showToast('Informe a pessoa ou instituicao.', 'err')
      return
    }
    if (!totalAmount || totalAmount <= 0) {
      showToast('Informe o valor total da pendencia.', 'err')
      return
    }
    if (paidAmount < 0 || paidAmount > totalAmount) {
      showToast('O valor ja compensado precisa ficar entre zero e o total.', 'err')
      return
    }

    setSaving(true)
    try {
      const existingContact = (Array.isArray(contacts) ? contacts : []).find(
        (contact) => String(contact?.name || '').trim().toLowerCase() === normalizedName.toLowerCase(),
      )
      const linkedContact = existingContact || await addExternalContact(normalizedName)

      await addDebt({
        name: normalizedName,
        type: externalDebtForm.type,
        relationshipKind: 'external_contact',
        contactId: linkedContact?.id || null,
        contactName: linkedContact?.name || normalizedName,
        externalDirection: externalDebtForm.direction,
        totalAmount,
        paidAmount,
        notes: externalDebtForm.notes.trim(),
        installmentPlan: monthlyAmount > 0
          ? { monthlyAmount, kind: 'manual_plan' }
          : null,
      })
      handleExternalDebtModalClose()
      showToast('Pendencia externa registrada. ✅')
    } catch (err) {
      showToast('Erro ao registrar pendencia externa: ' + err.message, 'err')
    } finally {
      setSaving(false)
    }
  }

  function handleProjectModalClose() {
    setProjectOpen(false)
    setEditingProjectId(null)
    setProjectName('')
    setProjectTarget('')
    setProjectCurrent('')
    setProjectOwnerId('')
    setProjectOwnerName('')
    setProjectAccount('')
    setProjectAccountId('')
    setProjectMatchText('')
    setProjectNotes('')
  }

  function handleProjectEditOpen(project) {
    setEditingProjectId(project.id)
    setProjectName(project.name || '')
    setProjectTarget(String(project.targetAmount || ''))
    setProjectCurrent(String(project.currentAmount || ''))
    setProjectOwnerId(project.ownerMemberId || '')
    setProjectOwnerName(project.ownerMemberName || '')
    setProjectAccount(project.linkedAccountLabel || '')
    setProjectAccountId(project.linkedAccountId || '')
    setProjectMatchText(project.matchText || '')
    setProjectNotes(project.notes || '')
    setProjectOpen(true)
  }

  function handleProjectCreateOpen() {
    handleProjectModalClose()
    setProjectOpen(true)
  }

  async function handleShareApp() {
    const appUrl = `${window.location.origin}/cadastro`
    const shareData = {
      title: 'Learnendo Financas',
      text:  'Use o Learnendo Financas para organizar sua propria vida financeira ou criar a sua familia dentro do app.',
      url:   appUrl,
    }
    if (navigator.share) {
      try {
        await navigator.share(shareData)
      } catch (_) { /* user cancelled */ }
    } else {
      try {
        await navigator.clipboard.writeText(appUrl)
        showToast('Link do app copiado.')
      } catch (_) {
        showToast('Link: ' + appUrl)
      }
    }
  }

  async function handleApproveInvite(invite) {
    if (!invite?.id || invite._source === 'legacy-family') return
    setSaving(true)
    try {
      await approveInvite(invite.id)
      await reload()
      showToast('Entrada na familia confirmada.')
    } catch (err) {
      showToast('Erro ao confirmar convite: ' + err.message, 'err')
    } finally {
      setSaving(false)
    }
  }

  async function handleCancelInvite(invite) {
    if (!invite?.id) return
    setSaving(true)
    try {
      if (invite._source === 'legacy-family') {
        await cancelLegacyInvite(invite.id)
      } else {
        await cancelWorkspaceInvite(invite.id)
      }
      await reload()
      showToast('Convite cancelado ✅')
    } catch (err) {
      showToast('Erro ao cancelar convite: ' + err.message, 'err')
    } finally {
      setSaving(false)
    }
  }

  // ── Loading / error / no-family states ───────────────────────────────────

  // Renderização condicional robusta
  if (loading) {
    return (
      <div className="familia-page">
        <div className="familia-loading">
          <div className="familia-spinner" />
          <p>Carregando família…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="familia-page">
        <div className="familia-error-box">
          <strong>Erro ao carregar dados da família</strong>
          <p>{error}</p>
        </div>
      </div>
    )
  }

  // Só renderiza dados se family válido
  if (!family && !activeWorkspace) {
    return (
      <div className="familia-page">
        {pendingInviteCard}
        <div className="familia-empty">
          <span className="familia-empty-icon">🏡</span>
          <p className="familia-empty-title">Você ainda não tem uma família</p>
          <p className="familia-empty-sub">Crie um grupo familiar para compartilhar dados financeiros com sua família.</p>
          <button className="btn-invite" onClick={() => setCreateFamilyOpen(true)}>
            Criar família
          </button>
        </div>

        {createFamilyOpen && (
          <div className="modal-overlay" onClick={() => setCreateFamilyOpen(false)}>
            <div className="modal-box" onClick={(e) => e.stopPropagation()}>
              <h3 className="modal-title">Criar família</h3>
              <form onSubmit={handleCreateFamily} className="invite-form">
                <div className="form-group">
                  <label>Nome da família</label>
                  <input
                    type="text"
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    placeholder="Ex: Família Silva"
                    required
                    autoFocus
                    maxLength={60}
                  />
                </div>
                <div className="invite-form-actions">
                  <button type="button" className="btn-cancel" onClick={() => setCreateFamilyOpen(false)}>
                    Cancelar
                  </button>
                  <button type="submit" className="btn-send" disabled={saving}>
                    {saving ? 'Criando…' : 'Criar'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {toast && <div className={`familia-toast ${toast.type === 'err' ? 'toast-err' : ''}`}>{toast.msg}</div>}
      </div>
    )
  }

  // ── Main render ───────────────────────────────────────────────────────────

  return (
    <div className="familia-page">
      {pendingInviteCard}

      {/* Cabeçalho */}
      <div className="familia-header">
        <div className="familia-icon">🏡</div>
        <div className="familia-header-info">
          <h1 className="familia-name">{familyName}</h1>
          <span className="familia-plan">Plano Familiar · {membersLabel(familyMembers.length)}</span>
        </div>
        {canChangeMemberRoles && (
          <div className="familia-header-actions">
            <button
              className="fh-btn"
              title="Editar nome da família"
              onClick={handleEditFamilyOpen}
            >
              ✏️
            </button>
            <button
              className="fh-btn fh-btn--danger"
              title="Excluir família"
              onClick={() => { setDeleteConfirmText(''); setDeleteFamilyOpen(true) }}
            >
              🗑️
            </button>
          </div>
        )}
      </div>

      {/* Resumo financeiro */}
      <Card>
        <CardHeader
          title="Resumo consolidado"
          subtitle={summarySubtitle}
        />
        <div className="familia-summary-toolbar">
          <button
            type="button"
            className={`familia-summary-toggle${summaryMode === 'month' ? ' active' : ''}`}
            onClick={() => setSummaryMode('month')}
          >
            Mensal
          </button>
          <button
            type="button"
            className={`familia-summary-toggle${summaryMode === 'year' ? ' active' : ''}`}
            onClick={() => setSummaryMode('year')}
          >
            Anual
          </button>
        </div>
        <div className="familia-summary-grid">
          <div className="familia-stat">
            <span className="familia-stat-label">Receitas</span>
            <span className="familia-stat-value green">
              {summaryLoading ? '…' : formatCurrency(totalReceitas)}
            </span>
          </div>
          <div className="familia-stat">
            <span className="familia-stat-label">Despesas</span>
            <span className="familia-stat-value red">
              {summaryLoading ? '…' : formatCurrency(totalDespesas)}
            </span>
          </div>
          <div className="familia-stat">
            <span className="familia-stat-label">Saldo líquido</span>
            <span className={`familia-stat-value ${totalSaldo >= 0 ? 'green' : 'red'}`}>
              {summaryLoading ? '…' : formatCurrency(totalSaldo)}
            </span>
          </div>
          <div className="familia-stat">
            <span className="familia-stat-label">{projectLabel}</span>
            <span className="familia-stat-value blue">{projectHighlight}</span>
          </div>
        </div>
      </Card>

      <Card>
        <div className="familia-members-header">
          <CardHeader
            title="Projetos familiares"
            subtitle={leadProject ? 'Caixinhas e objetivos compartilhados da familia' : 'Crie a primeira caixinha da familia'}
          />
          {canManageProjects && (
            <div className="members-header-btns">
              <button className="btn-add-member" onClick={handleProjectCreateOpen}>
                + Projeto
              </button>
            </div>
          )}
        </div>

        {activeProjects.length === 0 ? (
          <div className="familia-empty" style={{ marginTop: '0.5rem' }}>
            <p className="familia-empty-title">Nenhum projeto criado ainda</p>
            <p className="familia-empty-sub">Use projetos para acompanhar viagem, reserva, reforma ou outra caixinha da familia.</p>
            {canManageProjects && (
              <button className="btn-add-member" onClick={handleProjectCreateOpen}>
                + Criar primeiro projeto
              </button>
            )}
          </div>
        ) : (
          <ul className="projects-list">
            {activeProjects.map((project) => {
              const targetAmount = Number(project.targetAmount || 0)
              const currentAmount = Number(project.effectiveCurrentAmount || project.currentAmount || 0)
              const progress = targetAmount > 0
                ? Math.max(0, Math.min(100, Number(project.progress || (currentAmount / targetAmount) * 100)))
                : 0

              return (
                <li key={project.id} className="project-item">
                  <div className="project-main">
                    <div className="project-head">
                      <strong>{project.name}</strong>
                      <div className="project-head-actions">
                        <span className="project-kind">{project.kind === 'caixinha' ? 'Caixinha' : project.kind}</span>
                        {canManageProjects && (
                          <button className="project-edit-btn" onClick={() => handleProjectEditOpen(project)}>
                            Editar
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="project-values">
                      <span>{formatCurrency(currentAmount)}</span>
                      <span className="project-target">meta {formatCurrency(targetAmount)}</span>
                    </div>
                    <div className="project-progress-track">
                      <span className="project-progress-fill" style={{ width: `${progress}%` }} />
                    </div>
                    <div className="project-meta">
                      <span>{progress.toFixed(0)}% concluido</span>
                      {project.ownerMemberName && <span>Responsavel: {project.ownerMemberName}</span>}
                      {project.linkedAccountLabel && <span>Conta: {project.linkedAccountLabel}</span>}
                      {project.matchText && <span>Filtro: {project.matchText}</span>}
                      {project.isAutoTracked && <span>Auto: {project.trackedTransactionsCount} lancamentos</span>}
                    </div>
                    {project.isAutoTracked && (
                      <div className="project-meta">
                        <span>Base manual: {formatCurrency(Number(project.currentAmount || 0))}</span>
                        <span>Movimento automatico: {formatCurrency(Number(project.trackedAmount || 0))}</span>
                      </div>
                    )}
                    {project.notes && <p className="project-notes">{project.notes}</p>}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {/* Membros */}
      <Card>
        <div className="familia-members-header">
          <CardHeader title="Membros" subtitle={membersLabel(familyMembers.length)} />
          {canInviteMembers && (
            <div className="members-header-btns">
              <button className="btn-add-member" onClick={() => setAddMemberOpen(true)}>
                + Adicionar
              </button>
              <button className="btn-invite" onClick={() => setInviteOpen(true)}>
                + Convidar
              </button>
            </div>
          )}
        </div>

        {familyMembers.length === 0 ? (
          <div className="familia-empty" style={{ marginTop: '0.5rem' }}>
            <p className="familia-empty-title">Nenhum membro cadastrado</p>
            <p className="familia-empty-sub">Adicione pessoas da casa para começar o acompanhamento familiar.</p>
            {canInviteMembers && (
              <button className="btn-add-member" onClick={() => setAddMemberOpen(true)}>
                + Adicionar primeiro membro
              </button>
            )}
          </div>
        ) : (
        <ul className="members-list">
          {familyMembers.map((m) => {
            const roleMeta  = ROLE_META[m.role] ?? { label: m.role, cls: '', icon: '👤' }
            const memberId = memberStableId(m)
            const isMe      = m.uid === user?.uid || m.id === user?.uid
            const isGestor  = m.role === 'gestor'
            const memberPermissions = getPermissionsByRole(m.role, m.status)
            const canEdit = !memberPermissions.readOnly
            const canEditRoleTarget = canChangeMemberRoles && !isMe
            const memberDebtSummary = memberDebtSummaryById.get(memberId)
            const memberDebts = memberDebtDetailsById.get(memberId) || []
            const debtorMemberDebts = sortDebtsByOldestFirst(
              memberDebts.filter((debt) => debt.debtorMemberId === user?.uid && Number(debt.remainingAmount || 0) > 0),
            )
            const pendingIncomingSettlementAmount = memberDebts.reduce((sum, debt) => {
              if (debt.creditorMemberId !== user?.uid) return sum
              const pendingTotal = Array.isArray(debt.settlements)
                ? debt.settlements
                  .filter((settlement) => settlement.status === 'pending')
                  .reduce((acc, settlement) => acc + Number(settlement.amount || 0), 0)
                : 0
              return sum + pendingTotal
            }, 0)
            const pendingLoanReceipts = memberDebts.filter((debt) => (
              debt.status === 'pending_confirmation'
              && debt.debtorMemberId === user?.uid
            ))
            const pendingLoanReceiptAmount = pendingLoanReceipts.reduce(
              (sum, debt) => sum + Number(debt.originalAmount || debt.totalAmount || 0),
              0,
            )
            const hasMemberDebtPanel = !isMe && (memberDebts.length > 0 || canRegisterInternalDebt)
            const isLedgerOpen = activeMemberLedgerId === memberId
            const memberNetBalance = Number(memberDebtSummary?.netBalance || 0)
            const memberNetTone = memberNetBalance > 0 ? 'green' : (memberNetBalance < 0 ? 'red' : 'neutral')
            const memberSettlementDraft = memberSettlementDrafts[memberId] || defaultMemberSettlementDraft(debtorMemberDebts)
            const selectedMemberSettlementDebt = debtorMemberDebts[0] || null
            return (
              <li key={memberId} className="member-item">
                <div className="member-avatar" data-role={m.role}>
                  {m.avatarInitial ?? (m.displayName?.[0] ?? '?')}
                </div>
                <div className="member-info">
                  <span className="member-name">
                    {m.displayName}
                    {isMe && <span className="member-you">você</span>}
                    {memberInviteStatusLabel(m.status) && <span className="member-status-pending">{memberInviteStatusLabel(m.status)}</span>}
                  </span>
                  <span className="member-email">{m.email}</span>
                  {m.note && <span className="member-email">Obs: {m.note}</span>}
                  <div className="member-meta">
                    {canEditRoleTarget ? (
                      <select
                        className="role-select"
                        value={m.role}
                        onChange={(e) => handleRoleChange(m, e.target.value)}
                      >
                        {MANAGEABLE_ROLES.map((r) => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </select>
                    ) : (
                      <span className={`role-badge ${roleMeta.cls}`}>
                        {roleMeta.icon} {roleMeta.label}
                      </span>
                    )}
                    <span className="member-perm">
                      {canEdit ? '✏️ Pode editar' : '👁️ Só visualiza'}
                    </span>
                  </div>
                  {!isMe && hasMemberDebtPanel && (
                    <div className="member-ledger-row">
                      <span className={`member-ledger-chip member-ledger-chip--${memberNetTone}`}>
                        {memberNetBalance > 0 && `A receber ${formatCurrency(memberNetBalance)}`}
                        {memberNetBalance < 0 && formatCurrency(Math.abs(memberNetBalance))}
                        {memberNetBalance === 0 && 'Saldo zerado'}
                      </span>
                      {memberNetBalance < 0 && debtorMemberDebts.length > 0 && (
                        <button
                          type="button"
                          className="member-inline-btn"
                          disabled={saving}
                          onClick={() => toggleMemberSettlementDraft(memberId, debtorMemberDebts)}
                        >
                          {memberSettlementDraft.open ? 'Fechar alteracao' : 'Alterar valor'}
                        </button>
                      )}
                      {pendingIncomingSettlementAmount > 0 && (
                        <span className="member-ledger-chip member-ledger-chip--blue">
                          Voce recebeu {formatCurrency(pendingIncomingSettlementAmount)} para confirmar
                        </span>
                      )}
                      {pendingLoanReceiptAmount > 0 && (
                        <span className="member-ledger-chip member-ledger-chip--blue">
                          Confirmar recebimento do emprestimo {formatCurrency(pendingLoanReceiptAmount)}
                        </span>
                      )}
                    </div>
                  )}
                  {!isMe && memberNetBalance < 0 && debtorMemberDebts.length > 0 && memberSettlementDraft.open && (
                    <div className="member-ledger-adjust">
                      <div className="member-ledger-adjust-title">
                        <strong>Registrar valor enviado</strong>
                        <span>O saldo vermelho so muda depois que o outro membro confirmar o recebimento.</span>
                      </div>
                      {selectedMemberSettlementDebt && (
                        <div className="member-ledger-adjust-summary">
                          Vai abater primeiro: {memberSettlementDebtLabel(selectedMemberSettlementDebt)}
                        </div>
                      )}
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        value={memberSettlementDraft.amount}
                        onChange={(e) => updateMemberSettlementDraft(memberId, debtorMemberDebts, { amount: e.target.value })}
                        placeholder="Novo valor enviado"
                      />
                      <input
                        type="text"
                        value={memberSettlementDraft.notes}
                        onChange={(e) => updateMemberSettlementDraft(memberId, debtorMemberDebts, { notes: e.target.value })}
                        placeholder="Observacao opcional"
                      />
                      <select
                        value={memberSettlementDraft.paymentMethod}
                        onChange={(e) => updateMemberSettlementDraft(memberId, debtorMemberDebts, {
                          paymentMethod: e.target.value,
                          accountId: normalizePaymentMethodId(e.target.value) === 'credit_card' ? '' : memberSettlementDraft.accountId,
                          cardId: normalizePaymentMethodId(e.target.value) === 'credit_card' ? memberSettlementDraft.cardId : '',
                        })}
                      >
                        {TRANSACTION_PAYMENT_METHODS.map((method) => (
                          <option key={method.id} value={method.id}>{method.label}</option>
                        ))}
                      </select>
                      {normalizePaymentMethodId(memberSettlementDraft.paymentMethod) === 'credit_card' ? (
                        <select
                          value={memberSettlementDraft.cardId}
                          onChange={(e) => updateMemberSettlementDraft(memberId, debtorMemberDebts, { cardId: e.target.value })}
                        >
                          <option value="">Selecione o cartao</option>
                          {cards.map((card) => (
                            <option key={card.id} value={card.id}>{cardOptionLabel(card)}</option>
                          ))}
                        </select>
                      ) : normalizePaymentMethodId(memberSettlementDraft.paymentMethod) !== 'cash' ? (
                        <select
                          value={memberSettlementDraft.accountId}
                          onChange={(e) => updateMemberSettlementDraft(memberId, debtorMemberDebts, { accountId: e.target.value })}
                        >
                          <option value="">Selecione a conta</option>
                          {accounts.map((account) => (
                            <option key={account.id} value={account.id}>{accountOptionLabel(account)}</option>
                          ))}
                        </select>
                      ) : null}
                      <button
                        type="button"
                        className="member-inline-btn"
                        disabled={saving}
                        onClick={() => handleMemberSettlementSubmit(memberId, debtorMemberDebts)}
                      >
                        Enviar para confirmar
                      </button>
                      <span className="member-ledger-adjust-hint">
                        O outro membro confirma o recebimento e o saldo vermelho baixa automaticamente.
                      </span>
                    </div>
                  )}
                  {hasMemberDebtPanel && (
                    <div className="member-actions-row">
                      <button
                        type="button"
                        className="member-inline-btn"
                        onClick={() => handleMemberDebtOpen(m)}
                      >
                        {memberDebts.length > 0 ? 'Ajustar saldo' : 'Registrar saldo'}
                      </button>
                      <button
                        type="button"
                        className="member-inline-btn member-inline-btn--ghost"
                        onClick={() => setActiveMemberLedgerId((current) => (current === memberId ? '' : memberId))}
                      >
                        {isLedgerOpen ? 'Fechar conta' : 'Abrir conta'}
                      </button>
                    </div>
                  )}
                  {hasMemberDebtPanel && isLedgerOpen && (
                    <div className="member-debt-panel">
                      {memberDebts.length === 0 ? (
                        <div className="member-debt-empty">
                          <strong>Nenhum saldo aberto com {m.displayName}.</strong>
                          <p>Use "Registrar saldo" quando surgir um emprestimo, troca ou compra no cartao da familia.</p>
                        </div>
                      ) : (
                        <>
                          <div className="member-debt-summary">
                            <span className="member-debt-summary-item">
                              Em aberto: <strong>{formatCurrency((memberDebtSummary?.owesToMe || 0) + (memberDebtSummary?.iOwe || 0))}</strong>
                            </span>
                            {memberDebtSummary?.owesToMe > 0 && (
                              <span className="member-debt-summary-item">Ele te deve {formatCurrency(memberDebtSummary.owesToMe)}</span>
                            )}
                            {memberDebtSummary?.iOwe > 0 && (
                              <span className="member-debt-summary-item">Voce deve {formatCurrency(memberDebtSummary.iOwe)}</span>
                            )}
                          </div>
                          <div className="member-debt-list">
                            {memberDebts.map((debt) => {
                              const isPendingReceiptConfirmation = debt.status === 'pending_confirmation'
                              const remainingAmount = Number(debt.remainingAmount || 0)
                              const paidAmount = Number(debt.paidAmount || 0)
                              const totalAmount = Number(debt.totalAmount || 0)
                              const originalAmount = Number(debt.originalAmount || debt.totalAmount || 0)
                              const accruedInterestAmount = Number(debt.accruedInterestAmount || 0)
                              const debtPayments = paymentsByDebtId[debt.id] || []
                              const totalConfirmedAmount = debtPayments.reduce(
                                (sum, payment) => sum + Number(payment.amount || 0),
                                0,
                              )
                              const settlements = Array.isArray(debt.settlements) ? debt.settlements : []
                              const isDebtor = debt.debtorMemberId === user?.uid
                              const isCreditor = debt.creditorMemberId === user?.uid
                              const counterpartName = m.displayName || debt.counterpartyMemberName || 'Membro'
                              const relationLabel = isPendingReceiptConfirmation
                                ? `Aguardando sua confirmacao de recebimento de ${counterpartName}`
                                : isCreditor
                                ? `${counterpartName} te deve`
                                : `Voce deve para ${counterpartName}`
                              const debtStatusLabel = isPendingReceiptConfirmation
                                ? 'Aguardando confirmacao'
                                : (remainingAmount > 0 ? 'Em aberto' : 'Quitado')

                              return (
                                <div key={debt.id} className="member-debt-entry">
                                  <div className="member-debt-entry-top">
                                    <div>
                                      <strong>{debt.name}</strong>
                                      <p>{relationLabel}</p>
                                    </div>
                                    <span className={`member-debt-balance ${isCreditor ? 'green' : 'red'}`}>
                                      {formatCurrency(isPendingReceiptConfirmation ? originalAmount : remainingAmount)}
                                    </span>
                                  </div>
                                  <div className="family-debt-meta">
                                    <span>{debt.reasonLabel || debtReasonLabel(debt.reasonType)}</span>
                                    <span>Valor original {formatCurrency(originalAmount)}</span>
                                    <span>Status {debtStatusLabel}</span>
                                    {debt.loanConfirmedAt && <span>Confirmado em {formatDateBR(debt.loanConfirmedAt)}</span>}
                                    {!isPendingReceiptConfirmation && !!debt.interestRate && <span>Juros {String(debt.interestRate).replace('.', ',')}% a.m.</span>}
                                    {!isPendingReceiptConfirmation && <span>Saldo total restante {formatCurrency(remainingAmount)}</span>}
                                    {!isPendingReceiptConfirmation && accruedInterestAmount > 0 && <span>Juros em aberto {formatCurrency(accruedInterestAmount)}</span>}
                                    {!isPendingReceiptConfirmation && <span>Principal abatido {formatCurrency(paidAmount)}</span>}
                                    {!isPendingReceiptConfirmation && totalConfirmedAmount > 0 && <span>Total confirmado {formatCurrency(totalConfirmedAmount)}</span>}
                                    {!isPendingReceiptConfirmation && <span>{debtPayments.length} confirmacao(oes)</span>}
                                  </div>
                                  {debt.notes && <p className="family-debt-notes">{debt.notes}</p>}
                                  <div className="member-debt-entry-actions">
                                    {isPendingReceiptConfirmation && isDebtor && (
                                      <button
                                        type="button"
                                        className="member-inline-btn"
                                        disabled={saving}
                                        onClick={() => handleConfirmDebtReceipt(debt)}
                                      >
                                        Confirmar recebimento do emprestimo
                                      </button>
                                    )}
                                    {!isPendingReceiptConfirmation && isDebtor && remainingAmount > 0 && (
                                      <button
                                        type="button"
                                        className="member-inline-btn"
                                        onClick={() => handleSettlementOpen(debt)}
                                      >
                                        Registrar envio
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      className="member-inline-btn member-inline-btn--ghost"
                                      disabled={saving}
                                      onClick={() => handleDeleteDebt(debt)}
                                    >
                                      Excluir conta
                                    </button>
                                  </div>
                                  {!isPendingReceiptConfirmation && isDebtor && remainingAmount > 0 && (
                                    <div className="member-quick-settlement">
                                      <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        inputMode="decimal"
                                        value={quickSettlementDrafts[debt.id]?.amount || ''}
                                        onChange={(e) => updateQuickSettlementDraft(debt.id, { amount: e.target.value })}
                                        placeholder="Valor enviado"
                                      />
                                      <input
                                        type="text"
                                        value={quickSettlementDrafts[debt.id]?.notes || ''}
                                        onChange={(e) => updateQuickSettlementDraft(debt.id, { notes: e.target.value })}
                                        placeholder="Observacao opcional"
                                      />
                                      <select
                                        value={quickSettlementDrafts[debt.id]?.paymentMethod || 'pix'}
                                        onChange={(e) => updateQuickSettlementDraft(debt.id, {
                                          paymentMethod: e.target.value,
                                          accountId: normalizePaymentMethodId(e.target.value) === 'credit_card'
                                            ? ''
                                            : (quickSettlementDrafts[debt.id]?.accountId || ''),
                                          cardId: normalizePaymentMethodId(e.target.value) === 'credit_card'
                                            ? (quickSettlementDrafts[debt.id]?.cardId || '')
                                            : '',
                                        })}
                                      >
                                        {TRANSACTION_PAYMENT_METHODS.map((method) => (
                                          <option key={method.id} value={method.id}>{method.label}</option>
                                        ))}
                                      </select>
                                      {normalizePaymentMethodId(quickSettlementDrafts[debt.id]?.paymentMethod || 'pix') === 'credit_card' ? (
                                        <select
                                          value={quickSettlementDrafts[debt.id]?.cardId || ''}
                                          onChange={(e) => updateQuickSettlementDraft(debt.id, { cardId: e.target.value })}
                                        >
                                          <option value="">Selecione o cartao</option>
                                          {cards.map((card) => (
                                            <option key={card.id} value={card.id}>{cardOptionLabel(card)}</option>
                                          ))}
                                        </select>
                                      ) : normalizePaymentMethodId(quickSettlementDrafts[debt.id]?.paymentMethod || 'pix') !== 'cash' ? (
                                        <select
                                          value={quickSettlementDrafts[debt.id]?.accountId || ''}
                                          onChange={(e) => updateQuickSettlementDraft(debt.id, { accountId: e.target.value })}
                                        >
                                          <option value="">Selecione a conta</option>
                                          {accounts.map((account) => (
                                            <option key={account.id} value={account.id}>{accountOptionLabel(account)}</option>
                                          ))}
                                        </select>
                                      ) : null}
                                      <button
                                        type="button"
                                        className="member-inline-btn"
                                        disabled={saving}
                                        onClick={() => handleQuickSettlementSubmit(debt)}
                                      >
                                        Marcar como enviado
                                      </button>
                                    </div>
                                  )}
                                  {!isPendingReceiptConfirmation && settlements.length > 0 ? (
                                    <ul className="member-settlement-list">
                                      {settlements.map((settlement) => {
                                        const canConfirmPending = isCreditor && settlement.status === 'pending'
                                        const canCancelPending = isDebtor && settlement.status === 'pending' && settlement.createdByUid === user?.uid
                                        return (
                                          <li key={settlement.id} className="member-settlement-item">
                                            <div className="member-settlement-copy">
                                              <strong>{formatCurrency(settlement.amount)}</strong>
                                              <span>
                                                {debtSettlementStatusLabel(settlement.status)} · {formatDateBR(settlement.confirmedAt || settlement.createdAt)}
                                              </span>
                                              {settlement.note && <p>{settlement.note}</p>}
                                            </div>
                                            <div className="member-settlement-actions">
                                              {canConfirmPending && (
                                                <button
                                                  type="button"
                                                  className="member-inline-btn"
                                                  disabled={saving}
                                                  onClick={() => handleConfirmDebtSettlement(debt, settlement)}
                                                >
                                                  Confirmar recebido
                                                </button>
                                              )}
                                              {canCancelPending && (
                                                <button
                                                  type="button"
                                                  className="member-inline-btn member-inline-btn--ghost"
                                                  disabled={saving}
                                                  onClick={() => handleCancelDebtSettlement(debt, settlement)}
                                                >
                                                  Cancelar
                                                </button>
                                              )}
                                              <button
                                                type="button"
                                                className="member-inline-btn member-inline-btn--ghost"
                                                disabled={saving}
                                                onClick={() => handleDeleteDebtSettlement(debt, settlement)}
                                              >
                                                Excluir registro
                                              </button>
                                            </div>
                                          </li>
                                        )
                                      })}
                                    </ul>
                                  ) : !isPendingReceiptConfirmation ? (
                                    <p className="member-settlement-empty">
                                      Nenhuma restituicao registrada ainda nesta conta.
                                    </p>
                                  ) : null}
                                </div>
                              )
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
                {memberPermissions.canViewAmounts && (
                <div className="member-values">
                  {m.monthlyReceitas != null && (
                    <span className="mv-income">{formatCurrency(m.monthlyReceitas)}</span>
                  )}
                  {m.monthlyDespesas != null && (
                    <span className="mv-expense">{formatCurrency(m.monthlyDespesas)}</span>
                  )}
                </div>
                )}
                {canRemoveMembers && !isGestor && !isMe && (
                  <button
                    className="btn-remove"
                    title="Remover membro"
                    onClick={() => setRemoveMemberTarget(m)}
                  >
                    ✕
                  </button>
                )}
              </li>
            )
          })}
        </ul>
        )}
      </Card>

      {/* Convites pendentes */}
      {visibleInvitations.length > 0 && (
        <Card>
          <CardHeader title="Convites da familia" subtitle="Acompanhe quem ainda nao entrou ou quem ja pediu acesso" />
          <ul className="invites-list">
            {visibleInvitations.map((inv) => {
                const meta = INV_STATUS_META[inv.status] ?? { label: inv.status, cls: '' }
                const dest = inv.email ?? inv.phone ?? '—'
                const method = inv.method === 'whatsapp' ? '📲' : '📧'
                return (
                  <li key={inv.id} className="invite-item">
                    <span className="invite-method">{method}</span>
                    <span className="invite-email">{dest}</span>
                    <span className={`invite-status ${meta.cls}`}>{meta.label}</span>
                    <span className="invite-role">{ROLE_META[inv.role]?.label ?? inv.role}</span>
                    {inv.status === 'awaiting_confirmation' && inv._source !== 'legacy-family' && (
                      <button
                        type="button"
                        className="invite-cancel-btn"
                        onClick={() => handleApproveInvite(inv)}
                        disabled={saving}
                      >
                        Confirmar
                      </button>
                    )}
                    <button
                      type="button"
                      className="invite-cancel-btn"
                      onClick={() => handleCancelInvite(inv)}
                      disabled={saving}
                    >
                      Excluir
                    </button>
                  </li>
                )
              })}
          </ul>
        </Card>
      )}

      {/* Papéis e permissões */}
      <Card>
        <div className="familia-members-header">
          <CardHeader title="Papeis e permissoes" subtitle="Abra apenas quando precisar consultar" />
          <button
            type="button"
            className="member-inline-btn member-inline-btn--ghost"
            onClick={() => setRolesExpanded((current) => !current)}
          >
            {rolesExpanded ? 'Ocultar' : 'Ver papeis'}
          </button>
        </div>
        {rolesExpanded && <ul className="roles-legend roles-legend--plain">
          {Object.entries(ROLE_META).map(([key, meta]) => (
            <li key={key} className="role-legend-item role-legend-item--plain">
              <strong>{meta.label}:</strong>
              <span className="role-legend-desc">{ROLE_DESC[key]}</span>
            </li>
          ))}
        </ul>}
      </Card>

      <Card>
        <div className="familia-members-header">
          <CardHeader title="Resumo geral entre membros" subtitle="Seu total consolidado com toda a família" />
          {canRegisterInternalDebt && (
            <div className="members-header-btns">
              <button className="btn-add-member" onClick={() => handleMemberDebtOpen()}>
                + Registrar saldo
              </button>
            </div>
          )}
        </div>
        <div className="familia-summary-grid family-ledger-overview">
          <div className="familia-stat">
            <span className="familia-stat-label">Te devem</span>
            <span className="familia-stat-value green">{formatCurrency(familyDebtOverview.owesToMe)}</span>
          </div>
          <div className="familia-stat">
            <span className="familia-stat-label">Voce deve</span>
            <span className="familia-stat-value red">{formatCurrency(familyDebtOverview.iOwe)}</span>
          </div>
          <div className="familia-stat">
            <span className="familia-stat-label">Saldo liquido</span>
            <span className={`familia-stat-value ${familyDebtOverview.owesToMe - familyDebtOverview.iOwe >= 0 ? 'green' : 'red'}`}>
              {formatCurrency(Math.abs(familyDebtOverview.owesToMe - familyDebtOverview.iOwe))}
            </span>
          </div>
          <div className="familia-stat">
            <span className="familia-stat-label">Confirmacoes pendentes</span>
            <span className="familia-stat-value blue">{pendingSettlementCount}</span>
          </div>
          <div className="familia-stat">
            <span className="familia-stat-label">Fora da familia para pagar</span>
            <span className="familia-stat-value red">{formatCurrency(externalDebtSummary.payable)}</span>
          </div>
          <div className="familia-stat">
            <span className="familia-stat-label">Fora da familia para receber</span>
            <span className="familia-stat-value green">{formatCurrency(externalDebtSummary.receivable)}</span>
          </div>
          <div className="familia-stat">
            <span className="familia-stat-label">Minha divida total</span>
            <span className="familia-stat-value red">{formatCurrency(combinedDebtTotal)}</span>
          </div>
        </div>
        <div className="member-actions-row" style={{ marginTop: '0.75rem' }}>
          <button
            type="button"
            className="member-inline-btn"
            onClick={() => setExternalDebtOpen(true)}
          >
            + Pendencia externa
          </button>
          {(familyDebtLedger.length > 0 || legacyContactLedger.length > 0) && (
            <button
              type="button"
              className="member-inline-btn member-inline-btn--ghost"
              onClick={() => setGeneralLedgerExpanded((current) => !current)}
            >
              {generalLedgerExpanded ? 'Ocultar detalhes gerais' : 'Ver detalhes gerais'}
            </button>
          )}
        </div>
        {(openExternalPayableDebts.length > 0 || openExternalReceivableDebts.length > 0) && (
          <div className="family-debt-block">
            <strong className="family-debt-block-title">Pendencias externas em aberto</strong>
            {openExternalPayableDebts.length > 0 && (
              <ul className="family-debt-list">
                {openExternalPayableDebts.slice(0, 4).map((debt) => (
                  <li key={debt.id} className="family-debt-item">
                    <div className="family-debt-top">
                      <div>
                        <strong>{debt.name}</strong>
                        <p>{externalDebtRelationLabel(debt)}</p>
                      </div>
                      <span className="family-debt-remaining">{formatCurrency(debt.remainingAmount)}</span>
                    </div>
                    <div className="family-debt-meta">
                      <span>{EXTERNAL_DEBT_TYPE_OPTIONS.find((option) => option.value === debt.type)?.label || debt.type}</span>
                      <span>Total {formatCurrency(debt.totalAmount)}</span>
                      <span>Compensado {formatCurrency(debt.paidAmount)}</span>
                      {Number(debt.installmentPlan?.monthlyAmount || 0) > 0 && (
                        <span>Plano mensal {formatCurrency(debt.installmentPlan.monthlyAmount)}</span>
                      )}
                    </div>
                    {debt.notes && <p className="family-debt-notes">{debt.notes}</p>}
                    <div className="member-debt-entry-actions">
                      <button
                        type="button"
                        className="member-inline-btn member-inline-btn--ghost"
                        disabled={saving}
                        onClick={() => handleDeleteDebt(debt)}
                      >
                        Excluir pendencia
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {openExternalReceivableDebts.length > 0 && (
              <ul className="family-debt-list" style={{ marginTop: openExternalPayableDebts.length > 0 ? '0.75rem' : 0 }}>
                {openExternalReceivableDebts.slice(0, 4).map((debt) => (
                  <li key={debt.id} className="family-debt-item">
                    <div className="family-debt-top">
                      <div>
                        <strong>{debt.name}</strong>
                        <p>{externalDebtRelationLabel(debt)}</p>
                      </div>
                      <span className="family-debt-remaining" style={{ color: '#15803d' }}>
                        {formatCurrency(debt.remainingAmount)}
                      </span>
                    </div>
                    <div className="family-debt-meta">
                      <span>{EXTERNAL_DEBT_TYPE_OPTIONS.find((option) => option.value === debt.type)?.label || debt.type}</span>
                      <span>Total {formatCurrency(debt.totalAmount)}</span>
                      <span>Compensado {formatCurrency(debt.paidAmount)}</span>
                      {Number(debt.installmentPlan?.monthlyAmount || 0) > 0 && (
                        <span>Meta de recebimento {formatCurrency(debt.installmentPlan.monthlyAmount)}</span>
                      )}
                    </div>
                    {debt.notes && <p className="family-debt-notes">{debt.notes}</p>}
                    <div className="member-debt-entry-actions">
                      <button
                        type="button"
                        className="member-inline-btn member-inline-btn--ghost"
                        disabled={saving}
                        onClick={() => handleDeleteDebt(debt)}
                      >
                        Excluir pendencia
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="ledger-empty" style={{ marginTop: '0.75rem' }}>
              Para refletir no fluxo geral, registre o pagamento ou recebimento em Lancamentos usando essa mesma pessoa.
            </p>
          </div>
        )}
        {externalDebts.length === 0 && (
          <p className="ledger-empty" style={{ marginTop: '0.75rem' }}>
            Use "Pendencia externa" para registrar emprestimos, valores a receber e relacoes com pessoas que nao usam o aplicativo.
          </p>
        )}
        {familyDebtLedger.length === 0 && legacyContactLedger.length === 0 ? (
          <p className="ledger-empty">Nenhum saldo pendente entre pessoas no momento.</p>
        ) : generalLedgerExpanded ? (
          <>
            {familyDebtLedger.length > 0 && (
              <ul className="ledger-list">
                {familyDebtLedger.map((item) => (
                  <li key={item.memberId} className="ledger-item ledger-item--stacked">
                    <div className="ledger-main">
                      <span className="ledger-name">{item.memberName}</span>
                      <span className={`ledger-value ${item.netBalance >= 0 ? 'green' : 'red'}`}>
                        {formatCurrency(Math.abs(item.netBalance))} {item.netBalance >= 0 ? 'saldo a receber' : 'saldo a pagar'}
                      </span>
                    </div>
                    <div className="ledger-subline">
                      {item.owesToMe > 0 && <span>Te deve {formatCurrency(item.owesToMe)}</span>}
                      {item.iOwe > 0 && <span>Você deve {formatCurrency(item.iOwe)}</span>}
                      <span>{item.openDebtsCount} pendência(s)</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {openFamilyInternalDebts.length > 0 && (
              <div className="family-debt-block">
                <strong className="family-debt-block-title">Pendências abertas</strong>
                <ul className="family-debt-list">
                  {openFamilyInternalDebts.map((debt) => {
                    const remainingAmount = Number(debt.remainingAmount || 0)
                    const paidAmount = Number(debt.paidAmount || 0)
                    const totalAmount = Number(debt.totalAmount || 0)
                    const payments = paymentsByDebtId[debt.id] || []
                    const isMine = debt.creditorMemberId === user?.uid || debt.debtorMemberId === user?.uid
                    const relationLabel = isMine
                      ? (debt.creditorMemberId === user?.uid
                        ? `${debt.counterpartyMemberName || debt.debtorMemberName || 'Membro'} te deve`
                        : `Você deve para ${debt.counterpartyMemberName || debt.creditorMemberName || 'Membro'}`)
                      : `${debt.debtorMemberName || 'Membro'} deve para ${debt.creditorMemberName || 'Membro'}`

                    return (
                      <li key={debt.id} className="family-debt-item">
                        <div className="family-debt-top">
                          <div>
                            <strong>{debt.name}</strong>
                            <p>{relationLabel}</p>
                          </div>
                          <span className="family-debt-remaining">{formatCurrency(remainingAmount)}</span>
                        </div>
                        <div className="family-debt-meta">
                          <span>{debt.reasonLabel || debtReasonLabel(debt.reasonType)}</span>
                          <span>Total {formatCurrency(totalAmount)}</span>
                          <span>Compensado {formatCurrency(paidAmount)}</span>
                          <span>{payments.length} abatimento(s)</span>
                        </div>
                        {debt.notes && <p className="family-debt-notes">{debt.notes}</p>}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}

            {legacyContactLedger.length > 0 && (
              <div className="family-debt-block">
                <strong className="family-debt-block-title">Histórico legado por contato</strong>
                <ul className="ledger-list">
                  {legacyContactLedger.map((item) => (
                    <li key={item.contactId} className="ledger-item">
                      <span className="ledger-name">{item.contactName}</span>
                      <span className={`ledger-value ${item.pendingBalance >= 0 ? 'green' : 'red'}`}>
                        {formatCurrency(Math.abs(item.pendingBalance))} {item.pendingBalance >= 0 ? 'a receber' : 'a pagar'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : null}
      </Card>

      {/* Compartilhar app */}
      <Card>
        <div className="share-app-row">
          <div className="share-app-info">
            <strong>Compartilhar o app</strong>
            <p>Este link e geral do aplicativo. Cada pessoa cria a propria conta e a propria familia.</p>
          </div>
          <button className="btn-share-app" onClick={handleShareApp}>
            🔗 Compartilhar
          </button>
        </div>
      </Card>

      {/* ── Modals ─────────────────────────────────────────────────────────── */}

      {/* Edit family name */}
      {editFamilyOpen && (
        <div className="modal-overlay" onClick={() => setEditFamilyOpen(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Editar família</h3>
            <div className="invite-form">
              <div className="form-group">
                <label>Nome da família</label>
                <input
                  type="text"
                  value={editName_value}
                  onChange={(e) => setEditNameValue(e.target.value)}
                  placeholder="Ex: Família Silva"
                  autoFocus
                  maxLength={60}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleEditFamilySave() }}
                />
              </div>
              <div className="invite-form-actions">
                <button className="btn-cancel" onClick={() => setEditFamilyOpen(false)}>
                  Cancelar
                </button>
                <button
                  className="btn-send"
                  onClick={handleEditFamilySave}
                  disabled={saving || !editName_value.trim()}
                >
                  {saving ? 'Salvando…' : 'Salvar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete family confirm */}
      {deleteFamilyOpen && (
        <div className="modal-overlay" onClick={() => setDeleteFamilyOpen(false)}>
          <div className="modal-box modal-danger" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">⚠️ Excluir família</h3>
            <p className="modal-danger-text">
              Esta ação é <strong>irreversível</strong>. Todos os dados da família (membros e convites) serão deletados.
            </p>
            <p className="modal-danger-text">
              Digite <strong>excluir</strong> para confirmar:
            </p>
            <div className="invite-form">
              <div className="form-group">
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder="excluir"
                  autoFocus
                />
              </div>
              <div className="invite-form-actions">
                <button className="btn-cancel" onClick={() => setDeleteFamilyOpen(false)}>
                  Cancelar
                </button>
                <button
                  className="btn-delete-confirm"
                  onClick={handleDeleteFamily}
                  disabled={saving || deleteConfirmText.toLowerCase() !== 'excluir'}
                >
                  {saving ? 'Excluindo…' : 'Excluir definitivamente'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Remove member confirm */}
      {removeMemberTarget && (
        <div className="modal-overlay" onClick={() => setRemoveMemberTarget(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Remover membro</h3>
            <p className="modal-danger-text">
              Remover <strong>{removeMemberTarget.displayName}</strong> da família?
              Ele(a) perderá o acesso ao consolidado familiar.
            </p>
            <div className="invite-form-actions" style={{ marginTop: '1rem' }}>
              <button className="btn-cancel" onClick={() => setRemoveMemberTarget(null)}>
                Cancelar
              </button>
              <button className="btn-delete-confirm" onClick={handleRemoveMember} disabled={saving}>
                {saving ? 'Removendo…' : 'Remover'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add member modal */}
      {addMemberOpen && (
        <div className="modal-overlay" onClick={() => setAddMemberOpen(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Adicionar membro</h3>
            <form onSubmit={handleAddMember} className="invite-form">
              <div className="form-group">
                <label>Nome do membro</label>
                <input
                  type="text"
                  value={addMemberName}
                  onChange={(e) => setAddMemberName(e.target.value)}
                  placeholder="Ex: Ana Silva"
                  required
                  autoFocus
                  maxLength={60}
                />
              </div>
              <div className="form-group">
                <label>E-mail (opcional)</label>
                <input
                  type="email"
                  value={addMemberEmail}
                  onChange={(e) => setAddMemberEmail(e.target.value)}
                  placeholder="email@exemplo.com"
                />
              </div>
              <div className="form-group">
                <label>Papel</label>
                <select value={addMemberRole} onChange={(e) => setAddMemberRole(e.target.value)}>
                  {MANAGEABLE_ROLES.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Observação (opcional)</label>
                <textarea
                  rows={2}
                  value={addMemberNote}
                  onChange={(e) => setAddMemberNote(e.target.value)}
                  placeholder="Ex: responsável pelo mercado"
                  maxLength={160}
                />
              </div>
              <div className="invite-form-actions">
                <button type="button" className="btn-cancel" onClick={() => setAddMemberOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn-send" disabled={saving}>
                  {saving ? 'Adicionando…' : 'Adicionar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {memberDebtOpen && (
        <div className="modal-overlay" onClick={handleMemberDebtModalClose}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Registrar saldo interno</h3>
            <p className="modal-hint">
              Este formulario cria a pendencia principal. Quando houver devolucao, use o botao "Registrar restituicao" dentro da conta do membro para nao abrir um saldo novo.
            </p>
            <form onSubmit={handleCreateMemberDebt} className="invite-form">
              <div className="form-group">
                <label>Membro relacionado</label>
                <select
                  value={memberDebtForm.memberId}
                  onChange={(e) => setMemberDebtForm((current) => ({ ...current, memberId: e.target.value }))}
                >
                  <option value="">Selecione um membro</option>
                  {familyMembers
                    .filter((member) => memberStableId(member) && memberStableId(member) !== user?.uid)
                    .map((member) => (
                      <option key={memberStableId(member)} value={memberStableId(member)}>
                        {member.displayName}
                      </option>
                    ))}
                </select>
              </div>
              <div className="form-group">
                <label>Direção do saldo</label>
                <select
                  value={memberDebtForm.direction}
                  onChange={(e) => setMemberDebtForm((current) => ({ ...current, direction: e.target.value }))}
                >
                  {INTERNAL_DEBT_DIRECTION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Motivo</label>
                <select
                  value={memberDebtForm.reasonType}
                  onChange={(e) => setMemberDebtForm((current) => ({ ...current, reasonType: e.target.value }))}
                >
                  {INTERNAL_DEBT_REASON_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Título do registro (opcional)</label>
                <input
                  type="text"
                  value={memberDebtForm.title}
                  onChange={(e) => setMemberDebtForm((current) => ({ ...current, title: e.target.value }))}
                  placeholder="Ex: Pix por dinheiro do posto"
                  maxLength={80}
                />
              </div>
              <div className="form-group">
                <label>Valor total combinado</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={memberDebtForm.totalAmount}
                  onChange={(e) => setMemberDebtForm((current) => ({ ...current, totalAmount: e.target.value }))}
                  placeholder="0,00"
                  required
                />
              </div>
              <div className="form-group">
                <label>Valor já compensado</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={memberDebtForm.paidAmount}
                  onChange={(e) => setMemberDebtForm((current) => ({ ...current, paidAmount: e.target.value }))}
                  placeholder="0,00"
                />
                <span className="form-hint">
                  Use este campo quando parte do acerto já foi feita e só o restante precisa continuar em aberto.
                </span>
              </div>
              <div className="form-group">
                <label>Observação</label>
                <textarea
                  rows={3}
                  value={memberDebtForm.notes}
                  onChange={(e) => setMemberDebtForm((current) => ({ ...current, notes: e.target.value }))}
                  placeholder="Ex: Ela me deu 200 em dinheiro e eu devolvi 100 no Pix. Restam 100."
                  maxLength={240}
                />
              </div>
              <div className="internal-debt-preview">
                Saldo em aberto:{' '}
                <strong>
                  {formatCurrency(Math.max(0, Number(memberDebtForm.totalAmount || 0) - Number(memberDebtForm.paidAmount || 0)))}
                </strong>
              </div>
              <div className="invite-form-actions">
                <button type="button" className="btn-cancel" onClick={handleMemberDebtModalClose}>
                  Cancelar
                </button>
                <button type="submit" className="btn-send" disabled={saving}>
                  {saving ? 'Salvando...' : 'Registrar saldo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {externalDebtOpen && (
        <div className="modal-overlay" onClick={handleExternalDebtModalClose}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Nova pendencia externa</h3>
            <p className="modal-hint">
              Use para banco, parentes, amigos ou qualquer pessoa que nao participa do app. Esse cadastro organiza o saldo da relacao.
              Para mexer no caixa geral, registre depois o pagamento ou recebimento em Lancamentos.
            </p>
            <form onSubmit={handleCreateExternalDebt} className="invite-form">
              <div className="form-group">
                <label>Pessoa ou instituicao</label>
                <input
                  type="text"
                  value={externalDebtForm.name}
                  onChange={(e) => setExternalDebtForm((current) => ({ ...current, name: e.target.value }))}
                  placeholder="Ex: Banco do Brasil, Tio Joao"
                  required
                  autoFocus
                  maxLength={80}
                />
              </div>
              <div className="form-group">
                <label>Tipo</label>
                <select
                  value={externalDebtForm.type}
                  onChange={(e) => setExternalDebtForm((current) => ({ ...current, type: e.target.value }))}
                >
                  {EXTERNAL_DEBT_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Como essa relacao funciona</label>
                <select
                  value={externalDebtForm.direction}
                  onChange={(e) => setExternalDebtForm((current) => ({ ...current, direction: e.target.value }))}
                >
                  {EXTERNAL_DEBT_DIRECTION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Valor total</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={externalDebtForm.totalAmount}
                  onChange={(e) => setExternalDebtForm((current) => ({ ...current, totalAmount: e.target.value }))}
                  placeholder="0,00"
                  required
                />
              </div>
              <div className="form-group">
                <label>Valor ja compensado</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={externalDebtForm.paidAmount}
                  onChange={(e) => setExternalDebtForm((current) => ({ ...current, paidAmount: e.target.value }))}
                  placeholder="0,00"
                />
              </div>
              <div className="form-group">
                <label>Meta mensal (opcional)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={externalDebtForm.monthlyAmount}
                  onChange={(e) => setExternalDebtForm((current) => ({ ...current, monthlyAmount: e.target.value }))}
                  placeholder="Ex: 250,00"
                />
              </div>
              <div className="form-group">
                <label>Observacao</label>
                <textarea
                  rows={3}
                  value={externalDebtForm.notes}
                  onChange={(e) => setExternalDebtForm((current) => ({ ...current, notes: e.target.value }))}
                  placeholder="Ex: Vou pagando conforme entrar dinheiro, ou 12 parcelas no banco."
                  maxLength={240}
                />
              </div>
              <div className="invite-form-actions">
                <button type="button" className="btn-cancel" onClick={handleExternalDebtModalClose}>
                  Cancelar
                </button>
                <button type="submit" className="btn-send" disabled={saving}>
                  {saving ? 'Salvando...' : 'Registrar pendencia'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {settlementOpen && (
        <div className="modal-overlay" onClick={handleSettlementModalClose}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Registrar restituicao</h3>
            <p className="modal-hint">
              Use este passo quando o dinheiro ja foi enviado. O saldo so sera abatido depois que a outra pessoa confirmar o recebimento.
            </p>
            <form onSubmit={handleCreateSettlement} className="invite-form">
              <div className="form-group">
                <label>Conta em aberto</label>
                <select
                  value={settlementForm.debtId}
                  onChange={(e) => setSettlementForm((current) => ({ ...current, debtId: e.target.value }))}
                >
                  <option value="">Selecione uma pendencia</option>
                  {familyInternalDebts
                    .filter((debt) => debt.debtorMemberId === user?.uid && Number(debt.remainingAmount || 0) > 0)
                    .map((debt) => {
                      const counterpartId = counterpartMemberIdForDebt(debt, user?.uid)
                      const counterpartName = memberDebtSummaryById.get(counterpartId)?.memberName
                        || debt.counterpartyMemberName
                        || debt.creditorMemberName
                        || debt.debtorMemberName
                        || 'Membro'
                      return (
                        <option key={debt.id} value={debt.id}>
                          {debt.name} · {counterpartName} · restante {formatCurrency(debt.remainingAmount)}
                        </option>
                      )
                    })}
                </select>
              </div>
              <div className="form-group">
                <label>Valor enviado</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={settlementForm.amount}
                  onChange={(e) => setSettlementForm((current) => ({ ...current, amount: e.target.value }))}
                  placeholder="0,00"
                  required
                />
              </div>
              <div className="form-group">
                <label>Observacao (opcional)</label>
                <textarea
                  rows={3}
                  value={settlementForm.notes}
                  onChange={(e) => setSettlementForm((current) => ({ ...current, notes: e.target.value }))}
                  placeholder="Ex: Enviei no Pix agora, aguardando ele conferir a conta."
                  maxLength={240}
                />
              </div>
              <div className="form-group">
                <label>Como foi enviado</label>
                <select
                  value={settlementForm.paymentMethod}
                  onChange={(e) => setSettlementForm((current) => ({
                    ...current,
                    paymentMethod: e.target.value,
                    accountId: normalizePaymentMethodId(e.target.value) === 'credit_card' ? '' : current.accountId,
                    cardId: normalizePaymentMethodId(e.target.value) === 'credit_card' ? current.cardId : '',
                  }))}
                >
                  {TRANSACTION_PAYMENT_METHODS.map((method) => (
                    <option key={method.id} value={method.id}>{method.label}</option>
                  ))}
                </select>
              </div>
              {settlementRequiresCard ? (
                <div className="form-group">
                  <label>Cartao usado</label>
                  <select
                    value={settlementForm.cardId}
                    onChange={(e) => setSettlementForm((current) => ({ ...current, cardId: e.target.value }))}
                  >
                    <option value="">Selecione o cartao</option>
                    {cards.map((card) => (
                      <option key={card.id} value={card.id}>{cardOptionLabel(card)}</option>
                    ))}
                  </select>
                </div>
              ) : settlementRequiresAccount ? (
                <div className="form-group">
                  <label>Conta usada</label>
                  <select
                    value={settlementForm.accountId}
                    onChange={(e) => setSettlementForm((current) => ({ ...current, accountId: e.target.value }))}
                  >
                    <option value="">Selecione a conta</option>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>{accountOptionLabel(account)}</option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div className="invite-form-actions">
                <button type="button" className="btn-cancel" onClick={handleSettlementModalClose}>
                  Cancelar
                </button>
                <button type="submit" className="btn-send" disabled={saving}>
                  {saving ? 'Salvando...' : 'Registrar envio'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Invite modal */}
      {inviteOpen && (
        <div className="modal-overlay" onClick={() => setInviteOpen(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Convidar membro</h3>

            {/* Tabs */}
            <div className="invite-tabs">
              <button
                className={`invite-tab ${inviteTab === 'whatsapp' ? 'active' : ''}`}
                onClick={() => setInviteTab('whatsapp')}
              >
                📲 WhatsApp
              </button>
              <button
                className={`invite-tab ${inviteTab === 'email' ? 'active' : ''}`}
                onClick={() => setInviteTab('email')}
              >
                📧 E-mail
              </button>
            </div>

            {/* Role selector (shared) */}
            <div className="form-group" style={{ marginTop: '0.75rem' }}>
              <label>Papel</label>
              <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                {MANAGEABLE_ROLES.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>

            {/* WhatsApp tab */}
            {inviteTab === 'whatsapp' && (
              <form onSubmit={handleInviteWhatsApp} className="invite-form" style={{ marginTop: '0.25rem' }}>
                <div className="form-group">
                  <label>Número do WhatsApp</label>
                  <input
                    type="tel"
                    value={invitePhone}
                    onChange={(e) => setInvitePhone(e.target.value)}
                    placeholder="+55 11 99999-9999"
                    required
                    autoFocus
                  />
                  <span className="form-hint">Inclua o código do país. Ex: 5511999999999</span>
                </div>
                <div className="invite-form-actions">
                  <button type="button" className="btn-cancel" onClick={() => setInviteOpen(false)}>
                    Cancelar
                  </button>
                  <button type="submit" className="btn-whatsapp" disabled={saving}>
                    📲 Abrir WhatsApp
                  </button>
                </div>
              </form>
            )}

            {/* Email tab */}
            {inviteTab === 'email' && (
              <form onSubmit={handleInviteEmail} className="invite-form" style={{ marginTop: '0.25rem' }}>
                <div className="form-group">
                  <label>E-mail</label>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="email@exemplo.com"
                    required
                  />
                </div>
                <div className="invite-form-actions">
                  <button type="button" className="btn-cancel" onClick={() => setInviteOpen(false)}>
                    Cancelar
                  </button>
                  <button type="submit" className="btn-send" disabled={saving}>
                    {saving ? 'Enviando…' : 'Registrar convite'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {projectOpen && (
        <div className="modal-overlay" onClick={handleProjectModalClose}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">{editingProjectId ? 'Editar projeto familiar' : 'Novo projeto familiar'}</h3>
            <form onSubmit={handleCreateProject} className="invite-form">
              <div className="form-group">
                <label>Nome do projeto</label>
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="Ex: Viagem de ferias"
                  required
                  autoFocus
                  maxLength={80}
                />
              </div>
              <div className="form-group">
                <label>Membro responsavel</label>
                <select
                  value={projectOwnerId}
                  onChange={(e) => {
                    const nextId = e.target.value
                    const selectedMember = familyMembers.find((member) => (member.id ?? member.uid) === nextId)
                    setProjectOwnerId(nextId)
                    setProjectOwnerName(selectedMember?.displayName || '')
                  }}
                >
                  <option value="">Selecione um membro</option>
                  {familyMembers.map((member) => (
                    <option key={member.id ?? member.uid} value={member.id ?? member.uid}>
                      {member.displayName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Meta total</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={projectTarget}
                  onChange={(e) => setProjectTarget(e.target.value)}
                  placeholder="0,00"
                />
              </div>
              <div className="form-group">
                <label>Saldo inicial manual</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={projectCurrent}
                  onChange={(e) => setProjectCurrent(e.target.value)}
                  placeholder="0,00"
                />
              </div>
              <div className="form-group">
                <label>Conta real para acompanhar</label>
                <select
                  value={projectAccountId}
                  onChange={(e) => {
                    const nextId = e.target.value
                    const selectedAccount = accounts.find((account) => account.id === nextId)
                    setProjectAccountId(nextId)
                    setProjectAccount(selectedAccount ? `${selectedAccount.name}${selectedAccount.bank ? ` - ${selectedAccount.bank}` : ''}` : '')
                  }}
                >
                  <option value="">Selecione uma conta</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}{account.bank ? ` - ${account.bank}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Texto ou categoria para identificar</label>
                <input
                  type="text"
                  value={projectMatchText}
                  onChange={(e) => setProjectMatchText(e.target.value)}
                  placeholder="Ex: viagem, caixinha viagem, reserva"
                  maxLength={80}
                />
              </div>
              <div className="form-group">
                <label>Nome livre da conta</label>
                <input
                  type="text"
                  value={projectAccount}
                  onChange={(e) => setProjectAccount(e.target.value)}
                  placeholder="Ex: Nubank - caixinha viagem"
                  maxLength={80}
                />
              </div>
              <div className="form-group">
                <label>Observacoes</label>
                <textarea
                  rows={3}
                  value={projectNotes}
                  onChange={(e) => setProjectNotes(e.target.value)}
                  placeholder="Como esse projeto sera usado pela familia"
                  maxLength={240}
                />
              </div>
              <div className="invite-form-actions">
                <button type="button" className="btn-cancel" onClick={handleProjectModalClose}>
                  Cancelar
                </button>
                <button type="submit" className="btn-send" disabled={saving}>
                  {saving ? 'Salvando...' : (editingProjectId ? 'Salvar projeto' : 'Criar projeto')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`familia-toast ${toast.type === 'err' ? 'toast-err' : ''}`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}


