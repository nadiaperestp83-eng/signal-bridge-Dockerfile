#!/bin/bash
set -e

CONFIG_DIR="/data/signal-cli-config"
mkdir -p "$CONFIG_DIR"

if [ -n "$SIGNAL_CLI_STATE_B64" ]; then
  echo "Restaurando estado do signal-cli..."
  echo "$SIGNAL_CLI_STATE_B64" | base64 -d > /tmp/state.tar.gz
  tar xzf /tmp/state.tar.gz -C "$CONFIG_DIR"
  rm /tmp/state.tar.gz
  echo "Estado restaurado."
else
  echo "Sem estado prévio — contas serão registradas do zero."
fi

exec node /app/server.js
