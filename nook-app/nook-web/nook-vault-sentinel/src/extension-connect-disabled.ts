export const EXTENSION_CONNECT_PATH = "/extension-connect";

export type ExtensionConnectScope = never;

export type ExtensionConnectRequest = never;

export const isExtensionConnectPath: (pathname: string) => boolean = () =>
  false;

export const extensionConnectRequestFromLocation: (
  location: Location,
) => undefined = () => undefined;

export function scopeLabel(): never {
  throw new Error("errors.validation.sentinel_extension_forbidden");
}
