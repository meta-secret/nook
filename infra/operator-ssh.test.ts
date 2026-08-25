import { describe, expect, test } from "bun:test";
import { mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ensureInclude,
  renderManagedConfig,
  requireInventory,
  writableConfigPath,
} from "./operator-ssh";

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
    const rendered = renderManagedConfig({
      ...home,
      accessFallback: "ssh.bynull.link",
    });
    expect(rendered).toContain("Host nook-home-lan");
    expect(rendered).toContain("StrictHostKeyChecking yes");
    expect(rendered).toContain("PasswordAuthentication no");
    expect(rendered).toContain("ProxyCommand none");
    expect(rendered).not.toContain("cloudflared access ssh");
  });

  test("prepends the managed include exactly once", () => {
    const once = ensureInclude("Host existing\n  HostName example.invalid\n");
    expect(once.startsWith("Include ~/.ssh/config.d/*.conf\n")).toBe(true);
    expect(ensureInclude(once)).toBe(once);
  });

  test("moves an existing global include ahead of unsafe global options", () => {
    const original = [
      "StrictHostKeyChecking no",
      "UserKnownHostsFile /dev/null",
      "Include ~/.ssh/config.d/*.conf",
      "",
    ].join("\n");
    const configured = ensureInclude(original);
    expect(configured.startsWith("Include ~/.ssh/config.d/*.conf\n\n"))
      .toBe(true);
    expect(configured.match(/Include ~\/\.ssh\/config\.d\/\*\.conf/g)).toHaveLength(1);
  });

  test("does not treat a host-scoped include as global", () => {
    const original = [
      "Host existing",
      "  HostName example.invalid",
      "  Include ~/.ssh/config.d/*.conf",
      "",
    ].join("\n");
    expect(ensureInclude(original).startsWith("Include ~/.ssh/config.d/*.conf\n"))
      .toBe(true);
  });

  test("resolves a symlink-managed SSH config to its target", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "nook-operator-ssh-"));
    try {
      const target = join(fixture, "managed-config");
      const link = join(fixture, "config");
      await writeFile(target, "Host existing\n", "utf8");
      await symlink(target, link);
      expect(await writableConfigPath(link)).toBe(await realpath(target));
    } finally {
      await rm(fixture, { force: true, recursive: true });
    }
  });

  test("rejects a dangling symlink-managed SSH config", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "nook-operator-ssh-"));
    try {
      const link = join(fixture, "config");
      await symlink(join(fixture, "missing-config"), link);
      expect(writableConfigPath(link)).rejects.toThrow(
        "dangling symbolic link",
      );
    } finally {
      await rm(fixture, { force: true, recursive: true });
    }
  });

  test("rejects a non-private address", () => {
    expect(() => requireInventory({ ...home, address: "203.0.113.10" })).toThrow(
      "private LAN address",
    );
  });

  test("rejects malformed private-looking addresses", () => {
    expect(() =>
      requireInventory({ ...home, address: "192.168.999.140" }),
    ).toThrow("private LAN address");
  });

  test("requires a distinct Cloudflare fallback", () => {
    expect(() =>
      requireInventory({
        ...home,
        accessFallback: "nook-home-lan",
      }),
    ).toThrow("distinct hostname");
  });
});
