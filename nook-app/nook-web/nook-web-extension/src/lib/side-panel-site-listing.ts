import { Schema } from 'effect'
import type {
  SiteSecretItem,
  SiteSecretMatches,
  SiteSecretAction,
  SiteSecretEmptyHint,
  SiteSecretIdentityGroup,
  SiteSecretIdentityHeader,
  SiteSecretItemId,
  SiteSecretListing,
  SiteSecretRow,
  SiteSecretVaultLabel,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

/** A site-bound secret kind as Rust names it on a listing row. */
type SiteSecretRowKind = SiteSecretRow['kind']

type BoundedTextSchema = Schema.Codec<string>
type SiteSecretRowKinds = Readonly<Record<SiteSecretRowKind, SiteSecretRowKind>>
type NamedLabelFields = {
  readonly kind: Schema.Codec<'Named'>
  readonly name: BoundedTextSchema
}
type UnnamedLabelFields = {
  readonly kind: Schema.Codec<'Unnamed'>
  readonly message_key: BoundedTextSchema
}
type ItemIdFields = {
  readonly vault_store_id: BoundedTextSchema
  readonly secret_id: BoundedTextSchema
}
type FillActionFields<Kind extends SiteSecretAction['kind']> = {
  readonly kind: Schema.Codec<Kind>
  readonly label_key: BoundedTextSchema
  readonly accessible_label_key: BoundedTextSchema
}
type ViewOnlyActionFields = { readonly kind: Schema.Codec<'ViewOnly'> }
type RowFields = {
  readonly kind: Schema.Codec<SiteSecretRowKind>
  readonly item_id: Schema.Codec<SiteSecretItemId>
  readonly type_label_key: BoundedTextSchema
  readonly title: BoundedTextSchema
  readonly account: BoundedTextSchema
  readonly saved_host: BoundedTextSchema
  readonly vault: Schema.Codec<SiteSecretVaultLabel>
  readonly action: Schema.Codec<SiteSecretAction>
}
type ItemFields = {
  readonly kind: Schema.Codec<SiteSecretRowKind>
  readonly secret_id: BoundedTextSchema
  readonly title: BoundedTextSchema
  readonly account: BoundedTextSchema
  readonly saved_host: BoundedTextSchema
}
type MatchesFields = {
  readonly items: Schema.Codec<SiteSecretItem[]>
}
type GroupFields = {
  readonly header: Schema.Codec<SiteSecretIdentityHeader>
  readonly rows: Schema.Codec<SiteSecretRow[]>
}
type ListedFields = {
  readonly kind: Schema.Codec<'Listed'>
  readonly groups: Schema.Codec<SiteSecretIdentityGroup[]>
}
type ShownHintFields = {
  readonly kind: Schema.Codec<'Shown'>
  readonly message_key: BoundedTextSchema
}
type AbsentHintFields = { readonly kind: Schema.Codec<'Absent'> }
type EmptyFields = {
  readonly kind: Schema.Codec<'Empty'>
  readonly message_key: BoundedTextSchema
  readonly hint: Schema.Codec<SiteSecretEmptyHint>
}

/**
 * Strict codec for the Rust-presented This-site listing the worker forwards
 * to the panel. It checks the shape and bounds every string; Rust already
 * filtered, grouped and ordered the rows and chose every translation key.
 */
export class SiteSecretListingCodec {
  private constructor() {}

  private static readonly IDENTIFIER_MAX_LENGTH = 256
  private static readonly TEXT_MAX_LENGTH = 1024

  private static readonly identifier: BoundedTextSchema = Schema.String.check(
    Schema.isBetweenLength(1, SiteSecretListingCodec.IDENTIFIER_MAX_LENGTH),
  )
  private static readonly text: BoundedTextSchema = Schema.String.check(
    Schema.isMaxLength(SiteSecretListingCodec.TEXT_MAX_LENGTH),
  )
  private static readonly key: BoundedTextSchema = Schema.String.check(
    Schema.isBetweenLength(1, SiteSecretListingCodec.IDENTIFIER_MAX_LENGTH),
  )
  // Keyed by every Rust kind, so a new kind cannot be left undecodable.
  private static readonly rowKinds: SiteSecretRowKinds = {
    Login: 'Login',
    Authenticator: 'Authenticator',
    Passkey: 'Passkey',
    ApiKey: 'ApiKey',
  }
  private static readonly namedFields: NamedLabelFields = {
    kind: Schema.Literal('Named'),
    name: SiteSecretListingCodec.text,
  }
  private static readonly unnamedFields: UnnamedLabelFields = {
    kind: Schema.Literal('Unnamed'),
    message_key: SiteSecretListingCodec.key,
  }
  private static readonly label: Schema.Codec<SiteSecretVaultLabel> =
    Schema.Union([
      Schema.Struct(SiteSecretListingCodec.namedFields),
      Schema.Struct(SiteSecretListingCodec.unnamedFields),
    ])
  private static readonly itemIdFields: ItemIdFields = {
    vault_store_id: SiteSecretListingCodec.identifier,
    secret_id: SiteSecretListingCodec.identifier,
  }
  private static readonly fillLoginFields: FillActionFields<'FillLogin'> = {
    kind: Schema.Literal('FillLogin'),
    label_key: SiteSecretListingCodec.key,
    accessible_label_key: SiteSecretListingCodec.key,
  }
  private static readonly fillCodeFields: FillActionFields<'FillCode'> = {
    kind: Schema.Literal('FillCode'),
    label_key: SiteSecretListingCodec.key,
    accessible_label_key: SiteSecretListingCodec.key,
  }
  private static readonly viewOnlyFields: ViewOnlyActionFields = {
    kind: Schema.Literal('ViewOnly'),
  }
  private static readonly rowFields: RowFields = {
    kind: Schema.Literals(Object.values(SiteSecretListingCodec.rowKinds)),
    item_id: Schema.Struct(SiteSecretListingCodec.itemIdFields),
    type_label_key: SiteSecretListingCodec.key,
    title: SiteSecretListingCodec.text,
    account: SiteSecretListingCodec.text,
    saved_host: SiteSecretListingCodec.text,
    vault: SiteSecretListingCodec.label,
    action: Schema.Union([
      Schema.Struct(SiteSecretListingCodec.fillLoginFields),
      Schema.Struct(SiteSecretListingCodec.fillCodeFields),
      Schema.Struct(SiteSecretListingCodec.viewOnlyFields),
    ]),
  }
  private static readonly groupFields: GroupFields = {
    header: SiteSecretListingCodec.label,
    rows: Schema.mutable(
      Schema.Array(Schema.Struct(SiteSecretListingCodec.rowFields)),
    ),
  }
  private static readonly listedFields: ListedFields = {
    kind: Schema.Literal('Listed'),
    groups: Schema.mutable(
      Schema.Array(Schema.Struct(SiteSecretListingCodec.groupFields)),
    ),
  }
  private static readonly shownHintFields: ShownHintFields = {
    kind: Schema.Literal('Shown'),
    message_key: SiteSecretListingCodec.key,
  }
  private static readonly absentHintFields: AbsentHintFields = {
    kind: Schema.Literal('Absent'),
  }
  private static readonly emptyFields: EmptyFields = {
    kind: Schema.Literal('Empty'),
    message_key: SiteSecretListingCodec.key,
    hint: Schema.Union([
      Schema.Struct(SiteSecretListingCodec.shownHintFields),
      Schema.Struct(SiteSecretListingCodec.absentHintFields),
    ]),
  }

  private static readonly itemFields: ItemFields = {
    kind: Schema.Literals(Object.values(SiteSecretListingCodec.rowKinds)),
    secret_id: SiteSecretListingCodec.identifier,
    title: SiteSecretListingCodec.text,
    account: SiteSecretListingCodec.text,
    saved_host: SiteSecretListingCodec.text,
  }
  private static readonly matchesFields: MatchesFields = {
    items: Schema.mutable(
      Schema.Array(Schema.Struct(SiteSecretListingCodec.itemFields)),
    ),
  }

  /** One vault's session answer, checked before Rust presents it. */
  static readonly matches: Schema.Codec<SiteSecretMatches> = Schema.Struct(
    SiteSecretListingCodec.matchesFields,
  )

  static readonly listing: Schema.Codec<SiteSecretListing> = Schema.Union([
    Schema.Struct(SiteSecretListingCodec.listedFields),
    Schema.Struct(SiteSecretListingCodec.emptyFields),
  ])
}
