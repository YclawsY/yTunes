#!/bin/bash
# Auto-restart wrapper for yTunes server

cd "$(dirname "$0")"

while true; do
    echo "🦞 Starting yTunes server..."
    node server.js
    EXIT_CODE=$?
    echo "⚠️  Server exited with code $EXIT_CODE. Restarting in 2 seconds..."
    sleep 2
done
