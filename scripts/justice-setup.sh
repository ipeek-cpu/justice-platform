#!/bin/bash
# justice-setup.sh — Idempotent Mac Mini setup for the Justice platform
# Usage: bash scripts/justice-setup.sh [--dry-run] [--user <username>]

set -euo pipefail

# ─── Args ──────────────────────────────────────────────────────────────────────

DRY_RUN=false
USERNAME="justicewolf"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --user)    USERNAME="$2"; shift 2 ;;
    *)         echo "Unknown option: $1"; exit 1 ;;
  esac
done

HOME_DIR="/Users/$USERNAME"

# ─── Colors ────────────────────────────────────────────────────────────────────

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ok()   { echo -e "${GREEN}[OK]${NC} $1"; }
skip() { echo -e "${YELLOW}[SKIP]${NC} $1 — already installed"; }
info() { echo -e "${BLUE}[INFO]${NC} $1"; }
err()  { echo -e "${RED}[ERR]${NC} $1"; }
dry()  { echo -e "${YELLOW}[DRY-RUN]${NC} Would: $1"; }

run_or_dry() {
  if $DRY_RUN; then
    dry "$1"
  else
    eval "$2"
    ok "$1"
  fi
}

# ─── Header ────────────────────────────────────────────────────────────────────

echo ""
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Justice Platform — Mac Mini Setup${NC}"
echo -e "${BLUE}  User: $USERNAME   Home: $HOME_DIR${NC}"
$DRY_RUN && echo -e "${YELLOW}  DRY RUN — no changes will be made${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo ""

# ─── 1. Homebrew ───────────────────────────────────────────────────────────────

info "Checking Homebrew..."
if command -v brew &>/dev/null; then
  skip "Homebrew ($(brew --version | head -1))"
else
  run_or_dry "Install Homebrew" \
    'NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
fi

# ─── 2. Node 20+ ──────────────────────────────────────────────────────────────

info "Checking Node..."
if command -v node &>/dev/null; then
  NODE_VER=$(node --version | sed 's/v//' | cut -d. -f1)
  if [[ "$NODE_VER" -ge 20 ]]; then
    skip "Node $(node --version)"
  else
    run_or_dry "Upgrade Node to 20+" 'brew install node'
  fi
else
  run_or_dry "Install Node" 'brew install node'
fi

# ─── 3. Redis ──────────────────────────────────────────────────────────────────

info "Checking Redis..."
if command -v redis-server &>/dev/null; then
  skip "Redis"
else
  run_or_dry "Install Redis" 'brew install redis'
fi

if ! $DRY_RUN; then
  if brew services list 2>/dev/null | grep -q "redis.*started"; then
    skip "Redis service (already running)"
  else
    run_or_dry "Start Redis service" 'brew services start redis'
  fi
else
  dry "Start Redis as brew service"
fi

# ─── 4. GitHub CLI ─────────────────────────────────────────────────────────────

info "Checking GitHub CLI..."
if command -v gh &>/dev/null; then
  skip "GitHub CLI ($(gh --version | head -1))"
else
  run_or_dry "Install GitHub CLI" 'brew install gh'
fi

# ─── 5. Tailscale ─────────────────────────────────────────────────────────────

info "Checking Tailscale..."
if [ -d "/Applications/Tailscale.app" ] || command -v tailscale &>/dev/null; then
  skip "Tailscale"
else
  run_or_dry "Install Tailscale" 'brew install --cask tailscale'
fi

# ─── 6. Doppler CLI ───────────────────────────────────────────────────────────

info "Checking Doppler..."
if command -v doppler &>/dev/null; then
  skip "Doppler CLI ($(doppler --version 2>/dev/null || echo 'installed'))"
else
  run_or_dry "Install Doppler CLI" \
    'brew install gnupg && brew install dopplerhq/cli/doppler'
fi

# ─── 7. pnpm ──────────────────────────────────────────────────────────────────

info "Checking pnpm..."
if command -v pnpm &>/dev/null; then
  skip "pnpm ($(pnpm --version))"
else
  run_or_dry "Install pnpm" 'npm install -g pnpm'
fi

# ─── 8. Beads (bd) ────────────────────────────────────────────────────────────

info "Checking beads (bd)..."
if [ -f "$HOME_DIR/.local/bin/bd" ]; then
  skip "beads (bd)"
else
  if $DRY_RUN; then
    dry "Install beads CLI to ~/.local/bin/bd"
  else
    err "beads (bd) not found at ~/.local/bin/bd — install manually"
    info "See beads installation docs or copy bd binary from existing machine"
  fi
fi

# ─── 9. Cloudflared ───────────────────────────────────────────────────────────

info "Checking cloudflared..."
if command -v cloudflared &>/dev/null; then
  skip "cloudflared"
else
  run_or_dry "Install cloudflared" 'brew install cloudflared'
fi

# ─── 10. Directory structure ──────────────────────────────────────────────────

info "Setting up directory structure..."
for dir in "$HOME_DIR/Developer/ios" "$HOME_DIR/Developer/ios/.worktrees"; do
  if [ -d "$dir" ]; then
    skip "Directory $dir"
  else
    run_or_dry "Create $dir" "mkdir -p '$dir'"
  fi
done

# ─── 11. Clone repo ───────────────────────────────────────────────────────────

REPO_DIR="$HOME_DIR/Developer/justice-repo"

info "Checking justice-platform repo..."
if [ -d "$REPO_DIR/.git" ]; then
  skip "Repo at $REPO_DIR"
else
  run_or_dry "Clone justice-platform" \
    "gh repo clone ipeek-cpu/justice-platform '$REPO_DIR'"
fi

# ─── 12. pnpm install ─────────────────────────────────────────────────────────

info "Installing dependencies..."
if $DRY_RUN; then
  dry "Run pnpm install in $REPO_DIR"
else
  cd "$REPO_DIR"
  pnpm install
  ok "Dependencies installed"
fi

# ─── 13. Doppler setup ────────────────────────────────────────────────────────

info "Configuring Doppler..."
if $DRY_RUN; then
  dry "Run doppler setup --project justice --config production in $REPO_DIR/apps/justice-agent"
else
  if [ -f "$REPO_DIR/apps/justice-agent/.doppler.yaml" ]; then
    skip "Doppler config (already configured)"
  else
    info "Running interactive Doppler setup..."
    cd "$REPO_DIR/apps/justice-agent"
    doppler setup --project justice --config production
    ok "Doppler configured"
  fi
fi

# ─── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Setup complete!${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo ""

echo -e "${BLUE}Verification commands:${NC}"
echo "  node --version          # Should be >= 20"
echo "  redis-cli ping          # Should return PONG"
echo "  gh auth status          # Should show logged in"
echo "  doppler run -- env | grep JUSTICE_REGISTERED_PROJECTS"
echo "  pnpm --version"
echo "  cloudflared --version"
echo ""

echo -e "${YELLOW}Manual steps required:${NC}"
echo "  1. Install Xcode from the App Store"
echo "  2. sudo xcode-select --switch /Applications/Xcode.app"
echo "  3. xcodebuild -license accept"
echo "  4. Sign into Apple ID in Xcode → Settings → Accounts"
echo "  5. Tailscale enrollment: open Tailscale.app and sign in"
echo "  6. Grant Full Disk Access to Terminal:"
echo "     System Settings → Privacy & Security → Full Disk Access → add Terminal"
echo "  7. gh auth login (if not already authenticated)"
echo "  8. doppler login (if not already authenticated)"
echo "  9. Set up LaunchAgent for iMessage listener:"
echo "     cp scripts/com.justice.imessage-listener.plist ~/Library/LaunchAgents/"
echo "     launchctl load ~/Library/LaunchAgents/com.justice.imessage-listener.plist"
echo " 10. Start Justice:"
echo "     cd $REPO_DIR/apps/justice-agent && doppler run -- pnpm dev"
echo ""
