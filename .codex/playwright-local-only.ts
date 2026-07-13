const allowedOrigins = new Set([
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'http://127.0.0.1:5175',
  'http://localhost:5175',
  'ws://127.0.0.1:5173',
  'ws://localhost:5173',
  'ws://127.0.0.1:5175',
  'ws://localhost:5175',
])

function hasAllowedOrigin(rawUrl: string): boolean {
  try {
    return allowedOrigins.has(new URL(rawUrl).origin)
  } catch {
    return false
  }
}

export default async ({ page }) => {
  const context = page.context()

  await context.route('**/*', async (route) => {
    if (hasAllowedOrigin(route.request().url())) {
      await route.continue()
      return
    }

    await route.abort('blockedbyclient')
  })

  await context.routeWebSocket(/.*/, async (webSocket) => {
    if (hasAllowedOrigin(webSocket.url())) {
      webSocket.connectToServer()
      return
    }

    await webSocket.close({ code: 1008, reason: 'Nook AI-debug local-only policy' })
  })
}
