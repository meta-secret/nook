import { err, ok, type Result } from "neverthrow";

export interface RegistryDescriptor {
  digest: string;
  mediaType: string;
  size: number;
}
export enum RegistryDescriptorKind {
  Blob = "blob",
  Manifest = "manifest",
}
export enum RegistryFailureKind {
  Configuration = "configuration",
  ConflictingDescriptor = "conflicting-descriptor",
  Schema = "schema",
  Network = "network",
  Http = "http",
  Body = "body",
  Integrity = "integrity",
  Empty = "empty",
}
export interface RegistryFailure {
  kind: RegistryFailureKind;
  message: string;
}

/** Immutable inventory: conflicting registration never changes the admitted graph. */
export class RegistryDescriptorCollection {
  constructor(
    private readonly kind: RegistryDescriptorKind,
    private readonly descriptors: ReadonlyMap<string, RegistryDescriptor> = new Map(),
  ) {}
  register(descriptor: RegistryDescriptor): Result<RegistryDescriptorCollection, RegistryFailure> {
    const existing = this.descriptors.get(descriptor.digest);
    if (existing && (existing.size !== descriptor.size || existing.mediaType !== descriptor.mediaType))
      return err({ kind: RegistryFailureKind.ConflictingDescriptor,
        message: `${descriptor.digest} has conflicting ${this.kind} descriptors` });
    return ok(new RegistryDescriptorCollection(this.kind,
      new Map([...this.descriptors, [descriptor.digest, { ...descriptor }]])));
  }
  values(): readonly RegistryDescriptor[] {
    return [...this.descriptors.values()].map((descriptor) => ({ ...descriptor }));
  }
}
