import type { SiteFixture, SiteFixtureStep } from './site-fixtures'

export enum DetectionFixtureRenderKind {
  Missing = 'missing',
  Ready = 'ready',
}

export type DetectionFixtureRenderState =
  | { kind: DetectionFixtureRenderKind.Missing }
  | {
      kind: DetectionFixtureRenderKind.Ready
      fixture: SiteFixture
      step: SiteFixtureStep
    }
