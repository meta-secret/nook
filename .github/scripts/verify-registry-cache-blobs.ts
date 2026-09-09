import { createHash } from "node:crypto";
import { err, ok, type Result } from "neverthrow";
import {
  RegistryDescriptorCollection, RegistryDescriptorKind, RegistryFailureKind,
  type RegistryDescriptor, type RegistryFailure,
} from "./registry-cache-descriptor";

interface RegistryDocument {
  blobs: readonly RegistryDescriptor[];
  manifests: readonly RegistryDescriptor[];
}
interface RegistryLocation { host: string; reference: string; repository: string }
interface RegistryAccess { location: RegistryLocation; authorization: string; reference: string }
enum ManifestReferenceKind { Tag = "tag", Descriptor = "descriptor" }
type ManifestReference =
  | { kind: ManifestReferenceKind.Tag; reference: string }
  | { kind: ManifestReferenceKind.Descriptor; reference: string; descriptor: RegistryDescriptor };

class RegistryDescriptorDocument {
  constructor(private readonly value: unknown) {}
  admit(): Result<RegistryDescriptor, RegistryFailure> {
    const value = this.value;
    if (typeof value !== "object" || !value || !("digest" in value) ||
      typeof value.digest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value.digest) ||
      !("size" in value) || typeof value.size !== "number" || !Number.isSafeInteger(value.size) ||
      value.size < 0 || !("mediaType" in value) || typeof value.mediaType !== "string")
      return err({ kind: RegistryFailureKind.Schema, message: "registry descriptor has an invalid schema" });
    return ok({ digest: value.digest, size: value.size, mediaType: value.mediaType });
  }
}

class RegistryManifest {
  constructor(private readonly text: string) {}
  decode(): Result<RegistryDocument, RegistryFailure> {
    let value: unknown;
    try { value = JSON.parse(this.text); }
    catch { return err({ kind: RegistryFailureKind.Schema, message: "registry manifest is not valid JSON" }); }
    if (typeof value !== "object" || !value || Array.isArray(value))
      return err({ kind: RegistryFailureKind.Schema, message: "registry manifest has an invalid schema" });
    const blobs: RegistryDescriptor[] = [];
    if ("config" in value) {
      const config = new RegistryDescriptorDocument(value.config).admit();
      if (config.isErr()) return err(config.error);
      blobs.push(config.value);
    }
    const layers = this.descriptors("layers" in value ? value.layers : []);
    if (layers.isErr()) return err(layers.error);
    const manifests = this.descriptors("manifests" in value ? value.manifests : []);
    if (manifests.isErr()) return err(manifests.error);
    return ok({ blobs: [...blobs, ...layers.value], manifests: manifests.value });
  }
  private descriptors(value: unknown): Result<RegistryDescriptor[], RegistryFailure> {
    if (!Array.isArray(value))
      return err({ kind: RegistryFailureKind.Schema, message: "registry descriptor list has an invalid schema" });
    const descriptors: RegistryDescriptor[] = [];
    for (const entry of value) {
      const admitted = new RegistryDescriptorDocument(entry).admit();
      if (admitted.isErr()) return err(admitted.error);
      descriptors.push(admitted.value);
    }
    return ok(descriptors);
  }
}

class RegistryEnvironment {
  constructor(private readonly input: { args: string[]; environment: NodeJS.ProcessEnv }) {}
  admit(): Result<RegistryAccess, RegistryFailure> {
    const reference = this.input.args[2];
    if (!reference) return err({ kind: RegistryFailureKind.Configuration,
      message: "usage: bun verify-registry-cache-blobs.ts <registry-ref>" });
    const slash = reference.indexOf("/");
    const colon = reference.lastIndexOf(":");
    if (slash < 1 || colon <= slash + 1)
      return err({ kind: RegistryFailureKind.Configuration, message: "invalid registry cache ref" });
    const username = this.input.environment.NOOK_REGISTRY_USERNAME;
    const password = this.input.environment.NOOK_REGISTRY_PASSWORD;
    if (!username || !password)
      return err({ kind: RegistryFailureKind.Configuration,
        message: "registry blob verification requires NOOK_REGISTRY_USERNAME and NOOK_REGISTRY_PASSWORD" });
    return ok({ reference, location: { host: reference.slice(0, slash),
      repository: reference.slice(slash + 1, colon), reference: reference.slice(colon + 1) },
      authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` });
  }
}

class RegistryTransport {
  constructor(private readonly access: RegistryAccess) {}
  async get(path: string): Promise<Result<Response, RegistryFailure>> {
    let response: Response;
    try {
      const headers = new Headers({ Authorization: this.access.authorization });
      if (path.startsWith("manifests/")) headers.set("Accept",
        "application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json");
      response = await fetch(`https://${this.access.location.host}/v2/${this.access.location.repository}/${path}`,
        { headers, method: "GET", signal: AbortSignal.timeout(5 * 60_000) });
    } catch { return err({ kind: RegistryFailureKind.Network, message: `registry GET ${path} failed` }); }
    if (!response.ok) return err({ kind: RegistryFailureKind.Http,
      message: `registry GET ${path} failed with HTTP ${response.status}` });
    return ok(response);
  }
}

class RegistryManifestBody {
  constructor(private readonly response: Response) {}
  async read(reference: ManifestReference): Promise<Result<RegistryDocument, RegistryFailure>> {
    let bytes: Uint8Array;
    try { bytes = new Uint8Array(await this.response.arrayBuffer()); }
    catch { return err({ kind: RegistryFailureKind.Body, message: "Unable to read registry manifest body" }); }
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (reference.kind === ManifestReferenceKind.Descriptor) {
      if (bytes.length !== reference.descriptor.size || digest !== reference.descriptor.digest)
        return err({ kind: RegistryFailureKind.Integrity,
          message: `${reference.descriptor.digest} manifest has digest ${digest} and ${bytes.length} bytes; expected ${reference.descriptor.size}` });
    } else {
      const registryDigest = this.response.headers.get("docker-content-digest");
      if (registryDigest && registryDigest !== digest)
        return err({ kind: RegistryFailureKind.Integrity,
          message: `tagged manifest digest ${digest} does not match registry digest ${registryDigest}` });
    }
    return new RegistryManifest(new TextDecoder().decode(bytes)).decode();
  }
}

class RegistryManifestGraph {
  constructor(private readonly state: {
    blobs: RegistryDescriptorCollection;
    manifests: RegistryDescriptorCollection;
    visited: ReadonlySet<string>;
  } = { blobs: new RegistryDescriptorCollection(RegistryDescriptorKind.Blob),
    manifests: new RegistryDescriptorCollection(RegistryDescriptorKind.Manifest), visited: new Set() }) {}

  async collect(request: { reference: ManifestReference; transport: RegistryTransport }): Promise<Result<RegistryManifestGraph, RegistryFailure>> {
    let manifests = this.state.manifests;
    if (request.reference.kind === ManifestReferenceKind.Descriptor) {
      const registered = manifests.register(request.reference.descriptor);
      if (registered.isErr()) return err(registered.error);
      manifests = registered.value;
    }
    if (this.state.visited.has(request.reference.reference))
      return ok(new RegistryManifestGraph({ ...this.state, manifests }));
    const response = await request.transport.get(`manifests/${request.reference.reference}`);
    if (response.isErr()) return err(response.error);
    const document = await new RegistryManifestBody(response.value).read(request.reference);
    if (document.isErr()) return err(document.error);
    let blobs = this.state.blobs;
    for (const descriptor of document.value.blobs) {
      const registered = blobs.register(descriptor);
      if (registered.isErr()) return err(registered.error);
      blobs = registered.value;
    }
    let graph = new RegistryManifestGraph({ blobs, manifests,
      visited: new Set([...this.state.visited, request.reference.reference]) });
    for (const descriptor of document.value.manifests) {
      const collected = await graph.collect({ transport: request.transport,
        reference: { kind: ManifestReferenceKind.Descriptor, descriptor, reference: descriptor.digest } });
      if (collected.isErr()) return err(collected.error);
      graph = collected.value;
    }
    return ok(graph);
  }
  blobs(): readonly RegistryDescriptor[] { return this.state.blobs.values(); }
}

class RegistryBlob {
  constructor(private readonly descriptor: RegistryDescriptor) {}
  async verify(transport: RegistryTransport): Promise<Result<void, RegistryFailure>> {
    const requested = await transport.get(`blobs/${this.descriptor.digest}`);
    if (requested.isErr()) return err(requested.error);
    const response = requested.value;
    const lengthHeader = response.headers.get("content-length");
    const length = lengthHeader ? Number(lengthHeader) : this.descriptor.size;
    if (length !== this.descriptor.size)
      return err({ kind: RegistryFailureKind.Integrity,
        message: `${this.descriptor.digest} has ${length} bytes; manifest requires ${this.descriptor.size}` });
    const body = response.body;
    if (!body) return err({ kind: RegistryFailureKind.Body,
      message: `${this.descriptor.digest} has no readable response body` });
    const hash = createHash("sha256");
    let bytesRead = 0;
    // Reader acquisition and streaming are one foreign transport boundary.
    try {
      const reader = body.getReader();
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytesRead += chunk.value.length;
          hash.update(chunk.value);
        }
      } finally { reader.releaseLock(); }
    } catch { return err({ kind: RegistryFailureKind.Body,
      message: `${this.descriptor.digest} registry blob stream failed` }); }
    const digest = `sha256:${hash.digest("hex")}`;
    if (bytesRead !== this.descriptor.size || digest !== this.descriptor.digest)
      return err({ kind: RegistryFailureKind.Integrity,
        message: `${this.descriptor.digest} blob has digest ${digest} and ${bytesRead} bytes; expected ${this.descriptor.size}` });
    console.log(`verified complete registry blob ${this.descriptor.digest} (${bytesRead} bytes)`);
    return ok();
  }
}

class RegistryBlobLane {
  constructor(private readonly descriptors: readonly RegistryDescriptor[]) {}
  async verify(transport: RegistryTransport): Promise<Result<void, RegistryFailure>> {
    for (const descriptor of this.descriptors) {
      const outcome = await new RegistryBlob(descriptor).verify(transport);
      if (outcome.isErr()) return err(outcome.error);
    }
    return ok();
  }
}
class RegistryCacheVerification {
  constructor(private readonly access: RegistryAccess) {}
  async execute(): Promise<Result<void, RegistryFailure>> {
    const transport = new RegistryTransport(this.access);
    const collected = await new RegistryManifestGraph().collect({ transport,
      reference: { kind: ManifestReferenceKind.Tag, reference: this.access.location.reference } });
    if (collected.isErr()) return err(collected.error);
    const descriptors = collected.value.blobs();
    if (descriptors.length === 0) return err({ kind: RegistryFailureKind.Empty,
      message: `${this.access.reference} contains no cache blob descriptors` });
    const count = Math.min(4, descriptors.length);
    const lanes = Array.from({ length: count }, (_, lane) =>
      new RegistryBlobLane(descriptors.filter((_, index) => index % count === lane)));
    const outcomes = await Promise.all(lanes.map((lane) => lane.verify(transport)));
    for (const outcome of outcomes) if (outcome.isErr()) return err(outcome.error);
    const totalBytes = descriptors.reduce((total, descriptor) => total + descriptor.size, 0);
    console.log(`verified ${descriptors.length} complete registry blobs (${totalBytes} hashed bytes) for ${this.access.reference}`);
    return ok();
  }
}

const access = new RegistryEnvironment({ args: process.argv, environment: process.env }).admit();
const outcome = access.isErr() ? err<void, RegistryFailure>(access.error)
  : await new RegistryCacheVerification(access.value).execute();
if (outcome.isErr()) {
  console.error(outcome.error.message);
  process.exitCode = 1;
}
