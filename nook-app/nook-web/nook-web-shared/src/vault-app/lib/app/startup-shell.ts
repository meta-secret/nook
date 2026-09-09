import {
  BOOTSTRAP_MESSAGES,
  type BootstrapLocale,
} from "../../../generated/bootstrap-messages";
import { ColorMode, browserColorMode } from "$lib/app/theme";

const LOCALE_STORAGE_KEY = "nook_locale";

const COLOR_MODE_STORAGE_KEY = "nook_color_mode";

enum VaultStartupShellState {
  Loading = "loading",
  Unavailable = "unavailable",
}

type VaultStartupShellOptions = {
  readonly target: HTMLElement;
};
export class VaultStartupShell {
  private readonly shell: HTMLElement;
  private readonly status: HTMLElement;
  private readonly message: HTMLParagraphElement;
  private readonly messages: (typeof BOOTSTRAP_MESSAGES)[BootstrapLocale];
  private storedValue(key: string): string {
    try {
      return ((v) => (v ? v : ""))(localStorage.getItem(key));
    } catch {
      return "";
    }
  }

  private startupLocale(): BootstrapLocale {
    const savedLocale = this.storedValue(LOCALE_STORAGE_KEY);
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

  private applyStartupColorMode(): void {
    const storedMode = this.storedValue(COLOR_MODE_STORAGE_KEY);
    const colorMode =
      storedMode === ColorMode.Light || storedMode === ColorMode.Dark
        ? storedMode
        : browserColorMode.systemColorMode();
    document.documentElement.classList.toggle(
      ColorMode.Dark,
      colorMode === ColorMode.Dark,
    );
  }

  private faviconUrl(): string {
    return ((v) => (v ? v : ""))(
      document.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.href,
    );
  }
  constructor({ target }: VaultStartupShellOptions) {
    this.applyStartupColorMode();
    const locale = this.startupLocale();
    document.documentElement.lang = locale;
    this.messages = BOOTSTRAP_MESSAGES[locale];
    const messages = this.messages;

    const shell = document.createElement("main");
    shell.className = "vault-startup-shell";
    shell.dataset.state = VaultStartupShellState.Loading;
    shell.dataset.testid = "vault-startup-shell";
    shell.setAttribute("aria-busy", "true");

    const status = document.createElement("div");
    status.className = "vault-startup-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");

    const iconUrl = this.faviconUrl();
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

    this.shell = shell;
    this.status = status;
    this.message = message;
  }
  showUnavailable(): void {
    if (!this.shell.isConnected) return;
    this.shell.dataset.state = VaultStartupShellState.Unavailable;
    this.shell.setAttribute("aria-busy", "false");
    this.status.setAttribute("role", "alert");
    this.message.textContent = this.messages.unavailable;
  }
  remove(): void {
    this.shell.remove();
  }
}
