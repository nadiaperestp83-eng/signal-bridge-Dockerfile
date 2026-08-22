#!/bin/bash
set -e

CONFIG_DIR="/data/signal-cli-config"

if [ ! -d "$CONFIG_DIR" ] || [ -z "$(ls -A "$CONFIG_DIR" 2>/dev/null)" ]; then
  echo "Nada pra exportar: $CONFIG_DIR está vazio (você já registrou uma conta?)." >&2
  exit 1
fi

tar czf /tmp/state.tar.gz -C "$CONFIG_DIR" .
base64 -w 0 /tmp/state.tar.gz
echo ""
rm /tmp/state.tar.gz
