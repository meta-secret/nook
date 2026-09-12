import { describe, expect, test } from "bun:test";
import {
  RegistryDescriptorCollection,
  RegistryDescriptorKind,
  RegistryFailureKind,
  type RegistryDescriptor,
} from "./registry-cache-descriptor";

const descriptor: RegistryDescriptor = {
  digest: `sha256:${"a".repeat(64)}`,
  mediaType: "application/vnd.oci.image.layer.v1.tar+zstd",
  size: 42,
};

describe("registry cache descriptor registration", () => {
  test("deduplicates identical descriptors without mutating the previous inventory", () => {
    const empty = new RegistryDescriptorCollection(RegistryDescriptorKind.Blob);
    const first = empty.register(descriptor);
    expect(first.isOk()).toBe(true);
    if (first.isErr()) return;
    const duplicate = first.value.register({ ...descriptor });
    expect(duplicate.isOk()).toBe(true);
    if (duplicate.isErr()) return;
    expect(duplicate.value.values()).toEqual([descriptor]);
    expect(empty.values()).toEqual([]);
  });
  test("rejects a duplicate digest with a conflicting size", () => {
    const first = new RegistryDescriptorCollection(RegistryDescriptorKind.Blob).register(descriptor);
    expect(first.isOk()).toBe(true);
    if (first.isErr()) return;
    const conflict = first.value.register({ ...descriptor, size: 43 });
    expect(conflict.isErr()).toBe(true);
    if (conflict.isOk()) return;
    expect(conflict.error.kind).toBe(RegistryFailureKind.ConflictingDescriptor);
    expect(first.value.values()).toEqual([descriptor]);
  });
  test("rejects a duplicate digest with a conflicting media type", () => {
    const first = new RegistryDescriptorCollection(RegistryDescriptorKind.Blob).register(descriptor);
    expect(first.isOk()).toBe(true);
    if (first.isErr()) return;
    const conflict = first.value.register({ ...descriptor,
      mediaType: "application/vnd.oci.image.config.v1+json" });
    expect(conflict.isErr()).toBe(true);
    if (conflict.isOk()) return;
    expect(conflict.error.kind).toBe(RegistryFailureKind.ConflictingDescriptor);
  });
  test("severs aliases at admission and projection", () => {
    const input = { ...descriptor };
    const admitted = new RegistryDescriptorCollection(RegistryDescriptorKind.Blob).register(input);
    expect(admitted.isOk()).toBe(true);
    if (admitted.isErr()) return;
    input.size = 0;
    const projection = admitted.value.values();
    for (const entry of projection) entry.size = 1;
    expect(admitted.value.values()).toEqual([descriptor]);
  });
});
