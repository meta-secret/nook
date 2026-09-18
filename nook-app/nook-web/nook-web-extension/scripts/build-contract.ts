export enum ExtensionEntrypointBuildFormat {
  Classic = 'iife',
  Module = 'esm',
}

type ExtensionEntrypointBuildFormatArgs = {
  entrypoint: string
}

export class ExtensionEntrypointBuildPolicy {
  format({
    entrypoint,
  }: ExtensionEntrypointBuildFormatArgs): ExtensionEntrypointBuildFormat {
    if (entrypoint.includes('/content/')) {
      return ExtensionEntrypointBuildFormat.Classic
    }
    return ExtensionEntrypointBuildFormat.Module
  }
}

export const extensionEntrypointBuildPolicy =
  new ExtensionEntrypointBuildPolicy()
