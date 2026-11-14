#!/usr/bin/env python3
"""Publish tested webOS builds and a Homebrew Channel catalog using the job token.

Existing IPKs are immutable. Retry repairs missing metadata/index publication
using the already-published bytes, rather than silently replacing an app version.
"""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import tempfile


def app_metadata(ipk):
    raw = ipk.read_bytes()
    if not raw.startswith(b"!<arch>\n"):
        raise ValueError("Expected an IPK ar archive")
    offset = 8
    while offset + 60 <= len(raw):
        header = raw[offset:offset + 60]
        name = header[:16].decode().strip().rstrip("/")
        size = int(header[48:58])
        offset += 60
        payload = raw[offset:offset + size]
        offset += size + size % 2
        if name.startswith("data.tar"):
            with tarfile.open(fileobj=io.BytesIO(payload), mode="r:*") as archive:
                candidates = [entry for entry in archive if entry.name.endswith("/appinfo.json") and entry.isfile()]
                if len(candidates) != 1:
                    raise ValueError("Expected one app manifest")
                return json.load(archive.extractfile(candidates[0]))
    raise ValueError("IPK payload is missing")


def catalog(ipk, repository):
    info = app_metadata(ipk)
    if info["id"] != "com.themaxynator.resonatv" or not re.fullmatch(r"\d+\.\d+\.\d+", info["version"]):
        raise ValueError("Unexpected package identity or version")
    release = f'https://github.com/{repository}/releases/download/webos-v{info["version"]}'
    manifest = {
        "id": info["id"], "version": info["version"], "type": "web", "title": "Resona TV",
        "appDescription": "Album artwork, a faded cover background and direct music playback. Early test build for rooted webOS 23 TVs.",
        "iconUri": release + "/icon.png", "sourceUrl": f"https://github.com/{repository}",
        "rootRequired": True, "ipkUrl": release + "/" + ipk.name,
        "ipkHash": {"sha256": hashlib.sha256(ipk.read_bytes()).hexdigest()}, "ipkSize": ipk.stat().st_size,
    }
    index = {
        "name": "Resona TV", "description": "Resona TV test releases for rooted LG TVs",
        "paging": {"page": 1, "count": 1, "maxPage": 1, "itemsTotal": 1, "prevUrl": None, "nextUrl": None},
        "packages": [{"id": info["id"], "title": "Resona TV", "iconUri": manifest["iconUri"],
                      "manifestUrl": release + "/manifest.json", "manifest": manifest,
                      "shortDescription": "Music with a square cover and a faded full-screen background.", "pool": "main"}],
    }
    return manifest, index


def gh(*arguments, check=True):
    result = subprocess.run(["gh", *arguments], capture_output=True, text=True)
    if check and result.returncode:
        raise RuntimeError(result.stderr.strip() or "GitHub operation failed")
    return result


def main():
    root = Path(__file__).resolve().parents[1]
    repository = os.environ["GITHUB_REPOSITORY"]
    if not re.fullmatch(r"[\w.-]+/[\w.-]+", repository):
        raise ValueError("Invalid repository")
    info = json.loads((root / "app/appinfo.json").read_text())
    version = info["version"]
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError("Invalid version")
    tag = "webos-v" + version
    name = info["id"] + "_" + version + "_all.ipk"
    built = root / "dist" / name
    if not built.is_file():
        raise ValueError("Tested package was not downloaded")
    with tempfile.TemporaryDirectory(prefix="resona-publish-") as temporary:
        output = Path(temporary)
        existing = gh("release", "view", tag, "--repo", repository, "--json", "assets", check=False)
        already_exists = existing.returncode == 0
        ipk = built
        if already_exists:
            assets = json.loads(existing.stdout)["assets"]
            if not any(asset["name"] == name for asset in assets):
                raise RuntimeError("An incomplete release exists without its IPK. Repair it explicitly before publishing an index.")
            gh("release", "download", tag, "--repo", repository, "--pattern", name, "--dir", str(output))
            ipk = output / name
        elif "release not found" not in existing.stderr.lower():
            raise RuntimeError(existing.stderr.strip() or "Unable to inspect release")
        manifest, index = catalog(ipk, repository)
        if manifest["version"] != version:
            raise ValueError("Package and source versions differ")
        (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        (output / "repo.json").write_text(json.dumps(index, indent=2) + "\n")
        metadata = [str(output / "manifest.json"), str(output / "repo.json"), str(root / "app/icon.png"), str(root / "app/large-icon.png")]
        if already_exists:
            gh("release", "upload", tag, *metadata, "--repo", repository, "--clobber")
        else:
            notes = output / "release-notes.md"
            notes.write_text(f"Resona TV {version}: Studio, chapters and session tools.\n\n"
                             "Gallery is the default for new installations; existing preferences are retained. Studio adds a wide precomputed waveform, chapter markers and the current chapter. "
                             "Open Session from the toolbar or press Up from the idle screen for chapters, bookmarks, the current/upcoming queue, presets and a sleep timer. Back closes it; it hides after 30 seconds without interaction.\n\n"
                             "The companion iPhone 2.2.0 (build 23) forwards labelled timestamps from SoundCloud descriptions and adds Session & DJ sets in LG TV Connect. "
                             "Only valid labelled timestamps are converted; at least two are required. Manual imports can provide chapterText. No tracklist is guessed. "
                             "Queue chapter metadata is bounded, with extra space reserved for the selected track.\n\n"
                             "Bookmarks and listening positions survive receiver restarts and follow the original SoundCloud track ID across queue transfers. "
                             "Resume is explicit and seeks the currently loaded stream; it never stores an expiring URL or restores a queue automatically. "
                             "History is capped at 100 tracks and 20 bookmarks per track, with checkpoints every 15 seconds and on pause/track changes. Repeated paused reports do not rewrite storage.\n\n"
                             "The sleep timer pauses audio after 15/30/60/90 minutes or at the end of the current track. It does not turn off the television. "
                             "End-of-track sleep suppresses automatic queue advancement and cancels on a manual track change. "
                             "Gallery/DJ-set/Night presets retain the other layouts' progress choices. The optional Up next card appears near the end and stays hidden when end-of-track sleep is active.\n\n"
                             "The waveform is still a cached bitmap, with no FFT, second decoder or continuous JavaScript rendering loop. "
                             "The web remote now polls compact artwork metadata. Receiver tests, actual Node 12 compatibility and real-MP3 browser regressions gate publication; "
                             "Gallery/Studio/Session frame samples are CI measurements, not physical G3 FPS claims. "
                             "The native IPA and hardware testing are verified separately. Update using the existing Homebrew repository and reopen Resona TV.\n")
            gh("release", "create", tag, str(ipk), *metadata, "--repo", repository,
               "--target", os.environ["GITHUB_SHA"], "--title", "Resona TV (webOS) " + version,
               "--notes-file", str(notes), "--prerelease")
        current = gh("api", f"repos/{repository}/contents/repo.json", check=False)
        payload = {"message": "chore: update Homebrew repository to webOS " + version,
                   "content": base64.b64encode((output / "repo.json").read_bytes()).decode(), "branch": "main"}
        if current.returncode == 0:
            previous = json.loads(current.stdout)
            if base64.b64decode(previous["content"]) == (output / "repo.json").read_bytes():
                print("Homebrew index already matches the published release.")
                return
            payload["sha"] = previous["sha"]
        elif "404" not in current.stderr:
            raise RuntimeError(current.stderr.strip() or "Unable to inspect repository index")
        request = output / "index-write.json"
        request.write_text(json.dumps(payload))
        result = gh("api", "--method", "PUT", f"repos/{repository}/contents/repo.json", "--input", str(request), "--jq", ".commit.sha")
        print("Published tested Homebrew index:", result.stdout.strip())
        print("Repository URL: https://raw.githubusercontent.com/" + repository + "/main/repo.json")


if __name__ == "__main__":
    main()
