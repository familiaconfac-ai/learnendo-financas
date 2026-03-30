// ──────────────────────────────────────────────────────────────────────────────
// Mock data – domínio financeiro completo (sem dependência de Firebase)
//
// Transaction.type:   'income' | 'expense' | 'transfer_internal' | 'transfer' |
//                     'investment' | 'credit_card_payment' | 'adjustment'
// transfer_internal = neutral move between own accounts (no balance impact)
// transfer          = legacy/imported 3rd-party transfer (counted as expense if balanceImpact=true)
// Transaction.origin: 'manual' | 'bank_import' | 'credit_card_import'
// Transaction.status: 'confirmed' | 'pending' | 'needs_review'
//
// FamilyRole: 'owner' | 'admin' | 'member' | 'viewer'
//   owner  – criou a família, controle total
//   admin  – pode editar dados e gerenciar membros
//   member – pode lançar e editar os próprios dados
//   viewer – apenas visualiza o consolidado familiar
// ──────────────────────────────────────────────────────────────────────────────

// ── Família ───────────────────────────────────────────────────────────────────
export const MOCK_FAMILY = {
  id: 'fam1',
  name: 'Família Martins',
  createdAt: '2026-01-01',
  plan: 'family',           // 'personal' | 'family' | 'pro' (futuro: plano profissional)
  ownerUid: 'u1',
}

// ── Membros da família ────────────────────────────────────────────────────────
// FamilyRole: owner > admin > member > viewer
export const MOCK_FAMILY_MEMBERS = [
  {
    uid: 'u1',
    displayName: 'Márcio Martins',
    email: 'marcio@martins.com',
    avatarInitial: 'M',
    role: 'owner',          // dono da família, controle total
    canEdit: true,
    canViewAll: true,
    joinedAt: '2026-01-01',
    monthlyReceitas: 8850,
    monthlyDespesas: 3317.20,
  },
  {
    uid: 'u2',
    displayName: 'Carla Martins',
    email: 'carla@martins.com',
    avatarInitial: 'C',
    role: 'admin',          // esposa, co-gestora
    canEdit: true,
    canViewAll: true,
    joinedAt: '2026-01-01',
    monthlyReceitas: 5200,
    monthlyDespesas: 3800,
  },
  {
    uid: 'u3',
    displayName: 'Beatriz Martins',
    email: 'bia@martins.com',
    avatarInitial: 'B',
    role: 'member',         // filha, pode lançar os próprios gastos
    canEdit: true,
    canViewAll: false,
    joinedAt: '2026-02-10',
    monthlyReceitas: 1200,
    monthlyDespesas: 980,
  },
  {
    uid: 'u4',
    displayName: 'Avô João',
    email: 'joao@martins.com',
    avatarInitial: 'J',
    role: 'viewer',         // apenas visualiza o consolidado
    canEdit: false,
    canViewAll: true,
    joinedAt: '2026-03-01',
    monthlyReceitas: 3200,
    monthlyDespesas: 2100,
  },
]

// ── Convites pendentes ────────────────────────────────────────────────────────
export const MOCK_FAMILY_INVITATIONS = [
  {
    id: 'inv1',
    familyId: 'fam1',
    email: 'tio.rodrigo@email.com',
    role: 'viewer',
    status: 'pending',      // 'pending' | 'accepted' | 'declined' | 'expired'
    sentAt: '2026-03-25',
    expiresAt: '2026-04-01',
    sentBy: 'u1',
  },
]

// ── Resumo consolidado familiar ───────────────────────────────────────────────
export const MOCK_FAMILY_SUMMARY = {
  familyId: 'fam1',
  month: '2026-03',
  totalReceitas:    MOCK_FAMILY_MEMBERS.reduce((s, m) => s + m.monthlyReceitas, 0),
  totalDespesas:    MOCK_FAMILY_MEMBERS.reduce((s, m) => s + m.monthlyDespesas, 0),
  totalInvestido:   1200,
  totalSaldo() { return this.totalReceitas - this.totalDespesas - this.totalInvestido },
}

// ── Contas bancárias ──────────────────────────────────────────────────────────
export const MOCK_ACCOUNTS = [
  {
    id: 'acc1', name: 'Conta Corrente Itaú', bank: 'Itaú',
    type: 'checking', balance: 4820.45, initialBalance: 3000.00,
    color: '#1a56db', icon: '🏦',
  },
  {
    id: 'acc2', name: 'Conta Poupança Caixa', bank: 'Caixa',
    type: 'savings', balance: 12300.00, initialBalance: 10000.00,
    color: '#16a34a', icon: '🐷',
  },
]

// ── Cartões de crédito ────────────────────────────────────────────────────────
export const MOCK_CARDS = [
  {
    id: 'card1', name: 'Nubank Mastercard', flag: 'mastercard',
    limit: 8000.00, usedLimit: 2435.90, closingDay: 15, dueDay: 22,
    currentInvoice: 2435.90, color: '#8b5cf6', icon: '💳',
  },
  {
    id: 'card2', name: 'Bradesco Visa', flag: 'visa',
    limit: 5000.00, usedLimit: 880.00, closingDay: 10, dueDay: 18,
    currentInvoice: 880.00, color: '#dc2626', icon: '💳',
  },
]

// ── Categorias ────────────────────────────────────────────────────────────────
export const MOCK_CATEGORIES = [
  {
    id: 'cat1', name: 'Moradia', icon: '🏠', type: 'expense',
    subcategories: [
      { id: 'sub1', name: 'Aluguel' }, { id: 'sub2', name: 'Condomínio' },
      { id: 'sub3', name: 'Luz / Água / Gás' }, { id: 'sub4', name: 'Internet / TV' },
    ],
  },
  {
    id: 'cat2', name: 'Alimentação', icon: '🍽️', type: 'expense',
    subcategories: [
      { id: 'sub5', name: 'Supermercado' }, { id: 'sub6', name: 'Restaurante' },
      { id: 'sub7', name: 'Delivery' },
    ],
  },
  {
    id: 'cat3', name: 'Transporte', icon: '🚗', type: 'expense',
    subcategories: [
      { id: 'sub8', name: 'Combustível' }, { id: 'sub9', name: 'Estacionamento' },
      { id: 'sub10', name: 'Uber / Táxi' },
    ],
  },
  {
    id: 'cat4', name: 'Saúde', icon: '❤️', type: 'expense',
    subcategories: [
      { id: 'sub11', name: 'Plano de Saúde' }, { id: 'sub12', name: 'Farmácia' },
      { id: 'sub13', name: 'Consulta' },
    ],
  },
  {
    id: 'cat5', name: 'Lazer', icon: '🎭', type: 'expense',
    subcategories: [
      { id: 'sub14', name: 'Streaming' }, { id: 'sub15', name: 'Cinema / Show' },
      { id: 'sub16', name: 'Viagem' },
    ],
  },
  {
    id: 'cat6', name: 'Renda', icon: '📈', type: 'income',
    subcategories: [
      { id: 'sub17', name: 'Salário' }, { id: 'sub18', name: 'Freelance' },
      { id: 'sub19', name: 'Aluguel Recebido' },
    ],
  },
  {
    id: 'cat7', name: 'Investimentos', icon: '📊', type: 'investment',
    subcategories: [
      { id: 'sub20', name: 'Renda Fixa' }, { id: 'sub21', name: 'Renda Variável' },
      { id: 'sub22', name: 'Tesouro Direto' },
    ],
  },
]

// ── Transações (modelo completo) ──────────────────────────────────────────────
export const MOCK_TRANSACTIONS = [
  // Março – conta corrente
  { id: 't1',  date: '2026-03-05', competencyMonth: '2026-03', description: 'Salário',                  amount: 6500,   type: 'income',     origin: 'bank_import',        accountId: 'acc1', cardId: null,   categoryId: 'cat6', subcategoryId: 'sub17', status: 'confirmed',    notes: '',                               balanceImpact: true  },
  { id: 't2',  date: '2026-03-10', competencyMonth: '2026-03', description: 'Freelance – Projeto XYZ',  amount: 2000,   type: 'income',     origin: 'manual',             accountId: 'acc1', cardId: null,   categoryId: 'cat6', subcategoryId: 'sub18', status: 'confirmed',    notes: 'Pagamento parcial',              balanceImpact: true  },
  { id: 't3',  date: '2026-03-01', competencyMonth: '2026-03', description: 'Aluguel',                  amount: 1800,   type: 'expense',    origin: 'manual',             accountId: 'acc1', cardId: null,   categoryId: 'cat1', subcategoryId: 'sub1',  status: 'confirmed',    notes: '',                               balanceImpact: true  },
  { id: 't4',  date: '2026-03-05', competencyMonth: '2026-03', description: 'Boleto Luz',               amount: 145.30, type: 'expense',    origin: 'bank_import',        accountId: 'acc1', cardId: null,   categoryId: 'cat1', subcategoryId: 'sub3',  status: 'confirmed',    notes: '',                               balanceImpact: true  },
  { id: 't5',  date: '2026-03-12', competencyMonth: '2026-03', description: 'Posto Ipiranga',           amount: 280,    type: 'expense',    origin: 'bank_import',        accountId: 'acc1', cardId: null,   categoryId: 'cat3', subcategoryId: 'sub8',  status: 'needs_review', notes: 'Verificar valor',                balanceImpact: true  },
  { id: 't6',  date: '2026-03-15', competencyMonth: '2026-03', description: 'TED para poupança',        amount: 1000,   type: 'transfer',   origin: 'manual',             accountId: 'acc1', cardId: null,   categoryId: null,   subcategoryId: null,    status: 'confirmed',    notes: 'Reserva de emergência',          balanceImpact: true  },
  // Março – cartão Nubank
  { id: 't7',  date: '2026-03-07', competencyMonth: '2026-03', description: 'Pão de Açúcar',            amount: 680,    type: 'expense',    origin: 'credit_card_import', accountId: null,   cardId: 'card1', categoryId: 'cat2', subcategoryId: 'sub5',  status: 'confirmed',    notes: '',                               balanceImpact: false },
  { id: 't8',  date: '2026-03-08', competencyMonth: '2026-03', description: 'Netflix',                  amount: 59.90,  type: 'expense',    origin: 'credit_card_import', accountId: null,   cardId: 'card1', categoryId: 'cat5', subcategoryId: 'sub14', status: 'confirmed',    notes: '',                               balanceImpact: false },
  { id: 't9',  date: '2026-03-11', competencyMonth: '2026-03', description: 'Uber',                     amount: 35.70,  type: 'expense',    origin: 'credit_card_import', accountId: null,   cardId: 'card1', categoryId: 'cat3', subcategoryId: 'sub10', status: 'needs_review', notes: 'Categoria a confirmar',          balanceImpact: false },
  { id: 't10', date: '2026-03-14', competencyMonth: '2026-03', description: 'Farmácia Drogasil',        amount: 127.50, type: 'expense',    origin: 'credit_card_import', accountId: null,   cardId: 'card1', categoryId: 'cat4', subcategoryId: 'sub12', status: 'confirmed',    notes: '',                               balanceImpact: false },
  { id: 't11', date: '2026-03-20', competencyMonth: '2026-03', description: 'Restaurante Madero',       amount: 189.80, type: 'expense',    origin: 'credit_card_import', accountId: null,   cardId: 'card1', categoryId: 'cat2', subcategoryId: 'sub6',  status: 'needs_review', notes: '',                               balanceImpact: false },
  // Março – investimentos
  { id: 't12', date: '2026-03-05', competencyMonth: '2026-03', description: 'CDB Itaú',                 amount: 800,    type: 'investment', origin: 'manual',             accountId: 'acc1', cardId: null,   categoryId: 'cat7', subcategoryId: 'sub20', status: 'confirmed',    notes: '',                               balanceImpact: true  },
  { id: 't13', date: '2026-03-15', competencyMonth: '2026-03', description: 'Tesouro IPCA+ 2035',       amount: 400,    type: 'investment', origin: 'manual',             accountId: 'acc1', cardId: null,   categoryId: 'cat7', subcategoryId: 'sub22', status: 'confirmed',    notes: '',                               balanceImpact: true  },
  // Março – pendente
  { id: 't16', date: '2026-03-22', competencyMonth: '2026-03', description: 'PIX recebido',             amount: 350,    type: 'income',     origin: 'bank_import',        accountId: 'acc1', cardId: null,   categoryId: null,   subcategoryId: null,    status: 'pending',      notes: 'Aguardando confirmação de origem', balanceImpact: true },
  // Fevereiro
  { id: 't14', date: '2026-02-05', competencyMonth: '2026-02', description: 'Salário',                  amount: 6500,   type: 'income',     origin: 'bank_import',        accountId: 'acc1', cardId: null,   categoryId: 'cat6', subcategoryId: 'sub17', status: 'confirmed',    notes: '',                               balanceImpact: true  },
  { id: 't15', date: '2026-02-01', competencyMonth: '2026-02', description: 'Aluguel',                  amount: 1800,   type: 'expense',    origin: 'manual',             accountId: 'acc1', cardId: null,   categoryId: 'cat1', subcategoryId: 'sub1',  status: 'confirmed',    notes: '',                               balanceImpact: true  },
]

// ── Orçamento ─────────────────────────────────────────────────────────────────
export const MOCK_BUDGET = {
  totalBudgeted: 6000,
  totalSpent: 3317.20,
  categories: [
    {
      id: 'cat1', name: 'Moradia', icon: '🏠', budgeted: 2100, spent: 1945.30,
      subcategories: [
        { id: 'sub1', name: 'Aluguel',      budgeted: 1800, spent: 1800 },
        { id: 'sub3', name: 'Luz/Água/Gás', budgeted: 300,  spent: 145.30 },
      ],
    },
    {
      id: 'cat2', name: 'Alimentação', icon: '🍽️', budgeted: 900, spent: 869.80,
      subcategories: [
        { id: 'sub5', name: 'Supermercado', budgeted: 700, spent: 680 },
        { id: 'sub6', name: 'Restaurante',  budgeted: 200, spent: 189.80 },
      ],
    },
    {
      id: 'cat3', name: 'Transporte', icon: '🚗', budgeted: 400, spent: 315.70,
      subcategories: [
        { id: 'sub8',  name: 'Combustível', budgeted: 300, spent: 280 },
        { id: 'sub10', name: 'Uber / Táxi', budgeted: 100, spent: 35.70 },
      ],
    },
    {
      id: 'cat4', name: 'Saúde', icon: '❤️', budgeted: 300, spent: 127.50,
      subcategories: [
        { id: 'sub12', name: 'Farmácia',        budgeted: 150, spent: 127.50 },
        { id: 'sub11', name: 'Plano de Saúde',  budgeted: 150, spent: 0 },
      ],
    },
    {
      id: 'cat5', name: 'Lazer', icon: '🎭', budgeted: 300, spent: 59.90,
      subcategories: [
        { id: 'sub14', name: 'Streaming',     budgeted: 100, spent: 59.90 },
        { id: 'sub15', name: 'Cinema / Show', budgeted: 200, spent: 0 },
      ],
    },
  ],
}

// ── Resumo do mês ──────────────────────────────────────────────────────────────
export const MOCK_SUMMARY = {
  scope: 'personal',   // 'personal' | 'family' — indica de quem é o resumo
  ownerName: 'Márcio',
  receitas: 8850,
  despesas: 3317.20,
  cartao: 1093.90,
  investimentos: 1200,
  transferencias: 1000,
  saldo: 3332.80,
  orcado: 6000,
  pendingCount: 3,
  reconciled: false,
  reconciliationDiff: -1512.35,
  recentTransactions: MOCK_TRANSACTIONS.filter(t => t.competencyMonth === '2026-03').slice(0, 6),
}

// ── Importações ───────────────────────────────────────────────────────────────
export const MOCK_IMPORTS = [
  {
    id: 'imp1', fileName: 'extrato-itau-mar2026.pdf', type: 'bank',
    accountId: 'acc1', cardId: null,
    importedAt: '2026-03-20T10:32:00', status: 'processed',
    itemCount: 12, reviewCount: 2,
    items: [
      { id: 'ii1', date: '2026-03-05', description: 'SALARIO EMPRESA',     amount: 6500,   type: 'income',  status: 'confirmed'    },
      { id: 'ii2', date: '2026-03-05', description: 'BOLETO LUZ',          amount: 145.30, type: 'expense', status: 'confirmed'    },
      { id: 'ii3', date: '2026-03-12', description: 'POSTO IPIRANGA',      amount: 280,    type: 'expense', status: 'needs_review' },
      { id: 'ii4', date: '2026-03-15', description: 'TED TRANSFERENCIA',   amount: 1000,   type: 'transfer', status: 'confirmed'   },
      { id: 'ii5', date: '2026-03-22', description: 'PIX RECEBIDO 350,00', amount: 350,    type: 'income',  status: 'needs_review' },
    ],
  },
  {
    id: 'imp2', fileName: 'fatura-nubank-mar2026.pdf', type: 'credit_card',
    accountId: null, cardId: 'card1',
    importedAt: '2026-03-18T14:15:00', status: 'needs_review',
    itemCount: 8, reviewCount: 3,
    items: [
      { id: 'ii6',  date: '2026-03-07', description: 'PAO DE ACUCAR',       amount: 680,    type: 'expense', status: 'confirmed'    },
      { id: 'ii7',  date: '2026-03-08', description: 'NETFLIX.COM',         amount: 59.90,  type: 'expense', status: 'confirmed'    },
      { id: 'ii8',  date: '2026-03-11', description: 'UBER *VIAGEM',        amount: 35.70,  type: 'expense', status: 'needs_review' },
      { id: 'ii9',  date: '2026-03-14', description: 'DROGASIL',            amount: 127.50, type: 'expense', status: 'confirmed'    },
      { id: 'ii10', date: '2026-03-20', description: 'MADERO RESTAURANTE',  amount: 189.80, type: 'expense', status: 'needs_review' },
    ],
  },
]

// ── Reconciliação ─────────────────────────────────────────────────────────────
export const MOCK_RECONCILIATION = {
  accountId: 'acc1',
  month: '2026-03',
  openingBalance: 3000.00,
  totalIncome: 8850,
  totalExpenses: 3317.20,
  totalInvestments: 1200,
  totalTransfers: 1000,
  expectedClosingBalance: 6332.80,
  informedClosingBalance: 4820.45,
  difference: -1512.35,
  pendingItems: 3,
  divergenceReason: 'Existem 3 lançamentos não confirmados que podem explicar a diferença.',
}

// ── Admin (mantido para compatibilidade de código interno) ───────────────────
// Na interface esse dado é exibido como membros da família, não como "admin"
export const MOCK_ADMIN_USERS = MOCK_FAMILY_MEMBERS.map(m => ({
  uid:             m.uid,
  displayName:     m.displayName,
  email:           m.email,
  familyId:        'fam1',
  role:            m.role,
  monthlyReceitas: m.monthlyReceitas,
  monthlyDespesas: m.monthlyDespesas,
}))
