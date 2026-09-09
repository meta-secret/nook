import { expect, test } from "bun:test";
import { OvhDocument } from "./ovh-dedicated-document";
import { OvhFailureKind } from "./ovh-dedicated-failure";
import { OvhTaskStatus } from "./ovh-dedicated-contracts";

test("OVH task decoder carries typed status and rejects unknown task states", () => {
  const valid = new OvhDocument('{"status":"done","taskId":42}').task();
  expect(valid.isOk()).toBe(true);
  if (valid.isOk()) expect(valid.value).toEqual({ status: OvhTaskStatus.Done, taskId: 42 });
  for (const source of ['{"status":"future-status","taskId":42}', '{"status":"done","taskId":"42"}']) {
    const invalid = new OvhDocument(source).task();
    expect(invalid.isErr()).toBe(true);
    if (invalid.isErr()) expect(invalid.error.kind).toBe(OvhFailureKind.Schema);
  }
});
test("invalid credential shape never includes credential values in failure text", () => {
  const invalid = new OvhDocument('{"applicationKey":"private-key","applicationSecret":9}').credentials();
  expect(invalid.isErr()).toBe(true);
  if (invalid.isErr()) expect(invalid.error.message).toBe("OVH credentials has an invalid schema");
});
test("recovery markers reject unsupported writer versions", () => {
  const invalid = new OvhDocument('{"version":2,"hostname":"host","serviceName":"service","operatingSystem":"os"}').recoveryMarker();
  expect(invalid.isErr()).toBe(true);
  if (invalid.isErr()) expect(invalid.error.kind).toBe(OvhFailureKind.Schema);
});
