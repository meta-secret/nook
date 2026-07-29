import init, {
  generateTotpCode as wasmGenerateTotpCode,
  verifyTotpCode as wasmVerifyTotpCode,
} from 'nook-wasm'
import {
  EMPTY_VALUE,
  presentValue,
  type ValueState,
} from '../../../../../../nook-web-shared/src/explicit-state'

let readyState: ValueState<Promise<void>> = EMPTY_VALUE

async function ensureWasm(): Promise<void> {
  if (readyState.kind === 'empty') {
    readyState = presentValue(init().then(() => {}))
  }
  await readyState.value
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
