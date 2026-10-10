import { Effect } from "effect";
import {
  decode_extension_vault_event_log_response,
  type ExtensionVaultEventLogResponse,
} from "$app-wasm";
import type { ExtensionVaultEventLogRequestMessage } from "$web-shared/extension/nook-companion-wasm/nook_companion_wasm.js";
import {
  NativeVaultStorageFailure,
  VaultStorageFailure,
  VaultStorageFailureKind,
} from "$lib/runtime/storage-failure";
import {
  ExtensionMessageChannel,
  ExtensionMessageDeliveryKind,
  ExtensionMessageResponseWaitKind,
  EXTENSION_MESSAGE_TIMEOUT_MS,
} from "./extension-message-channel";
import type {
  ExtensionBrowserHost,
  ExtensionMessageRequest,
  ExtensionMessageDelivery,
} from "./extension-message-channel";
import type { ExtensionRuntimeResponseObject } from "./extension-response-decoders";

type VaultEventLogPullRequest = {
  readonly extensionId: string;
  readonly vault_store_id: string;
};
type ExportedVaultEventLog = Extract<
  ExtensionVaultEventLogResponse,
  { kind: "Exported" }
>;
type VaultEventLogResponseAdmission = {
  readonly response: ExtensionRuntimeResponseObject;
  readonly vault_store_id: string;
};
type VaultEventLogDeliveryReceipt = {
  readonly pull: VaultEventLogPullRequest;
  readonly received: ExtensionMessageDelivery;
};
type AdmittedVaultEventLogResponse = {
  readonly admission: VaultEventLogResponseAdmission;
  readonly decoded: ExtensionVaultEventLogResponse;
};

/** Owns the Chrome response boundary; Rust admits the requested store and signed-record shape. */
export class ExtensionVaultEventLogChannel {
  private readonly channel: ExtensionMessageChannel;
  constructor(browser: ExtensionBrowserHost) {
    this.channel = new ExtensionMessageChannel(browser);
  }

  pull(
    request: VaultEventLogPullRequest,
  ): Effect.Effect<ExtensionVaultEventLogResponse, VaultStorageFailure> {
    const message: ExtensionVaultEventLogRequestMessage = {
      type: "ExportVaultEventLog",
      payload: { vault_store_id: request.vault_store_id },
    };
    const delivery: ExtensionMessageRequest = {
      extensionId: request.extensionId,
      message,
      responseWait: {
        kind: ExtensionMessageResponseWaitKind.Bounded,
        timeoutMs: EXTENSION_MESSAGE_TIMEOUT_MS,
      },
    };
    const attempt: {
      readonly try: () => ReturnType<ExtensionMessageChannel["send"]>;
      readonly catch: (
        cause: ConstructorParameters<typeof NativeVaultStorageFailure>[0],
      ) => NativeVaultStorageFailure;
    } = {
      try: () => this.channel.send(delivery),
      catch: (cause) => new NativeVaultStorageFailure(cause),
    };
    return Effect.tryPromise(attempt).pipe(
      Effect.flatMap((received) => {
        const receipt: VaultEventLogDeliveryReceipt = {
          pull: request,
          received,
        };
        return this.receive(receipt);
      }),
    );
  }

  private receive(
    receipt: VaultEventLogDeliveryReceipt,
  ): Effect.Effect<ExtensionVaultEventLogResponse, VaultStorageFailure> {
    const { pull: request, received } = receipt;
    switch (received.kind) {
      case ExtensionMessageDeliveryKind.Unavailable:
        return Effect.fail(
          new VaultStorageFailure(
            VaultStorageFailureKind.ExtensionPublicationFailed,
          ),
        );
      case ExtensionMessageDeliveryKind.Received: {
        const admission: VaultEventLogResponseAdmission = {
          response: received.response,
          vault_store_id: request.vault_store_id,
        };
        return this.admit(admission);
      }
    }
  }

  private admit(
    request: VaultEventLogResponseAdmission,
  ): Effect.Effect<ExtensionVaultEventLogResponse, VaultStorageFailure> {
    const attempt: {
      readonly try: () => ExtensionVaultEventLogResponse;
      readonly catch: (
        cause: ConstructorParameters<typeof NativeVaultStorageFailure>[0],
      ) => NativeVaultStorageFailure;
    } = {
      try: () => {
        // This Chrome host value is untrusted; only Rust performs admission.
        /* eslint-disable @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/no-restricted-types -- The generated structural admission type cannot represent a raw Chrome response before Rust validates it. */
        return decode_extension_vault_event_log_response(
          request as unknown as Parameters<
            typeof decode_extension_vault_event_log_response
          >[0],
        );
        /* eslint-enable @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/no-restricted-types */
      },
      catch: (cause) => new NativeVaultStorageFailure(cause),
    };
    return Effect.try(attempt).pipe(
      Effect.map((decoded) => {
        const admitted: AdmittedVaultEventLogResponse = {
          admission: request,
          decoded,
        };
        return this.retainWireRecords(admitted);
      }),
    );
  }

  private retainWireRecords(
    admitted: AdmittedVaultEventLogResponse,
  ): ExtensionVaultEventLogResponse {
    const { admission: request, decoded } = admitted;
    switch (decoded.kind) {
      case "NotPaired":
      case "Rejected":
        return decoded;
      case "Exported": {
        // Rust has admitted this exact Chrome response. Retain its original
        // array so Rust serialization cannot alter signed numeric fields.
        /* eslint-disable @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/no-restricted-types -- Retain the original host array only after full Rust admission of this exact response. */
        const exported = request.response as unknown as ExportedVaultEventLog;
        /* eslint-enable @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/no-restricted-types */
        return {
          ...decoded,
          event_log_records: exported.event_log_records,
        };
      }
    }
  }
}
