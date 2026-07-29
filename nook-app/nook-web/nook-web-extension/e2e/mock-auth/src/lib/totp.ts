import init, {
  generateTotpCode as wasmGenerateTotpCode,
  verifyTotpCode as wasmVerifyTotpCode,
} from 'nook-wasm'
enum WasmStartupKind {
  NotStarted = 'not-started',
  Initializing = 'initializing',
}

type WasmStartup =
  | { kind: WasmStartupKind.NotStarted }
  | { kind: WasmStartupKind.Initializing; completion: Promise<void> }

let wasmStartup: WasmStartup = { kind: WasmStartupKind.NotStarted }

async function ensureWasm(): Promise<void> {
  if (wasmStartup.kind === WasmStartupKind.NotStarted) {
    wasmStartup = {
      kind: WasmStartupKind.Initializing,
      completion: init().then(() => {}),
    }
  }
  await wasmStartup.completion
}

/** Thin wrapper over nook-core TOTP via WASM — no hand-rolled crypto. */
export async function generateTotpCode(
  base32Secret: string,
  nowMs = Date.now(),
): Promise<string> {
  await ensureWasm()
  return wasmGenerateTotpCode(base32Secret, BigInt(Math.floor(nowMs / 1000)))
}

export async function verifyTotpCode(
  base32Secret: string,
  code: string,
  nowMs = Date.now(),
): Promise<boolean> {
  await ensureWasm()
  return wasmVerifyTotpCode(
    base32Secret,
    code,
    BigInt(Math.floor(nowMs / 1000)),
  )
}
