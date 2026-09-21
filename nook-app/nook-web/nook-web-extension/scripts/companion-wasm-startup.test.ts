import { describe, expect, test } from 'bun:test'
import { runInNewContext } from 'node:vm'
import {
  CompanionWasmHostAdmissionKind,
  CompanionWasmHostMessageAdmission,
  CompanionWasmHostRequestKind,
  CompanionWasmHostResponseKind,
  CompanionWasmStartup,
  CompanionWasmStartupFailureKind,
  CompanionWasmStartupOutcome,
  CompanionWasmStartupStage,
  type CompanionWasmHostResponse,
  type CompanionWasmStartupDiagnostic,
  type CompanionWasmStartupRequest,
} from '../../nook-web-shared/src/extension/companion-wasm-startup'

class CompanionWasmStartupTestFixture {
  validModule(): WebAssembly.Module {
    return new WebAssembly.Module(
      new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]),
    )
  }
}

class RecordingCompanionWasmStartupDiagnostics {
  readonly entries: CompanionWasmStartupDiagnostic[] = []

  record(entry: CompanionWasmStartupDiagnostic): void {
    this.entries.push(entry)
  }
}

describe('companion WASM startup', () => {
  test('retries an embedded compile failure with the extension-origin module', async () => {
    const diagnostics = new RecordingCompanionWasmStartupDiagnostics()
    const attempts: string[] = []
    const extensionOriginModule =
      new CompanionWasmStartupTestFixture().validModule()
    const request: CompanionWasmStartupRequest = {
      initializeEmbeddedCompanionWasm: async () => {
        attempts.push('embedded')
        throw new WebAssembly.CompileError()
      },
      loadExtensionOriginCompanionWasmModule: async () => {
        attempts.push('extension-origin-load')
        return extensionOriginModule
      },
      initializeExtensionOriginCompanionWasm: async (module) => {
        attempts.push(
          module === extensionOriginModule
            ? 'extension-origin'
            : 'wrong-module',
        )
      },
      diagnostics,
    }

    await new CompanionWasmStartup().initialize(request)

    expect(attempts).toEqual([
      'embedded',
      'extension-origin-load',
      'extension-origin',
    ])
    expect(diagnostics.entries).toEqual([
      {
        stage: CompanionWasmStartupStage.Embedded,
        outcome: CompanionWasmStartupOutcome.Failed,
        failure: CompanionWasmStartupFailureKind.Compile,
      },
      {
        stage: CompanionWasmStartupStage.ExtensionOrigin,
        outcome: CompanionWasmStartupOutcome.Succeeded,
      },
    ])
  })

  test('preserves unrelated embedded initialization failures', async () => {
    const diagnostics = new RecordingCompanionWasmStartupDiagnostics()
    const attempts: string[] = []
    const failure = new TypeError('embedded wasm bridge failure')
    const request: CompanionWasmStartupRequest = {
      initializeEmbeddedCompanionWasm: () => {
        attempts.push('embedded')
        throw failure
      },
      loadExtensionOriginCompanionWasmModule: async () => {
        attempts.push('extension-origin-load')
        return new CompanionWasmStartupTestFixture().validModule()
      },
      initializeExtensionOriginCompanionWasm: async () => {
        attempts.push('extension-origin')
      },
      diagnostics,
    }

    await expect(new CompanionWasmStartup().initialize(request)).rejects.toBe(
      failure,
    )
    expect(attempts).toEqual(['embedded'])
    expect(diagnostics.entries).toEqual([])
  })

  test('retries a synchronously rejected embedded instantiate under CSP', async () => {
    const diagnostics = new RecordingCompanionWasmStartupDiagnostics()
    const attempts: string[] = []
    const extensionOriginModule =
      new CompanionWasmStartupTestFixture().validModule()
    const request: CompanionWasmStartupRequest = {
      initializeEmbeddedCompanionWasm: () => {
        attempts.push('embedded')
        throw new TypeError(
          'WebAssembly.instantiate(): Wasm code generation disallowed by embedder',
        )
      },
      loadExtensionOriginCompanionWasmModule: async () => {
        attempts.push('extension-origin-load')
        return extensionOriginModule
      },
      initializeExtensionOriginCompanionWasm: async () => {
        attempts.push('extension-origin')
      },
      diagnostics,
    }

    await new CompanionWasmStartup().initialize(request)

    expect(attempts).toEqual([
      'embedded',
      'extension-origin-load',
      'extension-origin',
    ])
    expect(diagnostics.entries).toEqual([
      {
        stage: CompanionWasmStartupStage.Embedded,
        outcome: CompanionWasmStartupOutcome.Failed,
        failure: CompanionWasmStartupFailureKind.Compile,
      },
      {
        stage: CompanionWasmStartupStage.ExtensionOrigin,
        outcome: CompanionWasmStartupOutcome.Succeeded,
      },
    ])
  })

  test('retries an asynchronously rejected embedded instantiate under CSP', async () => {
    const diagnostics = new RecordingCompanionWasmStartupDiagnostics()
    const attempts: string[] = []
    const extensionOriginModule =
      new CompanionWasmStartupTestFixture().validModule()
    const request: CompanionWasmStartupRequest = {
      initializeEmbeddedCompanionWasm: async () => {
        attempts.push('embedded')
        await Promise.resolve()
        throw new TypeError(
          'WebAssembly.instantiate(): Wasm code generation disallowed by embedder',
        )
      },
      loadExtensionOriginCompanionWasmModule: async () => {
        attempts.push('extension-origin-load')
        return extensionOriginModule
      },
      initializeExtensionOriginCompanionWasm: async () => {
        attempts.push('extension-origin')
      },
      diagnostics,
    }

    await new CompanionWasmStartup().initialize(request)

    expect(attempts).toEqual([
      'embedded',
      'extension-origin-load',
      'extension-origin',
    ])
    expect(diagnostics.entries).toEqual([
      {
        stage: CompanionWasmStartupStage.Embedded,
        outcome: CompanionWasmStartupOutcome.Failed,
        failure: CompanionWasmStartupFailureKind.Compile,
      },
      {
        stage: CompanionWasmStartupStage.ExtensionOrigin,
        outcome: CompanionWasmStartupOutcome.Succeeded,
      },
    ])
  })

  test('rejects a response from a different source', () => {
    const admission = new CompanionWasmHostMessageAdmission()
    const channel = new MessageChannel()
    const expectedSource = channel.port1
    const response: CompanionWasmHostResponse = {
      kind: CompanionWasmHostResponseKind.Compiled,
      resourceUrl:
        'chrome-extension://nook/content/nook_companion_wasm_bg.wasm',
      module: new CompanionWasmStartupTestFixture().validModule(),
    }

    expect(
      admission.admitResponse({
        event: new MessageEvent('message', {
          data: response,
          origin: 'chrome-extension://nook',
          source: channel.port2,
        }),
        expectedSource,
        expectedOrigin: 'chrome-extension://nook',
        expectedResourceUrl: response.resourceUrl,
      }),
    ).toEqual({ kind: CompanionWasmHostAdmissionKind.Rejected })
  })

  test('rejects a response with the wrong origin or packaged resource', () => {
    const admission = new CompanionWasmHostMessageAdmission()
    const channel = new MessageChannel()
    const expectedSource = channel.port1
    const expectedResourceUrl =
      'chrome-extension://nook/content/nook_companion_wasm_bg.wasm'
    const response: CompanionWasmHostResponse = {
      kind: CompanionWasmHostResponseKind.Compiled,
      resourceUrl: expectedResourceUrl,
      module: new CompanionWasmStartupTestFixture().validModule(),
    }

    for (const event of [
      new MessageEvent('message', {
        data: response,
        origin: 'https://accounts.google.com',
        source: expectedSource,
      }),
      new MessageEvent('message', {
        data: {
          ...response,
          resourceUrl: 'chrome-extension://nook/content/other.wasm',
        },
        origin: 'chrome-extension://nook',
        source: expectedSource,
      }),
    ]) {
      expect(
        admission.admitResponse({
          event,
          expectedSource,
          expectedOrigin: 'chrome-extension://nook',
          expectedResourceUrl,
        }),
      ).toEqual({ kind: CompanionWasmHostAdmissionKind.Rejected })
    }
  })

  test('rejects a non-module response and classifies a failed response', () => {
    const admission = new CompanionWasmHostMessageAdmission()
    const channel = new MessageChannel()
    const expectedSource = channel.port1
    const expectedOrigin = 'chrome-extension://nook'
    const expectedResourceUrl =
      'chrome-extension://nook/content/nook_companion_wasm_bg.wasm'

    expect(
      admission.admitResponse({
        event: new MessageEvent('message', {
          data: {
            kind: CompanionWasmHostResponseKind.Compiled,
            resourceUrl: expectedResourceUrl,
            module: 'not-a-webassembly-module',
          },
          origin: expectedOrigin,
          source: expectedSource,
        }),
        expectedSource,
        expectedOrigin,
        expectedResourceUrl,
      }),
    ).toEqual({ kind: CompanionWasmHostAdmissionKind.Rejected })

    expect(
      admission.admitResponse({
        event: new MessageEvent('message', {
          data: { kind: CompanionWasmHostResponseKind.Failed },
          origin: expectedOrigin,
          source: expectedSource,
        }),
        expectedSource,
        expectedOrigin,
        expectedResourceUrl,
      }),
    ).toEqual({ kind: CompanionWasmHostAdmissionKind.Failed })
  })

  test('admits a compiled module cloned from the extension host realm', () => {
    const admission = new CompanionWasmHostMessageAdmission()
    const channel = new MessageChannel()
    const expectedOrigin = 'chrome-extension://nook'
    const expectedResourceUrl =
      'chrome-extension://nook/content/nook_companion_wasm_bg.wasm'
    const hostRealmModule = runInNewContext(
      'new WebAssembly.Module(bytes)',
      {
        bytes: new Uint8Array([
          0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
        ]),
      },
    ) as WebAssembly.Module

    expect(hostRealmModule instanceof WebAssembly.Module).toBe(false)
    expect(
      admission.admitResponse({
        event: new MessageEvent('message', {
          data: {
            kind: CompanionWasmHostResponseKind.Compiled,
            resourceUrl: expectedResourceUrl,
            module: hostRealmModule,
          },
          origin: expectedOrigin,
          source: channel.port1,
        }),
        expectedSource: channel.port1,
        expectedOrigin,
        expectedResourceUrl,
      }),
    ).toEqual({
      kind: CompanionWasmHostAdmissionKind.Accepted,
      module: hostRealmModule,
    })
  })

  test('admits only a request from the owning parent window', () => {
    const admission = new CompanionWasmHostMessageAdmission()
    const channel = new MessageChannel()
    const expectedSource = channel.port1
    const request = {
      kind: CompanionWasmHostRequestKind.CompileCompanionModule,
    }

    expect(
      admission.admitRequest({
        event: new MessageEvent('message', {
          data: request,
          source: expectedSource,
        }),
        expectedSource,
      }),
    ).toEqual({ kind: CompanionWasmHostAdmissionKind.Accepted })
    expect(
      admission.admitRequest({
        event: new MessageEvent('message', {
          data: request,
          source: channel.port2,
        }),
        expectedSource,
      }),
    ).toEqual({ kind: CompanionWasmHostAdmissionKind.Rejected })
  })
})
