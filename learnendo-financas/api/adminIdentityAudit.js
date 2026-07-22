import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

function initializeAdmin() {
  if (getApps().length > 0) return getApps()[0]

  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)) })
  }

  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    return initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    })
  }

  return initializeApp()
}

async function findAuthIdentity(auth, target) {
  const requestedUid = String(target?.uid || '').trim()
  const requestedEmail = String(target?.email || '').trim().toLowerCase()
  let authUser = null

  if (requestedUid) {
    try {
      authUser = await auth.getUser(requestedUid)
    } catch (error) {
      if (error?.code !== 'auth/user-not-found') throw error
    }
  }
  if (!authUser && requestedEmail) {
    try {
      authUser = await auth.getUserByEmail(requestedEmail)
    } catch (error) {
      if (error?.code !== 'auth/user-not-found') throw error
    }
  }

  if (!authUser) {
    return { exists: false, requestedUid, requestedEmail }
  }

  return {
    exists: true,
    uid: authUser.uid,
    email: authUser.email || '',
    displayName: authUser.displayName || '',
    disabled: authUser.disabled,
    emailVerified: authUser.emailVerified,
    createdAt: authUser.metadata?.creationTime || null,
    lastSignInAt: authUser.metadata?.lastSignInTime || null,
    uidMatches: !requestedUid || requestedUid === authUser.uid,
    emailMatches: !requestedEmail || requestedEmail === String(authUser.email || '').toLowerCase(),
  }
}

const FINANCIAL_COLLECTION_PATTERN = /(debt|divid|saldo|balance|transaction|moviment|payment|pagament|restitut|settlement|compens|adjust|audit|history|histor|log)/i
const KNOWN_COLLECTIONS = new Set(['debts', 'transactions', 'financialAuditLogs', 'auditAdjustments'])

function serializedValue(value) {
  if (value == null) return value
  if (typeof value?.toDate === 'function') return value.toDate().toISOString()
  if (Array.isArray(value)) return value.map(serializedValue)
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializedValue(item)]))
  return value
}

function targetAliases(targets) {
  return targets.flatMap((entry) => {
    const target = entry?.target || entry
    return [target?.uid, target?.email, target?.displayName, target?.name]
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean)
  })
}

function matchesAliases(data, aliases) {
  const serialized = JSON.stringify(serializedValue(data)).toLowerCase()
  return aliases.some((alias) => serialized.includes(alias))
}

function classifyLegacyCollection(name) {
  if (/(debt|divid|saldo|balance)/i.test(name)) return 'debt'
  if (/(transaction|moviment|payment|pagament|restitut|settlement|compens)/i.test(name)) return 'transaction'
  return 'audit_log'
}

async function discoverRelevantWorkspaceIds(firestore, targets, errors) {
  const ids = new Set()
  const searches = []
  targets.forEach((entry) => {
    const target = entry?.target || entry
    ;[
      ['uid', target?.uid], ['memberId', target?.uid], ['userId', target?.uid],
      ['email', target?.email], ['displayName', target?.displayName], ['name', target?.displayName],
    ].forEach(([field, value]) => {
      if (String(value || '').trim()) searches.push([field, String(value).trim()])
    })
  })

  for (const [field, value] of searches) {
    try {
      const snapshot = await firestore.collectionGroup('members').where(field, '==', value).get()
      snapshot.docs.forEach((document) => {
        const parentDocument = document.ref.parent.parent
        if (parentDocument?.id) ids.add(parentDocument.id)
      })
    } catch (error) {
      errors.push(`members.${field}: ${error?.message || error}`)
    }
  }
  return ids
}

async function scanCollection(collectionRef, metadata, aliases, output, errors) {
  if (output.length >= 1000) return
  try {
    const snapshot = await collectionRef.limit(Math.min(500, 1000 - output.length)).get()
    snapshot.docs.forEach((document) => {
      const data = document.data() || {}
      if (!matchesAliases(data, aliases)) return
      output.push({
        id: document.id,
        ...serializedValue(data),
        _collection: collectionRef.path,
        _workspaceId: metadata.workspaceId || data.workspaceId || data.familyId || '',
        _legacyKind: classifyLegacyCollection(collectionRef.id),
      })
    })
  } catch (error) {
    errors.push(`${collectionRef.path}: ${error?.message || error}`)
  }
}

async function discoverLegacyFinancialRecords(firestore, targets) {
  const aliases = targetAliases(targets)
  const errors = []
  const records = []
  const workspaceIds = await discoverRelevantWorkspaceIds(firestore, targets, errors)

  for (const workspaceId of workspaceIds) {
    for (const scope of ['workspaces', 'families']) {
      try {
        const collections = await firestore.doc(`${scope}/${workspaceId}`).listCollections()
        for (const collectionRef of collections) {
          if (!FINANCIAL_COLLECTION_PATTERN.test(collectionRef.id) || KNOWN_COLLECTIONS.has(collectionRef.id)) continue
          await scanCollection(collectionRef, { workspaceId }, aliases, records, errors)
        }
      } catch (error) {
        errors.push(`${scope}/${workspaceId}: ${error?.message || error}`)
      }
    }
  }

  try {
    const rootCollections = await firestore.listCollections()
    for (const collectionRef of rootCollections) {
      if (!FINANCIAL_COLLECTION_PATTERN.test(collectionRef.id)) continue
      await scanCollection(collectionRef, {}, aliases, records, errors)
    }
  } catch (error) {
    errors.push(`root collections: ${error?.message || error}`)
  }

  return { records, errors, truncated: records.length >= 1000 }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Metodo nao permitido.' })
    return
  }

  try {
    initializeAdmin()
    const auth = getAuth()
    const firestore = getFirestore()
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    if (!token) {
      sendJson(res, 401, { error: 'Token administrativo ausente.' })
      return
    }

    const decoded = await auth.verifyIdToken(token)
    const profile = await firestore.doc(`users/${decoded.uid}`).get()
    const configuredAdminEmail = String(process.env.ADMIN_EMAIL || process.env.VITE_ADMIN_EMAIL || '').toLowerCase()
    const isAdmin = profile.data()?.role === 'admin'
      || (configuredAdminEmail && String(decoded.email || '').toLowerCase() === configuredAdminEmail)
    if (!isAdmin) {
      sendJson(res, 403, { error: 'Apenas administradores podem consultar o Firebase Authentication.' })
      return
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    const targets = Array.isArray(body.targets) ? body.targets.slice(0, 3) : []
    const identities = {}
    for (const entry of targets) {
      const key = String(entry?.key || '').trim()
      if (!key) continue
      identities[key] = await findAuthIdentity(auth, entry.target || entry)
    }

    const legacyDiscovery = await discoverLegacyFinancialRecords(firestore, targets)

    sendJson(res, 200, {
      auditOnly: true,
      dryRun: true,
      identities,
      legacyDiscovery,
    })
  } catch (error) {
    console.error('[adminIdentityAudit]', error)
    sendJson(res, 500, { error: 'Nao foi possivel consultar o Firebase Authentication.', detail: error?.message || String(error) })
  }
}
