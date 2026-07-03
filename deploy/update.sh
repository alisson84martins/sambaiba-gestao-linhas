#!/bin/bash
# update.sh — Atualizar o sistema em produção (sem perder dados)
# Execute a partir da pasta do projeto atualizado
set -e

INSTALL_DIR="/opt/fiscal-sambaiba"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_SRC="$(dirname "$SCRIPT_DIR")"

echo "Atualizando backend..."
cp -r "$BACKEND_SRC/app/." "$INSTALL_DIR/backend/app/"
"$INSTALL_DIR/venv/bin/pip" install -r "$BACKEND_SRC/requirements.txt" -q

if [ -d "$BACKEND_SRC/dist" ]; then
    echo "Atualizando frontend..."
    cp -r "$BACKEND_SRC/dist/." "$INSTALL_DIR/dist/"
fi

echo "Reiniciando serviço..."
sudo systemctl restart fiscal-backend
sleep 2
sudo systemctl status fiscal-backend --no-pager | head -10
echo "Atualização concluída."
