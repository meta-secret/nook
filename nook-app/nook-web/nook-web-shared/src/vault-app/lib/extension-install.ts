import { DEFAULT_SITE_URL } from "$lib/sitemap";
import {
  discoverPairedExtensionIdentity,
  readInstalledExtensionRuntimeId,
} from "$lib/extension-connect";

export type ExtensionInstallMethod = "chrome_web_store" | "manual_zip";

export type ExtensionInstallTarget = {
  installMethod: ExtensionInstallMethod;
  installUrl: string;
  channel?: string;
  version?: string;
  source: "metadata" | "fallback";
};

export type ExtensionSetupStatus =
  | "not_installed"
  | "installed_unpaired"
  | "paired";

type BrowserExtensionEnvironment = {
  maxTouchPoints: number;
  platform: string;
  userAgent: string;
  userAgentData?: {
    mobile: boolean;
  };
};

type ExtensionDeploymentMetadata = {
  channel: string;
  version: string;
  extension_id: string;
  install_method: ExtensionInstallMethod;
  install_url: string;
};

function marketingSiteBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_SITE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return DEFAULT_SITE_URL;
}

export function extensionInstallLandingUrl(): string {
  return `${marketingSiteBaseUrl()}/#browser-extension`;
}

export function browserSupportsExtensionInstallation(
  environment: BrowserExtensionEnvironment = navigator,
): boolean {
  if (environment.userAgentData) {
    return !environment.userAgentData.mobile;
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

export function shouldOfferExtensionSetup(
  status: ExtensionSetupStatus,
  environment: BrowserExtensionEnvironment = navigator,
): boolean {
  return (
    status !== "not_installed" ||
    browserSupportsExtensionInstallation(environment)
  );
}

function isExtensionInstallMethod(
  value: unknown,
): value is ExtensionInstallMethod {
  return value === "chrome_web_store" || value === "manual_zip";
}

function parseExtensionMetadata(
  value: unknown,
): ExtensionDeploymentMetadata | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const channel = typeof record.channel === "string" ? record.channel : "";
  const version = typeof record.version === "string" ? record.version : "";
  const extensionId =
    typeof record.extension_id === "string" ? record.extension_id : "";
  const installUrl =
    typeof record.install_url === "string" ? record.install_url.trim() : "";
  if (
    !channel ||
    !version ||
    !extensionId ||
    !installUrl ||
    !isExtensionInstallMethod(record.install_method)
  ) {
    return undefined;
  }
  try {
    const parsed = new URL(installUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return {
    channel,
    version,
    extension_id: extensionId,
    install_method: record.install_method,
    install_url: installUrl,
  };
}

function metadataCandidateUrls(): string[] {
  const urls = [
    new URL("./downloads/extension.json", window.location.href).href,
    `${marketingSiteBaseUrl()}/downloads/extension.json`,
  ];
  return [...new Set(urls)];
}

async function fetchExtensionMetadata(
  url: string,
): Promise<ExtensionDeploymentMetadata | undefined> {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return undefined;
    return parseExtensionMetadata(await response.json());
  } catch {
    return undefined;
  }
}

export async function loadExtensionInstallTarget(): Promise<ExtensionInstallTarget> {
  for (const url of metadataCandidateUrls()) {
    const metadata = await fetchExtensionMetadata(url);
    if (!metadata) continue;
    return {
      installMethod: metadata.install_method,
      installUrl: metadata.install_url,
      channel: metadata.channel,
      version: metadata.version,
      source: "metadata",
    };
  }
  return {
    installMethod: "manual_zip",
    installUrl: extensionInstallLandingUrl(),
    source: "fallback",
  };
}

export async function resolveExtensionSetupStatus(
  vaultStoreId: string | undefined,
): Promise<ExtensionSetupStatus> {
  if (!readInstalledExtensionRuntimeId()) return "not_installed";
  if (!vaultStoreId) return "installed_unpaired";

  const discovery = await discoverPairedExtensionIdentity(vaultStoreId);
  if (discovery.status === "locked" || discovery.status === "unlocked") {
    return "paired";
  }
  return "installed_unpaired";
}

export function openExtensionInstallTarget(
  target: ExtensionInstallTarget,
): void {
  window.open(target.installUrl, "_blank", "noopener,noreferrer");
}
