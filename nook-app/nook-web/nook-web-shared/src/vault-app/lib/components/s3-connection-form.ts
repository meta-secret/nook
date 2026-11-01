import type { S3DraftField, S3DraftFieldError } from "$app-wasm";
import { I18N_KEYS, type I18nKey } from "../../../generated/i18n-keys";

/** The DOM type of one input. */
export enum S3InputType {
  Text = "text",
  Password = "password",
}

/** The keyboard an input asks for. */
export enum S3InputMode {
  Text = "text",
  Url = "url",
}

/** How wide an input sits from the small breakpoint up. */
export enum S3FieldWidth {
  Full = "sm:col-span-2",
  Half = "sm:col-span-1",
}

/** Whether an input says it may stay empty. */
export enum S3FieldRequirement {
  Required = "required",
  Optional = "optional",
}

/** What an input names: where the vault lives, or the key that reaches it.
 * A refused key points at the key inputs. */
export enum S3FieldRole {
  Location = "location",
  Key = "key",
}

export enum S3FieldPlaceholderKind {
  None = "none",
  Sample = "sample",
}

export type S3FieldPlaceholder =
  | { readonly kind: S3FieldPlaceholderKind.None }
  | { readonly kind: S3FieldPlaceholderKind.Sample; readonly key: I18nKey };

/** One input of the S3 form. */
export type S3FormField = {
  readonly name: S3DraftField;
  /** The kebab-case part of the input's HTML and test ids. */
  readonly slug: string;
  readonly label: I18nKey;
  readonly placeholder: S3FieldPlaceholder;
  readonly type: S3InputType;
  readonly inputMode: S3InputMode;
  readonly width: S3FieldWidth;
  readonly requirement: S3FieldRequirement;
  readonly role: S3FieldRole;
};

export type S3FormFields = readonly S3FormField[];

/** The fields Rust found wrong, each once, in form order. */
export type S3FieldErrors = readonly S3DraftFieldError[];

/** What the form's one action does in its host. */
export enum S3ConnectionSubmit {
  /** First run: read the location's keyrings. */
  Connect = "connect",
  /** A setup wizard: save the provider and sync. */
  ConnectAndSync = "connect-and-sync",
}

/** How far a connection attempt is. */
export enum S3ConnectionProgress {
  Idle = "idle",
  Connecting = "connecting",
  /** The vault engine is still starting. */
  LoadingEngine = "loading-engine",
}

/** Whether Connect may run now. */
export enum S3ConnectAvailability {
  Available = "available",
  /** The recovery question above Connect is still unanswered. */
  AwaitingRecoveryAnswer = "awaiting-recovery-answer",
}

/** Whether the form draws the panel it sits in. */
export enum S3ConnectionFrame {
  /** First run: the form is the panel the user acts in. */
  Panel = "panel",
  /** Inside a wizard step, which already is that panel. */
  Step = "step",
}

/** What stopped a connection attempt, as the alert's data-failure names it. */
export enum S3ConnectionFailureKind {
  /** The server refused the key. */
  AccessDenied = "access-denied",
  /** The location could not be listed for another reason. */
  ListFailed = "list-failed",
  /** A failure the host reported only by its message. */
  Other = "other",
}

export enum S3ConnectionAlertKind {
  None = "none",
  Shown = "shown",
}

/** The form's one alert, for failures that belong to no single field. */
export type S3ConnectionAlert =
  | { readonly kind: S3ConnectionAlertKind.None }
  | {
      readonly kind: S3ConnectionAlertKind.Shown;
      readonly failure: S3ConnectionFailureKind;
      readonly message: string;
    };

/** The S3 setup form's inputs, in the order Rust reports wrong fields. */
export class S3ConnectionForm {
  constructor(private readonly idPrefix: string) {}

  inputId(field: S3FormField): string {
    return `${this.idPrefix}-s3-${field.slug}`;
  }

  errorId(field: S3FormField): string {
    return `${this.inputId(field)}-error`;
  }

  get noteId(): string {
    return `${this.idPrefix}-s3-secret-note`;
  }

  get alertId(): string {
    return `${this.idPrefix}-s3-connection-error`;
  }

  static readonly FIELDS: S3FormFields = [
    {
      name: "endpoint",
      slug: "endpoint",
      label: I18N_KEYS.ProviderSetupS3EndpointLabel,
      placeholder: {
        kind: S3FieldPlaceholderKind.Sample,
        key: I18N_KEYS.ProviderSetupS3EndpointPlaceholder,
      },
      type: S3InputType.Text,
      inputMode: S3InputMode.Url,
      width: S3FieldWidth.Full,
      requirement: S3FieldRequirement.Required,
      role: S3FieldRole.Location,
    },
    {
      name: "region",
      slug: "region",
      label: I18N_KEYS.ProviderSetupS3RegionLabel,
      placeholder: {
        kind: S3FieldPlaceholderKind.Sample,
        key: I18N_KEYS.ProviderSetupS3RegionPlaceholder,
      },
      type: S3InputType.Text,
      inputMode: S3InputMode.Text,
      width: S3FieldWidth.Half,
      requirement: S3FieldRequirement.Required,
      role: S3FieldRole.Location,
    },
    {
      name: "bucket",
      slug: "bucket",
      label: I18N_KEYS.ProviderSetupS3BucketLabel,
      placeholder: {
        kind: S3FieldPlaceholderKind.Sample,
        key: I18N_KEYS.ProviderSetupS3BucketPlaceholder,
      },
      type: S3InputType.Text,
      inputMode: S3InputMode.Text,
      width: S3FieldWidth.Half,
      requirement: S3FieldRequirement.Required,
      role: S3FieldRole.Location,
    },
    {
      name: "keyPrefix",
      slug: "key-prefix",
      label: I18N_KEYS.ProviderSetupS3KeyPrefixLabel,
      placeholder: {
        kind: S3FieldPlaceholderKind.Sample,
        key: I18N_KEYS.ProviderSetupS3KeyPrefixPlaceholder,
      },
      type: S3InputType.Text,
      inputMode: S3InputMode.Text,
      width: S3FieldWidth.Full,
      requirement: S3FieldRequirement.Optional,
      role: S3FieldRole.Location,
    },
    {
      name: "accessKeyId",
      slug: "access-key-id",
      label: I18N_KEYS.ProviderSetupS3AccessKeyIdLabel,
      placeholder: {
        kind: S3FieldPlaceholderKind.Sample,
        key: I18N_KEYS.ProviderSetupS3AccessKeyIdPlaceholder,
      },
      type: S3InputType.Text,
      inputMode: S3InputMode.Text,
      width: S3FieldWidth.Full,
      requirement: S3FieldRequirement.Required,
      role: S3FieldRole.Key,
    },
    {
      name: "secretAccessKey",
      slug: "secret-access-key",
      label: I18N_KEYS.ProviderSetupS3SecretAccessKeyLabel,
      placeholder: { kind: S3FieldPlaceholderKind.None },
      type: S3InputType.Password,
      inputMode: S3InputMode.Text,
      width: S3FieldWidth.Full,
      requirement: S3FieldRequirement.Required,
      role: S3FieldRole.Key,
    },
  ];
}
