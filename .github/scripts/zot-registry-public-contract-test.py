#!/usr/bin/env python3
"""Behavior contract for the public authenticated Zot registry path."""

import pathlib
import re
import sys


ROOT = pathlib.Path(__file__).resolve().parents[2]


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def main() -> int:
    registry_task = read("infra/tasks/registry.yml")
    zot = read("infra/k0s/manifests/registry/zot.yaml")
    traefik = read("infra/traefik-dynamic.yaml")
    compose = read("infra/compose.yaml")
    hosts = read("infra/k0s/config/registry-hosts.toml")

    assert "registry.nokey.sh" in registry_task
    assert "nook-zot-htpasswd" in registry_task
    assert "kubectl port-forward --" not in registry_task
    assert "port-forward --address" not in registry_task
    assert "nook-zot-registry-loopback.service" in registry_task
    assert "disable --now" in registry_task
    assert "Host must not listen on :5000" in registry_task
    assert "gh secret set NOOK_REGISTRY_PASSWORD" in registry_task
    assert "kubectl.*port-forward.*nook-zot" in registry_task

    assert 'clusterIP: 10.96.90.10' in zot
    assert '"htpasswd"' in zot
    assert "nook-zot-htpasswd" in zot
    assert "kind: Service" in zot
    assert re.search(r"cidr:\s*10\.0\.0\.0/8", zot)

    assert "Host(`registry.nokey.sh`)" in traefik
    assert "http://10.96.90.10:5000" in traefik
    assert "127.0.0.1:6379" in traefik

    assert "network_mode: host" in compose
    assert "bind 127.0.0.1" in compose
    assert "network_mode: host" in compose
    assert "443:443" not in compose
    assert "5000:5000" not in compose

    assert 'server = "https://registry.nokey.sh"' in hosts
    assert "127.0.0.1:5000" not in hosts

    hive = read("infra/tasks/hive.yml")
    assert "registry.nokey.sh/nook-hive" in hive
    assert "127.0.0.1:5000" not in hive

    print("Public Zot registry contract: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
