#!/bin/sh
# Starts GNEZDO in this window (Ctrl+C stops it). To run it as a service that starts with the
# server, see INSTALL.txt, part 4 (gnezdo.service).
cd "$(dirname "$0")" || exit 1
if [ ! -f config.json ]; then
  cp config.example.json config.json
  echo "config.json made from config.example.json: put your PostgreSQL connection in it (INSTALL.txt, part 3), then start again."
  exit 1
fi
export GNEZDO_CONFIG="$PWD/config.json"
exec ./program/GNEZDO
