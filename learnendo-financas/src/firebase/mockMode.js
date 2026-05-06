const REQUIRED_FIREBASE_ENV_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
]

const PLACEHOLDER_VALUES = new Set([
  '',
  'sua_api_key_aqui',
  'seu_auth_domain_aqui',
  'seu_project_id_aqui',
  'seu_storage_bucket_aqui',
  'seu_messaging_sender_id_aqui',
  'seu_app_id_aqui',
])

export const FIREBASE_MISSING_ENV_KEYS = REQUIRED_FIREBASE_ENV_KEYS.filter((key) => {
  const value = String(import.meta.env[key] || '').trim()
  return !value || PLACEHOLDER_VALUES.has(value)
})

/**
 * MOCK MODE
 * Ativado automaticamente quando qualquer configuração essencial do Firebase
 * está ausente ou ainda contém valor placeholder.
 */
export const IS_MOCK_MODE = FIREBASE_MISSING_ENV_KEYS.length > 0

if (IS_MOCK_MODE) {
  console.warn(
    '%c[Learnendo Finanças] 🟡 Mock Mode ativo — Firebase não configurado.' +
      ` Variáveis ausentes: ${FIREBASE_MISSING_ENV_KEYS.join(', ')}.`,
    'color: #d97706; font-weight: bold; font-size: 12px'
  )
}

/** Usuário fictício para desenvolvimento local */
export const MOCK_USER = {
  uid: 'u1',
  email: 'marcio@martins.com',
  displayName: 'Márcio Martins',
}

/** Perfil Firestore fictício — role "admin" + family owner */
export const MOCK_PROFILE = {
  uid: 'u1',
  email: 'marcio@martins.com',
  displayName: 'Márcio Martins',
  role: 'admin',       // owner mapeia para admin no AuthContext
  familyId: 'fam1',
  familyRole: 'owner',
}
