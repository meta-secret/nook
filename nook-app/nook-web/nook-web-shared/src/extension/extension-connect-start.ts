import { Effect, Schema } from "effect";

/**
 * What the person chose in the side panel before Nook's connect page
 * opened: name a first vault, or join with an identity they already use.
 * The choice travels in the connect URL's fragment, which never reaches the
 * server, so the page continues the step the panel started instead of
 * opening on its first-vault screen unannounced.
 */
export enum ExtensionConnectStartKind {
  /** Nothing chosen: the connect page shows its own first screen. */
  Unspecified = "unspecified",
  Create = "create",
  Join = "join",
}

export type ExtensionConnectStart =
  | { readonly kind: ExtensionConnectStartKind.Unspecified }
  | {
      readonly kind: ExtensionConnectStartKind.Create;
      readonly vaultName: string;
    }
  | { readonly kind: ExtensionConnectStartKind.Join };

/** The first-vault field's own limit on the connect page. */
const VAULT_NAME_MAX_LENGTH = 64;

const startKindParam = "start";
const vaultNameParam = "vault_name";

const vaultNameSchema = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(VAULT_NAME_MAX_LENGTH)),
);
const createKindSchema = Schema.Literal(ExtensionConnectStartKind.Create);
const joinKindSchema = Schema.Literal(ExtensionConnectStartKind.Join);
const unspecifiedKindSchema = Schema.Literal(
  ExtensionConnectStartKind.Unspecified,
);
type CreateStartFields = {
  readonly kind: typeof createKindSchema;
  readonly vaultName: typeof vaultNameSchema;
};
const createStartFields: CreateStartFields = {
  kind: createKindSchema,
  vaultName: vaultNameSchema,
};
type JoinStartFields = { readonly kind: typeof joinKindSchema };
const joinStartFields: JoinStartFields = { kind: joinKindSchema };
type UnspecifiedStartFields = { readonly kind: typeof unspecifiedKindSchema };
const unspecifiedStartFields: UnspecifiedStartFields = {
  kind: unspecifiedKindSchema,
};

/** The start as the side panel sends it to the service worker. */
export const ExtensionConnectStartSchema = Schema.Union([
  Schema.Struct(unspecifiedStartFields),
  Schema.Struct(createStartFields),
  Schema.Struct(joinStartFields),
]);

export class ExtensionConnectStarts {
  private constructor() {}

  static unspecified(): ExtensionConnectStart {
    return { kind: ExtensionConnectStartKind.Unspecified };
  }

  /** The fragment the service worker puts on the connect URL; empty when
   * nothing was chosen. */
  static fragment(start: ExtensionConnectStart): string {
    switch (start.kind) {
      case ExtensionConnectStartKind.Unspecified:
        return "";
      case ExtensionConnectStartKind.Join: {
        const join: Record<string, string> = { [startKindParam]: start.kind };
        return new URLSearchParams(join).toString();
      }
      case ExtensionConnectStartKind.Create: {
        const create: Record<string, string> = {
          [startKindParam]: start.kind,
          [vaultNameParam]: start.vaultName,
        };
        return new URLSearchParams(create).toString();
      }
    }
  }

  /** The first vault's name the panel was given; empty otherwise. */
  static presetVaultName(start: ExtensionConnectStart): string {
    switch (start.kind) {
      case ExtensionConnectStartKind.Create:
        return start.vaultName;
      case ExtensionConnectStartKind.Join:
      case ExtensionConnectStartKind.Unspecified:
        return "";
    }
  }

  /** The person said they already use Nook: the page opens on joining. */
  static opensJoin(start: ExtensionConnectStart): boolean {
    switch (start.kind) {
      case ExtensionConnectStartKind.Join:
        return true;
      case ExtensionConnectStartKind.Create:
      case ExtensionConnectStartKind.Unspecified:
        return false;
    }
  }

  /** The connect page's read of that fragment. Anything it cannot read is
   * no choice, and the page shows its own first screen. */
  static fromFragment(hash: string): ExtensionConnectStart {
    const params = new URLSearchParams(hash.replace(/^#/, ""));
    const candidate: Record<string, string> = {};
    for (const [key, field] of [
      [startKindParam, "kind"],
      [vaultNameParam, "vaultName"],
    ] as const) {
      const value = params.get(key)?.trim();
      if (value) candidate[field] = value;
    }
    const decoded = Effect.runSync(
      Effect.result(
        Schema.decodeUnknownEffect(ExtensionConnectStartSchema)(candidate),
      ),
    );
    switch (decoded._tag) {
      case "Success":
        return decoded.success;
      case "Failure":
        return ExtensionConnectStarts.unspecified();
    }
  }
}
