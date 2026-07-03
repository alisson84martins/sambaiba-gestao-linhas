#!/bin/bash
# ============================================================
# deploy.sh — Primeiro deploy do Sistema de Fiscalização
# Execute no servidor como usuário com sudo:
#   bash deploy.sh
#
# Pré-requisitos no servidor:
#   - Ubuntu 20.04+ / Debian 11+
#   - Python 3.11+
#   - PostgreSQL 14+ com banco gestao_patio_sambaiba criado
#   - Nginx instalado
#   - Schema fiscalizacao já executado no pgAdmin
# ============================================================

set -e

INSTALL_DIR="/opt/fiscal-sambaiba"
BACKEND_DIR="$INSTALL_DIR/backend"
DIST_DIR="$INSTALL_DIR/dist"
VENV_DIR="$INSTALL_DIR/venv"

echo "======================================================"
echo "  Deploy — Fiscalização de Linhas Sambaíba G3"
echo "======================================================"

# ── 1. Criar diretórios ───────────────────────────────────
echo "[1/8] Criando diretórios..."
sudo mkdir -p "$BACKEND_DIR" "$DIST_DIR"
sudo chown -R "$USER:$USER" "$INSTALL_DIR"

# ── 2. Copiar backend ─────────────────────────────────────
echo "[2/8] Copiando backend..."
# Executar a partir da pasta raiz do projeto backend-fiscal/
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_SRC="$(dirname "$SCRIPT_DIR")"

cp -r "$BACKEND_SRC/app"            "$BACKEND_DIR/"
cp    "$BACKEND_SRC/requirements.txt" "$BACKEND_DIR/"
cp    "$BACKEND_SRC/seed.py"        "$BACKEND_DIR/" 2>/dev/null || true

# ── 3. Configurar .env ────────────────────────────────────
echo "[3/8] Configurando .env..."
if [ ! -f "$BACKEND_DIR/.env" ]; then
    cp "$BACKEND_SRC/.env.example" "$BACKEND_DIR/.env"
    echo ""
    echo "⚠️  ATENÇÃO: Edite $BACKEND_DIR/.env com suas credenciais ANTES de continuar!"
    echo "   nano $BACKEND_DIR/.env"
    echo ""
    read -p "Pressione Enter após editar o .env..."
fi

# ── 4. Copiar frontend (dist/) ────────────────────────────
echo "[4/8] Copiando frontend..."
if [ -d "$BACKEND_SRC/dist" ]; then
    cp -r "$BACKEND_SRC/dist/." "$DIST_DIR/"
    echo "     dist/ copiado."
else
    echo "     ⚠️  dist/ não encontrado. Copie manualmente para $DIST_DIR"
fi

# ── 5. Virtualenv + dependências ──────────────────────────
echo "[5/8] Instalando dependências Python..."
python3 -m venv "$VENV_DIR"
"$VENV_DIR/bin/pip" install --upgrade pip -q
"$VENV_DIR/bin/pip" install -r "$BACKEND_DIR/requirements.txt" -q
echo "     OK."

# ── 6. Criar usuário ADMIN inicial (seed, em public.usuario) ─
echo "[6/8] Seed — criando primeiro ADMIN..."
cd "$BACKEND_DIR"
read -p "  RE do admin (ex: ADMIN001): " SEED_RE
read -p "  Nome completo: " SEED_NOME
read -s -p "  Senha: " SEED_SENHA; echo ""

"$VENV_DIR/bin/python" seed.py \
    --re "$SEED_RE" \
    --nome "$SEED_NOME" \
    --senha "$SEED_SENHA" || echo "     (seed pulado — veja mensagem acima)"

# ── 7. Nginx ──────────────────────────────────────────────
echo "[7/8] Configurando nginx..."
sudo cp "$SCRIPT_DIR/nginx-fiscal.conf" /etc/nginx/sites-available/fiscal
sudo ln -sf /etc/nginx/sites-available/fiscal /etc/nginx/sites-enabled/fiscal
sudo nginx -t && sudo systemctl reload nginx
echo "     Nginx recarregado."

# ── 8. Systemd ────────────────────────────────────────────
echo "[8/8] Configurando serviço systemd..."
# Ajusta o usuário no service file
sed "s/User=ubuntu/User=$USER/g; s/Group=ubuntu/Group=$USER/g" \
    "$SCRIPT_DIR/fiscal-backend.service" | sudo tee /etc/systemd/system/fiscal-backend.service > /dev/null

sudo systemctl daemon-reload
sudo systemctl enable fiscal-backend
sudo systemctl start fiscal-backend

sleep 2
STATUS=$(sudo systemctl is-active fiscal-backend)
if [ "$STATUS" = "active" ]; then
    echo ""
    echo "✅ Deploy concluído com sucesso!"
    echo ""
    echo "   Frontend: http://SEU_IP/fiscal/"
    echo "   API docs: http://SEU_IP/fiscal/api/docs"
    echo ""
    echo "   Monitorar logs: journalctl -u fiscal-backend -f"
else
    echo ""
    echo "❌ Serviço não iniciou. Verifique:"
    echo "   journalctl -u fiscal-backend -n 50 --no-pager"
fi
