import { timingSafeEqual } from "node:crypto";

const namespace = "hive-system";
const kubernetesApi = "https://kubernetes.default.svc";
const tokenPath = "/run/kubernetes/token";
const certificatePath = "/run/kubernetes/ca.crt";
const reaperTokenPath = "/run/reaper-auth/token";
const kubernetesRequestTimeoutMs = 10_000;
const reapPollAttempts = 60;
const reapPollIntervalMs = 2_000;

export interface ApiRequest {
  method: ApiMethod;
  path: string;
  payload?: NetworkPolicyPatch;
}

export enum ApiMethod {
  Delete = "DELETE",
  Get = "GET",
  Patch = "PATCH",
}

export interface KubernetesApi {
  request(input: ApiRequest): Promise<string>;
  json<T>(input: ApiRequest): Promise<T>;
}

interface IpBlock {
  ipBlock: { cidr: string };
}

interface SelectorTarget {
  namespaceSelector?: { matchLabels: Record<string, string> };
  podSelector?: { matchLabels: Record<string, string> };
}

type NetworkTarget = IpBlock | SelectorTarget;

interface NetworkPort {
  protocol?: string;
  port?: number;
}

interface EgressRule {
  to?: NetworkTarget[];
  ports?: NetworkPort[];
}

export interface NetworkPolicy {
  metadata: { resourceVersion: string };
  spec: { egress: EgressRule[] };
}

export interface NetworkPolicyPatch {
  metadata: { resourceVersion: string };
  spec: { egress: EgressRule[] };
}

interface Service {
  spec: { clusterIP: string };
}

interface Endpoints {
  subsets?: Array<{ addresses?: Array<{ ip: string }> }>;
}

interface Pod {
  metadata?: { labels?: Record<string, string> };
}

export class KubernetesApiError extends Error {
  constructor(readonly status: number) {
    super(`Kubernetes API returned HTTP ${status}`);
  }
}

export class LiveKubernetesApi implements KubernetesApi {
  private readonly certificate = Bun.file(certificatePath).text();

  async request(input: ApiRequest): Promise<string> {
    const token = (await Bun.file(tokenPath).text()).trim();
    const certificate = await this.certificate;
    const headers = new Headers();
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("Content-Type", "application/merge-patch+json");
    const requestOptions =
      "payload" in input
        ? {
            method: input.method,
            headers,
            body: JSON.stringify(input.payload),
            signal: AbortSignal.timeout(kubernetesRequestTimeoutMs),
            tls: { ca: certificate },
          }
        : {
            method: input.method,
            headers,
            signal: AbortSignal.timeout(kubernetesRequestTimeoutMs),
            tls: { ca: certificate },
          };
    const response = await fetch(
      `${kubernetesApi}${input.path}`,
      requestOptions,
    );
    if (!response.ok) {
      throw new KubernetesApiError(response.status);
    }
    return response.text();
  }

  async json<T>(input: ApiRequest): Promise<T> {
    return JSON.parse(await this.request(input)) as T;
  }
}

function normalizeIpv4(value: string): string {
  const parts = value.split(".");
  const valid =
    parts.length === 4 &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
  if (!valid) {
    throw new Error(`invalid IPv4 address: ${value}`);
  }
  return parts.map((part) => String(Number(part))).join(".");
}

function isNeo4jIpRule(rule: EgressRule): boolean {
  const [ports = []] = [rule.ports];
  const [targets = []] = [rule.to];
  return (
    ports.some(
      (port) => port.protocol === "TCP" && port.port === 7687,
    ) && targets.some((target) => "ipBlock" in target)
  );
}

function destinationsEqual(input: {
  left: NetworkTarget[];
  right: NetworkTarget[];
}): boolean {
  return JSON.stringify(input.left) === JSON.stringify(input.right);
}

export interface ReaperControllerOptions {
  api: KubernetesApi;
  pollAttempts: number;
  sleep(milliseconds: number): Promise<void>;
}

export class ReaperController {
  private readonly api: KubernetesApi;
  private readonly pollAttempts: number;
  private readonly sleep: ReaperControllerOptions["sleep"];

  constructor(input: ReaperControllerOptions) {
    this.api = input.api;
    this.pollAttempts = input.pollAttempts;
    this.sleep = input.sleep;
  }

  async reconcileNeo4jPolicy(): Promise<void> {
    const serviceRequest: ApiRequest = {
      method: ApiMethod.Get,
      path: "/api/v1/namespaces/hive-data/services/hive-neo4j",
    };
    const endpointsRequest: ApiRequest = {
      method: ApiMethod.Get,
      path: "/api/v1/namespaces/hive-data/endpoints/hive-neo4j",
    };
    const service = await this.api.json<Service>(serviceRequest);
    const endpoints = await this.api.json<Endpoints>(endpointsRequest);
    const serviceIp = normalizeIpv4(service.spec.clusterIP);
    const [subsets = []] = [endpoints.subsets];
    const endpointIps = subsets
      .flatMap((subset) => {
        const [addresses = []] = [subset.addresses];
        return addresses;
      })
      .map((address) => normalizeIpv4(address.ip))
      .sort();
    const destinations: NetworkTarget[] = [
      { ipBlock: { cidr: `${serviceIp}/32` } },
    ];
    if (endpointIps.length > 0) {
      destinations.push({ ipBlock: { cidr: `${endpointIps[0]}/32` } });
    }
    for (const policyName of [
      "hive-worker-egress",
      "hive-dispatcher-reaper",
      "hive-observer-egress",
    ]) {
      await this.reconcilePolicy({ policyName, destinations });
    }
  }

  private async reconcilePolicy(input: {
    policyName: string;
    destinations: NetworkTarget[];
  }): Promise<void> {
    const policyPath =
      "/apis/networking.k8s.io/v1/namespaces/hive-system/networkpolicies/" +
      input.policyName;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const readRequest: ApiRequest = {
        method: ApiMethod.Get,
        path: policyPath,
      };
      const policy = await this.api.json<NetworkPolicy>(readRequest);
      const egress = structuredClone(policy.spec.egress);
      const rules = egress.filter(isNeo4jIpRule);
      if (rules.length !== 1) {
        throw new Error("Neo4j endpoint egress rule is missing");
      }
      const rule = rules[0]!;
      const [left = []] = [rule.to];
      const comparison = {
        left,
        right: input.destinations,
      };
      if (destinationsEqual(comparison)) {
        return;
      }
      rule.to = input.destinations;
      const payload: NetworkPolicyPatch = {
        metadata: { resourceVersion: policy.metadata.resourceVersion },
        spec: { egress },
      };
      const patchRequest: ApiRequest = {
        method: ApiMethod.Patch,
        path: policyPath,
        payload,
      };
      try {
        await this.api.request(patchRequest);
        return;
      } catch (error) {
        if (!(error instanceof KubernetesApiError) || error.status !== 409) {
          throw error;
        }
      }
    }
    throw new Error(
      `Neo4j NetworkPolicy ${input.policyName} changed during reconciliation`,
    );
  }

  async reap(podName: string): Promise<Response> {
    const podPath = `/api/v1/namespaces/${namespace}/pods/${podName}`;
    const readRequest: ApiRequest = { method: ApiMethod.Get, path: podPath };
    try {
      const pod = await this.api.json<Pod>(readRequest);
      if (pod.metadata?.labels?.["app.kubernetes.io/name"] !== "hive") {
        return responseWithStatus(403);
      }
      const deleteRequest: ApiRequest = {
        method: ApiMethod.Delete,
        path: podPath,
      };
      await this.api.request(deleteRequest);
      for (let attempt = 0; attempt < this.pollAttempts; attempt += 1) {
        try {
          await this.api.request(readRequest);
        } catch (error) {
          if (error instanceof KubernetesApiError && error.status === 404) {
            return responseWithStatus(204);
          }
          throw error;
        }
        await this.sleep(reapPollIntervalMs);
      }
      return responseWithStatus(504);
    } catch (error) {
      if (error instanceof KubernetesApiError && error.status === 404) {
        return responseWithStatus(204);
      }
      return responseWithStatus(502);
    }
  }
}

function responseWithStatus(status: number): Response {
  return new Response(new Response().body, { status });
}

function secureEqual(input: { supplied: string; expected: string }): boolean {
  const supplied = Buffer.from(input.supplied);
  const expected = Buffer.from(input.expected);
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}

async function reconcileLoop(controller: ReaperController): Promise<void> {
  while (true) {
    try {
      await controller.reconcileNeo4jPolicy();
    } catch (error) {
      console.error("Neo4j NetworkPolicy reconciliation failed:", error);
    }
    await Bun.sleep(10_000);
  }
}

export interface ReaperRequestHandlerOptions {
  controller: ReaperController;
  readExpectedToken(): Promise<string>;
}

export function createReaperRequestHandler(
  input: ReaperRequestHandlerOptions,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") {
      return responseWithStatus(404);
    }
    const [supplied = ("")] = [request.headers.get("Authorization")?.replace(/^Bearer /, "")];
    const expected = (await input.readExpectedToken()).trim();
    const match = new URL(request.url).pathname.match(
      /^\/reap\/(hive-[a-z0-9-]+)$/,
    );
    const credentials = { supplied, expected };
    if (!match || !secureEqual(credentials)) {
      return responseWithStatus(403);
    }
    const [, task = ""] = match;
    return input.controller.reap(task);
  };
}

export async function serve(): Promise<void> {
  const controllerOptions: ReaperControllerOptions = {
    api: new LiveKubernetesApi(),
    pollAttempts: reapPollAttempts,
    sleep: Bun.sleep,
  };
  const controller = new ReaperController(controllerOptions);
  void reconcileLoop(controller);
  const handlerOptions: ReaperRequestHandlerOptions = {
    controller,
    readExpectedToken: () => Bun.file(reaperTokenPath).text(),
  };
  Bun.serve({
    hostname: "0.0.0.0",
    port: 8080,
    fetch: createReaperRequestHandler(handlerOptions),
  });
}

if (import.meta.main) {
  await serve();
}
