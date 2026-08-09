export enum ColorMode {
  Light = "light",
  Dark = "dark",
}

export function systemColorMode(): ColorMode {
  return "window" in globalThis &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
    ? ColorMode.Dark
    : ColorMode.Light;
}

export function manualColorMode({
  current,
  storageKey,
}: {
  readonly current: ColorMode;
  readonly storageKey: string;
}): ColorMode {
  const selected =
    current === ColorMode.Dark ? ColorMode.Light : ColorMode.Dark;
  localStorage.setItem(storageKey, selected);
  return selected;
}
