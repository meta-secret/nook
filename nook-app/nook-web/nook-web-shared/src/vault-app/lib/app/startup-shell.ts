import {
  BOOTSTRAP_MESSAGES,
  type BootstrapLocale,
} from "../../../generated/bootstrap-messages";
import { ColorMode, systemColorMode } from "$lib/app/theme";

const LOCALE_STORAGE_KEY = "nook_locale";
const COLOR_MODE_STORAGE_KEY = "nook_color_mode";

enum VaultStartupShellState {
  Loading = "loading",
  Unavailable = "unavailable",
}

type VaultStartupShellOptions = {
  readonly target: HTMLElement;
};

export type VaultStartupShell = {
  showUnavailable(): void;
  remove(): void;
};

function storedValue(key: string): string {
  try {
    return ((v) => (v ? v : ""))(localStorage.getItem(key));
  } catch {
    return "";
  }
}

function startupLocale(): BootstrapLocale {
  const savedLocale = storedValue(LOCALE_STORAGE_KEY);
  if (Object.hasOwn(BOOTSTRAP_MESSAGES, savedLocale)) {
    return savedLocale as BootstrapLocale;
  }
  const languageTags = navigator.languages.length
    ? navigator.languages
    : [navigator.language];
  return languageTags.some((tag) => tag.toLowerCase().startsWith("ru"))
    ? "ru"
    : "en";
}

function applyStartupColorMode(): void {
  const storedMode = storedValue(COLOR_MODE_STORAGE_KEY);
  const colorMode =
    storedMode === ColorMode.Light || storedMode === ColorMode.Dark
      ? storedMode
      : systemColorMode();
  document.documentElement.classList.toggle(
    ColorMode.Dark,
    colorMode === ColorMode.Dark,
  );
}

function faviconUrl(): string {
  return ((v) => (v ? v : ""))(
    document.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.href,
  );
}

export function createVaultStartupShell({
  target,
}: VaultStartupShellOptions): VaultStartupShell {
  applyStartupColorMode();
  const locale = startupLocale();
  document.documentElement.lang = locale;
  const messages = BOOTSTRAP_MESSAGES[locale];

  const shell = document.createElement("main");
  shell.className = "vault-startup-shell";
  shell.dataset.state = VaultStartupShellState.Loading;
  shell.dataset.testid = "vault-startup-shell";
  shell.setAttribute("aria-busy", "true");

  const status = document.createElement("div");
  status.className = "vault-startup-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  const iconUrl = faviconUrl();
  if (iconUrl) {
    const icon = document.createElement("img");
    icon.className = "vault-startup-icon";
    icon.src = iconUrl;
    icon.alt = "";
    icon.width = 48;
    icon.height = 48;
    status.append(icon);
  }

  const indicator = document.createElement("span");
  indicator.className = "vault-startup-indicator";
  indicator.setAttribute("aria-hidden", "true");
  status.append(indicator);

  const message = document.createElement("p");
  message.className = "vault-startup-message";
  message.textContent = messages.loading;
  status.append(message);

  shell.append(status);
  target.replaceChildren(shell);

  return {
    showUnavailable(): void {
      if (!shell.isConnected) return;
      shell.dataset.state = VaultStartupShellState.Unavailable;
      shell.setAttribute("aria-busy", "false");
      status.setAttribute("role", "alert");
      message.textContent = messages.unavailable;
    },
    remove(): void {
      shell.remove();
    },
  };
}
