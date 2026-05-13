import { useEffect, useMemo, useState } from 'react'
import Card, { CardHeader } from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import { useWorkspace } from '../../context/WorkspaceContext'
import { useAuth } from '../../context/AuthContext'
import './Reunioes.css'

const ROOM_FORM_DEFAULT = {
  name: '',
  description: '',
  participantMemberIds: [],
}

function defaultRoomForm() {
  return { ...ROOM_FORM_DEFAULT }
}

function buildMeetingUrl(room) {
  if (!room?.roomSlug) return ''
  return `https://meet.jit.si/${encodeURIComponent(room.roomSlug)}`
}

function formatDateTime(value) {
  if (!value) return 'Nunca aberta'
  const date = value?.toDate?.() instanceof Date ? value.toDate() : new Date(value)
  if (Number.isNaN(date.getTime())) return 'Nunca aberta'
  return date.toLocaleString('pt-BR')
}

function participantNames(room, members) {
  const fallbackNames = Array.isArray(room?.participantMemberNames) ? room.participantMemberNames : []
  const memberNameById = new Map(
    (Array.isArray(members) ? members : []).map((member) => [
      member.uid || member.id,
      member.displayName || member.name || member.email || 'Membro',
    ]),
  )

  const byIds = (Array.isArray(room?.participantMemberIds) ? room.participantMemberIds : [])
    .map((memberId) => memberNameById.get(memberId))
    .filter(Boolean)

  const names = byIds.length > 0 ? byIds : fallbackNames
  return names.length > 0 ? names : ['Sala aberta para o workspace']
}

export default function Reunioes() {
  const { user } = useAuth()
  const {
    activeWorkspace,
    activeWorkspaceId,
    members,
    meetingRooms,
    addMeetingRoom,
    editMeetingRoom,
    archiveMeetingRoom,
    markMeetingRoomOpened,
  } = useWorkspace()

  const [modalOpen, setModalOpen] = useState(false)
  const [editingRoom, setEditingRoom] = useState(null)
  const [form, setForm] = useState(defaultRoomForm())
  const [saving, setSaving] = useState(false)
  const [selectedRoomId, setSelectedRoomId] = useState('')
  const [embeddedRoomId, setEmbeddedRoomId] = useState('')
  const [feedback, setFeedback] = useState('')

  const activeRooms = useMemo(
    () => (Array.isArray(meetingRooms) ? meetingRooms : []).filter((room) => room.status !== 'archived'),
    [meetingRooms],
  )
  const archivedRooms = useMemo(
    () => (Array.isArray(meetingRooms) ? meetingRooms : []).filter((room) => room.status === 'archived'),
    [meetingRooms],
  )
  const selectedRoom = activeRooms.find((room) => room.id === selectedRoomId)
    || archivedRooms.find((room) => room.id === selectedRoomId)
    || activeRooms[0]
    || archivedRooms[0]
    || null
  const embeddedRoom = activeRooms.find((room) => room.id === embeddedRoomId) || null

  useEffect(() => {
    if (!selectedRoomId && activeRooms[0]?.id) {
      setSelectedRoomId(activeRooms[0].id)
      return
    }

    if (selectedRoomId && !meetingRooms.some((room) => room.id === selectedRoomId)) {
      setSelectedRoomId(activeRooms[0]?.id || archivedRooms[0]?.id || '')
    }
  }, [activeRooms, archivedRooms, meetingRooms, selectedRoomId])

  useEffect(() => {
    if (!feedback) return undefined
    const timeoutId = window.setTimeout(() => setFeedback(''), 2200)
    return () => window.clearTimeout(timeoutId)
  }, [feedback])

  function openCreateModal() {
    setEditingRoom(null)
    setForm(defaultRoomForm())
    setModalOpen(true)
  }

  function openEditModal(room) {
    setEditingRoom(room)
    setForm({
      name: room?.name || '',
      description: room?.description || '',
      participantMemberIds: Array.isArray(room?.participantMemberIds) ? room.participantMemberIds : [],
    })
    setModalOpen(true)
  }

  function toggleParticipant(memberId) {
    setForm((current) => {
      const alreadyIncluded = current.participantMemberIds.includes(memberId)
      return {
        ...current,
        participantMemberIds: alreadyIncluded
          ? current.participantMemberIds.filter((entry) => entry !== memberId)
          : [...current.participantMemberIds, memberId],
      }
    })
  }

  async function handleSave() {
    if (!activeWorkspaceId) {
      window.alert('Workspace nao selecionado.')
      return
    }

    const trimmedName = String(form.name || '').trim()
    if (!trimmedName) {
      window.alert('Informe o nome da sala.')
      return
    }

    const participantMemberNames = form.participantMemberIds
      .map((memberId) => members.find((member) => (member.uid || member.id) === memberId))
      .filter(Boolean)
      .map((member) => member.displayName || member.name || member.email || 'Membro')

    setSaving(true)
    try {
      const payload = {
        name: trimmedName,
        description: String(form.description || '').trim(),
        participantMemberIds: form.participantMemberIds,
        participantMemberNames,
        provider: 'jitsi',
        status: 'active',
      }

      if (editingRoom?.id) {
        await editMeetingRoom(editingRoom.id, {
          ...editingRoom,
          ...payload,
          roomSlug: editingRoom.roomSlug,
        })
        setSelectedRoomId(editingRoom.id)
      } else {
        const createdId = await addMeetingRoom(payload)
        setSelectedRoomId(createdId)
      }

      setModalOpen(false)
      setEditingRoom(null)
      setForm(defaultRoomForm())
    } catch (err) {
      window.alert(`Erro ao salvar sala: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleArchive(room) {
    const confirmed = window.confirm(`Arquivar a sala "${room.name}"?`)
    if (!confirmed) return

    try {
      await archiveMeetingRoom(room.id)
      if (embeddedRoomId === room.id) setEmbeddedRoomId('')
      if (selectedRoomId === room.id) setSelectedRoomId('')
    } catch (err) {
      window.alert(`Erro ao arquivar sala: ${err.message}`)
    }
  }

  async function handleCopyLink(room) {
    const url = buildMeetingUrl(room)
    if (!url) return

    try {
      await navigator.clipboard.writeText(url)
      setFeedback('Link copiado')
    } catch (_) {
      window.prompt('Copie o link da sala:', url)
    }
  }

  async function handleJoinEmbedded(room) {
    if (!room?.id) return
    setSelectedRoomId(room.id)
    setEmbeddedRoomId(room.id)
    await markMeetingRoomOpened(room.id)
  }

  async function handleOpenExternal(room) {
    const url = buildMeetingUrl(room)
    if (!url) return
    setSelectedRoomId(room.id)
    const popup = window.open(url, '_blank', 'noopener,noreferrer')
    await markMeetingRoomOpened(room.id)
    if (!popup) {
      window.prompt('Seu navegador bloqueou a nova guia. Copie o link da sala:', url)
    }
  }

  const workspaceName = activeWorkspace?.name || 'Workspace atual'
  const selectedRoomParticipantNames = selectedRoom ? participantNames(selectedRoom, members) : []
  const embeddedUrl = embeddedRoom ? buildMeetingUrl(embeddedRoom) : ''

  return (
    <div className="reunioes-page">
      <div className="reunioes-hero">
        <div>
          <p className="reunioes-eyebrow">Colaboracao ao vivo</p>
          <h2>Salas persistentes do workspace</h2>
          <p>
            Crie uma sala para o planejador, outra para a familia ou quantas conversas recorrentes
            voce precisar. Cada sala fica guardada aqui com link fixo para voltar depois.
          </p>
        </div>
        <div className="reunioes-hero-actions">
          <Button onClick={openCreateModal}>Nova sala</Button>
          <Button variant="secondary" onClick={() => selectedRoom && handleJoinEmbedded(selectedRoom)} disabled={!selectedRoom}>
            Entrar no app
          </Button>
        </div>
      </div>

      {feedback && <div className="reunioes-feedback">{feedback}</div>}

      <div className="reunioes-grid">
        <Card className="reunioes-sidebar">
          <CardHeader
            title="Salas"
            subtitle={`${activeRooms.length} ativa(s) em ${workspaceName}`}
            action={<Button size="sm" onClick={openCreateModal}>Criar</Button>}
          />
          <div className="reunioes-room-list">
            {activeRooms.length === 0 && (
              <div className="reunioes-empty">
                <strong>Nenhuma sala criada ainda.</strong>
                <p>Comece com uma sala do planejador ou uma sala da familia.</p>
              </div>
            )}

            {activeRooms.map((room) => {
              const roomParticipants = participantNames(room, members)
              const isSelected = selectedRoom?.id === room.id
              return (
                <button
                  key={room.id}
                  type="button"
                  className={`reunioes-room-card${isSelected ? ' active' : ''}`}
                  onClick={() => setSelectedRoomId(room.id)}
                >
                  <div className="reunioes-room-card-top">
                    <strong>{room.name}</strong>
                    <span className="reunioes-room-status">Ativa</span>
                  </div>
                  <span>{room.description || 'Sala pronta para conversa, camera e compartilhamento de tela.'}</span>
                  <span className="reunioes-room-meta">
                    {roomParticipants.join(' · ')}
                  </span>
                  <span className="reunioes-room-meta">
                    Ultimo acesso: {formatDateTime(room.lastOpenedAt)}
                  </span>
                </button>
              )
            })}

            {archivedRooms.length > 0 && (
              <div className="reunioes-archived-block">
                <p className="reunioes-archived-title">Arquivadas</p>
                {archivedRooms.map((room) => (
                  <button
                    key={room.id}
                    type="button"
                    className={`reunioes-room-card archived${selectedRoom?.id === room.id ? ' active' : ''}`}
                    onClick={() => setSelectedRoomId(room.id)}
                  >
                    <div className="reunioes-room-card-top">
                      <strong>{room.name}</strong>
                      <span className="reunioes-room-status archived">Arquivada</span>
                    </div>
                    <span>{room.description || 'Sala arquivada.'}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Card>

        <div className="reunioes-main">
          <Card>
            <CardHeader
              title={selectedRoom?.name || 'Selecione uma sala'}
              subtitle={selectedRoom?.description || 'Abra uma sala para conversar no proprio app ou em nova guia.'}
              action={selectedRoom && selectedRoom.status !== 'archived' ? (
                <div className="reunioes-card-actions">
                  <Button size="sm" variant="secondary" onClick={() => handleCopyLink(selectedRoom)}>Copiar link</Button>
                  <Button size="sm" variant="secondary" onClick={() => openEditModal(selectedRoom)}>Editar</Button>
                  <Button size="sm" variant="ghost" onClick={() => handleArchive(selectedRoom)}>Arquivar</Button>
                </div>
              ) : null}
            />

            {selectedRoom ? (
              <div className="reunioes-room-detail">
                <div className="reunioes-detail-grid">
                  <div>
                    <span className="reunioes-detail-label">Participantes sugeridos</span>
                    <div className="reunioes-chip-row">
                      {selectedRoomParticipantNames.map((name) => (
                        <span key={name} className="reunioes-chip">{name}</span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="reunioes-detail-label">Link fixo da sala</span>
                    <code className="reunioes-code">{buildMeetingUrl(selectedRoom)}</code>
                  </div>
                  <div>
                    <span className="reunioes-detail-label">Ultima abertura</span>
                    <strong>{formatDateTime(selectedRoom.lastOpenedAt)}</strong>
                  </div>
                  <div>
                    <span className="reunioes-detail-label">Recursos</span>
                    <strong>Camera, microfone e compartilhamento de tela</strong>
                  </div>
                </div>

                {selectedRoom.status !== 'archived' && (
                  <div className="reunioes-join-actions">
                    <Button onClick={() => handleJoinEmbedded(selectedRoom)}>Entrar dentro do app</Button>
                    <Button variant="secondary" onClick={() => handleOpenExternal(selectedRoom)}>Abrir em nova guia</Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="reunioes-empty">
                <strong>Escolha uma sala para continuar.</strong>
                <p>Quando voce abrir uma sala, ela aparece aqui pronta para uso.</p>
              </div>
            )}
          </Card>

          <Card className="reunioes-player-card">
            <CardHeader
              title={embeddedRoom ? `Sala ao vivo: ${embeddedRoom.name}` : 'Reuniao no app'}
              subtitle={embeddedRoom
                ? 'Se o navegador pedir permissao, libere camera, microfone e compartilhamento de tela.'
                : 'Abra uma sala para iniciar a chamada aqui dentro.'}
            />
            {embeddedUrl ? (
              <div className="reunioes-player-shell">
                <iframe
                  title={embeddedRoom?.name || 'Sala de reuniao'}
                  src={embeddedUrl}
                  className="reunioes-player-frame"
                  allow="camera; microphone; fullscreen; display-capture; clipboard-read; clipboard-write; autoplay"
                />
              </div>
            ) : (
              <div className="reunioes-empty reunioes-empty-player">
                <strong>Nenhuma sala aberta no app.</strong>
                <p>Use "Entrar dentro do app" para carregar a reuniao nesta tela.</p>
              </div>
            )}
          </Card>
        </div>
      </div>

      <Modal
        isOpen={modalOpen}
        onClose={() => !saving && setModalOpen(false)}
        title={editingRoom ? 'Editar sala' : 'Nova sala'}
        footer={(
          <Button onClick={handleSave} loading={saving}>
            {editingRoom ? 'Salvar sala' : 'Criar sala'}
          </Button>
        )}
      >
        <div className="reunioes-form">
          <label htmlFor="room-name">Nome da sala</label>
          <input
            id="room-name"
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            placeholder="Ex.: Sala com planejador"
          />

          <label htmlFor="room-description">Descricao</label>
          <textarea
            id="room-description"
            rows={3}
            value={form.description}
            onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
            placeholder="Opcional: para que essa sala sera usada"
          />

          <div className="reunioes-member-picker">
            <p className="reunioes-detail-label">Membros sugeridos para esta sala</p>
            {members.length === 0 && <p>Nenhum membro encontrado neste workspace.</p>}
            {members.map((member) => {
              const memberId = member.uid || member.id
              const checked = form.participantMemberIds.includes(memberId)
              return (
                <label key={memberId} className="reunioes-member-option">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleParticipant(memberId)}
                  />
                  <span>{member.displayName || member.name || member.email || 'Membro'}</span>
                </label>
              )
            })}
          </div>

          <p className="reunioes-form-help">
            Esta primeira versao guarda a sala no workspace e reutiliza o mesmo link sempre que voce voltar.
          </p>
        </div>
      </Modal>
    </div>
  )
}
