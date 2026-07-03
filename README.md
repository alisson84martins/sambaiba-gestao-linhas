# Sistema de Fiscalização de Linhas — Sambaíba G3

Backend FastAPI + frontend React (painel do fiscal) e um painel vanilla JS
independente para o coordenador, construídos para digitalizar a fiscalização
de partidas de ônibus em campo: abertura de turno, registro de cada partida
programada (realizada/perdida, com motivo), ocorrências de RA/SOS, e
indicadores (IPP diário, Pareto de motivos de perda, operadores recorrentes).

Parte de um conjunto maior de sistemas operacionais da Sambaíba Transportes —
autentica contra a mesma base de usuários (`public.usuario`) compartilhada
com o sistema de Gestão de Pátio já em uso em campo, em vez de manter um
cadastro de login isolado por sistema.

## Stack

- **Backend:** FastAPI, SQLAlchemy 2 (async), asyncpg, Pydantic v2, JWT (HS256) + bcrypt
- **Frontend do fiscal:** React (build estático em `dist/`, consumido via SPA)
- **Painel do coordenador:** HTML/CSS/JS vanilla, sem framework nem build step
- **Banco:** PostgreSQL — schema próprio `fiscalizacao` (turnos, partidas, eventos) + leitura/escrita em `public.usuario` (autenticação compartilhada)

## Arquitetura

```
backend-fiscal/
├── app/
│   ├── main.py                  # FastAPI app, serve dist/ estático (SPA + painel do coordenador)
│   ├── core/
│   │   ├── config.py            # Settings (Pydantic Settings via .env)
│   │   ├── database.py          # Engine assíncrono + Base declarativa
│   │   ├── security.py          # JWT + bcrypt
│   │   └── deps.py              # get_current_usuario / require_papel (JWT + autorização por papel)
│   ├── models/
│   │   ├── fiscalizacao.py      # Schema fiscalizacao — turnos, partidas, eventos, linhas
│   │   └── v3.py                # Schema public — usuário, tipo_funcionario, cobrador, motorista (base compartilhada)
│   ├── schemas/fiscal.py        # Schemas Pydantic (request/response)
│   └── routers/
│       ├── auth.py              # Login, troca de senha no primeiro acesso
│       ├── coordenador.py       # Panorama de linha, previsão de recolhida, onboarding de usuário
│       ├── turno.py             # Abrir/fechar turno, registrar partidas e eventos
│       ├── escalas.py           # Upload de escala gerencial (.xlsx), listagem de partidas
│       └── relatorios.py        # IPP diário, Pareto de motivos, operadores recorrentes
├── dist/                        # Frontend React (fiscal) + painel do coordenador, buildados
├── deploy/                      # Scripts e configs de deploy (systemd, nginx)
├── seed.py                      # Bootstrap do primeiro usuário ADMIN
├── requirements.txt
└── .env.example
```

## Autenticação e onboarding

Todos os usuários vivem em `public.usuario`, com um `tipo_funcionario`
(tabela de referência extensível) resolvendo o papel efetivo de cada um —
sem precisar de `ALTER TYPE` a cada novo tipo de funcionário. Fluxo:

1. Bootstrap do primeiro ADMIN via `seed.py` (fala direto com o banco —
   único caso em que isso é necessário, pela dependência circular óbvia de
   um endpoint protegido por ADMIN exigir um ADMIN pra chamá-lo).
2. Dali em diante, todo onboarding novo passa por
   `POST /coordenador/usuarios` (protegido, só ADMIN).
3. Usuário novo nasce com `primeiro_acesso=True` e senha provisória; o
   frontend força a troca via `POST /auth/trocar-senha` no primeiro login.

## Desenvolvimento local

```bash
cd backend-fiscal
python -m venv venv && source venv/bin/activate   # ou venv\Scripts\activate no Windows
pip install -r requirements.txt
cp .env.example .env    # editar com suas credenciais locais

python seed.py --re ADMIN001 --nome "Seu Nome" --senha "SuaSenha123"
uvicorn app.main:app --reload --port 8001

# Swagger: http://localhost:8001/api/docs
```

## Endpoints principais

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | /api/v1/auth/login | Login RE+senha → JWT |
| POST | /api/v1/auth/trocar-senha | Troca de senha (fluxo de primeiro acesso) |
| POST | /api/v1/coordenador/usuarios | Onboarding de usuário (só ADMIN) |
| GET  | /api/v1/coordenador/panorama/{linha} | Timeline única (programado × realizado) de uma linha no dia |
| GET/POST | /api/v1/coordenador/previsao-recolhida | Horário previsto de chegada na garagem |
| GET  | /api/v1/linhas/ | Listar linhas |
| POST | /api/v1/linhas/ | Criar linha |
| POST | /api/v1/escalas/upload | Upload .xlsx → importa tabelas programadas |
| GET  | /api/v1/escalas/partidas/{codigo} | Partidas por tabela |
| POST | /api/v1/turno/abrir | Abrir turno |
| GET  | /api/v1/turno/ativo | Turno aberto do usuário autenticado |
| POST | /api/v1/turno/{id}/partida | Registrar partida (realizada/perdida) |
| POST | /api/v1/turno/{id}/evento | Registrar RA/SOS |
| POST | /api/v1/turno/{id}/fechar | Fechar turno |
| GET  | /api/v1/relatorios/ipp-diario | IPP por linha/data |
| GET  | /api/v1/relatorios/pareto-motivos | Pareto de causas de perda |
| GET  | /api/v1/relatorios/operadores-recorrentes | Operadores com 2+ faltas |

## Banco de dados

- Schema `fiscalizacao`: isolado, específico deste sistema (turnos, partidas
  programadas/realizadas, eventos de RA/SOS, linhas fiscalizadas).
- Schema `public`: compartilhado com os demais sistemas Sambaíba — só a
  tabela de usuários (`usuario`, `tipo_funcionario`, `cobrador`) é lida/
  escrita por aqui; nenhuma tabela operacional de outro sistema é tocada.

## Deploy

Os scripts de deploy (`deploy/`) cobrem systemd + nginx para um servidor
Linux genérico. Notas de infraestrutura específicas de um ambiente de
produção real (endereços, domínios, runbook passo a passo) não fazem parte
deste repositório público — ver `.gitignore`.
