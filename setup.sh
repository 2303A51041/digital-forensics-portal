#!/usr/bin/env bash
# One-step setup for macOS and Linux. Run with: bash setup.sh
set -e
cd "$(dirname "$0")"

echo
echo "=== Digital Forensics Portal setup (React + Express + MongoDB) ==="
echo

echo "[1/5] Checking for Node.js..."
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

if ! node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>=18?0:1)"; then
  echo "      Node.js $(node -v) is too old. Version 18 or newer is required (20 or 22 LTS recommended)."
  echo "      Install the current LTS version from https://nodejs.org and run this script again."
  exit 1
fi
echo "      Found Node.js $(node -v)"

echo
echo "[2/5] Checking for MongoDB..."
if command -v mongod >/dev/null 2>&1 || command -v mongosh >/dev/null 2>&1; then
  echo "      Found MongoDB tools. Make sure the MongoDB server is running."
else
  echo "      MongoDB was not found. Install MongoDB Community Server"
  echo "      (https://www.mongodb.com/try/download/community) or set MONGODB_URI in .env"
  echo "      to a MongoDB Atlas connection string. Setup will continue."
fi

echo
echo "[3/5] Installing project packages. This can take a minute..."
npm install --no-fund --no-audit

echo
echo "[4/5] Creating settings file..."
if [ -f .env ]; then
  echo "      .env already exists, leaving it unchanged."
else
  cp .env.example .env
  echo "      Created .env with default settings."
fi

echo
echo "[5/5] Building the React app and loading sample data..."
npm run build
if ! npm run seed:if-empty --silent; then
  echo "      Could not reach MongoDB, so no sample data was loaded yet."
  echo "      Start MongoDB or set MONGODB_URI in .env. The sample data is also created"
  echo "      automatically the first time the app starts with an empty database."
fi

echo
echo "=== Setup complete ==="
echo
echo "Development:  npm run dev   ->  frontend http://localhost:5173, API http://localhost:5000"
echo "Production:   npm start     ->  http://localhost:5000"
echo "Sign in as admin with password Forensics@123"
echo
