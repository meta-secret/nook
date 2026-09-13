import type {
  Service,
  Endpoints,
  NetworkPolicy,
  Pod,
  EgressRule,
} from "./reaper";

export enum KubernetesDocumentFailureKind {
  InvalidSchema = "invalid-schema",
}
export class KubernetesDocumentError extends Error {
  readonly kind = KubernetesDocumentFailureKind.InvalidSchema;
  constructor(schema: string) {
    super(`Kubernetes ${schema} has an invalid schema`);
  }
}

/** Validate consumed fields while preserving unmodified policy fields in merge patches. */
export class KubernetesDocument {
  private static record(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && !!value && !Array.isArray(value);
  }
  private static parse(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      throw new KubernetesDocumentError("JSON document");
    }
  }
  static service(this: void, text: string): Service {
    const value = KubernetesDocument.parse(text);
    if (
      !KubernetesDocument.record(value) ||
      !KubernetesDocument.record(value.spec) ||
      typeof value.spec.clusterIP !== "string"
    )
      throw new KubernetesDocumentError("service");
    return { spec: { clusterIP: value.spec.clusterIP } };
  }
  private static address(
    this: void,
    value: unknown,
  ): value is { ip: string } {
    return KubernetesDocument.record(value) && typeof value.ip === "string";
  }
  private static subset(
    this: void,
    value: unknown,
  ): value is { addresses?: { ip: string }[] } {
    return (
      KubernetesDocument.record(value) &&
      (!("addresses" in value) ||
        (Array.isArray(value.addresses) &&
          value.addresses.every(KubernetesDocument.address)))
    );
  }
  static endpoints(this: void, text: string): Endpoints {
    const value = KubernetesDocument.parse(text);
    if (!KubernetesDocument.record(value))
      throw new KubernetesDocumentError("endpoints");
    if (!("subsets" in value)) return {};
    if (
      !Array.isArray(value.subsets) ||
      !value.subsets.every(KubernetesDocument.subset)
    )
      throw new KubernetesDocumentError("endpoint subsets");
    return { subsets: value.subsets };
  }
  private static labels(value: unknown): value is Record<string, string> {
    return (
      KubernetesDocument.record(value) &&
      Object.values(value).every((label) => typeof label === "string")
    );
  }
  static pod(this: void, text: string): Pod {
    const value = KubernetesDocument.parse(text);
    if (!KubernetesDocument.record(value))
      throw new KubernetesDocumentError("pod");
    if (!("metadata" in value)) return {};
    if (!KubernetesDocument.record(value.metadata))
      throw new KubernetesDocumentError("pod metadata");
    if (!("labels" in value.metadata)) return { metadata: {} };
    if (!KubernetesDocument.labels(value.metadata.labels))
      throw new KubernetesDocumentError("pod labels");
    return { metadata: { labels: value.metadata.labels } };
  }
  private static selector(value: unknown): boolean {
    return (
      KubernetesDocument.record(value) &&
      (!("matchLabels" in value) ||
        KubernetesDocument.labels(value.matchLabels))
    );
  }
  private static target(this: void, value: unknown): boolean {
    if (!KubernetesDocument.record(value)) return false;
    if ("ipBlock" in value)
      return (
        KubernetesDocument.record(value.ipBlock) &&
        typeof value.ipBlock.cidr === "string"
      );
    return (
      (!("namespaceSelector" in value) ||
        KubernetesDocument.selector(value.namespaceSelector)) &&
      (!("podSelector" in value) ||
        KubernetesDocument.selector(value.podSelector))
    );
  }
  private static port(this: void, value: unknown): boolean {
    return (
      KubernetesDocument.record(value) &&
      (!("protocol" in value) || typeof value.protocol === "string") &&
      (!("port" in value) ||
        typeof value.port === "string" ||
        (typeof value.port === "number" && Number.isInteger(value.port)))
    );
  }
  private static rule(this: void, value: unknown): value is EgressRule {
    return (
      KubernetesDocument.record(value) &&
      (!("to" in value) ||
        (Array.isArray(value.to) &&
          value.to.every(KubernetesDocument.target))) &&
      (!("ports" in value) ||
        (Array.isArray(value.ports) &&
          value.ports.every(KubernetesDocument.port)))
    );
  }
  static networkPolicy(this: void, text: string): NetworkPolicy {
    const value = KubernetesDocument.parse(text);
    if (
      !KubernetesDocument.record(value) ||
      !KubernetesDocument.record(value.metadata) ||
      typeof value.metadata.resourceVersion !== "string" ||
      !KubernetesDocument.record(value.spec) ||
      !Array.isArray(value.spec.egress) ||
      !value.spec.egress.every(KubernetesDocument.rule)
    )
      throw new KubernetesDocumentError("network policy");
    return {
      metadata: { resourceVersion: value.metadata.resourceVersion },
      spec: { egress: value.spec.egress },
    };
  }
}
