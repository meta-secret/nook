export enum ColorMode {
  Light = "light",
  Dark = "dark",
}

type ManualColorModeSelection = {
  readonly current: ColorMode;
  readonly storageKey: string;
};

/** Owns this browser host’s resources and interaction lifecycle. */
class BrowserColorMode {
  constructor(private readonly browser: typeof globalThis) {}

  systemColorMode(): ColorMode {
    return "window" in this.browser &&
      this.browser.window.matchMedia("(prefers-color-scheme: dark)").matches
      ? ColorMode.Dark
      : ColorMode.Light;
  }

  manualColorMode({
    current,
    storageKey,
  }: ManualColorModeSelection): ColorMode {
    const selected =
      current === ColorMode.Dark ? ColorMode.Light : ColorMode.Dark;
    this.browser.localStorage.setItem(storageKey, selected);
    return selected;
  }
}

export const browserColorMode = new BrowserColorMode(globalThis);
