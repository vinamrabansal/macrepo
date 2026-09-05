#!/bin/bash

# KeyChat - Local macOS Server Runner
PORT=3000

echo "🔑 Starting KeyChat locally on http://localhost:$PORT..."

# Check if python3 is available
if command -v python3 &>/dev/null; then
  echo "✨ Running local server via Python 3..."
  python3 -m http.server $PORT
elif command -v npx &>/dev/null; then
  echo "✨ Running local server via npx serve..."
  npx serve -p $PORT .
else
  echo "❌ Neither python3 nor npx found. Please open index.html in your browser directly."
  open index.html
fi
