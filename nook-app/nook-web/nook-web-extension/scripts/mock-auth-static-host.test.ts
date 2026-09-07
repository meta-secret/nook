import { describe, expect, test } from 'bun:test'
import {
  AdmittedMockAuthRequestPath,
  MockAuthRequestPathAdmissionKind,
  MockAuthStaticAssetResolutionKind,
  MockAuthStaticAssetResolver,
  type MockAuthFileInspector,
} from '../e2e/mock-auth/static-host'

class MockAuthRequestPathTestOwner {
  static admitted(urlPath: string): AdmittedMockAuthRequestPath {
    const admission = AdmittedMockAuthRequestPath.admit(urlPath)
    expect(admission.kind).toBe(MockAuthRequestPathAdmissionKind.Admitted)
    if (admission.kind === MockAuthRequestPathAdmissionKind.Rejected) {
      throw new Error(`Expected admitted mock-auth path: ${urlPath}`)
    }
    return admission.requestPath
  }

  static failingInspector(error: unknown): MockAuthFileInspector {
    return {
      inspect: () => Promise.reject(error),
    }
  }
}

describe('mock auth static host', () => {
  test('classifies missing client routes and assets without serving assets as HTML', async () => {
    const missing = Object.assign(new Error('missing'), { code: 'ENOENT' })
    const resolver = new MockAuthStaticAssetResolver(
      MockAuthRequestPathTestOwner.failingInspector(missing),
    )

    const route = await resolver.resolve(
      MockAuthRequestPathTestOwner.admitted('/template/linkedin'),
    )
    expect(route.kind).toBe(MockAuthStaticAssetResolutionKind.Resolved)
    if (route.kind === MockAuthStaticAssetResolutionKind.Resolved) {
      expect(route.path.endsWith('/dist/index.html')).toBe(true)
    }

    await expect(
      resolver.resolve(
        MockAuthRequestPathTestOwner.admitted('/assets/index.js'),
      ),
    ).resolves.toEqual({ kind: MockAuthStaticAssetResolutionKind.NotFound })
  })

  test.each([
    ['permission', 'EACCES'],
    ['malformed path', 'ERR_INVALID_ARG_VALUE'],
  ])('propagates %s inspection failures without fallback', async (_, code) => {
    const failure = Object.assign(new Error(code), { code })
    const resolver = new MockAuthStaticAssetResolver(
      MockAuthRequestPathTestOwner.failingInspector(failure),
    )

    await expect(
      resolver.resolve(MockAuthRequestPathTestOwner.admitted('/linkedin')),
    ).rejects.toBe(failure)
  })
})
