import { expect, test } from "bun:test";
import {
  KubernetesDocument,
  KubernetesDocumentError,
} from "./kubernetes-document";

test("network policy decoder preserves untouched fields inside egress patches", () => {
  const source = {
    metadata: { resourceVersion: "7" },
    spec: {
      egress: [
        {
          to: [
            {
              namespaceSelector: {
                matchExpressions: [{ key: "role", operator: "Exists" }],
              },
            },
          ],
          ports: [{ port: "dns", protocol: "UDP", endPort: 53 }],
        },
        {
          to: [{ ipBlock: { cidr: "10.0.0.1/32", except: ["10.0.0.2/32"] } }],
          ports: [{ port: 7687, protocol: "TCP" }],
        },
      ],
    },
  };
  expect(KubernetesDocument.networkPolicy(JSON.stringify(source))).toEqual(
    source,
  );
});
test("invalid policy or endpoint fields fail before reconciliation", () => {
  expect(() =>
    KubernetesDocument.networkPolicy(
      '{"metadata":{"resourceVersion":9},"spec":{"egress":[]}}',
    ),
  ).toThrow(KubernetesDocumentError);
  expect(() =>
    KubernetesDocument.endpoints('{"subsets":[{"addresses":[{"ip":9}]}]}'),
  ).toThrow(KubernetesDocumentError);
});
test("external missing pod labels remain absent rather than fabricated", () => {
  expect(KubernetesDocument.pod('{"metadata":{}}')).toEqual({ metadata: {} });
});
