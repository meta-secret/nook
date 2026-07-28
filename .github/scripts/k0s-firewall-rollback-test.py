#!/usr/bin/env python3
"""Behavior regression for the Taskfile-owned k0s firewall rollback."""

import os
import pathlib
import subprocess
import tempfile
import textwrap


ROOT = pathlib.Path(__file__).resolve().parents[2]
TASKFILE = ROOT / "infra/tasks/k0s.yml"
FUNCTION_START = "        rollback_k0s_firewall() {\n"
FUNCTION_END = "        trap rollback_k0s_firewall EXIT\n"
REPLACE_START = "        replace_k0s_firewall_rules() {\n"
REPLACE_END = "        trap rollback_k0s_firewall EXIT\n"


def rollback_source():
    taskfile = TASKFILE.read_text(encoding="utf-8")
    embedded = taskfile.split(FUNCTION_START, 1)[1].split(FUNCTION_END, 1)[0]
    return "rollback_k0s_firewall() {\n" + textwrap.dedent(embedded)


def replace_source():
    taskfile = TASKFILE.read_text(encoding="utf-8")
    embedded = taskfile.split(REPLACE_START, 1)[1].split(REPLACE_END, 1)[0]
    return "replace_k0s_firewall_rules() {\n" + textwrap.dedent(embedded)


def uninstall_include_filter():
    taskfile = TASKFILE.read_text(encoding="utf-8")
    start = "        sudo -n awk \\\n          '"
    end = "' \\\n          /etc/nftables.conf > \"$firewall_config\"\n"
    return taskfile.split(start, 1)[1].split(end, 1)[0]


def write(path, content):
    path.write_text(content, encoding="utf-8")


def run_case(exit_mode):
    with tempfile.TemporaryDirectory() as directory:
        work = pathlib.Path(directory)
        mock_bin = work / "bin"
        mock_bin.mkdir()
        input_state = work / "input"
        forward_state = work / "forward"
        config = work / "nftables.conf"
        fragment = work / "nook-k0s.nft"
        previous_config = work / "previous.conf"
        previous_fragment = work / "previous.nft"
        previous_live = work / "previous-live.nft"
        original_input = (
            'add rule inet bynull_filter input tcp dport 6443 accept '
            'comment "nook k0s pod control plane v2"\n'
            'add rule inet bynull_filter input counter drop '
            'comment "later input rule"\n'
        )
        original_forward = (
            'add rule inet bynull_filter forward ip saddr 10.244.0.0/16 '
            'accept comment "nook k0s pod egress v2"\n'
            'add rule inet bynull_filter forward counter drop '
            'comment "later forward rule"\n'
        )
        original_config = "table inet bynull_filter { # original }\n"
        original_fragment = original_input + original_forward
        write(input_state, 'add rule inet bynull_filter input accept comment "nook k0s pod control plane v3"\n')
        write(forward_state, 'add rule inet bynull_filter forward accept comment "nook k0s pod egress v3 next"\n')
        write(config, "mutated config\n")
        write(fragment, "mutated fragment\n")
        write(previous_config, original_config)
        write(previous_fragment, original_fragment)
        write(
            previous_live,
            "flush chain inet bynull_filter input\n"
            + original_input
            + "flush chain inet bynull_filter forward\n"
            + original_forward,
        )

        sudo = mock_bin / "sudo"
        write(
            sudo,
            textwrap.dedent(
                """\
                #!/usr/bin/env python3
                import os
                import pathlib
                import shutil
                import sys

                args = sys.argv[1:]
                if args and args[0] == "-n":
                    args = args[1:]
                input_state = pathlib.Path(os.environ["MOCK_INPUT_STATE"])
                forward_state = pathlib.Path(os.environ["MOCK_FORWARD_STATE"])
                if args[:4] == ["nft", "--handle", "list", "chain"]:
                    state = input_state if args[-1] == "input" else forward_state
                    for line in state.read_text().splitlines():
                        expression = line.split(f" {args[-1]} ", 1)[1]
                        print(f"  {expression} # handle 1")
                elif args[:3] == ["nft", "delete", "rule"]:
                    state = input_state if args[4] == "input" else forward_state
                    state.write_text("")
                elif args[:2] == ["nft", "--file"]:
                    input_rules = []
                    forward_rules = []
                    for line in pathlib.Path(args[2]).read_text().splitlines():
                        if line.startswith("flush chain "):
                            continue
                        (input_rules if " input " in line else forward_rules).append(line)
                    input_state.write_text("\\n".join(input_rules) + ("\\n" if input_rules else ""))
                    forward_state.write_text("\\n".join(forward_rules) + ("\\n" if forward_rules else ""))
                elif args and args[0] == "install":
                    source = pathlib.Path(args[-2])
                    destination = args[-1]
                    target = (
                        os.environ["MOCK_CONFIG"]
                        if destination == "/etc/nftables.conf"
                        else os.environ["MOCK_FRAGMENT"]
                    )
                    shutil.copyfile(source, target)
                elif args[:2] == ["rm", "-f"]:
                    pathlib.Path(os.environ["MOCK_FRAGMENT"]).unlink(missing_ok=True)
                else:
                    raise SystemExit(f"unexpected sudo command: {args}")
                """
            ),
        )
        sudo.chmod(0o755)

        harness = work / "harness.sh"
        trigger = "false" if exit_mode == "error" else "kill -TERM $$"
        write(
            harness,
            f"""#!/usr/bin/env bash
set -Eeuo pipefail
firewall_fragment={work / "temporary-fragment"}
firewall_config={work / "temporary-config"}
firewall_previous_config={previous_config}
firewall_previous_fragment={previous_fragment}
firewall_previous_live={previous_live}
firewall_live_next={work / "live-next.nft"}
firewall_fragment_existed=true
firewall_rollback_armed=true
encryption_config=""
cni_config_next=""
recovery_key=""
encrypted_backup=""
expected_mac=""
{rollback_source()}
trap rollback_k0s_firewall EXIT
trap rollback_k0s_firewall ERR
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
{trigger}
""",
        )
        harness.chmod(0o755)
        env = {
            **os.environ,
            "PATH": f"{mock_bin}:{os.environ['PATH']}",
            "MOCK_INPUT_STATE": str(input_state),
            "MOCK_FORWARD_STATE": str(forward_state),
            "MOCK_CONFIG": str(config),
            "MOCK_FRAGMENT": str(fragment),
        }
        result = subprocess.run([str(harness)], env=env, check=False)
        expected_code = 1 if exit_mode == "error" else 143
        assert result.returncode == expected_code, (exit_mode, result.returncode)
        assert input_state.read_text() == original_input
        assert forward_state.read_text() == original_forward
        assert config.read_text() == original_config
        assert fragment.read_text() == original_fragment


def run_successful_replacement_case():
    with tempfile.TemporaryDirectory() as directory:
        work = pathlib.Path(directory)
        mock_bin = work / "bin"
        mock_bin.mkdir()
        input_state = work / "input"
        forward_state = work / "forward"
        firewall_live_next = work / "next.nft"
        original_input = (
            'tcp dport 6443 accept comment "nook k0s pod control plane v2"\n'
            'jump audit comment "unrelated input jump"\n'
            'counter drop comment "later input drop"\n'
        )
        original_forward = (
            'ip saddr 10.244.0.0/16 accept comment "nook k0s pod egress install"\n'
            'jump audit comment "unrelated forward jump"\n'
            'counter drop comment "later forward drop"\n'
        )
        write(input_state, original_input)
        write(forward_state, original_forward)

        sudo = mock_bin / "sudo"
        write(
            sudo,
            textwrap.dedent(
                """\
                #!/usr/bin/env python3
                import os
                import pathlib
                import sys

                args = sys.argv[1:]
                if args and args[0] == "-n":
                    args = args[1:]
                input_state = pathlib.Path(os.environ["MOCK_INPUT_STATE"])
                forward_state = pathlib.Path(os.environ["MOCK_FORWARD_STATE"])
                if args[:4] == ["nft", "--handle", "list", "chain"]:
                    state = input_state if args[-1] == "input" else forward_state
                    for handle, expression in enumerate(
                        state.read_text().splitlines(), start=1
                    ):
                        print(f"  {expression} # handle {handle}")
                elif args[:3] == ["nft", "--check", "--file"]:
                    pass
                elif args[:2] == ["nft", "--file"]:
                    states = {"input": [], "forward": []}
                    current = None
                    for line in pathlib.Path(args[2]).read_text().splitlines():
                        fields = line.split()
                        if fields[:4] == ["flush", "chain", "inet", "bynull_filter"]:
                            current = fields[4]
                        elif fields[:4] == ["add", "rule", "inet", "bynull_filter"]:
                            current = fields[4]
                            states[current].append(" ".join(fields[5:]))
                    input_state.write_text("\\n".join(states["input"]) + "\\n")
                    forward_state.write_text("\\n".join(states["forward"]) + "\\n")
                else:
                    raise SystemExit(f"unexpected sudo command: {args}")
                """
            ),
        )
        sudo.chmod(0o755)

        harness = work / "harness.sh"
        write(
            harness,
            f"""#!/usr/bin/env bash
set -Eeuo pipefail
firewall_live_next={firewall_live_next}
{replace_source()}
replace_k0s_firewall_rules committed
""",
        )
        harness.chmod(0o755)
        env = {
            **os.environ,
            "PATH": f"{mock_bin}:{os.environ['PATH']}",
            "MOCK_INPUT_STATE": str(input_state),
            "MOCK_FORWARD_STATE": str(forward_state),
        }
        subprocess.run([str(harness)], env=env, check=True)
        assert input_state.read_text() == (
            'iifname "kube-bridge" ip saddr 10.244.0.0/16 tcp dport '
            '{ 6443, 8132, 10250 } accept comment '
            '"nook k0s pod control plane v3"\n'
            'jump audit comment "unrelated input jump"\n'
            'counter drop comment "later input drop"\n'
        )
        assert forward_state.read_text() == (
            'iifname "kube-bridge" ip saddr 10.244.0.0/16 accept comment '
            '"nook k0s pod egress v3"\n'
            'jump audit comment "unrelated forward jump"\n'
            'counter drop comment "later forward drop"\n'
        )


def main():
    run_case("error")
    run_case("signal")
    run_successful_replacement_case()
    nftables_config = textwrap.dedent(
        """\
        table inet bynull_filter {}
          include   "/etc/nftables.d/nook-k0s.nft"   # managed
        include "/etc/nftables.d/unrelated.nft"
        """
    )
    filtered = subprocess.run(
        ["awk", uninstall_include_filter()],
        input=nftables_config,
        text=True,
        capture_output=True,
        check=True,
    ).stdout
    assert "nook-k0s.nft" not in filtered
    assert 'include "/etc/nftables.d/unrelated.nft"' in filtered
    print("k0s firewall error and signal rollback: ok")
    print("k0s firewall successful replacement ordering: ok")
    print("k0s firewall include uninstall variants: ok")


if __name__ == "__main__":
    main()
