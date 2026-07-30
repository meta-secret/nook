#!/usr/bin/env python3
"""Behavior regression for the legacy-registry to Zot migration guard."""

import os
import pathlib
import subprocess
import tempfile
import textwrap


ROOT = pathlib.Path(__file__).resolve().parents[2]
TASKFILE = ROOT / "infra/tasks/registry.yml"
FUNCTION_START = "        registry_digest() {\n"
FUNCTION_END = "\n        legacy_registry=\"$(\n"


def migration_source(work):
    task = TASKFILE.read_text(encoding="utf-8")
    functions = task.split(FUNCTION_START, 1)[1].split(FUNCTION_END, 1)[0]
    functions = FUNCTION_START.strip() + "\n" + functions
    return textwrap.dedent(
        f"""\
        #!/usr/bin/env bash
        set -euo pipefail
        work={work}
        start_temporary_forward() {{ :; }}
        {functions}
        copy_legacy_registry
        """
    )


def write_executable(path, source):
    path.write_text(source, encoding="utf-8")
    path.chmod(0o755)


def run_case(mode):
    with tempfile.TemporaryDirectory() as directory:
        work = pathlib.Path(directory)
        mock_bin = work / "bin"
        mock_bin.mkdir()
        command_log = work / "commands.log"
        write_executable(
            mock_bin / "docker",
            textwrap.dedent(
                """\
                #!/usr/bin/env python3
                import os
                import pathlib
                import sys

                with pathlib.Path(os.environ["MOCK_LOG"]).open("a") as log:
                    log.write("docker " + " ".join(sys.argv[1:]) + "\\n")
                """
            ),
        )
        write_executable(
            mock_bin / "curl",
            textwrap.dedent(
                """\
                #!/usr/bin/env python3
                import os
                import pathlib
                import sys

                args = sys.argv[1:]
                url = args[-1]
                mode = os.environ["MOCK_MODE"]
                if "--head" in args:
                    digest = "a" * 64
                    if mode == "mismatch" and "127.0.0.1:5001" in url:
                        digest = "b" * 64
                    print(f"Docker-Content-Digest: sha256:{digest}\\r")
                    raise SystemExit(0)
                output = pathlib.Path(args[args.index("--output") + 1])
                headers = pathlib.Path(args[args.index("--dump-header") + 1])
                headers.write_text(
                    "Link: </next>; rel=\\"next\\"\\r\\n"
                    if mode == "pagination" and "_catalog" in url
                    else "HTTP/1.1 200 OK\\r\\n",
                    encoding="utf-8",
                )
                if "_catalog" in url:
                    output.write_text(
                        '{"repositories":["nook-hive"]}\\n',
                        encoding="utf-8",
                    )
                elif "/tags/list" in url:
                    output.write_text(
                        '{"name":"nook-hive","tags":["current"]}\\n',
                        encoding="utf-8",
                    )
                else:
                    raise SystemExit(f"unexpected curl URL: {url}")
                """
            ),
        )
        harness = work / "harness.sh"
        write_executable(harness, migration_source(work))
        result = subprocess.run(
            [str(harness)],
            env={
                **os.environ,
                "PATH": f"{mock_bin}:{os.environ['PATH']}",
                "MOCK_LOG": str(command_log),
                "MOCK_MODE": mode,
            },
            text=True,
            capture_output=True,
            check=False,
        )
        commands = (
            command_log.read_text(encoding="utf-8")
            if command_log.exists()
            else ""
        )
        return result, commands


def main():
    success, commands = run_case("success")
    assert success.returncode == 0, success.stderr
    assert "docker pull 127.0.0.1:5000/nook-hive:current" in commands
    assert (
        "docker tag 127.0.0.1:5000/nook-hive:current "
        "127.0.0.1:5001/nook-hive:current"
    ) in commands
    assert "docker push 127.0.0.1:5001/nook-hive:current" in commands

    mismatch, commands = run_case("mismatch")
    assert mismatch.returncode != 0
    assert "Refusing lossy registry migration" in mismatch.stderr
    assert "docker push" in commands

    pagination, commands = run_case("pagination")
    assert pagination.returncode != 0
    assert "catalog exceeds the bounded migration page" in pagination.stderr
    assert not commands
    print("Zot migration copy, digest, and pagination guards: ok")


if __name__ == "__main__":
    main()
