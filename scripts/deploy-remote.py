#!/usr/bin/env python3
import os
import pathlib
import posixpath
import sys
import tarfile
import tempfile

import paramiko

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


PROJECT_ROOT = pathlib.Path(__file__).resolve().parent.parent
EXCLUDED_PARTS = {
    ".git",
    ".runtime",
    ".runtime-smoke",
    ".runtime-visual",
    "node_modules",
    "dist",
    "test-results",
}


def include(path: pathlib.Path) -> bool:
    relative = path.relative_to(PROJECT_ROOT)
    return not any(part in EXCLUDED_PARTS or part.startswith(".runtime-") for part in relative.parts)


def build_archive(destination: pathlib.Path) -> None:
    with tarfile.open(destination, "w:gz") as archive:
        for path in PROJECT_ROOT.rglob("*"):
            if include(path):
                archive.add(path, arcname=path.relative_to(PROJECT_ROOT), recursive=False)


def main() -> int:
    host = os.environ.get("MYDST_SSH_HOST", "45.125.47.27")
    port = int(os.environ.get("MYDST_SSH_PORT", "8006"))
    user = os.environ.get("MYDST_SSH_USER", "root")
    password = os.environ.get("MYDST_SSH_PASSWORD")
    mode = os.environ.get("MYDST_REMOTE_MODE", "install")
    if mode not in {"install", "update"}:
        print("MYDST_REMOTE_MODE must be install or update", file=sys.stderr)
        return 2
    if not password:
        print("MYDST_SSH_PASSWORD is required", file=sys.stderr)
        return 2

    remote_archive = "/tmp/mydst-server.tar.gz"
    remote_dir = "/tmp/mydst-server"
    with tempfile.TemporaryDirectory() as temp:
        archive_path = pathlib.Path(temp) / "mydst-server.tar.gz"
        build_archive(archive_path)
        print(f"Uploading {archive_path.stat().st_size / 1024:.1f} KiB to {host}:{remote_archive}")

        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(host, port=port, username=user, password=password, timeout=20, banner_timeout=20)
        try:
            with client.open_sftp() as sftp:
                sftp.put(str(archive_path), remote_archive)

            installer = "update.sh" if mode == "update" else "install.sh"
            command = (
                f"rm -rf {remote_dir} && mkdir -p {remote_dir} && "
                f"tar -xzf {remote_archive} -C {remote_dir} && "
                f"cd {remote_dir} && chmod +x deployment/*.sh && ./deployment/{installer}"
            )
            _, stdout, stderr = client.exec_command(command, get_pty=True)
            channel = stdout.channel
            while True:
                if channel.recv_ready():
                    sys.stdout.write(channel.recv(8192).decode("utf-8", "replace"))
                    sys.stdout.flush()
                if channel.recv_stderr_ready():
                    sys.stderr.write(channel.recv_stderr(8192).decode("utf-8", "replace"))
                    sys.stderr.flush()
                if channel.exit_status_ready() and not channel.recv_ready() and not channel.recv_stderr_ready():
                    break
            status = channel.recv_exit_status()
            if status != 0:
                print(f"Remote installer failed with exit code {status}", file=sys.stderr)
                return status
        finally:
            client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
