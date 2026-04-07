#!/usr/bin/env bash
# Convict — first-run setup for Yoga 5 (Linux / WSL2)
# Run from the repo root: bash setup.sh
set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$REPO_ROOT/backend"
FRONTEND="$REPO_ROOT/frontend"

echo "=== Convict first-run setup ==="
echo "Repo: $REPO_ROOT"
echo ""

# ── Python ──────────────────────────────────────────────────────────────────
echo "[1/5] Creating Python venv..."
cd "$BACKEND"
python3 -m venv .venv
source .venv/bin/activate

echo "[2/5] Installing Python dependencies..."
pip install --upgrade pip -q
pip install -e ".[dev]"

# ── .env.local ───────────────────────────────────────────────────────────────
ENV_FILE="$BACKEND/.env.local"
if [ ! -f "$ENV_FILE" ]; then
    echo "[3/5] Creating .env.local..."
    cat > "$ENV_FILE" <<'ENV'
# Camera — find indices by running: python3 -c "import cv2; [print(i, cv2.VideoCapture(i).isOpened()) for i in range(5)]"
CAMERA_INDEX=0
CAMERA_INDEX_2=-1        # set to real index once confirmed; -1 = disabled

# Detector — rfdetr for accuracy, mog2 for speed (no model download)
DETECTOR_TYPE=mog2

# VLM — enable after: ollama pull gemma3:2b
VLM_ENABLED=false
VLM_MODEL=gemma3:2b
ENV
    echo "    Written: $ENV_FILE"
    echo "    !! Edit CAMERA_INDEX / CAMERA_INDEX_2 before starting !!"
else
    echo "[3/5] .env.local already exists — skipping."
fi

# ── Frontend ─────────────────────────────────────────────────────────────────
echo "[4/5] Installing frontend dependencies..."
cd "$FRONTEND"
npm install

# ── Ollama (optional) ────────────────────────────────────────────────────────
echo "[5/5] Ollama / Gemma setup (optional)..."
if command -v ollama &>/dev/null; then
    echo "    Ollama found — pulling gemma3:2b..."
    ollama pull gemma3:2b
    echo "    Done. Set VLM_ENABLED=true in .env.local to activate."
else
    echo "    Ollama not found. To enable VLM analysis:"
    echo "      1. Install: https://ollama.com/download"
    echo "      2. Run:     ollama pull gemma3:2b"
    echo "      3. Set:     VLM_ENABLED=true in backend/.env.local"
fi

# ── Camera enumeration helper ────────────────────────────────────────────────
echo ""
echo "=== Detecting cameras ==="
cd "$BACKEND"
source .venv/bin/activate
python3 - <<'PY'
import cv2
found = []
for i in range(6):
    cap = cv2.VideoCapture(i)
    if cap.isOpened():
        w = cap.get(cv2.CAP_PROP_FRAME_WIDTH)
        h = cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
        found.append((i, int(w), int(h)))
        cap.release()
if found:
    for idx, w, h in found:
        print(f"  Camera index {idx}: {w}x{h}")
    print(f"\n  Set CAMERA_INDEX and CAMERA_INDEX_2 in backend/.env.local accordingly.")
else:
    print("  No cameras found. Check USB connections.")
PY

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "=== Setup complete ==="
echo ""
echo "To start the backend:"
echo "  cd backend && source .venv/bin/activate"
echo "  uvicorn convict.api.app:app --host 0.0.0.0 --port 8000 --reload"
echo ""
echo "To start the frontend (separate terminal):"
echo "  cd frontend && npm run dev"
echo ""
echo "Open: http://localhost:3000"
