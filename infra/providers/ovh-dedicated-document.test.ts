import { expect, test } from "bun:test";
import { OvhDocument, OvhDocumentError } from "./ovh-dedicated-document";
import { OvhTaskStatus } from "./ovh-dedicated-contracts";

test("OVH task decoder carries typed status and rejects unknown task states", () => {
  expect(OvhDocument.task('{"status":"done","taskId":42}')).toEqual({
    status: OvhTaskStatus.Done,
    taskId: 42,
  });
  expect(() =>
    OvhDocument.task('{"status":"future-status","taskId":42}'),
  ).toThrow(OvhDocumentError);
  expect(() => OvhDocument.task('{"status":"done","taskId":"42"}')).toThrow(
    OvhDocumentError,
  );
});
test("invalid credential shape never includes credential values in failure text", () => {
  expect(() =>
    OvhDocument.credentials(
      '{"applicationKey":"private-key","applicationSecret":9}',
    ),
  ).toThrow("OVH credentials has an invalid schema");
});
test("recovery markers reject unsupported writer versions", () => {
  expect(() =>
    OvhDocument.recoveryMarker(
      '{"version":2,"hostname":"host","serviceName":"service","operatingSystem":"os"}',
    ),
  ).toThrow(OvhDocumentError);
});
