import { describe, expect, test } from "bun:test";

import {
  RegistryCacheDescriptorRegisterRegistryDescriptor,
  type RegistryDescriptor,
  type RegistryDescriptorRegistration,
  RegistryDescriptorKind,
} from "./registry-cache-descriptor";

class RegistryCacheDescriptorRegister {
  constructor(
    private readonly request: {
      collection: Map<string, RegistryDescriptor>;
      descriptor: RegistryDescriptor;
    },
  ) {}
  execute(): void {
    const input = this.request;

    const registration: RegistryDescriptorRegistration = {
      collection: input.collection,
      descriptor: input.descriptor,
      kind: RegistryDescriptorKind.Blob,
    };
    new RegistryCacheDescriptorRegisterRegistryDescriptor(
      registration,
    ).execute();
  }
}

const digest = `sha256:${"a".repeat(64)}`;
const descriptor: RegistryDescriptor = {
  digest,
  mediaType: "application/vnd.oci.image.layer.v1.tar+zstd",
  size: 42,
};

describe("registry cache descriptor registration", () => {
  test("deduplicates identical descriptors", () => {
    const collection = new Map<string, RegistryDescriptor>();
    const first = { collection, descriptor };
    const duplicate = { collection, descriptor: { ...descriptor } };
    new RegistryCacheDescriptorRegister(first).execute();
    new RegistryCacheDescriptorRegister(duplicate).execute();
    expect(collection.size).toBe(1);
  });

  test("rejects a duplicate digest with a conflicting size", () => {
    const collection = new Map<string, RegistryDescriptor>();
    const first = { collection, descriptor };
    const conflict = { collection, descriptor: { ...descriptor, size: 43 } };
    new RegistryCacheDescriptorRegister(first).execute();
    expect(() =>
      new RegistryCacheDescriptorRegister(conflict).execute(),
    ).toThrow("conflicting blob descriptors");
  });

  test("rejects a duplicate digest with a conflicting media type", () => {
    const collection = new Map<string, RegistryDescriptor>();
    const first = { collection, descriptor };
    const conflict = {
      collection,
      descriptor: {
        ...descriptor,
        mediaType: "application/vnd.oci.image.config.v1+json",
      },
    };
    new RegistryCacheDescriptorRegister(first).execute();
    expect(() =>
      new RegistryCacheDescriptorRegister(conflict).execute(),
    ).toThrow("conflicting blob descriptors");
  });
});
