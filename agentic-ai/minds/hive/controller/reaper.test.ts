import { expect, test } from "bun:test";
import {
  ApiMethod,
  PreparedNeo4jPolicyPatch,
  Neo4jPolicyPreparationKind,
  ConsumedNeo4jPolicyPatch,
  createReaperRequestHandler,
  KubernetesApiError,
  ReaperController,
  type ApiRequest,
  type ApiJsonRequest,
  type KubernetesApi,
  type NetworkPolicy,
  type NetworkPolicyPatch,
  type ReaperControllerOptions,
  type ReaperRequestHandlerOptions,
} from "./reaper";

const oldEndpoint = "10.244.0.7/32";
const newEndpoint = "10.244.0.9/32";
const serviceCidr = "10.96.87.23/32";

function assertValue<T>(value: T, label: string): asserts value is NonNullable<T> {
  if (!value) throw new Error(`${label} is missing`);
}

function policy(): NetworkPolicy {
  return {
    metadata: { resourceVersion: "10" },
    spec: {
      egress: [
        {
          to: [{ namespaceSelector: { matchLabels: { role: "data" } } }],
          ports: [{ protocol: "TCP", port: 7687 }],
        },
        {
          to: [
            { ipBlock: { cidr: serviceCidr } },
            { ipBlock: { cidr: oldEndpoint } },
          ],
          ports: [{ protocol: "TCP", port: 7687 }],
        },
      ],
    },
  };
}

class MockApi implements KubernetesApi {
  readonly policies = new Map<string, NetworkPolicy>([
    ["hive-worker-egress", policy()],
    ["hive-dispatcher-reaper", policy()],
    ["hive-observer-egress", policy()],
  ]);
  readonly patches: ApiRequest[] = [];
  policyReads = 0;
  readyEndpoint = true;
  conflictOnce = true;

  json<T>(input: ApiJsonRequest<T>): Promise<T> {
    if (input.path.endsWith("/services/hive-neo4j")) {
      return Promise.resolve(input.decode(
        JSON.stringify({ spec: { clusterIP: serviceCidr.replace("/32", "") } }),
      ));
    }
    if (input.path.endsWith("/endpoints/hive-neo4j")) {
      const addresses = this.readyEndpoint
        ? [{ ip: newEndpoint.replace("/32", "") }]
        : [];
      return Promise.resolve(input.decode(JSON.stringify({ subsets: [{ addresses }] })));
    }
    const [policyName = ""] = [input.path.split("/").at(-1)];
    this.policyReads += 1;
    if (!this.policies.has(policyName)) {
      throw new Error(`unexpected API path: ${input.path}`);
    }
    const existing = this.policies.get(policyName);
    assertValue(existing, `policy ${policyName}`);
    const stored = structuredClone(existing);
    if (this.policyReads === 2) {
      stored.metadata.resourceVersion = "11";
      const [firstEgress] = stored.spec.egress;
      assertValue(firstEgress, "first egress rule");
      firstEgress.to = [
        { namespaceSelector: { matchLabels: { role: "updated-data" } } },
      ];
      this.policies.set(policyName, structuredClone(stored));
    }
    return Promise.resolve(input.decode(JSON.stringify(stored)));
  }

  request(input: ApiRequest): Promise<string> {
    this.patches.push(structuredClone(input));
    if (
      this.conflictOnce &&
      input.path.endsWith("/networkpolicies/hive-worker-egress")
    ) {
      this.conflictOnce = false;
      throw new KubernetesApiError(409);
    }
    return Promise.resolve("{}");
  }
}

function cidrs(payload: NetworkPolicyPatch): string[] {
  return payload.spec.egress.flatMap((rule) => {
    const [targets = []] = [rule.to];
    return targets.flatMap((target) =>
      "ipBlock" in target ? [target.ipBlock.cidr] : [],
    );
  });
}

test("reconciles service and endpoint CIDRs without losing concurrent policy edits", async () => {
  const api = new MockApi();
  const controllerOptions: ReaperControllerOptions = {
    api,
    pollAttempts: 1,
    sleep: async () => {},
  };
  const controller = new ReaperController(controllerOptions);
  await controller.reconcileNeo4jPolicy();

  expect(api.patches).toHaveLength(4);
  const workerPatch = api.patches[1];
  assertValue(workerPatch, "worker patch");
  const worker = workerPatch.payload;
  assertValue(worker, "worker payload");
  const initialPatch = api.patches[0];
  assertValue(initialPatch, "initial patch");
  const initialPayload = initialPatch.payload;
  assertValue(initialPayload, "initial payload");
  expect(initialPayload.metadata.resourceVersion).toBe("10");
  expect(worker.metadata.resourceVersion).toBe("11");
  const workerEgress = worker.spec.egress[0];
  assertValue(workerEgress, "worker egress rule");
  expect(workerEgress.to).toEqual([
    { namespaceSelector: { matchLabels: { role: "updated-data" } } },
  ]);
  expect(cidrs(worker)).toEqual([serviceCidr, newEndpoint]);
  const dispatcherPatch = api.patches[2];
  assertValue(dispatcherPatch, "dispatcher patch");
  const dispatcherPayload = dispatcherPatch.payload;
  assertValue(dispatcherPayload, "dispatcher payload");
  expect(dispatcherPatch.path).toEndWith(
    "/networkpolicies/hive-dispatcher-reaper",
  );
  expect(cidrs(dispatcherPayload)).toEqual([serviceCidr, newEndpoint]);
  const observerPatch = api.patches[3];
  assertValue(observerPatch, "observer patch");
  const observerPayload = observerPatch.payload;
  assertValue(observerPayload, "observer payload");
  expect(observerPatch.path).toEndWith(
    "/networkpolicies/hive-observer-egress",
  );
  expect(cidrs(observerPayload)).toEqual([serviceCidr, newEndpoint]);

  for (const request of api.patches.slice(1)) {
    const [name] = request.path.split("/").slice(-1);
    assertValue(name, "policy name");
    const requestPayload = request.payload;
    assertValue(requestPayload, "request payload");
    const stored: NetworkPolicy = {
      metadata: { resourceVersion: "12" },
      spec: structuredClone(requestPayload.spec),
    };
    api.policies.set(name, stored);
  }
  api.policyReads = 2;
  api.readyEndpoint = false;
  api.patches.length = 0;
  await controller.reconcileNeo4jPolicy();
  expect(api.patches).toHaveLength(3);
  const finalPatch = api.patches[0];
  assertValue(finalPatch, "final patch");
  const finalPayload = finalPatch.payload;
  assertValue(finalPayload, "final payload");
  expect(cidrs(finalPayload)).toEqual([serviceCidr]);
});

enum ReapReadResult {
  Error = "error",
  Hive = "hive",
  Missing = "missing",
  Other = "other",
}

enum DeletionResult {
  Error = "error",
  Missing = "missing",
  Present = "present",
}

interface ReapApiOptions {
  deletionResult: DeletionResult;
  initialRead: ReapReadResult;
}

class ReapApi implements KubernetesApi {
  readonly requests: ApiRequest[] = [];
  pollCount = 0;
  private readonly deletionResult: ReapApiOptions["deletionResult"];
  private readonly initialRead: ReapReadResult;

  constructor(input: ReapApiOptions) {
    this.deletionResult = input.deletionResult;
    this.initialRead = input.initialRead;
  }

  json<T>(input: ApiJsonRequest<T>): Promise<T> {
    const { decode, ...request } = input;
    this.requests.push(structuredClone(request));
    if (this.initialRead === ReapReadResult.Missing) {
      throw new KubernetesApiError(404);
    }
    if (this.initialRead === ReapReadResult.Error) {
      throw new KubernetesApiError(500);
    }
    const name = this.initialRead === ReapReadResult.Hive ? "hive" : "not-hive";
    return Promise.resolve(decode(
      JSON.stringify({
        metadata: { labels: { "app.kubernetes.io/name": name } },
      }),
    ));
  }

  async request(input: ApiRequest): Promise<string> {
    this.requests.push(structuredClone(input));
    if (input.method === ApiMethod.Delete) {
      return Promise.resolve("{}");
    }
    this.pollCount += 1;
    if (this.deletionResult === DeletionResult.Missing) {
      throw new KubernetesApiError(404);
    }
    if (this.deletionResult === DeletionResult.Error) {
      throw new KubernetesApiError(500);
    }
    return Promise.resolve("{}");
  }
}

function reaperController(input: {
  api: KubernetesApi;
  pollAttempts?: number;
  sleeps?: number[];
}): ReaperController {
  const [sleeps = []] = [input.sleeps];
  const [pollAttempts = 2] = [input.pollAttempts];
  const options: ReaperControllerOptions = {
    api: input.api,
    pollAttempts,
    sleep: (milliseconds) => {
      sleeps.push(milliseconds);
      return Promise.resolve();
    },
  };
  return new ReaperController(options);
}

function reaperHandler(input: {
  controller: ReaperController;
  expectedToken?: string;
}): (request: Request) => Promise<Response> {
  const [expectedToken = "secret-token"] = [input.expectedToken];
  const options: ReaperRequestHandlerOptions = {
    controller: input.controller,
    readExpectedToken: () => Promise.resolve(expectedToken),
  };
  return createReaperRequestHandler(options);
}

function reapRequest(token = "secret-token"): Request {
  const headers = new Headers();
  headers.set("Authorization", `Bearer ${token}`);
  return new Request("http://reaper/reap/hive-worker-abc123", {
    method: "POST",
    headers,
  });
}

test("rejects unauthenticated reaping before contacting Kubernetes", async () => {
  const apiOptions: ReapApiOptions = {
    deletionResult: DeletionResult.Missing,
    initialRead: ReapReadResult.Hive,
  };
  const api = new ReapApi(apiOptions);
  const controllerInput = { api };
  const handlerInput = { controller: reaperController(controllerInput) };
  const handler = reaperHandler(handlerInput);

  expect((await handler(reapRequest("wrong-token"))).status).toBe(403);
  expect(api.requests).toHaveLength(0);
});

test("reaps only Hive-labeled pods and polls until Kubernetes returns 404", async () => {
  const apiOptions: ReapApiOptions = {
    deletionResult: DeletionResult.Missing,
    initialRead: ReapReadResult.Hive,
  };
  const api = new ReapApi(apiOptions);
  const controllerInput = { api };
  const handlerInput = { controller: reaperController(controllerInput) };
  const handler = reaperHandler(handlerInput);

  expect((await handler(reapRequest())).status).toBe(204);
  expect(api.requests.map((request) => request.method)).toEqual([
    ApiMethod.Get,
    ApiMethod.Delete,
    ApiMethod.Get,
  ]);

  const unauthorizedApiOptions: ReapApiOptions = {
    deletionResult: DeletionResult.Missing,
    initialRead: ReapReadResult.Other,
  };
  const unauthorizedApi = new ReapApi(unauthorizedApiOptions);
  const unauthorizedControllerInput = { api: unauthorizedApi };
  const unauthorizedController = reaperController(unauthorizedControllerInput);
  expect((await unauthorizedController.reap("hive-worker-abc123")).status).toBe(
    403,
  );
  expect(unauthorizedApi.requests).toHaveLength(1);
});

test("treats an already missing pod as a successful reap", async () => {
  const apiOptions: ReapApiOptions = {
    deletionResult: DeletionResult.Missing,
    initialRead: ReapReadResult.Missing,
  };
  const api = new ReapApi(apiOptions);
  const controllerInput = { api };
  expect(
    (await reaperController(controllerInput).reap("hive-worker-gone")).status,
  ).toBe(204);
});

test("bounds deletion polling and reports Kubernetes API failures", async () => {
  const sleeps: number[] = [];
  const presentApiOptions: ReapApiOptions = {
    deletionResult: DeletionResult.Present,
    initialRead: ReapReadResult.Hive,
  };
  const presentApi = new ReapApi(presentApiOptions);
  const timeoutControllerInput = {
    api: presentApi,
    pollAttempts: 2,
    sleeps,
  };
  const timeoutController = reaperController(timeoutControllerInput);
  expect((await timeoutController.reap("hive-worker-slow")).status).toBe(504);
  expect(presentApi.pollCount).toBe(2);
  expect(sleeps).toEqual([2_000, 2_000]);

  const failedApiOptions: ReapApiOptions = {
    deletionResult: DeletionResult.Missing,
    initialRead: ReapReadResult.Error,
  };
  const failedApi = new ReapApi(failedApiOptions);
  const failedControllerInput = { api: failedApi };
  expect(
    (await reaperController(failedControllerInput).reap("hive-worker-bad"))
      .status,
  ).toBe(502);
});

test("a prepared policy patch cannot be applied twice through an alias", async () => {
  const api = new MockApi();
  api.conflictOnce = false;
  const preparation = PreparedNeo4jPolicyPatch.prepare({
    api,
    policy: policy(),
    policyPath:
      "/apis/networking.k8s.io/v1/namespaces/hive-system/networkpolicies/hive-worker-egress",
    destinations: [{ ipBlock: { cidr: newEndpoint } }],
  });
  expect(preparation.kind).toBe(Neo4jPolicyPreparationKind.Prepared);
  if (preparation.kind !== Neo4jPolicyPreparationKind.Prepared) return;
  const alias = preparation.patch;
  await preparation.patch.apply();
  let aliasError: unknown;
  try {
    await alias.apply();
  } catch (error) {
    aliasError = error;
  }
  expect(aliasError).toBeInstanceOf(ConsumedNeo4jPolicyPatch);
  expect(api.patches).toHaveLength(1);
});

test("policy admission retains its resource version and isolates caller mutations", async () => {
  const api = new MockApi();
  api.conflictOnce = false;
  const observed = policy();
  const destinations = [{ ipBlock: { cidr: newEndpoint } }];
  const preparation = PreparedNeo4jPolicyPatch.prepare({
    api,
    policy: observed,
    policyPath:
      "/apis/networking.k8s.io/v1/namespaces/hive-system/networkpolicies/hive-worker-egress",
    destinations,
  });
  expect(preparation.kind).toBe(Neo4jPolicyPreparationKind.Prepared);
  if (preparation.kind !== Neo4jPolicyPreparationKind.Prepared) return;
  observed.metadata.resourceVersion = "changed-after-admission";
  const [destination] = destinations;
  assertValue(destination, "destination");
  destination.ipBlock.cidr = "changed-after-admission";
  await preparation.patch.apply();
  const admittedPatch = api.patches[0];
  assertValue(admittedPatch, "admitted patch");
  const admittedPayload = admittedPatch.payload;
  assertValue(admittedPayload, "admitted payload");
  expect(admittedPayload.metadata.resourceVersion).toBe("10");
  const [secondEgress] = admittedPayload.spec.egress.slice(1);
  assertValue(secondEgress, "second egress rule");
  expect(secondEgress.to).toEqual([
    { ipBlock: { cidr: newEndpoint } },
  ]);
});
