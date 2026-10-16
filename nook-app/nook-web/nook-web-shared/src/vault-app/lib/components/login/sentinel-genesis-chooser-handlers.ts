import { SentinelGenesisActions } from "$lib/vault/sentinel-genesis";
import type { VaultState } from "$lib/vault.svelte";
import type {
  LoginCreateVaultChooserProps,
  SentinelGenesisParticipation,
} from "./login-create-vault-chooser-contract";

type SentinelGenesisChooserHandlers = Required<
  Pick<
    LoginCreateVaultChooserProps,
    | "onAddSentinelGenesisParticipantResponse"
    | "onFinalizeSentinelGenesis"
    | "onCreateSentinelGenesisParticipantResponse"
    | "onCreateSentinelGenesisPublicKeyAnnouncement"
    | "onRememberSentinelGenesisRequest"
    | "onReceiveSentinelGenesisShare"
    | "onCompleteSentinelGenesisDelivery"
  >
>;

/** Callers may supply their own participant response and key announcement. */
type SentinelGenesisChooserBindingRequest = {
  readonly vault: VaultState;
} & Pick<
  LoginCreateVaultChooserProps,
  | "onCreateSentinelGenesisParticipantResponse"
  | "onCreateSentinelGenesisPublicKeyAnnouncement"
>;

/** The create-vault chooser's Sentinel genesis steps, bound to one vault. */
export class SentinelGenesisChooserBinding {
  constructor(private readonly request: SentinelGenesisChooserBindingRequest) {}

  private actions(): SentinelGenesisActions {
    return new SentinelGenesisActions(this.request.vault);
  }

  handlers(): SentinelGenesisChooserHandlers {
    const {
      onCreateSentinelGenesisParticipantResponse,
      onCreateSentinelGenesisPublicKeyAnnouncement,
    } = this.request;
    return {
      onAddSentinelGenesisParticipantResponse: ({
        payload,
        participantLabel,
      }: SentinelGenesisParticipation) => {
        const participantRequest: Parameters<
          SentinelGenesisActions["addParticipantResponse"]
        >[0] = {
          payload,
          participantLabel: participantLabel ? participantLabel : "",
        };
        return this.actions().addParticipantResponse(participantRequest);
      },
      onFinalizeSentinelGenesis: () => this.actions().finalize(),
      onCreateSentinelGenesisParticipantResponse:
        onCreateSentinelGenesisParticipantResponse
          ? onCreateSentinelGenesisParticipantResponse
          : (requestPayload: string) => {
              const responseRequest: Parameters<
                SentinelGenesisActions["createParticipantResponse"]
              >[0] = { requestPayload };
              return this.actions().createParticipantResponse(responseRequest);
            },
      onCreateSentinelGenesisPublicKeyAnnouncement:
        onCreateSentinelGenesisPublicKeyAnnouncement
          ? onCreateSentinelGenesisPublicKeyAnnouncement
          : () => this.actions().createPublicKeyAnnouncement(),
      onRememberSentinelGenesisRequest: (requestPayload: string) => {
        const rememberRequest: Parameters<
          SentinelGenesisActions["rememberRequest"]
        >[0] = { requestPayload };
        return this.actions().rememberRequest(rememberRequest);
      },
      onReceiveSentinelGenesisShare: (payload: string) => {
        const shareRequest: Parameters<
          SentinelGenesisActions["acceptShareDelivery"]
        >[0] = { payload };
        return this.actions().acceptShareDelivery(shareRequest);
      },
      onCompleteSentinelGenesisDelivery: () =>
        this.actions().completeDelivery(),
    };
  }
}
