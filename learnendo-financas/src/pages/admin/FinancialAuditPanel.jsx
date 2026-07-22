import { useEffect, useMemo, useState } from 'react'
import Button from '../../components/ui/Button'
import Card, { CardHeader } from '../../components/ui/Card'
import { useAuth } from '../../context/AuthContext'
import {
  exportCrossFinancialAuditCsv,
  exportCrossFinancialAuditJson,
  exportFinancialAuditCsv,
  exportFinancialAuditJson,
  fetchAuthenticationDiagnostics,
  runCrossMemberFinancialAudit,
} from '../../services/financialAuditService'
import {
  createVerifiedWorkspaceMemberInvite,
  inspectWorkspaceMemberInvitation,
} from '../../services/workspaceService'
import { formatCurrency } from '../../utils/formatCurrency'

const ARTHUR_FAMILY_WORKSPACE_ID = 'B8UWq9EAhdTKgDveAoWA'
const ARTHUR_UID = 'pbf1El4rE7aZ2Xv306qQcdqTm1i2'
const ARTHUR_EMAIL = 'arttsmartts@gmail.com'

const MEMBER_SLOTS = [
  { key: 'eric', label: 'Eric', priority: true },
  { key: 'levi', label: 'Levi' },
  { key: 'arthur', label: 'Arthur', registration: true, targetWorkspaceId: ARTHUR_FAMILY_WORKSPACE_ID },
]

function normalized(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

function dateTime(value) {
  if (!value) return 'Data ausente'
  return new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

function memberTarget(slot, selectedUid, manual, users) {
  const profile = users.find((item) => item.uid === selectedUid)
  if (profile) return { ...profile, _profileExists: true }
  if (!manual?.uid && !manual?.email) return null
  return {
    uid: manual.uid.trim(),
    email: manual.email.trim(),
    displayName: manual.displayName.trim() || slot.label,
    _profileExists: false,
  }
}

function MemberSummary({ label, audit, diagnostic, detailed = false }) {
  const summary = audit?.summary || {}
  const pendingMovements = (audit?.reports || [])
    .flatMap((report) => report.movements || [])
    .filter((movement) => movement.status === 'pending_confirmation')
  return (
    <div className="admin-audit-member-view">
      <h4>Auditoria do {label}</h4>
      <div className="admin-audit-summary">
        <div><span>Principal confirmado</span><strong>{formatCurrency(summary.principalConfirmed)}</strong></div>
        <div><span>Juros positivos</span><strong>{formatCurrency(summary.interestPositive)}</strong></div>
        <div><span>Juros negativos</span><strong>{formatCurrency(summary.interestNegative)}</strong></div>
        <div><span>Juros líquidos</span><strong>{formatCurrency(summary.netInterest)}</strong></div>
        <div><span>Saldo reconstruído com juros</span><strong>{formatCurrency(summary.reconstructedBalanceWithInterest)}</strong></div>
        <div><span>Saldo exibido no sistema</span><strong>{formatCurrency(summary.displayedSystemBalance)}</strong></div>
        <div><span>Diferença real</span><strong>{formatCurrency(summary.realDifference)}</strong></div>
        <div><span>Créditos pendentes</span><strong>{formatCurrency(summary.pendingCredits)}</strong></div>
        <div><span>Débitos pendentes</span><strong>{formatCurrency(summary.pendingDebits)}</strong></div>
        <div><span>Devido por {label}</span><strong>{formatCurrency(summary.originallyOwedBy)}</strong></div>
        <div><span>Devido a {label}</span><strong>{formatCurrency(summary.originallyOwedTo)}</strong></div>
        <div><span>Pago por {label}</span><strong>{formatCurrency(summary.paidByTarget)}</strong></div>
        <div><span>Recebido por {label}</span><strong>{formatCurrency(summary.receivedByTarget)}</strong></div>
        <div><span>Compensado</span><strong>{formatCurrency(summary.compensated)}</strong></div>
        <div><span>Cancelado</span><strong>{formatCurrency(summary.cancelled)}</strong></div>
        <div><span>Excluido logicamente</span><strong>{formatCurrency(summary.logicallyDeleted)}</strong></div>
        <div><span>Registros</span><strong>{summary.recordsAnalyzed || 0}</strong></div>
        <div><span>Inconsistencias</span><strong>{summary.inconsistencies || 0}</strong></div>
        <div><span>Duplicidades</span><strong>{summary.possibleDuplicates || 0}</strong></div>
        <div><span>Orfaos</span><strong>{summary.orphanRecords || 0}</strong></div>
      </div>
      <p className="admin-audit-formula">
          Fórmula: principal confirmado {formatCurrency(summary.principalConfirmed)} + juros líquidos {formatCurrency(summary.netInterest)} = <strong>{formatCurrency(summary.reconstructedBalanceWithInterest)}</strong>.
      </p>
      {pendingMovements.length > 0 && (
        <div className="admin-audit-pending">
          <strong>Lançamentos pendentes, fora do saldo confirmado</strong>
          {pendingMovements.map((movement) => (
            <span key={`${movement.collection}:${movement.documentId}`}>
              {movement.direction === 'creditor' ? 'Crédito' : 'Débito'} de {formatCurrency(movement.originalAmount)} · {movement.title} · {movement.documentId}
            </span>
          ))}
        </div>
      )}
      {diagnostic && (
        <details>
          <summary>Identificacao cadastral de {label}</summary>
          <div className="admin-audit-identity-details">
            <span>Nome completo: {diagnostic.displayName || 'nao informado'}</span>
            <span>E-mail: {diagnostic.email || 'nao informado'}</span>
            <span>UID: {diagnostic.uid || 'nao informado'}</span>
            <span>Authentication: {diagnostic.authentication?.exists === true ? 'encontrado' : diagnostic.authentication?.exists === false ? 'nao encontrado' : 'nao confirmado'}</span>
            <span>Workspaces: {diagnostic.workspaceMemberships.map((item) => `${item.workspaceId} (memberId ${item.memberId}, userId ${item.userId || '—'}, uid ${item.uid || '—'}, ${item.status || 'sem status'})`).join(' · ') || 'nenhum'}</span>
            <span>Families: {diagnostic.legacyFamilyMemberships.map((item) => `${item.familyId} (memberId ${item.memberId}, userId ${item.userId || '—'}, uid ${item.uid || '—'}, ${item.status || 'sem status'})`).join(' · ') || 'nenhum'}</span>
            <span>Origens: {[...diagnostic.workspaceMemberships, ...diagnostic.legacyFamilyMemberships].map((item) => item.origin).filter(Boolean).join(' · ') || 'nao identificada'}</span>
            <span>IDs antigos: {diagnostic.oldIds.join(', ') || 'nenhum'}</span>
            <span>Possiveis duplicados: {diagnostic.possibleDuplicateRecords}</span>
          </div>
        </details>
      )}
      {label === 'Levi' && (
        <p className={Number(summary.reconstructedBalanceWithInterest || 0) === 0 ? 'admin-audit-success' : 'admin-audit-warning'}>
          {Number(summary.reconstructedBalanceWithInterest || 0) === 0
            ? `O saldo zerado do Levi foi confirmado. O crédito pendente de ${formatCurrency(summary.pendingCredits)} contra Eric permanece separado.`
            : 'O saldo zerado exibido para Levi nao foi confirmado; existe divergencia.'}
        </p>
      )}
      <details open={detailed}>
        <summary>Documentos que sustentam o resultado</summary>
        <div className="admin-audit-timeline">
          {(audit?.reports || []).flatMap((report) => report.movements).map((movement) => (
            <div key={`${movement.collection}:${movement.documentId}`} className="admin-audit-movement">
              <strong>{movement.title}</strong>
              <span>{dateTime(movement.date)} · {movement.operationType} · {movement.status}</span>
              <span>principal {formatCurrency(movement.principalRemainingAmount)} · juros {formatCurrency(movement.accruedInterestAmount)} · total {formatCurrency(movement.remainingAmount)}</span>
              <span>{movement.calculationJustification}</span>
            </div>
          ))}
        </div>
      </details>
      <div className="admin-actions">
        <Button variant="secondary" onClick={() => exportFinancialAuditJson(audit)}>JSON {label}</Button>
        <Button variant="secondary" onClick={() => exportFinancialAuditCsv(audit)}>CSV {label}</Button>
      </div>
    </div>
  )
}

function ArthurDiagnostic({ diagnostic, financialRecordCount }) {
  if (!diagnostic) return null
  return (
    <div className="admin-audit-registration">
      <h4>Impedimento cadastral do Arthur</h4>
      <dl>
        <dt>Firebase Authentication</dt>
        <dd>{diagnostic.authentication?.exists === true ? `Existe · UID ${diagnostic.authentication.uid}` : diagnostic.authentication?.exists === false ? 'Nao encontrado' : `Nao confirmado · ${diagnostic.authentication?.error || ''}`}</dd>
        <dt>Documento users</dt><dd>{diagnostic.userDocumentExists ? 'Existe' : 'Nao encontrado'}</dd>
        <dt>Vinculo em workspaces</dt><dd>{diagnostic.workspaceMemberships.length ? `${diagnostic.workspaceMemberships.length} registro(s)` : 'Nao encontrado'}</dd>
        <dt>Vinculo em families</dt><dd>{diagnostic.legacyFamilyMemberships.length ? `${diagnostic.legacyFamilyMemberships.length} registro(s)` : 'Nao encontrado'}</dd>
        <dt>Workspace familiar alvo</dt><dd>{diagnostic.targetWorkspaceId || ARTHUR_FAMILY_WORKSPACE_ID}</dd>
        <dt>Vinculo no workspace familiar</dt><dd>{diagnostic.targetWorkspaceMemberExists ? 'Existe' : 'Ausente'}</dd>
        <dt>Convite pendente no workspace familiar</dt><dd>{diagnostic.targetWorkspacePendingInvitations?.length || 0}</dd>
        <dt>UID divergente</dt><dd>{diagnostic.uidMismatch ? 'Sim' : 'Nao detectado'}</dd>
        <dt>IDs antigos</dt><dd>{diagnostic.oldIds.join(', ') || 'Nenhum identificado'}</dd>
        <dt>Movimentacoes financeiras</dt><dd>{financialRecordCount}</dd>
        <dt>Causa provavel</dt><dd>{diagnostic.probableCause}</dd>
        <dt>Arquivo ou funcao</dt><dd>{diagnostic.involvedFunction}</dd>
        <dt>Documento afetado</dt><dd>{diagnostic.affectedDocument}</dd>
        <dt>Correcao proposta</dt><dd>{diagnostic.proposedCorrection}</dd>
        <dt>Risco</dt><dd>{diagnostic.wrongUserLinkRisk}</dd>
      </dl>
      <p className="admin-audit-warning">Diagnostico somente leitura: nenhum convite, UID, status ou membro foi alterado.</p>
    </div>
  )
}

function ArthurInvitationAction({ state, onInspect, onConfirmChange, onCreate }) {
  const checks = state.inspection?.checks || {}
  const checkLabels = {
    workspaceExists: 'Workspace familiar encontrado',
    userDocumentExists: 'Documento users do Arthur encontrado',
    uidMatches: `UID confirmado: ${ARTHUR_UID}`,
    emailMatches: `E-mail confirmado: ${ARTHUR_EMAIL}`,
    memberAbsent: 'Arthur ainda nao pertence ao workspace familiar',
    pendingInviteAbsent: 'Nao existe convite pendente para Arthur',
    actorCanInvite: 'Administrador pode convidar neste workspace',
  }
  return (
    <div className="admin-audit-registration">
      <h4>Convite seguro para o workspace familiar</h4>
      <p>Workspace: <strong>{ARTHUR_FAMILY_WORKSPACE_ID}</strong></p>
      <p>Esta acao cria apenas um convite para Arthur. Os workspaces pessoais existentes nao sao apagados, substituidos ou modificados.</p>
      <Button variant="secondary" onClick={onInspect} loading={state.inspecting}>Verificar elegibilidade do Arthur</Button>
      {state.inspection && (
        <div className="admin-audit-invite-checks">
          {Object.entries(checkLabels).map(([key, label]) => (
            <span key={key} className={checks[key] ? 'admin-audit-success' : 'admin-audit-warning'}>
              {checks[key] ? 'OK' : 'Bloqueado'} · {label}
            </span>
          ))}
        </div>
      )}
      {state.inspection?.eligible && !state.result && (
        <>
          <label className="admin-audit-confirm">
            <input type="checkbox" checked={state.confirmed} onChange={(event) => onConfirmChange(event.target.checked)} />
            Confirmo o UID, o e-mail, a ausencia no workspace e a ausencia de convite pendente. Criar somente o convite como membro.
          </label>
          <Button onClick={onCreate} loading={state.creating} disabled={!state.confirmed}>Criar convite seguro para Arthur</Button>
        </>
      )}
      {state.result && (
        <div className="admin-audit-success">
          Convite criado sem alterar os workspaces pessoais.
          <input value={state.result.link} readOnly aria-label="Link do convite do Arthur" />
        </div>
      )}
      {state.error && <div className="admin-error-box">{state.error}</div>}
    </div>
  )
}

export default function FinancialAuditPanel({ users = [] }) {
  const { user } = useAuth()
  const [selected, setSelected] = useState({ eric: '', levi: '', arthur: '' })
  const [manual, setManual] = useState({
    eric: { uid: '', email: '', displayName: 'Eric' },
    levi: { uid: '', email: '', displayName: 'Levi' },
    arthur: { uid: '', email: '', displayName: 'Arthur' },
  })
  const [audit, setAudit] = useState(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [memberFilter, setMemberFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [arthurInvite, setArthurInvite] = useState({
    inspecting: false,
    creating: false,
    confirmed: false,
    inspection: null,
    result: null,
    error: '',
  })

  useEffect(() => {
    setSelected((current) => {
      const next = { ...current }
      MEMBER_SLOTS.forEach((slot) => {
        if (next[slot.key]) return
        const matches = users.filter((item) => normalized(item.displayName).includes(normalized(slot.label)))
        if (matches.length === 1) next[slot.key] = matches[0].uid
      })
      return next
    })
  }, [users])

  const targetEntries = useMemo(() => MEMBER_SLOTS.map((slot) => ({
    ...slot,
    target: memberTarget(slot, selected[slot.key], manual[slot.key], users),
  })), [manual, selected, users])
  const ready = targetEntries.every((entry) => entry.target?.uid || entry.target?.email)

  async function runAudit() {
    if (!ready) return
    setRunning(true)
    setError('')
    setAudit(null)
    setArthurInvite({ inspecting: false, creating: false, confirmed: false, inspection: null, result: null, error: '' })
    try {
      const token = await user?.getIdToken?.()
      const backendDiagnostics = await fetchAuthenticationDiagnostics(targetEntries, token)
      const result = await runCrossMemberFinancialAudit(
        targetEntries,
        backendDiagnostics.identities,
        backendDiagnostics.legacyDiscovery,
      )
      setAudit(result)
      const ambiguous = Object.values(result.individual).some((item) => item.ambiguousIdentity)
      if (ambiguous) setError('Uma ou mais identidades sao ambiguas. O relatorio foi gerado, mas nenhum vinculo deve ser corrigido automaticamente.')
    } catch (err) {
      setError(err?.message || 'Nao foi possivel executar a auditoria cruzada.')
    } finally {
      setRunning(false)
    }
  }

  async function inspectArthurInvite() {
    const auditedArthur = audit?.individual?.arthur?.target
    if (auditedArthur?.uid !== ARTHUR_UID || normalized(auditedArthur?.email) !== ARTHUR_EMAIL) {
      setArthurInvite((current) => ({ ...current, error: 'A identidade auditada nao corresponde ao UID e e-mail confirmados de Arthur.' }))
      return
    }
    setArthurInvite((current) => ({ ...current, inspecting: true, confirmed: false, result: null, error: '' }))
    try {
      const inspection = await inspectWorkspaceMemberInvitation({
        workspaceId: ARTHUR_FAMILY_WORKSPACE_ID,
        targetUid: ARTHUR_UID,
        targetEmail: ARTHUR_EMAIL,
        actorUid: user?.uid,
      })
      setArthurInvite((current) => ({ ...current, inspecting: false, inspection }))
    } catch (inviteError) {
      setArthurInvite((current) => ({ ...current, inspecting: false, error: inviteError?.message || 'Nao foi possivel verificar o convite.' }))
    }
  }

  async function createArthurInvite() {
    if (!arthurInvite.confirmed || !arthurInvite.inspection?.eligible) return
    setArthurInvite((current) => ({ ...current, creating: true, error: '' }))
    try {
      const result = await createVerifiedWorkspaceMemberInvite({
        workspaceId: ARTHUR_FAMILY_WORKSPACE_ID,
        targetUid: ARTHUR_UID,
        targetEmail: ARTHUR_EMAIL,
        actorUid: user?.uid,
      })
      setArthurInvite((current) => ({ ...current, creating: false, confirmed: false, result }))
    } catch (inviteError) {
      setArthurInvite((current) => ({ ...current, creating: false, confirmed: false, error: inviteError?.message || 'Nao foi possivel criar o convite.' }))
    }
  }

  const filteredMovements = useMemo(() => {
    const movements = audit?.consolidated?.movements || []
    return movements.filter((movement) => {
      const memberMatch = memberFilter === 'all'
        || (memberFilter === 'between' ? movement.betweenSelectedMembers : movement.affectedMemberKeys.includes(memberFilter))
      if (!memberMatch) return false
      if (statusFilter === 'all') return true
      if (statusFilter === 'open') return movement.recordKind === 'debt' && Number(movement.remainingAmount || 0) > 0 && !['cancelled', 'deleted'].includes(movement.status)
      if (statusFilter === 'settled') return movement.recordKind === 'debt' && (movement.status === 'settled' || Number(movement.remainingAmount || 0) === 0)
      if (statusFilter === 'cancelled') return ['cancelled', 'canceled'].includes(movement.status)
      if (statusFilter === 'deleted') return movement.status === 'deleted' || Boolean(movement.deletedAt)
      if (statusFilter === 'duplicates') return movement.possibleDuplicate
      if (statusFilter === 'orphans') return movement.orphan
      if (statusFilter === 'inconsistent') return movement.missingFields.length > 0 || movement.technicalNotes.length > 0
      return true
    })
  }, [audit, memberFilter, statusFilter])

  return (
    <Card>
      <CardHeader title="Auditoria cruzada — Eric, Levi e Arthur" subtitle="Somente leitura: dryRun e auditOnly obrigatorios" />
      <div className="admin-audit-identities">
        {MEMBER_SLOTS.map((slot) => {
          const matches = users.filter((item) => normalized(item.displayName).includes(normalized(slot.label)))
          return (
            <div className="admin-audit-identity" key={slot.key}>
              <strong>{slot.label}</strong>
              <select value={selected[slot.key]} onChange={(event) => setSelected((current) => ({ ...current, [slot.key]: event.target.value }))}>
                <option value="">Selecione por nome, e-mail e UID</option>
                {users.map((item) => <option key={item.uid} value={item.uid}>{item.displayName} · {item.email || 'sem e-mail'} · {item.uid}</option>)}
              </select>
              {matches.length > 1 && <span className="admin-audit-warning">Ha {matches.length} perfis possiveis. Confirme e-mail e UID.</span>}
              {!selected[slot.key] && (
                <div className="admin-audit-manual">
                  <input placeholder="UID (se conhecido)" value={manual[slot.key].uid} onChange={(event) => setManual((current) => ({ ...current, [slot.key]: { ...current[slot.key], uid: event.target.value } }))} />
                  <input placeholder="E-mail exato" value={manual[slot.key].email} onChange={(event) => setManual((current) => ({ ...current, [slot.key]: { ...current[slot.key], email: event.target.value } }))} />
                </div>
              )}
            </div>
          )
        })}
      </div>
      <Button variant="secondary" onClick={runAudit} loading={running} disabled={!ready}>Executar auditoria cruzada somente leitura</Button>
      {error && <div className="admin-error-box">{error}</div>}

      {audit && (
        <>
          <MemberSummary label="Eric" audit={audit.individual.eric} diagnostic={audit.registrationDiagnostics.eric} detailed />
          <MemberSummary label="Levi" audit={audit.individual.levi} diagnostic={audit.registrationDiagnostics.levi} />
          <MemberSummary label="Arthur" audit={audit.individual.arthur} diagnostic={audit.registrationDiagnostics.arthur} />
          <ArthurDiagnostic diagnostic={audit.registrationDiagnostics.arthur} financialRecordCount={audit.individual.arthur.summary.recordsAnalyzed || 0} />
          <ArthurInvitationAction
            state={arthurInvite}
            onInspect={inspectArthurInvite}
            onConfirmChange={(confirmed) => setArthurInvite((current) => ({ ...current, confirmed }))}
            onCreate={createArthurInvite}
          />

          <div className="admin-audit-member-view">
            <h4>Auditoria cruzada — Eric, Levi e Arthur</h4>
            <div className="admin-audit-summary">
              <div><span>Total movimentado</span><strong>{formatCurrency(audit.consolidated.summary.totalMoved)}</strong></div>
              <div><span>Ainda em aberto</span><strong>{formatCurrency(audit.consolidated.summary.stillOpen)}</strong></div>
              <div><span>Quitado/compensado</span><strong>{formatCurrency(audit.consolidated.summary.settled)}</strong></div>
              <div><span>Sem vinculo confiavel</span><strong>{audit.consolidated.summary.untrustedLinks}</strong></div>
              <div><span>Duplicidades</span><strong>{audit.consolidated.summary.possibleDuplicates}</strong></div>
              <div><span>Divergencias individuais</span><strong>{audit.consolidated.summary.divergences}</strong></div>
              <div><span>Registros legados descobertos</span><strong>{audit.legacyDiscovery.recordsFound}</strong></div>
            </div>
            <div className="admin-actions">
              <Button variant="secondary" onClick={() => exportCrossFinancialAuditJson(audit)}>JSON consolidado</Button>
              <Button variant="secondary" onClick={() => exportCrossFinancialAuditCsv(audit)}>CSV consolidado</Button>
            </div>
            <div className="admin-audit-filters">
              <select value={memberFilter} onChange={(event) => setMemberFilter(event.target.value)}>
                <option value="all">Todos os membros</option><option value="eric">Eric</option><option value="levi">Levi</option><option value="arthur">Arthur</option><option value="between">Entre os tres</option>
              </select>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="all">Todos os status</option><option value="open">Abertas</option><option value="settled">Quitadas</option><option value="cancelled">Canceladas</option><option value="deleted">Excluidas</option><option value="duplicates">Duplicadas</option><option value="orphans">Orfas</option><option value="inconsistent">Inconsistentes</option>
              </select>
            </div>
            <div className="admin-audit-table-wrap">
              <table className="admin-audit-table">
                <thead><tr><th>Data</th><th>Tipo/descricao</th><th>Origem</th><th>Criado por</th><th>Credor</th><th>Devedor</th><th>Original</th><th>Principal restante</th><th>Juros</th><th>Pago/restituido</th><th>Compensado</th><th>Total com juros</th><th>Status</th><th>Afetados</th><th>Calculo</th><th>Inconsistencia</th></tr></thead>
                <tbody>
                  {filteredMovements.map((movement) => (
                    <tr key={`${movement.collection}:${movement.documentId}`}>
                      <td>{dateTime(movement.date)}</td><td><strong>{movement.operationType}</strong><br />{movement.title}</td><td>{movement.collection}<br />{movement.documentId}</td><td>{movement.createdBy || '—'}</td><td>{movement.creditor || '—'}</td><td>{movement.debtor || '—'}</td><td>{formatCurrency(movement.originalAmount)}</td><td>{formatCurrency(movement.principalRemainingAmount)}</td><td>{formatCurrency(movement.accruedInterestAmount)}</td><td>{formatCurrency(movement.restitutedAmount)}</td><td>{formatCurrency(movement.compensatedAmount)}</td><td>{movement.remainingAmount == null ? '—' : formatCurrency(movement.remainingAmount)}</td><td>{movement.status}</td><td>{movement.affectedMembers.join(', ')}</td><td>{movement.includedInCalculation ? 'Incluido' : 'Informativo'}<br />{movement.calculationJustification}</td><td>{movement.missingFields.join(', ') || movement.technicalNotes.join(' ') || (movement.possibleDuplicate ? 'Possivel duplicidade' : '—')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="admin-audit-warning">Esta tela nao oferece restauracao, ajuste, migracao, ativacao ou correcao de UID.</p>
        </>
      )}
    </Card>
  )
}
