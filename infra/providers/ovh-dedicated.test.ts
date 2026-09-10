import { resolve } from "node:path";
import { ok } from "neverthrow";
import {
  OvhRecoveryMarkerObservation,
  RecoveryMarkerCompatibilityKind,
} from "./ovh-dedicated-observations";
import { ArcTier, EndpointMode } from "./ovh-dedicated-contracts";
import { describe, expect, test } from "bun:test";

import {
  OvhDedicatedCreateOvhSignature,
  OvhTaskOutcome,
  OvhTaskStatus,
  OvhReinstallIntent,
  ReinstallDecision,
  ReinstallAuthorization,
} from "./ovh-dedicated";
import { OvhFailureKind } from "./ovh-dedicated-failure";
import { OvhLocalFile, OvhPathPresence } from "./ovh-dedicated-local";

describe("OVH dedicated provider", () => {
  test("distinguishes a missing local path from a failed lookup", async () => {
    const missingPath = resolve(process.cwd(), `.nook-missing-${crypto.randomUUID()}`);
    const missing = await new OvhLocalFile(missingPath).presence();
    expect(missing).toEqual(ok(OvhPathPresence.Absent));

    const failed = await new OvhLocalFile("/dev/null/child").presence();
    expect(failed.isErr()).toBe(true);
    if (failed.isErr()) expect(failed.error.kind).toBe(OvhFailureKind.Filesystem);
  });

  test("signs the canonical OVH request material", () => {
    const input = {
      applicationSecret: "secret",
      body: "",
      consumerKey: "consumer",
      method: "GET",
      timestamp: 1_700_000_000,
      url: "https://api.us.ovhcloud.com/1.0/dedicated/server",
    };
    expect(new OvhDedicatedCreateOvhSignature(input).execute()).toBe(
      "$1$fb37e9a312d2e1a8a8653b0cac91c4ed7195ca7a",
    );
  });

  test("reinstalls a blank server and converges the declared OS", () => {
    const blankInput = {
      allowReinstall: ReinstallAuthorization.Preserve,
      currentOperatingSystem: "none_64",
      desiredOperatingSystem: "debian13_64",
    };
    const convergedInput = {
      ...blankInput,
      currentOperatingSystem: "debian13_64",
    };
    expect(new OvhReinstallIntent(blankInput).decision()).toEqual(ok(ReinstallDecision.Required));
    expect(new OvhReinstallIntent(convergedInput).decision()).toEqual(ok(ReinstallDecision.Converged));
  });

  test("refuses to replace an installed OS without disaster recovery", () => {
    const input = {
      allowReinstall: ReinstallAuthorization.Preserve,
      currentOperatingSystem: "debian12_64",
      desiredOperatingSystem: "debian13_64",
    };
    const decision = new OvhReinstallIntent(input).decision();
    expect(decision.isErr()).toBe(true);
    if (decision.isErr()) expect(decision.error.message).toContain("refusing to replace");
  });

  test("honors an explicit same-OS disaster-recovery reinstall", () => {
    const input = {
      allowReinstall: ReinstallAuthorization.Replace,
      currentOperatingSystem: "debian13_64",
      desiredOperatingSystem: "debian13_64",
    };
    expect(new OvhReinstallIntent(input).decision()).toEqual(ok(ReinstallDecision.Required));
  });

  test("recognizes every OVH terminal reinstall failure", () => {
    expect(OvhTaskStatus.outcome(OvhTaskStatus.Cancelled)).toBe(
      OvhTaskOutcome.Failed,
    );
    expect(OvhTaskStatus.outcome(OvhTaskStatus.CustomerError)).toBe(
      OvhTaskOutcome.Failed,
    );
    expect(OvhTaskStatus.outcome(OvhTaskStatus.OvhError)).toBe(
      OvhTaskOutcome.Failed,
    );
    expect(OvhTaskStatus.outcome(OvhTaskStatus.Doing)).toBe(
      OvhTaskOutcome.Pending,
    );
  });

  test("accepts only the exact durable recovery operation", () => {
    const definition = {
      arcTier: ArcTier.Primary,
      endpointMode: EndpointMode.Direct,
      expectedCommercialRange: "RISE-S | AMD Ryzen 7 9700X",
      expectedDatacenter: "vin",
      meshAddress: "10.202.0.4",
      operatingSystem: "debian13_64",
      publicAddress: "167.114.158.40",
      serviceName: "ns513432.ip-167-114-158.net",
      sshPublicKeyFile: "~/.ssh/id_ed25519.pub",
      sshUser: "debian",
    } as const;
    const marker = {
      hostname: "nook-rise-s-2",
      operatingSystem: "debian13_64",
      serviceName: "ns513432.ip-167-114-158.net",
      version: 1,
    } as const;
    expect(
      OvhRecoveryMarkerObservation.fromRecord(marker).compatibility({
        definition,
        hostname: "nook-rise-s-2",
      }).kind,
    ).toBe(RecoveryMarkerCompatibilityKind.Matching);
    expect(
      OvhRecoveryMarkerObservation.fromRecord(marker).compatibility({
        definition,
        hostname: "nook-rise-s-1",
      }).kind,
    ).toBe(RecoveryMarkerCompatibilityKind.DifferentInventory);
  });
});
