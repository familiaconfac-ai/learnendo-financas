import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { addCard, deleteCard, fetchCards, updateCard } from '../services/cardService'

export function useCards() {
  const { user } = useAuth()
  const { activeWorkspaceId } = useWorkspace()
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    if (!user?.uid) {
      setCards([])
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const data = await fetchCards(user.uid, { workspaceId: activeWorkspaceId })
      setCards(data)
    } catch (err) {
      console.error('[useCards] Error:', err.message)
      setError(err.message)
      setCards([])
    } finally {
      setLoading(false)
    }
  }, [activeWorkspaceId, user?.uid])

  useEffect(() => { reload() }, [reload])

  async function add(data) {
    if (!user?.uid) throw new Error('Usuario nao autenticado')
    const id = await addCard(user.uid, data, { workspaceId: activeWorkspaceId })
    await reload()
    return id
  }

  async function update(cardId, data) {
    if (!user?.uid) throw new Error('Usuario nao autenticado')
    await updateCard(user.uid, cardId, data, { workspaceId: activeWorkspaceId })
    await reload()
  }

  async function remove(cardId) {
    if (!user?.uid) throw new Error('Usuario nao autenticado')
    await deleteCard(user.uid, cardId, { workspaceId: activeWorkspaceId })
    await reload()
  }

  return { cards, loading, error, reload, add, update, remove }
}
