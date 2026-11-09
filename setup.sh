#!/usr/bin/env bash
# One-step setup for macOS and Linux. Run with: bash setup.sh
set -e
cd "$(dirname "$0")"

echo
echo "=== Digital Forensics Portal setup ==="
echo

echo "[1/3] Checking for Node.js..."
if ! command -v node >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    echo "      Node.js is not installed. Installing it with Homebrew..."
    brew install node
  else
    echo "      Node.js is not installed."
    echo "      Install the LTS version from https://nodejs.org and run this script again."
    exit 1
  fi
fi

if ! node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"; then
  echo "      Node.js $(node -v) is too old. Version 22.13 or newer is required."
  echo "      Install the current LTS version from https://nodejs.org and run this script again."
  exit 1
fi
echo "      Found Node.js $(node -v)"

echo
echo "[2/3] Installing project packages. This can take a minute..."
npm install --no-fund --no-audit

echo
echo "[3/3] Creating settings file..."
if [ -f .env ]; then
  echo "      .env already exists, leaving it unchanged."
else
  cp .env.example .env
  echo "      Created .env with default settings."
fi

echo
echo "=== Setup complete ==="
echo
echo "To start the portal, run:   npm start"
echo "Then open in your browser:  http://localhost:3000"
echo "Sign in as admin with password Forensics@123"
echo
