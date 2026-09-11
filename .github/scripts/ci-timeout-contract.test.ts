import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

interface WorkflowJobTimeoutContract {
  readonly workflow: string;
  readonly job: string;
  readonly nextJob: string;
  readonly timeoutMinutes: number;
}

const contracts: readonly WorkflowJobTimeoutContract[] = [
  {
    workflow: ".github/workflows/rust-ecosystem-checks.yml",
    job: "kani",
    nextJob: "dylint",
    timeoutMinutes: 3,
  },
  {
    workflow: ".github/workflows/pr.yml",
    job: "verify",
    nextJob: "preview",
    timeoutMinutes: 5,
  },
];

describe("CI runaway execution bounds", () => {
  for (const contract of contracts) {
    test(`${contract.workflow}#${contract.job} keeps its timeout`, async () => {
      const source = await readFile(resolve(contract.workflow), "utf8");
      const jobStart = source.indexOf(`  ${contract.job}:\n`);
      const nextJobStart = source.indexOf(`  ${contract.nextJob}:\n`, jobStart);

      expect(jobStart).toBeGreaterThanOrEqual(0);
      expect(nextJobStart).toBeGreaterThan(jobStart);

      const job = source.slice(jobStart, nextJobStart);
      expect(job).toContain(`    timeout-minutes: ${contract.timeoutMinutes}\n`);
    });
  }
});
