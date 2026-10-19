import type { ZXingModuleOverrides } from "zxing-wasm/reader";

/** Eager ZXing module preparation; the same overrides object reuses one WASM instance. */
export interface QrCodeReaderModuleLoad {
  readonly overrides: ZXingModuleOverrides;
  readonly fireImmediately: true;
}

/**
 * Where one build serves `zxing_reader.wasm`.
 *
 * Emscripten requests only that file, so every lookup resolves to the build's
 * own asset and the package's default CDN is never contacted. Each build keeps
 * one instance so all of its readers share one prepared WASM module.
 */
export class QrCodeReaderWasm {
  readonly moduleLoad: QrCodeReaderModuleLoad;

  constructor(wasmUrl: string) {
    this.moduleLoad = {
      overrides: { locateFile: () => wasmUrl },
      fireImmediately: true,
    };
  }
}
