#!/usr/bin/env python3
import json
import os
import subprocess
import tempfile
import threading
import time


with tempfile.TemporaryDirectory(
    prefix="hive-publication-smoke-", dir="/workspace"
) as directory:
    os.chmod(directory, 0o700)
    requests = os.path.join(directory, "requests")
    responses = os.path.join(directory, "responses")
    os.mkdir(requests, mode=0o700)
    os.mkdir(responses, mode=0o700)
    broker_errors: list[Exception] = []

    def serve_ping() -> None:
        try:
            deadline = time.monotonic() + 5
            request_path = ""
            while time.monotonic() < deadline:
                candidates = sorted(
                    name for name in os.listdir(requests) if name.endswith(".json")
                )
                if candidates:
                    request_path = os.path.join(requests, candidates[0])
                    break
                time.sleep(0.05)
            if not request_path:
                raise TimeoutError("publication smoke request was not created")
            with open(request_path, encoding="utf-8") as request_file:
                request = json.load(request_file)
            if request != {"operation": "ping"}:
                raise RuntimeError(f"unexpected publication request: {request!r}")
            request_id = os.path.basename(request_path).removesuffix(".json")
            temporary = os.path.join(responses, f".{request_id}.tmp")
            destination = os.path.join(responses, f"{request_id}.json")
            with open(temporary, "x", encoding="utf-8") as response_file:
                os.chmod(temporary, 0o600)
                json.dump(
                    {
                        "result": "value",
                        "value": {"status": "ok"},
                    },
                    response_file,
                )
                response_file.flush()
                os.fsync(response_file.fileno())
            os.replace(temporary, destination)
        except Exception as error:
            broker_errors.append(error)

    broker = threading.Thread(target=serve_ping, daemon=True)
    broker.start()

    environment = os.environ.copy()
    environment["HIVE_PUBLICATION_DIRECTORY"] = directory
    client_error: Exception | None = None
    completed: subprocess.CompletedProcess[str] | None = None
    try:
        completed = subprocess.run(
            [
                "bwrap",
                "--unshare-user",
                "--unshare-pid",
                "--unshare-net",
                "--ro-bind",
                "/",
                "/",
                "--dev",
                "/dev",
                "--tmpfs",
                "/tmp",
                "--bind",
                "/workspace",
                "/workspace",
                "--chdir",
                "/workspace",
                "hive",
                "github",
                "ping",
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
            env=environment,
        )
    except Exception as error:
        client_error = error
    finally:
        broker.join(timeout=6)

    if broker.is_alive():
        raise RuntimeError("publication smoke broker did not terminate") from client_error
    if broker_errors:
        raise RuntimeError("publication smoke broker failed") from broker_errors[0]
    if client_error is not None:
        raise client_error
    if completed is None:
        raise RuntimeError("publication smoke client did not return a result")
    if json.loads(completed.stdout) != {"status": "ok"}:
        raise RuntimeError(f"unexpected publication response: {completed.stdout!r}")

print("result=ok")
