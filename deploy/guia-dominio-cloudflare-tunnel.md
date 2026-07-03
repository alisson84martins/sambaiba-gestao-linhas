# Colocar o backend-fiscal no ar com domínio real — servidor de casa

## Por que Cloudflare Tunnel (e não porta aberta no roteador)

Seu servidor é uma máquina física em casa/garagem, sem provedor de nuvem e
provavelmente sem IP público fixo. As duas formas clássicas de expor isso na
internet seriam:

1. Abrir as portas 80/443 no roteador de casa e apontar o domínio pro seu IP —
   funciona, mas expõe sua rede doméstica direto pra internet, e se o IP mudar
   (comum em plano residencial) o domínio para de funcionar até você atualizar
   o DNS manualmente.
2. **Cloudflare Tunnel** — um processo (`cloudflared`) roda no seu servidor e
   abre uma conexão de saída criptografada pra Cloudflare. Nenhuma porta
   precisa ficar aberta no roteador, o HTTPS é automático (Cloudflare cuida do
   certificado), e funciona normalmente mesmo com IP dinâmico. É grátis.

Recomendo a opção 2. Resolve de quebra o risco de HTTPS que te apontei na
auditoria anterior — o tráfego chega criptografado até a borda da Cloudflare.

## Estrutura de domínio recomendada

Seu domínio (registrado no Registro.br) hoje aponta pro GitHub Pages do site
estático do Gestão de Pátio — isso continua exatamente como está, sem
alterações. Este sistema novo (e qualquer sistema futuro — manutenção, etc.)
ganha um **subdomínio próprio**, todos passando pelo mesmo túnel:

```
seudominio.com.br              → continua no GitHub Pages (Gestão de Pátio, estático)
fiscal.seudominio.com.br       → backend-fiscal (este sistema)
manutencao.seudominio.com.br   → sistema futuro de manutenção (quando existir)
```

Um único `cloudflared` instalado no servidor consegue rotear vários
subdomínios pra portas locais diferentes — não precisa de um túnel por
sistema.

---

## Passo 1 — Mover o DNS do domínio pra Cloudflare

1. Crie uma conta gratuita em https://dash.cloudflare.com
2. "Add a site" → digite seu domínio (o mesmo do Registro.br).
3. A Cloudflare escaneia os registros DNS atuais automaticamente — ela deve
   detectar os registros do GitHub Pages (geralmente `A` apontando pra IPs do
   GitHub, ou `CNAME` pro `seuusuario.github.io`). **Confira que esses
   registros aparecem na lista antes de continuar** — se algum não vier, anote
   antes de trocar o DNS, senão o site do pátio sai do ar.
4. A Cloudflare te dá 2 nameservers novos (algo como `ana.ns.cloudflare.com`).
5. No painel do **Registro.br**: Meus Domínios → seu domínio → "Alterar
   servidor DNS" → cole os 2 nameservers da Cloudflare.
6. Aguarda propagar (geralmente minutos, pode levar até algumas horas).
   Confirma rodando `nslookup seudominio.com.br` ou só acessando o site do
   pátio no navegador — se continuar abrindo normal, propagou certo.

## Passo 2 — Instalar e autenticar o cloudflared no servidor de casa

No servidor (Ubuntu/Debian, via SSH ou direto no teclado):

```bash
# Instala o cloudflared
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb

# Autentica — abre uma URL, você loga na Cloudflare pelo navegador (pode ser
# em outro computador, só copiar o link) e autoriza o domínio
cloudflared tunnel login
```

## Passo 3 — Criar o túnel e apontar o subdomínio

```bash
cloudflared tunnel create fiscal-sambaiba
# Anota o ID do túnel que aparece (ex: a1b2c3d4-...)

# Cria o registro DNS do subdomínio automaticamente na Cloudflare
cloudflared tunnel route dns fiscal-sambaiba fiscal.seudominio.com.br
```

Crie o arquivo de configuração `~/.cloudflared/config.yml`:

```yaml
tunnel: fiscal-sambaiba
credentials-file: /home/SEU_USUARIO/.cloudflared/<ID_DO_TUNEL>.json

ingress:
  - hostname: fiscal.seudominio.com.br
    service: http://localhost:8001
  - service: http_status:404
```

Repare que aponto direto pra porta 8001 (o uvicorn do backend-fiscal), sem
passar pelo nginx — o FastAPI já serve o frontend (`dist/`) sozinho via
`StaticFiles` no `main.py`, então o nginx fica redundante nesse cenário com
subdomínio dedicado. Isso simplifica: uma coisa a menos pra manter
sincronizada. Se no futuro você preferir manter o nginx no meio (por exemplo,
pra servir vários sistemas atrás de um só processo), dá pra apontar o
`service` pro nginx (`http://localhost:80`) em vez do uvicorn direto — mas
pra fase de teste, ir direto no uvicorn é mais simples.

Instala como serviço, pra sobreviver a reinícios do servidor:

```bash
sudo cloudflared service install
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
```

## Passo 4 — Teste rápido, sem esperar nada disso (opcional, mas recomendo fazer primeiro)

Antes de configurar o túnel nomeado acima, você pode validar que o backend
sobe e responde publicamente em segundos, com uma URL temporária gratuita da
própria Cloudflare, sem precisar de domínio nem DNS:

```bash
cloudflared tunnel --url http://localhost:8001
```

Isso imprime uma URL tipo `https://palavras-aleatorias.trycloudflare.com` que
funciona imediatamente. Bom pra confirmar que o servidor e a porta estão
certos antes de mexer em DNS de verdade.

## Passo 5 — Deploy do backend-fiscal

Usa o `deploy.sh` que já existe no projeto (`backend-fiscal/deploy/deploy.sh`).
Antes de rodar, gere uma `SECRET_KEY` nova e forte pro `.env` de produção —
não reaproveite a que está no `.env.example`/`.env` local (isso ficou como
risco pendente na auditoria anterior):

```bash
openssl rand -hex 32
```

Do seu computador (com os arquivos já commitados/atualizados):

```bash
scp -r backend-fiscal/ SEU_USUARIO@IP_OU_HOSTNAME_DO_SERVIDOR:/tmp/
```

Se o servidor não tem IP público (é justamente o caso), rode esse `scp` só
quando estiver na mesma rede local (mesma casa/Wi-Fi), ou copie via pendrive,
ou monte um túnel SSH temporário. No servidor:

```bash
cd /tmp/backend-fiscal/deploy
chmod +x deploy.sh update.sh
bash deploy.sh
```

O script vai pedir pra editar o `.env` — é o momento de colocar a
`SECRET_KEY` nova gerada acima e a `DATABASE_URL`/credenciais reais do
Postgres do próprio servidor.

## Passo 6 — Testar de verdade

Acesse `https://fiscal.seudominio.com.br/` (ou a porta 8001 direto, mesma
coisa nesse esquema) e tenta logar com um RE/senha reais que já existem em
`public.usuario` com perfil COORDENADOR ou ADMIN.

## Corrigindo erros pontualmente daqui pra frente

- Logs em tempo real: `journalctl -u fiscal-backend -f` (backend) e
  `journalctl -u cloudflared -f` (túnel), rodando no servidor via SSH.
- Depois de qualquer correção de código (feita aqui comigo ou no Claude Code
  local), você só precisa repetir o `scp` dos arquivos mudados e rodar
  `bash update.sh` no servidor — ele reinicia o serviço sozinho, sem precisar
  mexer no túnel nem no nginx de novo.
- Não precisa reconfigurar o Cloudflare Tunnel toda vez — ele só depende da
  porta 8001 continuar respondendo.

## Pendências da auditoria anterior que valem resolver antes de convidar alguém pra testar

1. `SECRET_KEY` nova no `.env` de produção (já coberto no Passo 5 acima).
2. Onboarding de fiscal ainda quebrado (`seed.py` aponta pra tabela errada) —
   se for testar só você (COORDENADOR/ADMIN), não bloqueia; se for convidar um
   fiscal de verdade pra testar, resolve isso antes.
3. Remover a rota `/api/docs` (Swagger) do nginx/config antes de expor
   publicamente, ou pelo menos ter consciência de que ela fica acessível.
