import { expect, test } from "bun:test";
import {
  KubernetesApiError,
  ReaperController,
  type ApiRequest,
  type KubernetesApi,
  type NetworkPolicy,
  type NetworkPolicyPatch,
} from "./reaper";

const oldEndpoint = "10.244.0.7/32";
const newEndpoint = "10.244.0.9/32";
const serviceCidr = "10.96.87.23/32";

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

  async json<T>(input: ApiRequest): Promise<T> {
    if (input.path.endsWith("/services/hive-neo4j")) {
      return { spec: { clusterIP: serviceCidr.replace("/32", "") } } as T;
    }
    if (input.path.endsWith("/endpoints/hive-neo4j")) {
      const addresses = this.readyEndpoint
        ? [{ ip: newEndpoint.replace("/32", "") }]
        : [];
      return { subsets: [{ addresses }] } as T;
    }
    const policyName = input.path.split("/").at(-1) ?? "";
    this.policyReads += 1;
    const stored = structuredClone(this.policies.get(policyName));
    if (stored === undefined) {
      throw new Error(`unexpected API path: ${input.path}`);
    }
    if (this.policyReads === 2) {
      stored.metadata.resourceVersion = "11";
      stored.spec.egress[0].to = [
        { namespaceSelector: { matchLabels: { role: "updated-data" } } },
      ];
      this.policies.set(policyName, structuredClone(stored));
    }
    return stored as T;
  }

  async request(input: ApiRequest): Promise<string> {
    this.patches.push(structuredClone(input));
    if (
      this.conflictOnce &&
      input.path.endsWith("/networkpolicies/hive-worker-egress")
    ) {
      this.conflictOnce = false;
      throw new KubernetesApiError(409);
    }
    return "{}";
  }
}

function cidrs(payload: NetworkPolicyPatch): string[] {
  return payload.spec.egress.flatMap((rule) =>
    (rule.to ?? []).flatMap((target) =>
      "ipBlock" in target ? [target.ipBlock.cidr] : [],
    ),
  );
}

test("reconciles service and endpoint CIDRs without losing concurrent policy edits", async () => {
  const api = new MockApi();
  const controller = new ReaperController(api);
  await controller.reconcileNeo4jPolicy();

  expect(api.patches).toHaveLength(4);
  const worker = api.patches[1].payload!;
  expect(api.patches[0].payload?.metadata.resourceVersion).toBe("10");
  expect(worker.metadata.resourceVersion).toBe("11");
  expect(worker.spec.egress[0].to).toEqual([
    { namespaceSelector: { matchLabels: { role: "updated-data" } } },
  ]);
  expect(cidrs(worker)).toEqual([serviceCidr, newEndpoint]);
  expect(api.patches[2].path).toEndWith(
    "/networkpolicies/hive-dispatcher-reaper",
  );
  expect(cidrs(api.patches[2].payload!)).toEqual([serviceCidr, newEndpoint]);
  expect(api.patches[3].path).toEndWith(
    "/networkpolicies/hive-observer-egress",
  );
  expect(cidrs(api.patches[3].payload!)).toEqual([serviceCidr, newEndpoint]);

  for (const request of api.patches.slice(1)) {
    const name = request.path.split("/").at(-1)!;
    const stored: NetworkPolicy = {
      metadata: { resourceVersion: "12" },
      spec: structuredClone(request.payload!.spec),
    };
    api.policies.set(name, stored);
  }
  api.policyReads = 2;
  api.readyEndpoint = false;
  api.patches.length = 0;
  await controller.reconcileNeo4jPolicy();
  expect(api.patches).toHaveLength(3);
  expect(cidrs(api.patches[0].payload!)).toEqual([serviceCidr]);
});
