"""
Downloading and unpacking release assets: browsers, the fpgen model, GeoIP databases.
"""

import hashlib
import os
import tempfile
from io import BufferedWriter, BytesIO
from pathlib import Path
from typing import Any, Callable, Dict, Optional, Union
from zipfile import ZipFile

import requests
from rich.console import Console
from rich.progress import (
    BarColumn,
    DownloadColumn,
    Progress,
    SpinnerColumn,
    TaskProgressColumn,
    TextColumn,
    TimeRemainingColumn,
    TransferSpeedColumn,
)
from typing_extensions import TypeAlias
from yaml import CLoader, load

from .exceptions import CorruptedDownload

DownloadBuffer: TypeAlias = Union[BytesIO, tempfile._TemporaryFileWrapper, BufferedWriter]

LOCAL_DATA: Path = Path(__file__).parent

GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")
console = Console()


def rprint(msg: str, fg: Optional[str] = None, nl: bool = True) -> None:
    """
    Print a styled message
    """
    style = f"bold {fg}" if fg else "bold"
    console.print(msg, style=style, end="\n" if nl else "", highlight=False)


ProgressCallback: TypeAlias = 'Callable[[int, int], None]'


def webdl(
    url: str,
    desc: Optional[str] = None,
    buffer: Optional[DownloadBuffer] = None,
    bar: bool = True,
    progress_callback: Optional[ProgressCallback] = None,
) -> DownloadBuffer:
    """
    Download a file from the given URL
    """
    headers = (
        {"Authorization": f"Bearer {GITHUB_TOKEN}"} if "api.github" in url and GITHUB_TOKEN else {}
    )
    response = requests.get(url, stream=True, headers=headers)
    response.raise_for_status()

    total_size = int(response.headers.get('content-length', 0))
    block_size = 8192
    if buffer is None:
        buffer = BytesIO()

    if progress_callback:
        downloaded = 0
        last_update = 0
        for data in response.iter_content(block_size * 4):
            size = buffer.write(data)
            downloaded += size
            if downloaded - last_update >= 65536 or downloaded == total_size:
                progress_callback(downloaded, total_size)
                last_update = downloaded
    elif bar:
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            DownloadColumn(),
            TransferSpeedColumn(),
            TimeRemainingColumn(),
            console=console,
        ) as progress:
            task = progress.add_task(desc or "Downloading", total=total_size)
            for data in response.iter_content(block_size):
                size = buffer.write(data)
                progress.update(task, advance=size)
    else:
        downloaded = 0
        for data in response.iter_content(block_size):
            size = buffer.write(data)
            downloaded += size
            if total_size:
                pct = (downloaded / total_size) * 100
                print(f"\r{desc}: {pct:.0f}%", end="", flush=True)
        print(f"\r{desc}: Complete" if desc else "")

    buffer.seek(0)
    return buffer


def write_atomic(dest: Path, data: bytes, mtime: Optional[float] = None) -> None:
    """Write `dest` through a temporary file beside it, then replace it in one step.

    The temporary file is created in dest's own directory, so it takes that
    directory's permissions. A file staged in tempfile.mkdtemp() does not: since
    Python 3.13 that directory is private on Windows, and a file moved out of it
    keeps an owner-only ACL, so another account or elevation level cannot read it.
    """
    tmp = dest.with_name(f".{dest.name}.{os.getpid()}.tmp")
    try:
        tmp.write_bytes(data)
        if mtime is not None:
            os.utime(tmp, (mtime, mtime))
        os.replace(tmp, dest)
    finally:
        tmp.unlink(missing_ok=True)


def verify_sha256(buffer: DownloadBuffer, expected: Optional[str], desc: str = "asset") -> None:
    """
    Check a downloaded buffer against its expected sha256 digest.

    Raises CorruptedDownload on mismatch. Skips silently when no digest is
    known, so installs from sources that publish no digest still work.
    """
    if not expected:
        rprint(f"Warning: no sha256 published for {desc}; skipping verification.", fg="yellow")
        return

    buffer.seek(0)
    digest = hashlib.sha256()
    for block in iter(lambda: buffer.read(1024 * 1024), b""):
        digest.update(block)
    buffer.seek(0)

    actual = digest.hexdigest()
    if actual != expected.lower():
        raise CorruptedDownload(
            f"Checksum mismatch for {desc}.\n"
            f"  expected sha256: {expected.lower()}\n"
            f"  actual   sha256: {actual}\n"
            "The download was corrupted or tampered with. Installation aborted."
        )


def unzip(
    zip_file: DownloadBuffer,
    extract_path: str,
    desc: Optional[str] = None,
    bar: bool = True,
) -> None:
    """
    Extract a zip file to the given path
    """
    with ZipFile(zip_file) as zf:
        members = zf.infolist()
        if bar:
            with Progress(
                SpinnerColumn(),
                TextColumn("[progress.description]{task.description}"),
                BarColumn(),
                TaskProgressColumn(),
                console=console,
            ) as progress:
                task = progress.add_task(desc or "Extracting", total=len(members))
                for member in members:
                    zf.extract(member, extract_path)
                    progress.update(task, advance=1)
        else:
            for i, member in enumerate(members):
                zf.extract(member, extract_path)
                if desc:
                    pct = ((i + 1) / len(members)) * 100
                    print(f"\r{desc}: {pct:.0f}%", end="", flush=True)
            if desc:
                print(f"\r{desc}: Complete")


def flatten_single_root(extract_path: Union[str, Path]) -> None:
    """Move the contents of an archive's single top-level directory up.

    A release zip can hold one directory (camouwolf-<version>-<release>/); the
    launcher expects the binary and version.json directly in the install
    directory.
    """
    root = Path(extract_path)
    entries = list(root.iterdir())
    if len(entries) != 1 or not entries[0].is_dir() or entries[0].suffix == '.app':
        return
    inner = entries[0]
    for child in inner.iterdir():
        os.replace(child, root / child.name)
    inner.rmdir()


def load_yaml(path: Path) -> Dict[str, Any]:
    """
    Load a YAML file as a dictionary
    """
    with open(path, 'r') as f:
        return load(f, Loader=CLoader)
