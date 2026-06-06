function sendJson(res, statusCode, body) {
  res.statusCode = statusCode
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}

export default async function handler(_req, res) {
  sendJson(res, 410, {
    error: 'As sessoes ao vivo estao desativadas neste momento.',
    code: 'financial_session_disabled',
  })
}
