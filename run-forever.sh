#!/bin/bash
cd /home/claw/.openclaw/workspace/ytunes
while true; do
    echo "[$(date)] Starting yTunes server..."
    node server.js
    EXIT_CODE=$?
    echo "[$(date)] Server exited with code $EXIT_CODE, restarting in 2s..."
    sleep 2
done
