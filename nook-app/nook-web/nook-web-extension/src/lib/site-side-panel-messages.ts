import { Schema } from 'effect'

export enum SiteSidePanelOpenMessageType {
  NookSiteSidePanelOpen = 'nook:site-side-panel-open',
}

/**
 * A site page asks to show the Nook side panel beside it, for example to
 * unlock Nook after Sign in found it locked. Structural browser wire value.
 */
export class SiteSidePanelOpenMessage {
  private constructor() {}
  declare readonly type: SiteSidePanelOpenMessageType.NookSiteSidePanelOpen
  static decode<WireMessage>(message: WireMessage) {
    return Schema.decodeUnknownEffect(siteSidePanelOpenMessageSchema)(message)
  }
}

export enum SiteSidePanelOpenKind {
  Opened = 'opened',
  Failed = 'failed',
}

export type SiteSidePanelOpenResponse = {
  readonly kind: SiteSidePanelOpenKind
}

type SiteSidePanelOpenMessageSchemaFields = {
  type: Schema.Literal<SiteSidePanelOpenMessageType>
}
const siteSidePanelOpenMessageSchemaFields: SiteSidePanelOpenMessageSchemaFields =
  { type: Schema.Literal(SiteSidePanelOpenMessageType.NookSiteSidePanelOpen) }

const siteSidePanelOpenMessageSchema = Schema.Struct(
  siteSidePanelOpenMessageSchemaFields,
) satisfies Schema.Codec<SiteSidePanelOpenMessage>
