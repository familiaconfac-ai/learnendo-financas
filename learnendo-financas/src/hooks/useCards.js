import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { addCard, deleteCard, fetchCards, updateCard } from '../services/cardService'

export function useCards() {
  const { user } = useAuth()
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
      const data = await fetchCards(user.uid)
      setCards(data)
    } catch (err) {
      console.error('[useCards] Error:', err.message)
      setError(err.message)
      setCards([])
    } finally {
      setLoading(false)
    }
  }, [user?.uid])

  useEffect(() => { reload() }, [reload])

  async function add(data) {
    if (!user?.uid) throw new Error('Usuário não autenticado')
    const id = await addCard(user.uid, data)
    await reload()
    return id
  }

  async function update(cardId, data) {
    if (!user?.uid) throw new Error('Usuário não autenticado')
    await updateCard(user.uid, cardId, data)
    await reload()
  }

  async function remove(cardId) {
    if (!user?.uid) throw new Error('Usuário não autenticado')
    await deleteCard(user.uid, cardId)
    await reload()
  }

  return { cards, loading, error, reload, add, update, remove }
}
