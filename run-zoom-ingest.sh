#!/bin/bash
# Wrapper for cron-based Zoom session ingestion
# Runs at 8 AM IST Mon-Sat, ingests previous day's morning session

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DATE=$(date -d "yesterday" +%Y-%m-%d)

cd "$SCRIPT_DIR/../" && node server/scripts/ingest-zoom-session.js --date "$DATE" 2>&1
