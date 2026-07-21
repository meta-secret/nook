import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { findMockAuthAccount } from './accounts'
import {
  detectionCombinedPage,
  detectionHiddenHeaderLoginPage,
  detectionHiddenOtpPage,
  detectionLoginPage,
  detectionOtpPage,
  detectionSignupPage,
  detectionSpaPage,
  plainLoginPage,
  successPage,
  totpLoginPage,
  totpVerifyPage,
} from './pages'
import { verifyTotpCode } from './totp'

export type MockAuthServer = {
  origin: string
  close: () => Promise<void>
}

type PendingTotpSession = {
  username: string
  totpSecret: string
}

const pendingSessions = new Map<string, PendingTotpSession>()

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

function parseForm(body: string): Record<string, string> {
  const params = new URLSearchParams(body)
  const values: Record<string, string> = {}
  for (const [key, value] of params.entries()) {
    values[key] = value
  }
  return values
}

function cookieValue(
  request: IncomingMessage,
  name: string,
): string | undefined {
  const header = request.headers.cookie
  if (!header) return undefined
  for (const part of header.split(';')) {
    const [rawName, ...rest] = part.trim().split('=')
    if (rawName === name) return decodeURIComponent(rest.join('='))
  }
  return undefined
}

function sendHtml(
  response: ServerResponse,
  status: number,
  html: string,
  headers?: Record<string, string>,
): void {
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    ...headers,
  })
  response.end(html)
}

function redirect(
  response: ServerResponse,
  location: string,
  headers?: Record<string, string>,
): void {
  response.writeHead(302, { location, ...headers })
  response.end()
}

async function handlePlainLogin(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method === 'GET') {
    sendHtml(response, 200, plainLoginPage())
    return
  }
  if (request.method !== 'POST') {
    response.writeHead(405)
    response.end('Method not allowed')
    return
  }
  const form = parseForm(await readBody(request))
  const account = findMockAuthAccount(form.username ?? '', form.password ?? '')
  if (!account || account.totpSecret) {
    sendHtml(response, 401, plainLoginPage('Invalid username or password.'))
    return
  }
  redirect(response, '/plain/success')
}

async function handleTotpLogin(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method === 'GET') {
    sendHtml(response, 200, totpLoginPage())
    return
  }
  if (request.method !== 'POST') {
    response.writeHead(405)
    response.end('Method not allowed')
    return
  }
  const form = parseForm(await readBody(request))
  const account = findMockAuthAccount(form.username ?? '', form.password ?? '')
  if (!account?.totpSecret) {
    sendHtml(response, 401, totpLoginPage('Invalid username or password.'))
    return
  }
  const sessionId = `totp-${Date.now()}-${Math.random().toString(16).slice(2)}`
  pendingSessions.set(sessionId, {
    username: account.username,
    totpSecret: account.totpSecret,
  })
  redirect(response, '/totp/verify', {
    'set-cookie': `mock_auth_pending=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax`,
  })
}

async function handleTotpVerify(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const sessionId = cookieValue(request, 'mock_auth_pending')
  const session = sessionId ? pendingSessions.get(sessionId) : undefined
  if (request.method === 'GET') {
    if (!session) {
      redirect(response, '/totp/login')
      return
    }
    sendHtml(response, 200, totpVerifyPage())
    return
  }
  if (request.method !== 'POST') {
    response.writeHead(405)
    response.end('Method not allowed')
    return
  }
  if (!session || !sessionId) {
    redirect(response, '/totp/login')
    return
  }
  const form = parseForm(await readBody(request))
  if (!verifyTotpCode(session.totpSecret, form.otp ?? '')) {
    sendHtml(response, 401, totpVerifyPage('Invalid authentication code.'))
    return
  }
  pendingSessions.delete(sessionId)
  redirect(response, '/totp/success', {
    'set-cookie':
      'mock_auth_pending=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',
  })
}

function handleDetectionRoutes(
  pathname: string,
  response: ServerResponse,
): boolean {
  switch (pathname) {
    case '/login':
      sendHtml(response, 200, detectionLoginPage())
      return true
    case '/signup':
      sendHtml(response, 200, detectionSignupPage())
      return true
    case '/otp':
      sendHtml(response, 200, detectionOtpPage())
      return true
    case '/otp-hidden':
      sendHtml(response, 200, detectionHiddenOtpPage())
      return true
    case '/combined':
      sendHtml(response, 200, detectionCombinedPage())
      return true
    case '/spa':
      sendHtml(response, 200, detectionSpaPage())
      return true
    case '/login-with-hidden-header':
      sendHtml(response, 200, detectionHiddenHeaderLoginPage())
      return true
    default:
      return false
  }
}

export async function startMockAuthServer(): Promise<MockAuthServer> {
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const { pathname } = url

      if (pathname === '/plain/login') {
        await handlePlainLogin(request, response)
        return
      }
      if (pathname === '/plain/success') {
        sendHtml(response, 200, successPage('plain-login'))
        return
      }
      if (pathname === '/totp/login') {
        await handleTotpLogin(request, response)
        return
      }
      if (pathname === '/totp/verify') {
        await handleTotpVerify(request, response)
        return
      }
      if (pathname === '/totp/success') {
        sendHtml(response, 200, successPage('login-then-totp'))
        return
      }
      if (handleDetectionRoutes(pathname, response)) {
        return
      }

      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('Not found')
    })().catch(() => {
      if (!response.headersSent) {
        response.writeHead(500)
      }
      response.end('Internal error')
    })
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Mock auth server failed to bind a local port.')
  }

  return {
    // Prefer localhost in the origin so vault website matching matches browser URLs.
    origin: `http://localhost:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      }),
  }
}
