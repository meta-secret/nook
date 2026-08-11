import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { countAuthoredNumstat } from "../main/git.js";

describe("countAuthoredNumstat", () => {
  it("counts authored additions and deletions", () => {
    const numstat = "12\t3\tsrc/domain.ts\n4\t5\ttests/domain.test.ts\n";
    assert.equal(countAuthoredNumstat(numstat), 24);
  });

  it("reports generated, lock, snapshot, vendor, binary, and pure rename rows separately", () => {
    const numstat = [
      "8\t1\tsrc/domain.ts",
      "40\t20\tbun.lock",
      "12\t0\ttests/domain.snap",
      "15\t4\tvendor/library.ts",
      "10\t0\tgenerated/client.ts",
      "-\t-\tassets/demo.png",
      "0\t0\tsrc/{old.ts => new.ts}",
    ].join("\n");
    assert.equal(countAuthoredNumstat(numstat), 9);
  });
});
