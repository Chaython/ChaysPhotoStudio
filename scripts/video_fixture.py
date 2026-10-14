"""Small reproducible VP8/WebM test fixture: red first second, blue next second.

No binary fixtures are checked into Git; ffmpeg is used only during CI tests.
The editor itself does not require ffmpeg for browser-native frame selection.
"""
from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path


def video_fixture() -> bytes:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg is required to generate the Chromium video test fixture")
    with tempfile.TemporaryDirectory(prefix="chays-video-fixture-") as temp_dir:
        path = Path(temp_dir) / "two-tone.webm"
        command = [
            ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", "color=c=red:s=80x60:r=8:d=1",
            "-f", "lavfi", "-i", "color=c=blue:s=80x60:r=8:d=1",
            "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[outv]",
            "-map", "[outv]", "-c:v", "libvpx", "-b:v", "180k",
            "-pix_fmt", "yuv420p", "-an", str(path),
        ]
        completed = subprocess.run(command, capture_output=True, timeout=30, check=False)
        if completed.returncode:
            raise RuntimeError(
                "Could not generate VP8 video test fixture: " +
                completed.stderr.decode("utf-8", errors="replace")[-2000:]
            )
        data = path.read_bytes()
        if not data.startswith(bytes.fromhex("1a45dfa3")) or len(data) < 256:
            raise AssertionError("ffmpeg produced an invalid WebM regression fixture")
        return data
