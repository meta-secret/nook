class DebugRequestOrigin {
  constructor(private readonly request: string) {}
  isAllowed(): boolean {
    const rawUrl = this.request;

    try {
      return allowedOrigins.has(new URL(rawUrl).origin);
    } catch {
      return false;
    }
  }
}
// Keep in sync with allowed-origins.json (enforced by check-origins.mjs and
// `task ai-debug:check`).
const allowedOrigins = new Set([
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "https://127.0.0.1:5173",
  "https://localhost:5173",
  "ws://127.0.0.1:5173",
  "ws://localhost:5173",
  "wss://127.0.0.1:5173",
  "wss://localhost:5173",
  "http://127.0.0.1:5175",
  "http://localhost:5175",
  "https://127.0.0.1:5175",
  "https://localhost:5175",
  "ws://127.0.0.1:5175",
  "ws://localhost:5175",
  "wss://127.0.0.1:5175",
  "wss://localhost:5175",
]);

export default async ({ page }) => {
  const context = page.context();

  await context.route("**/*", async (route) => {
    if (new DebugRequestOrigin(route.request().url()).isAllowed()) {
      await route.continue();
      return;
    }

    await route.abort("blockedbyclient");
  });

  await context.routeWebSocket(/.*/, async (webSocket) => {
    if (new DebugRequestOrigin(webSocket.url()).isAllowed()) {
      webSocket.connectToServer();
      return;
    }

    await webSocket.close({
      code: 1008,
      reason: "Nook AI-debug local-only policy",
    });
  });
};
