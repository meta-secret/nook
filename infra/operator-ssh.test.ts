import {describe,expect,test} from "bun:test";
import {mkdtemp,realpath,rm,symlink,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {OperatorSshFailureKind,OperatorSshEnsureInclude,OperatorSshRenderManagedConfig,OperatorSshRequireInventory,OperatorSshWritableConfigPath} from "./operator-ssh";

const home = {
  accessFallback: "ssh.example.invalid",
  address: "192.168.1.140",
  alias: "nook-home-lan",
  expectedHostname: "nook-home",
  hostKeyFingerprint: "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  identityFile: "~/.ssh/id_ed25519",
  user: "operator",
};

describe("operator SSH configuration", () => {
  test("renders a strict browserless LAN alias", () => {
    const rendered = new OperatorSshRenderManagedConfig({
      ...home,
      accessFallback: "ssh.bynull.link",
    }).execute();
    expect(rendered).toContain("Host nook-home-lan");
    expect(rendered).toContain("StrictHostKeyChecking yes");
    expect(rendered).toContain("PasswordAuthentication no");
    expect(rendered).toContain("ProxyCommand none");
    expect(rendered).not.toContain("cloudflared access ssh");
  });

  test("prepends the managed include exactly once", () => {
    const once = new OperatorSshEnsureInclude(
      "Host existing\n  HostName example.invalid\n",
    ).execute();
    expect(once.startsWith("Include ~/.ssh/config.d/nook-infra.conf\n")).toBe(
      true,
    );
    expect(new OperatorSshEnsureInclude(once).execute()).toBe(once);
  });

  test("loads the managed host before wildcard fragments and unsafe options", () => {
    const original = [
      "StrictHostKeyChecking no",
      "UserKnownHostsFile /dev/null",
      "Include ~/.ssh/config.d/*.conf",
      "",
    ].join("\n");
    const configured = new OperatorSshEnsureInclude(original).execute();
    expect(
      configured.startsWith("Include ~/.ssh/config.d/nook-infra.conf\n\n"),
    ).toBe(true);
    expect(configured).toContain("Include ~/.ssh/config.d/*.conf");
  });

  test("does not treat a host-scoped include as global", () => {
    const original = [
      "Host existing",
      "  HostName example.invalid",
      "  Include ~/.ssh/config.d/nook-infra.conf",
      "",
    ].join("\n");
    const configured = new OperatorSshEnsureInclude(original).execute();
    expect(
      configured.startsWith("Include ~/.ssh/config.d/nook-infra.conf\n"),
    ).toBe(true);
    expect(
      configured.match(/Include ~\/\.ssh\/config\.d\/nook-infra\.conf/g),
    ).toHaveLength(2);
  });

  test("resolves a symlink-managed SSH config to its target", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "nook-operator-ssh-"));
    try {
      const target = join(fixture, "managed-config");
      const link = join(fixture, "config");
      await writeFile(target, "Host existing\n", "utf8");
      await symlink(target, link);
      const outcome = await new OperatorSshWritableConfigPath(link).execute();
      expect(outcome.isOk()).toBe(true);
      if (outcome.isOk()) expect(outcome.value).toBe(await realpath(target));
    } finally {
      await rm(fixture, { force: true, recursive: true });
    }
  });

  test("rejects a dangling symlink-managed SSH config", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "nook-operator-ssh-"));
    try {
      const link = join(fixture, "config");
      await symlink(join(fixture, "missing-config"), link);
      const outcome = await new OperatorSshWritableConfigPath(link).execute();
      expect(outcome.isErr()).toBe(true);
      if (outcome.isErr()) expect(outcome.error.kind).toBe(OperatorSshFailureKind.DanglingLink);
    } finally {
      await rm(fixture, { force: true, recursive: true });
    }
  });

  test("rejects a non-private address", () => {
    const outcome = new OperatorSshRequireInventory({
        ...home,
        address: "203.0.113.10",
      }).execute();
    expect(outcome.isErr()).toBe(true);
    if (outcome.isErr()) expect(outcome.error.message).toContain("private LAN address");
  });

  test("rejects malformed private-looking addresses", () => {
    const outcome = new OperatorSshRequireInventory({
        ...home,
        address: "192.168.999.140",
      }).execute();
    expect(outcome.isErr()).toBe(true);
    if (outcome.isErr()) expect(outcome.error.message).toContain("private LAN address");
  });

  test("requires a distinct Cloudflare fallback", () => {
    const outcome = new OperatorSshRequireInventory({
        ...home,
        accessFallback: "nook-home-lan",
      }).execute();
    expect(outcome.isErr()).toBe(true);
    if (outcome.isErr()) expect(outcome.error.message).toContain("distinct hostname");
  });
});
