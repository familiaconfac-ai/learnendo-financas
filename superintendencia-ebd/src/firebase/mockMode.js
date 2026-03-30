/**
 * MOCK MODE
 * Ativado automaticamente quando VITE_FIREBASE_API_KEY não está definida
 * ou ainda contém o valor-exemplo do .env.example.
 *
 * Nesse modo o app roda 100% local com dados mockados, sem nenhuma
 * chamada ao Firebase. Para sair do mock mode, configure o .env real.
 */
export const IS_MOCK_MODE =
  !import.meta.env.VITE_FIREBASE_API_KEY ||
  import.meta.env.VITE_FIREBASE_API_KEY === 'sua_api_key_aqui'

if (IS_MOCK_MODE) {
  console.warn(
    '%c[Superintendência EBD] 🟡 Mock Mode ativo — Firebase não configurado.' +
      ' Configure o .env para conectar ao backend real.',
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
