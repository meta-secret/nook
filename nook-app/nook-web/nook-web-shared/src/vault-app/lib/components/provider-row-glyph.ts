import type { StoredProvider } from "$app-wasm";

/** The icon a saved provider row draws. */
export enum ProviderRowGlyph {
  Cloud = "cloud-glyph",
  Archive = "archive-glyph",
  Drive = "drive-glyph",
}

export class ProviderRowGlyphs {
  /** Cloud for GitHub, Google Drive and iCloud, archive for S3, drive for
   * storage on this device. */
  static of(provider: StoredProvider): ProviderRowGlyph {
    switch (provider.type) {
      case "github":
      case "oauth-file":
        return ProviderRowGlyph.Cloud;
      case "s3":
        return ProviderRowGlyph.Archive;
      case "local":
      case "local-folder":
        return ProviderRowGlyph.Drive;
    }
  }
}
