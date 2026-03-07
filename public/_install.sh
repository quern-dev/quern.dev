#!/usr/bin/env bash
set -euo pipefail

# Quern installer — https://quern.dev
# Usage: curl -fsSL https://quern.dev/install.sh | bash

INSTALL_DIR="$HOME/.local/share/quern"
REPO_URL="https://github.com/quern-dev/quern.git"
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
    printf '%s\n%s' "$1" "$2" | sort -t. -k1,1n -k2,2n -k3,3n -C
    # sort -C exits 0 if already sorted (i.e. $2 <= $1 when $2 is first)
    # We need $1 >= $2, so put $2 first
    [ "$(printf '%s\n%s' "$2" "$1" | sort -t. -k1,1n -k2,2n -k3,3n | head -1)" = "$2" ]
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

# Git
if ! command -v git &>/dev/null; then
    die "Git is required. Install Xcode CLI tools: xcode-select --install"
fi
ok "git $(git --version | awk '{print $3}')"

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
# Phase 2: Clone or update
# ---------------------------------------------------------------------------

step "Installing Quern"

if [ -d "$INSTALL_DIR/.git" ]; then
    ok "Existing installation found at $INSTALL_DIR"
    cd "$INSTALL_DIR"
    if git pull --ff-only &>/dev/null; then
        ok "Updated to latest version"
    else
        warn "Could not fast-forward (local changes?). Continuing with current version."
        warn "To update manually: cd $INSTALL_DIR && git pull"
    fi
else
    mkdir -p "$(dirname "$INSTALL_DIR")"
    printf "  Cloning into %s...\n" "$INSTALL_DIR"
    git clone "$REPO_URL" "$INSTALL_DIR"
    ok "Cloned successfully"
fi

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
printf "${GREEN}${BOLD}  Quern is installed!${RESET}\n"
printf "\n"

if command -v quern &>/dev/null; then
    printf "  Start the server:  ${BOLD}quern start${RESET}\n"
else
    printf "  Add ~/.local/bin to your PATH, then restart your shell:\n"
    printf "    ${BOLD}source ~/.zshrc${RESET}\n"
    printf "\n"
    printf "  Start the server:  ${BOLD}quern start${RESET}\n"
fi

printf "  Open the API docs:  ${BOLD}http://localhost:9100${RESET}\n"
printf "\n"
