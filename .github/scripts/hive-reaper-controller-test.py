#!/usr/bin/env python3
"""Behavior regression for the embedded Hive lifecycle controller."""

import copy
import pathlib
import ssl
import textwrap
import urllib.error


ROOT = pathlib.Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "infra/k0s/manifests/hive/reaper-controller.yaml"
START = "exec python3 - <<'PY'\n"
END = "\n              PY"


def controller_source():
    manifest = MANIFEST.read_text(encoding="utf-8")
    embedded = manifest.split(START, 1)[1].split(END, 1)[0]
    return textwrap.dedent(embedded)


def main():
    namespace = {"__name__": "hive_controller_test"}
    create_default_context = ssl.create_default_context
    ssl.create_default_context = lambda **_kwargs: object()
    try:
        exec(compile(controller_source(), str(MANIFEST), "exec"), namespace)
    finally:
        ssl.create_default_context = create_default_context

    old_endpoint = "10.244.0.7/32"
    new_endpoint = "10.244.0.9/32"
    service_cidr = "10.96.87.23/32"
    policy = {
        "metadata": {"resourceVersion": "10"},
        "spec": {
            "egress": [
                {
                    "to": [{"namespaceSelector": {"matchLabels": {"role": "data"}}}],
                    "ports": [{"protocol": "TCP", "port": 7687}],
                },
                {
                    "to": [
                        {"ipBlock": {"cidr": service_cidr}},
                        {"ipBlock": {"cidr": old_endpoint}},
                    ],
                    "ports": [{"protocol": "TCP", "port": 7687}],
                },
            ]
        }
    }
    policies = {
        "hive-worker-egress": policy,
        "hive-dispatcher-reaper": copy.deepcopy(policy),
        "hive-observer-egress": copy.deepcopy(policy),
    }
    patches = []
    policy_reads = 0
    ready_endpoint = True
    conflict_once = True

    def json_request(_method, path, _payload=None):
        nonlocal policy_reads, ready_endpoint
        if path.endswith("/services/hive-neo4j"):
            return {"spec": {"clusterIP": service_cidr.removesuffix("/32")}}
        if path.endswith("/endpoints/hive-neo4j"):
            return {
                "subsets": [
                    {
                        "addresses": (
                            [{"ip": new_endpoint.removesuffix("/32")}]
                            if ready_endpoint
                            else []
                        )
                    }
                ]
            }
        if "/networkpolicies/" in path:
            policy_name = path.rsplit("/", 1)[1]
            policy_reads += 1
            if policy_reads == 2:
                policies[policy_name]["metadata"]["resourceVersion"] = "11"
                policies[policy_name]["spec"]["egress"][0]["to"] = [
                    {
                        "namespaceSelector": {
                            "matchLabels": {"role": "updated-data"}
                        }
                    }
                ]
            return copy.deepcopy(policies[policy_name])
        raise AssertionError(f"unexpected API path: {path}")

    def api_request(method, path, payload=None):
        nonlocal conflict_once
        patches.append((method, path, payload))
        if conflict_once and path.endswith("/networkpolicies/hive-worker-egress"):
            conflict_once = False
            raise urllib.error.HTTPError(path, 409, "Conflict", {}, None)
        return b"{}"

    namespace["json_request"] = json_request
    namespace["api_request"] = api_request
    namespace["reconcile_neo4j_policy"]()

    assert len(patches) == 4, patches
    method, path, payload = patches[1]
    assert method == "PATCH"
    assert path.endswith("/networkpolicies/hive-worker-egress")
    assert patches[0][2]["metadata"]["resourceVersion"] == "10"
    assert payload["metadata"]["resourceVersion"] == "11"
    assert payload["spec"]["egress"][0]["to"] == [
        {"namespaceSelector": {"matchLabels": {"role": "updated-data"}}}
    ]
    cidrs = [
        destination["ipBlock"]["cidr"]
        for rule in payload["spec"]["egress"]
        for destination in rule.get("to", [])
        if "ipBlock" in destination
    ]
    assert cidrs == [service_cidr, new_endpoint], cidrs
    assert old_endpoint not in cidrs
    assert patches[2][1].endswith(
        "/networkpolicies/hive-dispatcher-reaper"
    ), patches
    dispatcher_cidrs = [
        destination["ipBlock"]["cidr"]
        for rule in patches[2][2]["spec"]["egress"]
        for destination in rule.get("to", [])
        if "ipBlock" in destination
    ]
    assert dispatcher_cidrs == [service_cidr, new_endpoint], dispatcher_cidrs
    assert patches[3][1].endswith(
        "/networkpolicies/hive-observer-egress"
    ), patches
    observer_cidrs = [
        destination["ipBlock"]["cidr"]
        for rule in patches[3][2]["spec"]["egress"]
        for destination in rule.get("to", [])
        if "ipBlock" in destination
    ]
    assert observer_cidrs == [service_cidr, new_endpoint], observer_cidrs

    policies["hive-worker-egress"] = copy.deepcopy(payload)
    policies["hive-worker-egress"]["metadata"]["resourceVersion"] = "12"
    policies["hive-dispatcher-reaper"] = copy.deepcopy(patches[2][2])
    policies["hive-dispatcher-reaper"]["metadata"]["resourceVersion"] = "12"
    policies["hive-observer-egress"] = copy.deepcopy(patches[3][2])
    policies["hive-observer-egress"]["metadata"]["resourceVersion"] = "12"
    policy_reads = 2
    ready_endpoint = False
    patches.clear()
    namespace["reconcile_neo4j_policy"]()
    assert len(patches) == 3, patches
    unready_payload = patches[0][2]
    unready_cidrs = [
        destination["ipBlock"]["cidr"]
        for rule in unready_payload["spec"]["egress"]
        for destination in rule.get("to", [])
        if "ipBlock" in destination
    ]
    assert unready_cidrs == [service_cidr], unready_cidrs
    print("Hive lifecycle controller endpoint reconciliation: ok")


if __name__ == "__main__":
    main()
