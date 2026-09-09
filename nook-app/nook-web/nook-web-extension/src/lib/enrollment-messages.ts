import { OriginRuntimeMessage as OriginRuntimeMessageSchema } from './origin-runtime-message'

export enum WebsiteAuthenticatorEnrollPreviewMessageType {
  NookWebsiteAuthenticatorEnrollPreview = 'nook:website-authenticator-enroll-preview',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class WebsiteAuthenticatorEnrollPreviewMessage {
  private constructor() {}
  declare readonly type: WebsiteAuthenticatorEnrollPreviewMessageType.NookWebsiteAuthenticatorEnrollPreview
  declare readonly payload: {
    origin: string
    otpauthUri: string
  }
  static isOtpauthTotpUri(value: string): value is string {
    return typeof value === 'string' && value.startsWith('otpauth://totp/')
  }

  static is(
    message: unknown,
  ): message is WebsiteAuthenticatorEnrollPreviewMessage {
    if (
      !OriginRuntimeMessageSchema.is(message) ||
      message.type !==
        WebsiteAuthenticatorEnrollPreviewMessageType.NookWebsiteAuthenticatorEnrollPreview
    ) {
      return false
    }
    const payload =
      message.payload as WebsiteAuthenticatorEnrollPreviewMessage['payload']

    return WebsiteAuthenticatorEnrollPreviewMessage.isOtpauthTotpUri(
      payload.otpauthUri,
    )
  }
}

export enum WebsiteAuthenticatorEnrollStageMessageType {
  NookWebsiteAuthenticatorEnrollStage = 'nook:website-authenticator-enroll-stage',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class WebsiteAuthenticatorEnrollStageMessage {
  private constructor() {}
  declare readonly type: WebsiteAuthenticatorEnrollStageMessageType.NookWebsiteAuthenticatorEnrollStage
  declare readonly payload: {
    origin: string
    vaultStoreId: string
    otpauthUri: string
  }
  static is(
    message: unknown,
  ): message is WebsiteAuthenticatorEnrollStageMessage {
    if (
      !OriginRuntimeMessageSchema.is(message) ||
      message.type !==
        WebsiteAuthenticatorEnrollStageMessageType.NookWebsiteAuthenticatorEnrollStage
    ) {
      return false
    }
    const payload =
      message.payload as WebsiteAuthenticatorEnrollStageMessage['payload']

    return (
      typeof payload.vaultStoreId === 'string' &&
      payload.vaultStoreId.length > 0 &&
      WebsiteAuthenticatorEnrollPreviewMessage.isOtpauthTotpUri(
        payload.otpauthUri,
      )
    )
  }
}

export enum WebsiteAuthenticatorEnrollCodeMessageType {
  NookWebsiteAuthenticatorEnrollCode = 'nook:website-authenticator-enroll-code',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class WebsiteAuthenticatorEnrollCodeMessage {
  private constructor() {}
  declare readonly type: WebsiteAuthenticatorEnrollCodeMessageType.NookWebsiteAuthenticatorEnrollCode
  declare readonly payload: {
    origin: string
    stageId: string
  }
  static is(
    message: unknown,
  ): message is WebsiteAuthenticatorEnrollCodeMessage {
    if (
      !OriginRuntimeMessageSchema.is(message) ||
      message.type !==
        WebsiteAuthenticatorEnrollCodeMessageType.NookWebsiteAuthenticatorEnrollCode
    ) {
      return false
    }
    const payload =
      message.payload as WebsiteAuthenticatorEnrollCodeMessage['payload']

    return typeof payload.stageId === 'string' && payload.stageId.length > 0
  }
}

export enum WebsiteAuthenticatorEnrollConfirmMessageType {
  NookWebsiteAuthenticatorEnrollConfirm = 'nook:website-authenticator-enroll-confirm',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class WebsiteAuthenticatorEnrollConfirmMessage {
  private constructor() {}
  declare readonly type: WebsiteAuthenticatorEnrollConfirmMessageType.NookWebsiteAuthenticatorEnrollConfirm
  declare readonly payload: {
    origin: string
    vaultStoreId: string
    stageId: string
  }
  static is(
    message: unknown,
  ): message is WebsiteAuthenticatorEnrollConfirmMessage {
    if (
      !OriginRuntimeMessageSchema.is(message) ||
      message.type !==
        WebsiteAuthenticatorEnrollConfirmMessageType.NookWebsiteAuthenticatorEnrollConfirm
    ) {
      return false
    }
    const payload =
      message.payload as WebsiteAuthenticatorEnrollConfirmMessage['payload']

    return (
      typeof payload.vaultStoreId === 'string' &&
      payload.vaultStoreId.length > 0 &&
      typeof payload.stageId === 'string' &&
      payload.stageId.length > 0
    )
  }
}

export enum WebsiteAuthenticatorEnrollDismissMessageType {
  NookWebsiteAuthenticatorEnrollDismiss = 'nook:website-authenticator-enroll-dismiss',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class WebsiteAuthenticatorEnrollDismissMessage {
  private constructor() {}
  declare readonly type: WebsiteAuthenticatorEnrollDismissMessageType.NookWebsiteAuthenticatorEnrollDismiss
  declare readonly payload: {
    origin: string
    stageId: string
  }
  static is(
    message: unknown,
  ): message is WebsiteAuthenticatorEnrollDismissMessage {
    if (
      !OriginRuntimeMessageSchema.is(message) ||
      message.type !==
        WebsiteAuthenticatorEnrollDismissMessageType.NookWebsiteAuthenticatorEnrollDismiss
    ) {
      return false
    }
    const payload =
      message.payload as WebsiteAuthenticatorEnrollDismissMessage['payload']

    return typeof payload.stageId === 'string' && payload.stageId.length > 0
  }
}

export enum WebsiteAuthenticatorEnrollPendingMessageType {
  NookWebsiteAuthenticatorEnrollPending = 'nook:website-authenticator-enroll-pending',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class WebsiteAuthenticatorEnrollPendingMessage {
  private constructor() {}
  declare readonly type: WebsiteAuthenticatorEnrollPendingMessageType.NookWebsiteAuthenticatorEnrollPending
  declare readonly payload: {
    origin: string
  }
  static is(
    message: unknown,
  ): message is WebsiteAuthenticatorEnrollPendingMessage {
    return (
      OriginRuntimeMessageSchema.is(message) &&
      message.type ===
        WebsiteAuthenticatorEnrollPendingMessageType.NookWebsiteAuthenticatorEnrollPending
    )
  }
}

export enum WebsiteAuthenticatorBackupAttachMessageType {
  NookWebsiteAuthenticatorBackupAttach = 'nook:website-authenticator-backup-attach',
}

export enum WebsiteAuthenticatorBackupAttachMessageMode {
  Replace = 'replace',
  Merge = 'merge',
}

/** Structural browser wire value; validation requires no instance methods or runtime state. */
export class WebsiteAuthenticatorBackupAttachMessage {
  private constructor() {}
  declare readonly type: WebsiteAuthenticatorBackupAttachMessageType.NookWebsiteAuthenticatorBackupAttach
  declare readonly payload: {
    origin: string
    vaultStoreId: string
    secretId: string
    codes: string[]
    mode:
      | WebsiteAuthenticatorBackupAttachMessageMode.Replace
      | WebsiteAuthenticatorBackupAttachMessageMode.Merge
  }
  static is(
    message: unknown,
  ): message is WebsiteAuthenticatorBackupAttachMessage {
    if (
      !OriginRuntimeMessageSchema.is(message) ||
      message.type !==
        WebsiteAuthenticatorBackupAttachMessageType.NookWebsiteAuthenticatorBackupAttach
    ) {
      return false
    }
    const payload =
      message.payload as WebsiteAuthenticatorBackupAttachMessage['payload']

    return (
      typeof payload.vaultStoreId === 'string' &&
      payload.vaultStoreId.length > 0 &&
      typeof payload.secretId === 'string' &&
      payload.secretId.length > 0 &&
      Array.isArray(payload.codes) &&
      payload.codes.every((code) => typeof code === 'string') &&
      (payload.mode === WebsiteAuthenticatorBackupAttachMessageMode.Replace ||
        payload.mode === WebsiteAuthenticatorBackupAttachMessageMode.Merge)
    )
  }
}

export type OtpauthEnrollmentPreview = {
  issuer: string
  account: string
  websiteUrl: string
  algorithm: string
  digits: number
  period: number
}
