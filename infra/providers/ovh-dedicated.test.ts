import { describe, expect, test } from "bun:test";

import {
  createOvhSignature,
  isTerminalTaskFailure,
  OvhTaskStatus,
  requiresReinstall,
} from "./ovh-dedicated";

describe("OVH dedicated provider", () => {
  test("signs the canonical OVH request material", () => {
    const input = {
      applicationSecret: "secret",
      body: "",
      consumerKey: "consumer",
      method: "GET",
      timestamp: 1_700_000_000,
      url: "https://api.us.ovhcloud.com/1.0/dedicated/server",
    };
    expect(createOvhSignature(input)).toBe(
      "$1$fb37e9a312d2e1a8a8653b0cac91c4ed7195ca7a",
    );
  });

  test("reinstalls a blank server and converges the declared OS", () => {
    const blankInput = {
      allowReinstall: false,
      currentOperatingSystem: "none_64",
      desiredOperatingSystem: "debian13_64",
    };
    const convergedInput = {
      ...blankInput,
      currentOperatingSystem: "debian13_64",
    };
    expect(requiresReinstall(blankInput)).toBeTrue();
    expect(requiresReinstall(convergedInput)).toBeFalse();
  });

  test("refuses to replace an installed OS without disaster recovery", () => {
    const input = {
      allowReinstall: false,
      currentOperatingSystem: "debian12_64",
      desiredOperatingSystem: "debian13_64",
    };
    expect(() => requiresReinstall(input)).toThrow("refusing to replace");
  });

  test("recognizes every OVH terminal reinstall failure", () => {
    expect(isTerminalTaskFailure(OvhTaskStatus.Cancelled)).toBeTrue();
    expect(isTerminalTaskFailure(OvhTaskStatus.CustomerError)).toBeTrue();
    expect(isTerminalTaskFailure(OvhTaskStatus.OvhError)).toBeTrue();
    expect(isTerminalTaskFailure(OvhTaskStatus.Doing)).toBeFalse();
  });
});
