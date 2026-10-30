/** One manifest dependency: its key and the spec it declares. */
export type NpmManifestDependency = {
  readonly key: string;
  readonly spec: string;
};

/** Owns which registry package a manifest dependency installs. */
export class NpmInstalledPackage {
  private constructor() {}

  /** An `npm:` alias installs its target, as TypeScript 7 does under
   * `@typescript/native`; any other spec installs the key's own package. */
  static name(dependency: NpmManifestDependency): string {
    if (!dependency.spec.startsWith('npm:')) return dependency.key;
    const target = dependency.spec.slice('npm:'.length);
    const versionSeparator = target.lastIndexOf('@');
    return versionSeparator > 0 ? target.slice(0, versionSeparator) : target;
  }
}
