import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ConnectionState, Room, RoomEvent, Track } from 'livekit-client'
import { upsertFinancialPresence } from '../services/financialPresenceService'
import { requestFinancialSessionMediaCredentials } from '../services/financialSessionMediaService'

function getParticipantRole(participant, fallbackRole) {
  try {
    const parsed = JSON.parse(participant.metadata || '{}')
    if (parsed?.role === 'planner') return 'planner'
    if (parsed?.role === 'client') return 'client'
    if (parsed?.role === 'viewer') return 'viewer'
  } catch {
    return fallbackRole
  }
  return fallbackRole
}

function getParticipantName(participant) {
  return participant.name || participant.identity || 'Participante'
}

function hasTrackEnabled(participant, source) {
  return Array.from(participant.trackPublications.values()).some(
    (publication) => publication.source === source && !publication.isMuted,
  )
}

function getTrackPublication(participant, source) {
  return Array.from(participant.trackPublications.values()).find(
    (publication) => publication.source === source && publication.track && !publication.isMuted,
  )
}

function sortParticipants(a, b) {
  if (a.sessionRole !== b.sessionRole) {
    if (a.sessionRole === 'planner') return -1
    if (b.sessionRole === 'planner') return 1
    if (a.sessionRole === 'client') return -1
    if (b.sessionRole === 'client') return 1
  }

  if (a.isLocal !== b.isLocal) {
    return a.isLocal ? -1 : 1
  }

  return a.name.localeCompare(b.name)
}

async function ensureMicrophonePermission() {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('Este navegador nao suporta acesso ao microfone.')
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  stream.getTracks().forEach((track) => track.stop())
}

async function ensureCameraPermission() {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('Este navegador nao suporta acesso a camera.')
  }

  const stream = await navigator.mediaDevices.getUserMedia({ video: true })
  stream.getTracks().forEach((track) => track.stop())
}

function getMediaTransportLabel(connectionState, plannerTransport) {
  if (connectionState === ConnectionState.Connected) return 'Conectado'
  if (connectionState === ConnectionState.Connecting) return 'Conectando'
  if (connectionState === ConnectionState.Reconnecting || connectionState === ConnectionState.SignalReconnecting) {
    return 'Reconectando'
  }

  if (plannerTransport === 'connected') return 'Sala pronta'
  if (plannerTransport === 'connecting') return 'Sala iniciando'
  if (plannerTransport === 'error') return 'Erro de midia'
  return 'Nao conectado'
}

function buildFallbackRoomSnapshot(currentUserId, currentUserName) {
  return {
    state: ConnectionState.Disconnected,
    name: '',
    remoteParticipants: new Map(),
    localParticipant: {
      identity: currentUserId,
      name: currentUserName,
      isSpeaking: false,
      trackPublications: new Map(),
    },
  }
}

export function useFinancialSessionMedia({
  workspaceId,
  sessionId,
  sessionRole,
  currentUserId,
  currentUserName,
  activePanel,
  state,
  updateState,
}) {
  const [connectionState, setConnectionState] = useState(ConnectionState.Disconnected)
  const [participantMedia, setParticipantMedia] = useState([])
  const [transportError, setTransportError] = useState('')
  const [joining, setJoining] = useState(false)
  const [audioPlaybackReady, setAudioPlaybackReady] = useState(true)
  const roomRef = useRef(null)
  const audioHostRef = useRef(null)
  const videoHostRefs = useRef(new Map())
  const screenShareHostRef = useRef(null)

  const isPlanner = sessionRole === 'planner'
  const allowClientMicrophone = state.allowClientMicrophone === true
  const clientCameraMode = state.clientCameraMode || 'off'
  const localParticipant = participantMedia.find((entry) => entry.isLocal) || null
  const localMicEnabled = !!localParticipant?.micEnabled
  const localCameraEnabled = !!localParticipant?.cameraEnabled
  const localScreenShareEnabled = !!localParticipant?.screenShareEnabled
  const connected = connectionState === ConnectionState.Connected

  const visibleCameraParticipants = useMemo(
    () => participantMedia.filter((entry) => entry.cameraEnabled),
    [participantMedia],
  )
  const screenSharePresenter = useMemo(
    () => participantMedia.find((entry) => entry.screenShareEnabled) || null,
    [participantMedia],
  )

  const syncLocalPresence = useCallback(async (activeRoom) => {
    if (!workspaceId || !sessionId || !currentUserId || !activeRoom) return

    await upsertFinancialPresence(workspaceId, sessionId, currentUserId, {
      name: currentUserName,
      sessionRole,
      activePanel,
      mediaConnected: activeRoom.state === ConnectionState.Connected,
      mediaMicEnabled: hasTrackEnabled(activeRoom.localParticipant, Track.Source.Microphone),
      mediaCameraEnabled: hasTrackEnabled(activeRoom.localParticipant, Track.Source.Camera),
      mediaSpeaking: activeRoom.localParticipant.isSpeaking,
      mediaRoomName: activeRoom.name || '',
    })
  }, [activePanel, currentUserId, currentUserName, sessionId, sessionRole, workspaceId])

  const clearAudioHost = useCallback(() => {
    const host = audioHostRef.current
    if (!host) return
    host.querySelectorAll('audio').forEach((element) => {
      element.pause()
      element.srcObject = null
      element.remove()
    })
  }, [])

  const clearVideoHost = useCallback((host) => {
    if (!host) return
    host.querySelectorAll('video').forEach((element) => {
      element.pause()
      element.srcObject = null
      element.remove()
    })
  }, [])

  const clearScreenShareHost = useCallback(() => {
    const host = screenShareHostRef.current
    if (!host) return
    host.querySelectorAll('video').forEach((element) => {
      element.pause()
      element.srcObject = null
      element.remove()
    })
  }, [])

  const attachAudioTrack = useCallback((track, participant) => {
    if (!audioHostRef.current || track.kind !== Track.Kind.Audio) return

    const existing = audioHostRef.current.querySelector(`audio[data-track-sid="${track.sid}"]`)
    if (existing) {
      existing.remove()
    }

    const element = track.attach()
    element.autoplay = true
    element.muted = false
    element.dataset.trackSid = track.sid
    element.dataset.participantIdentity = participant.identity
    element.className = 'sessao-room-hidden-media'
    audioHostRef.current.appendChild(element)
    void element.play().catch(() => {})
  }, [])

  const syncVideoTiles = useCallback((activeRoom) => {
    const participants = [
      activeRoom.localParticipant,
      ...Array.from(activeRoom.remoteParticipants.values()),
    ]

    participants.forEach((participant) => {
      const host = videoHostRefs.current.get(participant.identity)
      if (!host) return

      clearVideoHost(host)

      const publication = getTrackPublication(participant, Track.Source.Camera)
      const track = publication?.track
      if (!track || track.kind !== Track.Kind.Video) return

      const element = track.attach()
      element.autoplay = true
      element.muted = true
      element.playsInline = true
      element.className = 'sessao-room-video-element'
      host.appendChild(element)
    })

    videoHostRefs.current.forEach((host, identity) => {
      if (!participants.some((participant) => participant.identity === identity)) {
        clearVideoHost(host)
      }
    })
  }, [clearVideoHost])

  const syncScreenShareHost = useCallback((activeRoom) => {
    const host = screenShareHostRef.current
    if (!host) return

    clearScreenShareHost()

    const participants = [
      activeRoom.localParticipant,
      ...Array.from(activeRoom.remoteParticipants.values()),
    ]
    const presenter = participants.find((participant) => getTrackPublication(participant, Track.Source.ScreenShare))
    const publication = presenter ? getTrackPublication(presenter, Track.Source.ScreenShare) : null
    const track = publication?.track
    if (!track || track.kind !== Track.Kind.Video) return

    const element = track.attach()
    element.autoplay = true
    element.muted = true
    element.playsInline = true
    element.className = 'sessao-room-video-element'
    host.appendChild(element)
  }, [clearScreenShareHost])

  const syncParticipants = useCallback(async (activeRoom) => {
    const nextParticipants = [
      {
        identity: activeRoom.localParticipant.identity,
        name: getParticipantName(activeRoom.localParticipant),
        sessionRole,
        isLocal: true,
        isSpeaking: activeRoom.localParticipant.isSpeaking,
        micEnabled: hasTrackEnabled(activeRoom.localParticipant, Track.Source.Microphone),
        cameraEnabled: hasTrackEnabled(activeRoom.localParticipant, Track.Source.Camera),
        screenShareEnabled: !!getTrackPublication(activeRoom.localParticipant, Track.Source.ScreenShare),
      },
      ...Array.from(activeRoom.remoteParticipants.values()).map((participant) => ({
        identity: participant.identity,
        name: getParticipantName(participant),
        sessionRole: getParticipantRole(participant, 'viewer'),
        isLocal: false,
        isSpeaking: participant.isSpeaking,
        micEnabled: hasTrackEnabled(participant, Track.Source.Microphone),
        cameraEnabled: hasTrackEnabled(participant, Track.Source.Camera),
        screenShareEnabled: !!getTrackPublication(participant, Track.Source.ScreenShare),
      })),
    ].sort(sortParticipants)

    setParticipantMedia(nextParticipants)
    syncVideoTiles(activeRoom)
    syncScreenShareHost(activeRoom)
    await syncLocalPresence(activeRoom)
  }, [sessionRole, syncLocalPresence, syncScreenShareHost, syncVideoTiles])

  const syncPlannerMediaState = useCallback(async (activeRoom) => {
    if (!isPlanner || !updateState || !activeRoom) return

    await updateState({
      mediaTransport: activeRoom.state === ConnectionState.Connected
        ? 'connected'
        : activeRoom.state === ConnectionState.Connecting
          ? 'connecting'
          : 'not_configured',
      plannerMicEnabled: hasTrackEnabled(activeRoom.localParticipant, Track.Source.Microphone),
      plannerCameraEnabled: hasTrackEnabled(activeRoom.localParticipant, Track.Source.Camera),
      plannerScreenShareEnabled: !!getTrackPublication(activeRoom.localParticipant, Track.Source.ScreenShare),
    }).catch((error) => {
      console.warn('[FinancialSessionMedia] planner media state sync failed', error)
    })
  }, [isPlanner, updateState])

  const resetDisconnectedState = useCallback(() => {
    setConnectionState(ConnectionState.Disconnected)
    setParticipantMedia([])
    setAudioPlaybackReady(true)
    clearAudioHost()
    clearScreenShareHost()
    videoHostRefs.current.forEach((host) => clearVideoHost(host))
  }, [clearAudioHost, clearScreenShareHost, clearVideoHost])

  const disconnectRoom = useCallback(async () => {
    const activeRoom = roomRef.current
    if (!activeRoom) return

    try {
      await activeRoom.localParticipant.setMicrophoneEnabled(false)
    } catch {}

    try {
      await activeRoom.localParticipant.setCameraEnabled(false)
    } catch {}

    try {
      await activeRoom.localParticipant.setScreenShareEnabled(false)
    } catch {}

    activeRoom.disconnect()
    roomRef.current = null
    resetDisconnectedState()

    await syncLocalPresence(buildFallbackRoomSnapshot(currentUserId, currentUserName))

    if (isPlanner) {
      await updateState({
        mediaTransport: 'not_configured',
        plannerMicEnabled: false,
        plannerCameraEnabled: false,
        plannerScreenShareEnabled: false,
      }).catch((error) => {
        console.warn('[FinancialSessionMedia] planner disconnect sync failed', error)
      })
    }
  }, [currentUserId, currentUserName, isPlanner, resetDisconnectedState, syncLocalPresence, updateState])

  const joinMedia = useCallback(async () => {
    if (roomRef.current && roomRef.current.state !== ConnectionState.Disconnected) {
      return roomRef.current
    }

    setJoining(true)
    setTransportError('')
    setConnectionState(ConnectionState.Connecting)

    try {
      const credentials = await requestFinancialSessionMediaCredentials({
        workspaceId,
        sessionId,
        userName: currentUserName,
      })

      const nextRoom = new Room({
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })

      nextRoom.on(RoomEvent.ConnectionStateChanged, (nextState) => {
        setConnectionState(nextState)
        void syncParticipants(nextRoom)
        void syncPlannerMediaState(nextRoom)
      })
      nextRoom.on(RoomEvent.ParticipantConnected, () => void syncParticipants(nextRoom))
      nextRoom.on(RoomEvent.ParticipantDisconnected, () => void syncParticipants(nextRoom))
      nextRoom.on(RoomEvent.ActiveSpeakersChanged, () => void syncParticipants(nextRoom))
      nextRoom.on(RoomEvent.LocalTrackPublished, () => {
        void syncParticipants(nextRoom)
        void syncPlannerMediaState(nextRoom)
      })
      nextRoom.on(RoomEvent.LocalTrackUnpublished, () => {
        void syncParticipants(nextRoom)
        void syncPlannerMediaState(nextRoom)
      })
      nextRoom.on(RoomEvent.TrackMuted, () => {
        void syncParticipants(nextRoom)
        void syncPlannerMediaState(nextRoom)
      })
      nextRoom.on(RoomEvent.TrackUnmuted, () => {
        void syncParticipants(nextRoom)
        void syncPlannerMediaState(nextRoom)
      })
      nextRoom.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
        if (track.kind === Track.Kind.Audio) {
          attachAudioTrack(track, participant)
        }
        void syncParticipants(nextRoom)
      })
      nextRoom.on(RoomEvent.TrackUnsubscribed, () => void syncParticipants(nextRoom))
      nextRoom.on(RoomEvent.AudioPlaybackStatusChanged, () => {
        setAudioPlaybackReady(nextRoom.canPlaybackAudio)
      })
      nextRoom.on(RoomEvent.MediaDevicesError, () => {
        setTransportError('Nao foi possivel acessar microfone, camera ou compartilhamento de tela. Verifique a permissao do navegador.')
      })
      nextRoom.on(RoomEvent.Disconnected, () => {
        roomRef.current = null
        resetDisconnectedState()
      })

      await nextRoom.connect(credentials.wsUrl, credentials.token)
      await nextRoom.startAudio()
      setAudioPlaybackReady(nextRoom.canPlaybackAudio)

      Array.from(nextRoom.remoteParticipants.values()).forEach((participant) => {
        Array.from(participant.trackPublications.values()).forEach((publication) => {
          if (publication.track && publication.track.kind === Track.Kind.Audio) {
            attachAudioTrack(publication.track, participant)
          }
        })
      })

      roomRef.current = nextRoom
      await syncParticipants(nextRoom)
      await syncPlannerMediaState(nextRoom)
      return nextRoom
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Nao foi possivel entrar no audio e camera.'
      setTransportError(message)
      setConnectionState(ConnectionState.Disconnected)

      if (isPlanner) {
        await updateState({
          mediaTransport: 'error',
          plannerMicEnabled: false,
          plannerCameraEnabled: false,
          plannerScreenShareEnabled: false,
        }).catch(() => {})
      }

      throw error
    } finally {
      setJoining(false)
    }
  }, [attachAudioTrack, currentUserName, isPlanner, sessionId, syncParticipants, syncPlannerMediaState, updateState, workspaceId])

  const resumeAudioPlayback = useCallback(async () => {
    const activeRoom = roomRef.current
    if (!activeRoom) return
    await activeRoom.startAudio()
    setAudioPlaybackReady(activeRoom.canPlaybackAudio)
  }, [])

  const setVideoHostRef = useCallback((identity, node) => {
    const refs = videoHostRefs.current
    if (node) {
      refs.set(identity, node)
      if (roomRef.current) {
        syncVideoTiles(roomRef.current)
      }
      return
    }

    const existing = refs.get(identity)
    if (existing) {
      clearVideoHost(existing)
    }
    refs.delete(identity)
  }, [clearVideoHost, syncVideoTiles])

  const setScreenShareHostRef = useCallback((node) => {
    if (!node) {
      clearScreenShareHost()
      screenShareHostRef.current = null
      return
    }

    screenShareHostRef.current = node
    if (roomRef.current) {
      syncScreenShareHost(roomRef.current)
    }
  }, [clearScreenShareHost, syncScreenShareHost])

  const toggleMicrophone = useCallback(async () => {
    if (!isPlanner && !allowClientMicrophone) {
      setTransportError('O planejador ainda nao liberou o microfone do cliente nesta sessao.')
      return
    }

    const activeRoom = await joinMedia()
    const nextEnabled = !hasTrackEnabled(activeRoom.localParticipant, Track.Source.Microphone)

    if (nextEnabled) {
      await ensureMicrophonePermission()
    }

    await activeRoom.localParticipant.setMicrophoneEnabled(nextEnabled)
    setTransportError('')

    if (!isPlanner && clientCameraMode === 'follow_mic') {
      await activeRoom.localParticipant.setCameraEnabled(nextEnabled, nextEnabled ? { facingMode: 'user' } : undefined)
    }

    await syncParticipants(activeRoom)
    await syncPlannerMediaState(activeRoom)
  }, [allowClientMicrophone, clientCameraMode, isPlanner, joinMedia, syncParticipants, syncPlannerMediaState])

  const toggleCamera = useCallback(async () => {
    if (!isPlanner) {
      if (clientCameraMode === 'off') {
        setTransportError('O planejador deixou a camera do cliente desativada nesta sessao.')
        return
      }

      if (clientCameraMode === 'follow_mic') {
        setTransportError('Nesta sessao, a camera do cliente acompanha o microfone.')
        return
      }

      if (clientCameraMode === 'required' && localCameraEnabled) {
        setTransportError('Nesta sessao, a camera do cliente precisa continuar ligada.')
        return
      }
    }

    const activeRoom = await joinMedia()
    const nextEnabled = !hasTrackEnabled(activeRoom.localParticipant, Track.Source.Camera)

    if (nextEnabled) {
      await ensureCameraPermission()
    }

    await activeRoom.localParticipant.setCameraEnabled(
      nextEnabled,
      nextEnabled ? { facingMode: 'user' } : undefined,
    )

    setTransportError('')
    await syncParticipants(activeRoom)
    await syncPlannerMediaState(activeRoom)
  }, [clientCameraMode, isPlanner, joinMedia, localCameraEnabled, syncParticipants, syncPlannerMediaState])

  const toggleScreenShare = useCallback(async () => {
    const activeRoom = await joinMedia()
    const nextEnabled = !Boolean(getTrackPublication(activeRoom.localParticipant, Track.Source.ScreenShare))

    await activeRoom.localParticipant.setScreenShareEnabled(nextEnabled, nextEnabled ? {
      audio: true,
      selfBrowserSurface: 'include',
    } : undefined)

    setTransportError('')
    await syncParticipants(activeRoom)
    await syncPlannerMediaState(activeRoom)
  }, [joinMedia, syncParticipants, syncPlannerMediaState])

  useEffect(() => {
    if (isPlanner || !roomRef.current || connectionState !== ConnectionState.Connected) return

    const activeRoom = roomRef.current

    if (!allowClientMicrophone && localMicEnabled) {
      void activeRoom.localParticipant.setMicrophoneEnabled(false)
        .then(() => syncParticipants(activeRoom))
        .catch(() => {})
    }

    if (clientCameraMode === 'off' && localCameraEnabled) {
      void activeRoom.localParticipant.setCameraEnabled(false)
        .then(() => syncParticipants(activeRoom))
        .catch(() => {})
    }

    if (clientCameraMode === 'required' && !localCameraEnabled) {
      void ensureCameraPermission()
        .then(() => activeRoom.localParticipant.setCameraEnabled(true, { facingMode: 'user' }))
        .then(() => syncParticipants(activeRoom))
        .catch((error) => {
          setTransportError(error instanceof Error ? error.message : 'Nao foi possivel ligar a camera obrigatoria.')
        })
    }
  }, [allowClientMicrophone, clientCameraMode, connectionState, isPlanner, localCameraEnabled, localMicEnabled, syncParticipants])

  useEffect(() => {
    return () => {
      void disconnectRoom()
    }
  }, [disconnectRoom])

  const transportLabel = getMediaTransportLabel(connectionState, state.mediaTransport)

  return {
    audioHostRef,
    setVideoHostRef,
    setScreenShareHostRef,
    connectionState,
    transportLabel,
    transportError,
    joining,
    connected,
    audioPlaybackReady,
    localMicEnabled,
    localCameraEnabled,
    localScreenShareEnabled,
    participantMedia,
    visibleCameraParticipants,
    screenSharePresenter,
    allowClientMicrophone,
    clientCameraMode,
    joinMedia,
    leaveMedia: disconnectRoom,
    resumeAudioPlayback,
    toggleMicrophone,
    toggleCamera,
    toggleScreenShare,
  }
}
