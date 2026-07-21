import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export type MockAuthServer = {
  origin: string
  close: () => Promise<void>
}

const fixtureRoot = path.dirname(fileURLToPath(import.meta.url))
const distRoot = path.join(fixtureRoot, 'dist')

function contentType(filePath: string): string {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8'
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8'
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8'
  if (filePath.endsWith('.wasm')) return 'application/wasm'
  if (filePath.endsWith('.svg')) return 'image/svg+xml'
  return 'application/octet-stream'
}

async function resolveAsset(urlPath: string): Promise<string | undefined> {
  const relative = urlPath === '/' ? '/index.html' : urlPath
  const candidate = path.normalize(path.join(distRoot, relative))
  if (!candidate.startsWith(distRoot)) return undefined
  try {
    const info = await stat(candidate)
    if (info.isFile()) return candidate
  } catch {
    // fall through to SPA index
  }
  // Client-side routes: serve the SPA shell.
  return path.join(distRoot, 'index.html')
}

/**
 * Host the built client-side mock auth SPA. Auth quirks live in the browser;
 * this process only serves static assets (+ SPA fallback).
 */
export async function startMockAuthServer(): Promise<MockAuthServer> {
  try {
    await stat(path.join(distRoot, 'index.html'))
  } catch {
    throw new Error(
      'Mock auth SPA is not built. Run `bun run e2e:mock-auth:build` first.',
    )
  }

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const asset = await resolveAsset(url.pathname)
      if (!asset) {
        response.writeHead(404)
        response.end('Not found')
        return
      }
      const body = await readFile(asset)
      response.writeHead(200, { 'content-type': contentType(asset) })
      response.end(body)
    })().catch(() => {
      if (!response.headersSent) response.writeHead(500)
      response.end('Internal error')
    })
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Mock auth static host failed to bind a local port.')
  }

  return {
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
