#!/bin/bash
set -e

CONFIG_DIR="/data/signal-cli-config"
mkdir -p "$CONFIG_DIR"

if [ -n "$SIGNAL_CLI_STATE_B64" ]; then
  echo "Restaurando estado do signal-cli a partir da variável de ambiente..."
  echo "$SIGNAL_CLI_STATE_B64" | base64 -d > /tmp/state.tar.gz
  tar xzf /tmp/state.tar.gz -C "$CONFIG_DIR"
  rm /tmp/state.tar.gz
  echo "Estado restaurado com sucesso."
else
  echo "SIGNAL_CLI_STATE_B64 vazio — iniciando sem estado prévio (primeiro registro)."
fi

exec signal-cli --config "$CONFIG_DIR" daemon --http 0.0.0.0:${PORT:-8080}
