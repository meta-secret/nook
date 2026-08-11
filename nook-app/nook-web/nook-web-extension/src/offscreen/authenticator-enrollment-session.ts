import {
  current_code_from_otpauth_uri,
  preview_otpauth_uri,
  type NookVaultManager,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import type initNookWasm from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { ExtensionSessionMessageType } from './session-message-dispatch'
import type { ExtensionSessionRequest } from './session-request-adapter'
import {
  type ExtensionVaultGrant,
  flushPasskeyEventToProviders,
  openPasskeyVault,
} from './session-vault-operations'

type AuthenticatorEnrollmentMessage = Extract<
  ExtensionSessionRequest,
  {
    type:
      | ExtensionSessionMessageType.AuthenticatorEnrollPreview
      | ExtensionSessionMessageType.AuthenticatorEnrollCode
      | ExtensionSessionMessageType.AuthenticatorEnrollConfirm
      | ExtensionSessionMessageType.AuthenticatorBackupAttach
  }
>

type AuthenticatorEnrollmentSessionDependencies = {
  ensureWasm: () => ReturnType<typeof initNookWasm>
  getManager: () => Promise<NookVaultManager>
  extensionVaultGrant: (payload: {
    vaultStoreId: string
    deviceId: string
    devicePublicKey: string
    deviceSigningPublicKey: string
  }) => ExtensionVaultGrant
}

export async function handleAuthenticatorEnrollmentMessage({
  message,
  dependencies,
}: {
  message: AuthenticatorEnrollmentMessage
  dependencies: AuthenticatorEnrollmentSessionDependencies
}) {
  switch (message.type) {
    case ExtensionSessionMessageType.AuthenticatorEnrollPreview: {
      const payload = message.payload
      if (typeof payload.otpauthUri !== 'string') {
        throw new Error('Extension session received an invalid otpauth URI.')
      }
      await dependencies.ensureWasm()
      const preview = preview_otpauth_uri(payload.otpauthUri)
      try {
        return {
          ok: true,
          preview: {
            issuer: preview.issuer,
            account: preview.account,
            websiteUrl: preview.websiteUrl,
            algorithm: preview.algorithm,
            digits: preview.digits,
            period: preview.period,
          },
        }
      } finally {
        preview.free()
      }
    }
    case ExtensionSessionMessageType.AuthenticatorEnrollCode: {
      const payload = message.payload
      if (typeof payload.otpauthUri !== 'string') {
        throw new Error('Extension session received an invalid otpauth URI.')
      }
      await dependencies.ensureWasm()
      const code = current_code_from_otpauth_uri(payload.otpauthUri)
      try {
        return { ok: true, code: code.code }
      } finally {
        code.free()
      }
    }
    case ExtensionSessionMessageType.AuthenticatorEnrollConfirm: {
      const payload = message.payload
      const grant = dependencies.extensionVaultGrant(payload)
      if (
        typeof payload.otpauthUri !== 'string' ||
        typeof payload.origin !== 'string'
      ) {
        throw new Error('Extension session received an invalid enrollment.')
      }
      const activeManager = await dependencies.getManager()
      const openArgs: Parameters<typeof openPasskeyVault>[0] = {
        activeManager,
        grant,
      }
      await openPasskeyVault(openArgs)
      const secretId = await activeManager.add_authenticator_from_otpauth_js(
        payload.otpauthUri,
        payload.origin,
      )
      const flushArgs: Parameters<typeof flushPasskeyEventToProviders>[0] = {
        activeManager,
        vaultStoreId: grant.vaultStoreId,
      }
      await flushPasskeyEventToProviders(flushArgs)
      return { ok: true, secretId }
    }
    case ExtensionSessionMessageType.AuthenticatorBackupAttach: {
      const payload = message.payload
      const grant = dependencies.extensionVaultGrant(payload)
      if (
        typeof payload.secretId !== 'string' ||
        typeof payload.mode !== 'string' ||
        !Array.isArray(payload.codes) ||
        !payload.codes.every((code) => typeof code === 'string')
      ) {
        throw new Error(
          'Extension session received an invalid backup-code attach.',
        )
      }
      const activeManager = await dependencies.getManager()
      const openArgs: Parameters<typeof openPasskeyVault>[0] = {
        activeManager,
        grant,
      }
      await openPasskeyVault(openArgs)
      const attachResult =
        await activeManager.attach_authenticator_backup_codes_js(
          payload.secretId,
          payload.codes,
          payload.mode,
        )
      try {
        if (!attachResult.backupCodesVerified) {
          throw new Error(
            'Extension session could not verify persisted backup codes.',
          )
        }
        if (!attachResult.reviewed_input_persisted) {
          throw new Error(
            'Extension session could not verify the reviewed backup codes.',
          )
        }
        const flushArgs: Parameters<typeof flushPasskeyEventToProviders>[0] = {
          activeManager,
          vaultStoreId: grant.vaultStoreId,
        }
        await flushPasskeyEventToProviders(flushArgs)
        return {
          ok: true,
          secretId: attachResult.secretId,
          backupCodesVerified: true,
          reviewedInputPersisted: true,
        }
      } finally {
        attachResult.free()
      }
    }
  }
}
