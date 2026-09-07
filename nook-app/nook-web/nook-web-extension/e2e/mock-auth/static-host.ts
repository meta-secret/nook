import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export type MockAuthServer = {
  origin: string
  close: () => Promise<void>
}

type MockAuthFileInfo = {
  isFile: () => boolean
}

export type MockAuthFileInspector = {
  inspect: (filePath: string) => Promise<MockAuthFileInfo>
}

const fixtureRoot = path.dirname(fileURLToPath(import.meta.url))
const distRoot = path.join(fixtureRoot, 'dist')
const nodeFileInspector: MockAuthFileInspector = { inspect: stat }

export enum MockAuthRequestPathAdmissionKind {
  Admitted = 'admitted',
  Rejected = 'rejected',
}

export type MockAuthRequestPathAdmission =
  | {
      kind: MockAuthRequestPathAdmissionKind.Admitted
      requestPath: AdmittedMockAuthRequestPath
    }
  | { kind: MockAuthRequestPathAdmissionKind.Rejected }

export enum MockAuthMissingTargetKind {
  ClientRoute = 'client-route',
  StaticAsset = 'static-asset',
}

export class AdmittedMockAuthRequestPath {
  private constructor(private readonly urlPath: string) {}

  static admit(urlPath: string): MockAuthRequestPathAdmission {
    if (!urlPath.startsWith('/')) {
      return { kind: MockAuthRequestPathAdmissionKind.Rejected }
    }
    return {
      kind: MockAuthRequestPathAdmissionKind.Admitted,
      requestPath: new AdmittedMockAuthRequestPath(urlPath),
    }
  }

  candidatePath(): string {
    const relative = this.urlPath === '/' ? '/index.html' : this.urlPath
    return path.normalize(path.join(distRoot, relative))
  }

  missingTargetKind(): MockAuthMissingTargetKind {
    return path.extname(this.urlPath) === ''
      ? MockAuthMissingTargetKind.ClientRoute
      : MockAuthMissingTargetKind.StaticAsset
  }
}

export enum MockAuthStaticAssetResolutionKind {
  NotFound = 'not-found',
  Rejected = 'rejected',
  Resolved = 'resolved',
}

export type MockAuthStaticAssetResolution =
  | { kind: MockAuthStaticAssetResolutionKind.NotFound }
  | { kind: MockAuthStaticAssetResolutionKind.Rejected }
  | { kind: MockAuthStaticAssetResolutionKind.Resolved; path: string }

enum MockAuthFileInspectionFailureKind {
  Missing = 'missing',
  Unexpected = 'unexpected',
}

type MockAuthFileInspectionFailure =
  | { kind: MockAuthFileInspectionFailureKind.Missing }
  | { kind: MockAuthFileInspectionFailureKind.Unexpected; error: unknown }

export class MockAuthStaticAssetResolver {
  constructor(
    private readonly fileInspector: MockAuthFileInspector = nodeFileInspector,
  ) {}

  async resolve(
    requestPath: AdmittedMockAuthRequestPath,
  ): Promise<MockAuthStaticAssetResolution> {
    const candidate = requestPath.candidatePath()
    const relativeCandidate = path.relative(distRoot, candidate)
    if (
      relativeCandidate.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeCandidate)
    ) {
      return { kind: MockAuthStaticAssetResolutionKind.Rejected }
    }

    try {
      const info = await this.fileInspector.inspect(candidate)
      if (info.isFile()) {
        return {
          kind: MockAuthStaticAssetResolutionKind.Resolved,
          path: candidate,
        }
      }
    } catch (error) {
      const failure = MockAuthStaticAssetResolver.classifyFailure(error)
      if (failure.kind === MockAuthFileInspectionFailureKind.Unexpected) {
        throw failure.error
      }
    }

    if (
      requestPath.missingTargetKind() === MockAuthMissingTargetKind.StaticAsset
    ) {
      return { kind: MockAuthStaticAssetResolutionKind.NotFound }
    }
    return {
      kind: MockAuthStaticAssetResolutionKind.Resolved,
      path: path.join(distRoot, 'index.html'),
    }
  }

  static classifyFailure(error: unknown): MockAuthFileInspectionFailure {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { kind: MockAuthFileInspectionFailureKind.Missing }
    }
    return { kind: MockAuthFileInspectionFailureKind.Unexpected, error }
  }
}

export class MockAuthStaticHost {
  static async start(): Promise<MockAuthServer> {
    await MockAuthStaticHost.assertBuilt()
    const resolver = new MockAuthStaticAssetResolver()
    const server = createServer((request, response) => {
      void (async () => {
        const url = new URL(
          ((...[v = '/']) => v)(request.url),
          'http://127.0.0.1',
        )
        const admission = AdmittedMockAuthRequestPath.admit(url.pathname)
        if (admission.kind === MockAuthRequestPathAdmissionKind.Rejected) {
          response.writeHead(404)
          response.end('Not found')
          return
        }
        const asset = await resolver.resolve(admission.requestPath)
        if (
          asset.kind === MockAuthStaticAssetResolutionKind.Rejected ||
          asset.kind === MockAuthStaticAssetResolutionKind.NotFound
        ) {
          response.writeHead(404)
          response.end('Not found')
          return
        }
        const body = await readFile(asset.path)
        response.writeHead(200, {
          'content-type': MockAuthStaticHost.contentType(asset.path),
        })
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

  private static async assertBuilt(): Promise<void> {
    try {
      await stat(path.join(distRoot, 'index.html'))
    } catch (error) {
      const failure = MockAuthStaticAssetResolver.classifyFailure(error)
      if (failure.kind === MockAuthFileInspectionFailureKind.Unexpected) {
        throw failure.error
      }
      throw new Error(
        'Mock auth SPA is not built. Run `bun run e2e:mock-auth:build` first.',
        { cause: error },
      )
    }
  }

  private static contentType(filePath: string): string {
    if (filePath.endsWith('.html')) return 'text/html; charset=utf-8'
    if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8'
    if (filePath.endsWith('.css')) return 'text/css; charset=utf-8'
    if (filePath.endsWith('.wasm')) return 'application/wasm'
    if (filePath.endsWith('.svg')) return 'image/svg+xml'
    return 'application/octet-stream'
  }
}

export const startMockAuthServer = MockAuthStaticHost.start
