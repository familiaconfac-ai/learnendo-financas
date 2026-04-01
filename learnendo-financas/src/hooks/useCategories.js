import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { fetchCategories, addCategory, deleteCategory, updateCategory } from '../services/categoryService'
import { MOCK_CATEGORIES } from '../utils/mockData'

/**
 * Hook para categorias do usuário.
 * Lê do Firestore; se vazio, usa os defaults locais como fallback visual
 * (não persiste os defaults — o usuário cria as suas próprias no app).
 */
export function useCategories() {
  const { user } = useAuth()
  const { activeWorkspaceId, permissions } = useWorkspace()
  const [categories, setCategories] = useState([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)

  const reload = useCallback(async () => {
    if (!user?.uid) { setCategories([]); setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      const data = await fetchCategories(user.uid, { workspaceId: activeWorkspaceId })
      if (data.length === 0) {
        // Nenhuma categoria no Firestore — usa lista padrão como referência visual
        console.log('[useCategories] Nenhuma categoria cadastrada — usando defaults visuais')
        setCategories(MOCK_CATEGORIES)
      } else {
        setCategories(data)
      }
    } catch (err) {
      console.error('[useCategories] Error:', err.message)
      setError(err.message)
      setCategories(MOCK_CATEGORIES)  // fallback seguro
    } finally {
      setLoading(false)
    }
  }, [user?.uid, activeWorkspaceId])

  useEffect(() => { reload() }, [reload])

  async function add(data) {
    if (!user?.uid) throw new Error('Usuário não autenticado')
    if (!permissions.canCreateGlobalCategories) {
      throw new Error('Seu papel não permite criar categorias globais neste workspace')
    }
    const id = await addCategory(user.uid, { ...data, workspaceId: activeWorkspaceId }, { workspaceId: activeWorkspaceId })
    await reload()
    return id
  }

  async function remove(catId) {
    if (!user?.uid) throw new Error('Usuário não autenticado')
    if (!permissions.canCreateGlobalCategories) {
      throw new Error('Seu papel não permite remover categorias globais neste workspace')
    }
    await deleteCategory(user.uid, catId, { workspaceId: activeWorkspaceId })
    await reload()
  }

  async function update(catId, data) {
    if (!user?.uid) throw new Error('Usuário não autenticado')
    if (!permissions.canCreateGlobalCategories) {
      throw new Error('Seu papel não permite editar categorias neste workspace')
    }
    await updateCategory(user.uid, catId, { ...data, workspaceId: activeWorkspaceId }, { workspaceId: activeWorkspaceId })
    await reload()
  }

  return { categories, loading, error, reload, add, update, remove }
}
