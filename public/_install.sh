#!/usr/bin/env bash
set -euo pipefail

# Quern installer — https://quern.dev
# Usage: curl -fsSL https://quern.dev/install.sh | bash

INSTALL_DIR="$HOME/.local/share/quern"
GITHUB_REPO="quern-dev/quern"
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
for candidate in python3.13 python3.12 python3.11 python3; do
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
  brew install python@3.12
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
RELEASE_JSON=$(curl -fsSL "https://api.github.com/repos/${GITHUB_REPO}/releases/latest") || \
    die "Could not fetch release info from GitHub. Check your internet connection."

LATEST_VERSION=$(printf '%s' "$RELEASE_JSON" | sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p')
if [ -z "$LATEST_VERSION" ]; then
    die "Could not determine latest version from GitHub release."
fi

# Check if already installed at this version
CURRENT_VERSION=$(read_installed_version)
if [ -n "$CURRENT_VERSION" ] && [ "$CURRENT_VERSION" = "$LATEST_VERSION" ]; then
    ok "Quern v${LATEST_VERSION} is already installed"
    printf "\n  Run ${BOLD}quern setup${RESET} to re-check dependencies.\n\n"
    exit 0
fi

if [ -n "$CURRENT_VERSION" ]; then
    ok "Upgrading v${CURRENT_VERSION} → v${LATEST_VERSION}"
else
    ok "Installing v${LATEST_VERSION}"
fi

step "Downloading Quern v${LATEST_VERSION}"

TARBALL_URL="https://github.com/${GITHUB_REPO}/archive/refs/tags/v${LATEST_VERSION}.tar.gz"
TMPDIR_DL=$(mktemp -d)
trap 'rm -rf "$TMPDIR_DL"' EXIT

curl -fsSL "$TARBALL_URL" -o "$TMPDIR_DL/quern.tar.gz" || \
    die "Failed to download release tarball."
ok "Downloaded"

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
"$PYTHON_BIN" -m server setup

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
