import { DEFAULT_SITE_URL } from "$lib/content/sitemap";
import { Effect, Schema } from "effect";
import {
  InstalledExtensionRuntimeKind,
  extensionConnectionBrowser,
} from "$lib/extension/connect";
import { ExtensionPairedVaultIdentityStatusMessageStatus } from "$web-shared/extension/paired-vault-identity-status";
import {
  ActiveVaultKind,
  type ActiveVault,
} from "$lib/vault/state/provider.svelte";

export enum ExtensionInstallMethod {
  ChromeWebStore = "chrome_web_store",
  ManualZip = "manual_zip",
}

export enum ExtensionInstallSource {
  Metadata = "metadata",
  Fallback = "fallback",
}

export type ExtensionInstallTarget = {
  installMethod: ExtensionInstallMethod;
  installUrl: string;
  channel?: string;
  version?: string;
  source: ExtensionInstallSource;
};

export enum ExtensionSetupStatus {
  NotInstalled = "not_installed",
  InstalledUnpaired = "installed_unpaired",
  PairedElsewhere = "paired_elsewhere",
  Paired = "paired",
}

export type ExtensionSetupState =
  | { status: ExtensionSetupStatus.NotInstalled }
  | { status: ExtensionSetupStatus.InstalledUnpaired }
  | { status: ExtensionSetupStatus.Paired }
  | {
      status: ExtensionSetupStatus.PairedElsewhere;
      connectedVaultName: string;
      connectedVaultStoreId: string;
    };

type BrowserExtensionEnvironment = {
  maxTouchPoints: number;
  platform: string;
  userAgent: string;
  userAgentData?: Navigator["userAgentData"] | { mobile?: boolean };
};

type ExtensionDeploymentMetadata = {
  channel: string;
  version: string;
  extension_id: string;
  install_method: ExtensionInstallMethod;
  install_url: string;
};

enum ExtensionMetadataParseKind {
  Invalid = "invalid",
  Valid = "valid",
}

type ExtensionMetadataParse =
  | { kind: ExtensionMetadataParseKind.Invalid }
  | {
      kind: ExtensionMetadataParseKind.Valid;
      metadata: ExtensionDeploymentMetadata;
    };

export enum ExtensionDeploymentMetadataDecodeFailureKind {
  Invalid = "invalid-extension-deployment-metadata",
}

export class ExtensionDeploymentMetadataDecodeFailure extends Error {
  readonly _tag = "ExtensionDeploymentMetadataDecodeFailure";

  constructor(
    readonly kind: ExtensionDeploymentMetadataDecodeFailureKind,
    readonly cause: unknown,
  ) {
    super(kind);
  }
}

const ExtensionDeploymentMetadataSchema = Schema.Struct({
  channel: Schema.String.pipe(Schema.minLength(1)),
  version: Schema.String.pipe(Schema.minLength(1)),
  extension_id: Schema.String.pipe(Schema.minLength(1)),
  install_method: Schema.Literal(
    ExtensionInstallMethod.ChromeWebStore,
    ExtensionInstallMethod.ManualZip,
  ),
  install_url: Schema.String.pipe(Schema.minLength(1)),
});

export class ExtensionDeploymentMetadataDecoder {
  private constructor() {}

  static decode(
    value: unknown,
  ): Effect.Effect<
    ExtensionDeploymentMetadata,
    ExtensionDeploymentMetadataDecodeFailure
  > {
    return Schema.decodeUnknown(ExtensionDeploymentMetadataSchema)(
      value,
    ).pipe(
      Effect.mapError(
        (cause) =>
          new ExtensionDeploymentMetadataDecodeFailure(
            ExtensionDeploymentMetadataDecodeFailureKind.Invalid,
            cause,
          ),
      ),
      Effect.flatMap((metadata) => {
        const installUrl = metadata.install_url.trim();
        return Effect.try({
          try: () => new URL(installUrl),
          catch: (cause) =>
            new ExtensionDeploymentMetadataDecodeFailure(
              ExtensionDeploymentMetadataDecodeFailureKind.Invalid,
              cause,
            ),
        }).pipe(
          Effect.flatMap((parsedUrl) =>
            parsedUrl.protocol === "https:" || parsedUrl.protocol === "http:"
              ? Effect.succeed({ ...metadata, install_url: installUrl })
              : Effect.fail(
                  new ExtensionDeploymentMetadataDecodeFailure(
                    ExtensionDeploymentMetadataDecodeFailureKind.Invalid,
                    parsedUrl.protocol,
                  ),
                ),
          ),
        );
      }),
    );
  }
}

enum ExtensionMetadataFetchKind {
  Unavailable = "unavailable",
  Loaded = "loaded",
}

type ExtensionMetadataFetch =
  | { kind: ExtensionMetadataFetchKind.Unavailable }
  | {
      kind: ExtensionMetadataFetchKind.Loaded;
      metadata: ExtensionDeploymentMetadata;
    };

type ExtensionSetupOfferContext = {
  readonly status: ExtensionSetupStatus;
  readonly environment: BrowserExtensionEnvironment;
};

/** Owns this browser host’s resources and interaction lifecycle. */
class ExtensionInstallationBrowser {
  constructor(private readonly browser: typeof globalThis) {}

  private marketingSiteBaseUrl(): string {
    const fromEnv = import.meta.env.VITE_SITE_URL?.trim();
    if (fromEnv) return fromEnv.replace(/\/$/, "");
    return DEFAULT_SITE_URL;
  }

  extensionInstallLandingUrl(): string {
    return `${this.marketingSiteBaseUrl()}/#browser-extension`;
  }

  browserSupportsExtensionInstallation(
    environment: BrowserExtensionEnvironment,
  ): boolean {
    const userAgentData = environment.userAgentData;
    if (
      userAgentData &&
      "mobile" in userAgentData &&
      userAgentData.mobile === true
    ) {
      return false;
    }

    if (
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobi/i.test(
        environment.userAgent,
      )
    ) {
      return false;
    }

    const isDesktopModeIPad =
      /Macintosh/i.test(environment.userAgent) &&
      environment.platform === "MacIntel" &&
      environment.maxTouchPoints > 1;
    return !isDesktopModeIPad;
  }

  shouldOfferExtensionSetup({
    status,
    environment,
  }: ExtensionSetupOfferContext): boolean {
    return (
      status !== ExtensionSetupStatus.NotInstalled ||
      this.browserSupportsExtensionInstallation(environment)
    );
  }

  private parseExtensionMetadata(value: unknown): ExtensionMetadataParse {
    const decoded = Effect.runSync(
      Effect.either(ExtensionDeploymentMetadataDecoder.decode(value)),
    );
    if (decoded._tag === "Left") {
      return { kind: ExtensionMetadataParseKind.Invalid };
    }
    return {
      kind: ExtensionMetadataParseKind.Valid,
      metadata: decoded.right,
    };
  }

  private metadataCandidateUrls(): string[] {
    const urls = [
      new URL("./downloads/extension.json", this.browser.window.location.href)
        .href,
      `${this.marketingSiteBaseUrl()}/downloads/extension.json`,
    ];
    return [...new Set(urls)];
  }

  private async fetchExtensionMetadata(
    url: string,
  ): Promise<ExtensionMetadataFetch> {
    try {
      const fetchArgs: Parameters<typeof fetch>[1] = {
        cache: "no-store",
        headers: { Accept: "application/json" },
      };
      const response = await fetch(url, fetchArgs);
      if (!response.ok) return { kind: ExtensionMetadataFetchKind.Unavailable };
      const parsed = this.parseExtensionMetadata(await response.json());
      return parsed.kind === ExtensionMetadataParseKind.Valid
        ? {
            kind: ExtensionMetadataFetchKind.Loaded,
            metadata: parsed.metadata,
          }
        : { kind: ExtensionMetadataFetchKind.Unavailable };
    } catch {
      return { kind: ExtensionMetadataFetchKind.Unavailable };
    }
  }

  async loadExtensionInstallTarget(): Promise<ExtensionInstallTarget> {
    for (const url of this.metadataCandidateUrls()) {
      const metadata = await this.fetchExtensionMetadata(url);
      if (metadata.kind !== ExtensionMetadataFetchKind.Loaded) continue;
      return {
        installMethod: metadata.metadata.install_method,
        installUrl: metadata.metadata.install_url,
        channel: metadata.metadata.channel,
        version: metadata.metadata.version,
        source: ExtensionInstallSource.Metadata,
      };
    }
    return {
      installMethod: ExtensionInstallMethod.ManualZip,
      installUrl: this.extensionInstallLandingUrl(),
      source: ExtensionInstallSource.Fallback,
    };
  }

  async resolveExtensionSetupState(
    activeVault: ActiveVault,
  ): Promise<ExtensionSetupState> {
    if (
      extensionConnectionBrowser.readInstalledExtensionRuntimeId().kind ===
      InstalledExtensionRuntimeKind.NotInstalled
    ) {
      return { status: ExtensionSetupStatus.NotInstalled };
    }
    if (activeVault.kind === ActiveVaultKind.Closed) {
      return { status: ExtensionSetupStatus.InstalledUnpaired };
    }

    const discovery =
      await extensionConnectionBrowser.discoverPairedExtensionIdentity(
        activeVault.storeId,
      );
    if (
      discovery.status ===
        ExtensionPairedVaultIdentityStatusMessageStatus.Locked ||
      discovery.status ===
        ExtensionPairedVaultIdentityStatusMessageStatus.Unlocked
    ) {
      return { status: ExtensionSetupStatus.Paired };
    }
    if (
      discovery.status ===
      ExtensionPairedVaultIdentityStatusMessageStatus.DifferentVault
    ) {
      return {
        status: ExtensionSetupStatus.PairedElsewhere,
        connectedVaultName: discovery.connectedVaultName,
        connectedVaultStoreId: discovery.connectedVaultStoreId,
      };
    }
    return { status: ExtensionSetupStatus.InstalledUnpaired };
  }

  openExtensionInstallTarget(target: ExtensionInstallTarget): void {
    this.browser.window.open(
      target.installUrl,
      "_blank",
      "noopener,noreferrer",
    );
  }
}

export const extensionInstallationBrowser = new ExtensionInstallationBrowser(
  globalThis,
);
