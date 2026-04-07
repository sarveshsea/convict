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

# ── Torch CPU-only (must happen before pip install -e . so transitive deps
#    don't pull in the 2GB CUDA wheel) ───────────────────────────────────────
echo "[2/5] Installing dependencies..."
if [[ "$(uname -s)" == "Linux" ]]; then
    if command -v nvidia-smi &>/dev/null && nvidia-smi &>/dev/null 2>&1; then
        echo "    NVIDIA GPU found — torch will use CUDA"
    else
        echo "    Intel/AMD CPU detected — installing CPU-only torch (~250MB vs 2GB)"
        pip install torch torchvision \
            --index-url https://download.pytorch.org/whl/cpu \
            --quiet
    fi
fi

pip install --upgrade pip -q
pip install -e ".[dev]" -q

# rfdetr forces opencv-python (full GUI); replace with headless for server use
pip install --force-reinstall opencv-python-headless>=4.10.0 -q 2>/dev/null || true
pip uninstall -y opencv-python 2>/dev/null || true

# ── .env.local ───────────────────────────────────────────────────────────────
ENV_FILE="$BACKEND/.env.local"
if [ ! -f "$ENV_FILE" ]; then
    echo "[3/5] Creating .env.local..."
    cat > "$ENV_FILE" <<'ENV'
# Camera — run setup.sh to auto-detect indices, or set manually
# (0 = first USB camera, 1 = second, etc.)
CAMERA_INDEX=0
CAMERA_INDEX_2=-1        # set to real index once confirmed; -1 = disabled

# Detector: mog2 (fast, no download) | yolo_onnx (accurate, ~6MB) | rfdetr (best, ~120MB)
DETECTOR_TYPE=mog2

# VLM — filled in automatically if Ollama is set up (see below)
VLM_ENABLED=false
VLM_MODEL=gemma3:2b
ENV
    echo "    Written: $ENV_FILE"
else
    echo "[3/5] .env.local already exists — skipping"
fi

# ── Frontend ─────────────────────────────────────────────────────────────────
echo "[4/5] Installing frontend dependencies..."
cd "$FRONTEND"
npm install -q

# ── Ollama + VLM ─────────────────────────────────────────────────────────────
echo "[5/5] Ollama / Gemma setup..."
if ! command -v ollama &>/dev/null; then
    echo "    Ollama not installed. To enable VLM scene analysis:"
    echo "      1. Install: https://ollama.com/download"
    echo "      2. Run:     ollama pull gemma3:2b"
    echo "      3. Set in $ENV_FILE:  VLM_ENABLED=true"
else
    # Start Ollama server if not already running (Linux needs this; macOS app handles it)
    if ! ollama list &>/dev/null; then
        ollama serve &>/dev/null & OLLAMA_PID=$!
        sleep 3
    fi

    PULLED_MODEL=""
    for MODEL in "gemma3:2b" "gemma2:2b" "gemma:2b"; do
        echo "    Trying: ollama pull $MODEL ..."
        if ollama pull "$MODEL"; then
            PULLED_MODEL="$MODEL"
            break
        fi
        echo "    → $MODEL not available, trying next..."
    done

    kill "${OLLAMA_PID:-0}" 2>/dev/null || true

    if [ -n "$PULLED_MODEL" ]; then
        echo "    Pulled: $PULLED_MODEL — enabling VLM in .env.local"
        # Update or add VLM settings in .env.local
        if grep -q "^VLM_ENABLED=" "$ENV_FILE"; then
            sed -i.bak "s/^VLM_ENABLED=.*/VLM_ENABLED=true/" "$ENV_FILE"
            sed -i.bak "s/^VLM_MODEL=.*/VLM_MODEL=$PULLED_MODEL/" "$ENV_FILE"
            rm -f "$ENV_FILE.bak"
        else
            printf "\nVLM_ENABLED=true\nVLM_MODEL=%s\n" "$PULLED_MODEL" >> "$ENV_FILE"
        fi
        echo "    VLM enabled (model=$PULLED_MODEL)"
    else
        echo "    Could not pull a Gemma model — VLM disabled for now."
        echo "    Run manually: ollama pull gemma3:2b"
        echo "    Then set VLM_ENABLED=true in $ENV_FILE"
    fi
fi

# ── Camera enumeration ────────────────────────────────────────────────────────
echo ""
echo "=== Detecting cameras ==="
cd "$BACKEND"
source .venv/bin/activate
python3 - <<'PY' 2>/dev/null
import cv2, os, sys

# Suppress OpenCV's noisy stderr on macOS/Linux
_devnull = os.open(os.devnull, os.O_WRONLY)
_saved   = os.dup(2)
os.dup2(_devnull, 2)

found = []
for i in range(8):
    cap = cv2.VideoCapture(i)
    if cap.isOpened():
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        found.append((i, w, h))
        cap.release()

os.dup2(_saved, 2)
os.close(_devnull)
os.close(_saved)

if found:
    print(f"  Found {len(found)} camera(s):")
    for idx, w, h in found:
        print(f"    Index {idx}: {w}×{h}")
    print()
    if len(found) >= 1:
        print(f"  → Set CAMERA_INDEX={found[0][0]} in backend/.env.local")
    if len(found) >= 2:
        print(f"  → Set CAMERA_INDEX_2={found[1][0]} for second tank camera")
    if len(found) >= 3:
        print(f"  Note: {len(found)} cameras found — indices above include built-in webcam.")
        print(f"        Check which index is which by testing each.")
else:
    print("  No cameras found. Check USB connections and permissions.")
    print("  On Linux you may need: sudo usermod -aG video $USER  (then log out/in)")
PY

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "=== Setup complete ==="
echo ""
echo "Edit camera indices in backend/.env.local, then:"
echo ""
echo "  Terminal 1 — backend:"
echo "    cd backend && source .venv/bin/activate"
echo "    uvicorn convict.api.app:app --host 0.0.0.0 --port 8000 --reload"
echo ""
echo "  Terminal 2 — frontend:"
echo "    cd frontend && npm run dev"
echo ""
echo "  Open: http://localhost:3000"
