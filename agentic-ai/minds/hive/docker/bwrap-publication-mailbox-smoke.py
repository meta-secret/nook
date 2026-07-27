#!/usr/bin/env python3
import hashlib
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
    acknowledgements = os.path.join(directory, "acknowledgements")
    commits = os.path.join(directory, "commits")
    responses = os.path.join(directory, "responses")
    os.mkdir(requests, mode=0o700)
    os.mkdir(acknowledgements, mode=0o700)
    os.mkdir(commits, mode=0o700)
    os.mkdir(responses, mode=0o700)
    signing_key = os.path.join(directory, ".signing-key.pem")
    subprocess.run(
        ["openssl", "genpkey", "-algorithm", "ED25519", "-out", signing_key],
        check=True,
        capture_output=True,
    )
    public_der = subprocess.run(
        ["openssl", "pkey", "-in", signing_key, "-pubout", "-outform", "DER"],
        check=True,
        capture_output=True,
    ).stdout
    if len(public_der) < 32:
        raise RuntimeError("publication smoke verification key is invalid")
    verifying_key = public_der[-32:].hex()
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
            with open(request_path, "rb") as request_file:
                request_bytes = request_file.read()
            request_envelope = json.loads(request_bytes)
            if request_envelope["request"] != {"operation": "ping"}:
                raise RuntimeError(
                    f"unexpected publication request: {request_envelope!r}"
                )
            request_id = os.path.basename(request_path).removesuffix(".json")
            request_digest = hashlib.sha256(request_bytes).digest()
            acknowledgement_message = (
                b"ack" + b"\0" + request_id.encode() + b"\0" + request_digest
            )
            acknowledgement_signature = subprocess.run(
                [
                    "openssl",
                    "pkeyutl",
                    "-sign",
                    "-rawin",
                    "-inkey",
                    signing_key,
                ],
                input=acknowledgement_message,
                check=True,
                capture_output=True,
            ).stdout
            acknowledgement_path = os.path.join(
                acknowledgements, f"{request_id}.json"
            )
            with open(acknowledgement_path, "x", encoding="utf-8") as output:
                json.dump(
                    {
                        "request_digest": request_digest.hex(),
                        "signature": acknowledgement_signature.hex(),
                    },
                    output,
                )
            commit_path = os.path.join(commits, f"{request_id}.json")
            commit_deadline = time.monotonic() + 5
            while time.monotonic() < commit_deadline and not os.path.isfile(
                commit_path
            ):
                time.sleep(0.05)
            with open(commit_path, encoding="utf-8") as commit_file:
                commit = json.load(commit_file)
            if (
                commit["acknowledgement_signature"]
                != acknowledgement_signature.hex()
            ):
                raise RuntimeError("publication commit did not match acknowledgement")
            authorization_secret = bytes.fromhex(commit["authorization_secret"])
            if (
                hashlib.sha256(authorization_secret).hexdigest()
                != request_envelope["authorization_hash"]
            ):
                raise RuntimeError("publication commit did not authorize request")
            temporary = os.path.join(responses, f".{request_id}.tmp")
            destination = os.path.join(responses, f"{request_id}.json")
            response_json = json.dumps(
                {
                    "result": "value",
                    "value": {"status": "ok"},
                },
                separators=(",", ":"),
            )
            signed_message = (
                request_id.encode()
                + b"\0"
                + request_digest
                + b"\0"
                + response_json.encode()
            )
            signature = subprocess.run(
                [
                    "openssl",
                    "pkeyutl",
                    "-sign",
                    "-rawin",
                    "-inkey",
                    signing_key,
                ],
                input=signed_message,
                check=True,
                capture_output=True,
            ).stdout
            with open(temporary, "x", encoding="utf-8") as response_file:
                os.chmod(temporary, 0o600)
                json.dump(
                    {
                        "response_json": response_json,
                        "signature": signature.hex(),
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
    environment["HIVE_PUBLICATION_VERIFY_KEY"] = verifying_key
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
