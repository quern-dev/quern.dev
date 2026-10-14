#!/usr/bin/env bash
set -euo pipefail

# Quern installer — https://quern.dev
# Usage: curl -fsSL https://quern.dev/install.sh | bash

INSTALL_DIR="$HOME/.local/share/quern"
GITHUB_REPO="quern-dev/quern"
# Where release metadata and assets come from. Overridden only by a release
# rehearsal, which serves a candidate locally so the first-install path can be
# tested before the release exists (quern#219). Unset in normal use.
RELEASES_API="${QUERN_RELEASES_URL:-https://api.github.com/repos/${GITHUB_REPO}}"
RELEASES_API="${RELEASES_API%/}"
MIN_PYTHON_VERSION="3.11"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
RESET='\033[0m'

step() { printf "\n${BLUE}${BOLD}==>${RESET}${BOLD} %s${RESET}\n" "$1"; }
ok()   { printf "  ${GREEN}✓${RESET} %s\n" "$1"; }
warn() { printf "  ${YELLOW}!${RESET} %s\n" "$1"; }
die()  { printf "\n${RED}${BOLD}Error:${RESET} %s\n" "$1"; exit 1; }

# Compare version strings: returns 0 if $1 >= $2
version_gte() {
    [ "$(printf '%s\n%s' "$2" "$1" | sort -t. -k1,1n -k2,2n -k3,3n | head -1)" = "$2" ]
}

# How to run quern from here: the bare name once setup has put it on PATH, the
# install's own wrapper before that. Telling someone to run `quern setup` when
# setup never got far enough to write the command is "command not found" --
# which is how a half-finished install presented in the field (quern.dev#3).
quern_cmd() {
    if command -v quern &>/dev/null; then
        printf 'quern'
    else
        printf '%s/quern' "$INSTALL_DIR"
    fi
}

# Whether setup finished: it builds the venv and writes the quern command, and
# an install without either is not installed, whatever pyproject.toml says.
setup_finished() {
    [ -x "$INSTALL_DIR/.venv/bin/python" ] && [ -e "$HOME/.local/bin/quern" ]
}

# Read version from pyproject.toml
read_installed_version() {
    if [ -f "$INSTALL_DIR/pyproject.toml" ]; then
        sed -n 's/^version = "\(.*\)"/\1/p' "$INSTALL_DIR/pyproject.toml"
    fi
}

# ---------------------------------------------------------------------------
# Phase 1: Prerequisite checks
# ---------------------------------------------------------------------------

step "Checking prerequisites"

# macOS
if [ "$(uname -s)" != "Darwin" ]; then
    die "Quern requires macOS. Detected: $(uname -s)"
fi
ok "macOS $(sw_vers -productVersion)"

# Python — probe specific versions, then fall back to python3
PYTHON_BIN=""
for candidate in python3.14 python3.13 python3.12 python3.11 python3; do
    if command -v "$candidate" &>/dev/null; then
        ver=$("$candidate" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")' 2>/dev/null || true)
        if [ -n "$ver" ] && version_gte "$ver" "$MIN_PYTHON_VERSION"; then
            PYTHON_BIN="$(command -v "$candidate")"
            break
        fi
    fi
done

if [ -z "$PYTHON_BIN" ]; then
    die "Python 3.11+ is required. Install via:
  brew install python@3.13
  or download from https://www.python.org/downloads/"
fi
ok "$($PYTHON_BIN --version)"

# Homebrew — warn only
if command -v brew &>/dev/null; then
    ok "Homebrew $(brew --version 2>/dev/null | head -1 | awk '{print $2}')"
else
    warn "Homebrew not found — some optional dependencies may need manual install"
    warn "Install: https://brew.sh"
fi

# ---------------------------------------------------------------------------
# Phase 2: Download release
# ---------------------------------------------------------------------------

step "Fetching latest release"

# Get latest release tag from GitHub API
RELEASE_JSON=$(curl -fsSL "${RELEASES_API}/releases/latest") || \
    die "Could not fetch release info from ${RELEASES_API}. Check your internet connection."

LATEST_VERSION=$(printf '%s' "$RELEASE_JSON" | sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p')
if [ -z "$LATEST_VERSION" ]; then
    die "Could not determine latest version from GitHub release."
fi

# Prefer the release's own asset over GitHub's generated source tarball. The
# asset bundles the signed, notarized menu-bar Quern.app alongside the same
# source tree; the generated tarball is source only, so installing from it
# leaves the menu bar app absent with nothing to say why. `quern update` has
# preferred the asset since it existed -- this brings a fresh install in line
# with an upgrade.
#
# Matched by exact name, not by prefix, for the same reason the updater does:
# a release carrying a second quern-*.tar.gz would otherwise be a coin toss
# between them, and the wrong one installs a version that disagrees with the
# tag it reports.
ASSET_URL=$(printf '%s' "$RELEASE_JSON" | "$PYTHON_BIN" -c '
import json, sys
wanted = "quern-" + sys.argv[1] + ".tar.gz"
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for asset in data.get("assets", []):
    if asset.get("name") == wanted and asset.get("browser_download_url"):
        print(asset["browser_download_url"])
        break
' "$LATEST_VERSION" || true)

# Check if already installed at this version
CURRENT_VERSION=$(read_installed_version)
REPAIRING=""
if [ -n "$CURRENT_VERSION" ] && [ "$CURRENT_VERSION" = "$LATEST_VERSION" ]; then
    # Same version is normally nothing to do. One case is not: an install that
    # reached this version by updating from before v0.15.0 has the source tree
    # and no menu-bar app. That version's updater fetched GitHub's generated
    # source tarball because it had no concept of release assets -- and the
    # code that prefers the asset shipped inside the asset, so it could not
    # help itself. `quern update` will not repair it either, since it is
    # already on the latest version and downloads nothing.
    #
    # Reinstalling over the top is the repair, and it costs one command rather
    # than waiting for the next release.
    #
    # The other is an install whose setup never finished: a version on disk is
    # not an install without its venv and command. This used to answer
    # "already installed" and exit, so re-running could not repair it and the
    # only way out was deleting the directory by hand (quern.dev#3).
    #
    # The app is looked for where setup leaves it, not only where the asset
    # delivers it: setup moves it to ~/Applications, so checking the install
    # directory alone called every same-version re-run "missing the menu-bar
    # app" and reinstalled -- setup's own check (quern's setup.py) looks in both
    # for the same reason. Found in a clean-VM test (quern.dev#3).
    if [ "$(uname -s)" = "Darwin" ] && [ ! -d "$INSTALL_DIR/Quern.app" ] \
            && [ ! -d "$HOME/Applications/Quern.app" ] && [ -n "$ASSET_URL" ]; then
        REPAIRING="1"
        ok "Quern v${LATEST_VERSION} is installed, but the menu-bar app is missing"
        step "Reinstalling to add it"
    elif ! setup_finished; then
        REPAIRING="1"
        warn "Quern v${LATEST_VERSION} is on disk, but its setup did not finish"
        step "Reinstalling to finish it"
    else
        ok "Quern v${LATEST_VERSION} is already installed"
        printf "\n  Run ${BOLD}%s setup${RESET} to re-check dependencies.\n\n" "$(quern_cmd)"
        exit 0
    fi
elif [ -n "$CURRENT_VERSION" ]; then
    ok "Upgrading v${CURRENT_VERSION} → v${LATEST_VERSION}"
else
    ok "Installing v${LATEST_VERSION}"
fi

step "Downloading Quern v${LATEST_VERSION}"

if [ -n "$ASSET_URL" ]; then
    TARBALL_URL="$ASSET_URL"
    BUNDLE_NOTE=" (with menu-bar app)"
else
    # Releases cut before the asset existed, and any release where the upload
    # did not happen. Source-only is a complete, working install.
    if [ -n "${QUERN_RELEASES_URL:-}" ]; then
        TARBALL_URL="${RELEASES_API}/archive/refs/tags/v${LATEST_VERSION}.tar.gz"
    else
        TARBALL_URL="https://github.com/${GITHUB_REPO}/archive/refs/tags/v${LATEST_VERSION}.tar.gz"
    fi
    BUNDLE_NOTE=""
fi

TMPDIR_DL=$(mktemp -d)
trap 'rm -rf "$TMPDIR_DL"' EXIT

curl -fsSL "$TARBALL_URL" -o "$TMPDIR_DL/quern.tar.gz" || \
    die "Failed to download release tarball."
ok "Downloaded${BUNDLE_NOTE}"

# Extract — GitHub tarballs extract to repo-name-version/
tar -xzf "$TMPDIR_DL/quern.tar.gz" -C "$TMPDIR_DL" || \
    die "Failed to extract tarball."
EXTRACTED_DIR=$(find "$TMPDIR_DL" -mindepth 1 -maxdepth 1 -type d | head -1)
if [ -z "$EXTRACTED_DIR" ]; then
    die "Tarball extracted but no directory found."
fi
ok "Extracted"

# Install to INSTALL_DIR
mkdir -p "$(dirname "$INSTALL_DIR")"

if [ -d "$INSTALL_DIR" ]; then
    # Preserve venv and local state across upgrades
    if [ -d "$INSTALL_DIR/.venv" ]; then
        mv "$INSTALL_DIR/.venv" "$TMPDIR_DL/.venv-preserve"
    fi
    rm -rf "$INSTALL_DIR"
fi

mv "$EXTRACTED_DIR" "$INSTALL_DIR"

# Restore preserved venv
if [ -d "$TMPDIR_DL/.venv-preserve" ]; then
    mv "$TMPDIR_DL/.venv-preserve" "$INSTALL_DIR/.venv"
    ok "Preserved existing virtual environment"
fi

ok "Installed to $INSTALL_DIR"

# ---------------------------------------------------------------------------
# Phase 3: Delegate to setup
# ---------------------------------------------------------------------------

step "Running setup"

cd "$INSTALL_DIR"
# Setup's exit code is checked rather than left to `set -e`, which would end the
# script without a word. And its success is not taken on trust: the venv is
# checked for before anything runs in it, because a setup that returned 0 with
# no venv is exactly how a first install failed in the field (quern#455).
if ! "$PYTHON_BIN" -m server setup; then
    # A setup that fails late has already built the venv and the command, so a
    # re-run would call this installed and never register the MCP server --
    # setup does not do that itself. Register it now, best effort, so the
    # remaining problem is the one setup reported.
    # Only from a venv that works: from a broken one it prints an unrelated
    # npm error right above "its output says why", pointing the reader at the
    # wrong thing.
    if "$INSTALL_DIR/.venv/bin/python" -I -c "import fastapi, httpx, uvicorn" 2>/dev/null; then
        "$INSTALL_DIR/.venv/bin/python" -m server mcp-install || true
    fi
    # The installer first: it repairs a half-built environment, which
    # `quern setup` -- running inside that environment -- cannot.
    die "Setup did not finish. Its output above says why. Once that is fixed,
run this installer again, or:
  $(quern_cmd) setup"
fi
# The same test a re-run uses to decide "installed", so this run can't accept a
# state the next one would call unfinished (CodeRabbit, #4): the venv *and* the
# command, not the venv alone.
if ! setup_finished; then
    missing=""
    [ -x "$INSTALL_DIR/.venv/bin/python" ] || missing="Quern's Python environment ($INSTALL_DIR/.venv)"
    [ -e "$HOME/.local/bin/quern" ] || missing="${missing:+$missing and }the quern command ($HOME/.local/bin/quern)"
    die "Setup exited without creating ${missing}.
Run this installer again, or:
  $(quern_cmd) setup"
fi

step "Registering MCP server"

"$INSTALL_DIR/.venv/bin/python" -m server mcp-install

# ---------------------------------------------------------------------------
# Phase 4: Done
# ---------------------------------------------------------------------------

printf "\n"
printf "${GREEN}${BOLD}  Quern v${LATEST_VERSION} is installed!${RESET}\n"
printf "\n"

if command -v quern &>/dev/null; then
    printf "  Start the server:  ${BOLD}quern start${RESET}\n"
else
    printf "  Add ~/.local/bin to your PATH, then restart your shell:\n"
    printf "    ${BOLD}source ~/.zshrc${RESET}\n"
    printf "\n"
    printf "  Start the server:  ${BOLD}quern start${RESET}\n"
fi

printf "  Open the API docs:  ${BOLD}http://localhost:9100/docs${RESET}\n"
printf "\n"
