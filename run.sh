#!/usr/bin/env bash
# Trakerz - one-click local launcher (macOS/Linux)
set -e
cd "$(dirname "$0")"

if ! command -v python3 >/dev/null 2>&1; then
    echo "ERROR: python3 was not found on your PATH. Install Python 3.9+ and try again."
    exit 1
fi

if [ ! -d ".venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv .venv
fi

source .venv/bin/activate

echo "Installing/checking dependencies..."
python -m pip install -q --upgrade pip
if ! python -m pip install -q -r backend/requirements.txt; then
    echo "ERROR: dependency install failed (see output above). Check your internet connection."
    exit 1
fi

echo ""
echo "Starting Trakerz server..."
cd backend
python3 -m uvicorn main:app --host 127.0.0.1 --port 8000 &
SERVER_PID=$!
cd ..

READY=""
for i in $(seq 1 25); do
    if curl -s -o /dev/null http://127.0.0.1:8000/api/dashboard 2>/dev/null; then
        READY=1
        break
    fi
    sleep 1
done

if [ -n "$READY" ]; then
    (open http://127.0.0.1:8000 2>/dev/null || xdg-open http://127.0.0.1:8000 2>/dev/null || true)
    echo ""
    echo "Trakerz is running at http://127.0.0.1:8000"
    echo "Press CTRL+C to stop."
    wait $SERVER_PID
else
    echo "ERROR: server did not respond within 25 seconds. Check the output above for errors."
    kill $SERVER_PID 2>/dev/null || true
    exit 1
fi
