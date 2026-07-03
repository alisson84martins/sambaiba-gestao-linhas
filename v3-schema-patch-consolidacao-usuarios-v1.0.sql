-- ============================================================================
-- Patch: Consolidação de usuários — base v3 (schema public)
-- Projeto: backend-fiscal (Sistema de Fiscalização de Linhas — Sambaíba G3)
-- Banco:   gestao_patio_sambaiba
-- Autor:   Claude Code
-- Versão:  1.0
-- Data:    2026-07-02
-- ============================================================================
--
-- OBJETIVO
-- Consolidar a autenticação de todos os sistemas futuros na base única
-- public.usuario (schema da v3, EM USO ATIVO NO CAMPO), em vez de cada
-- sistema manter seu próprio cadastro isolado. Introduz:
--   - public.tipo_funcionario: tabela de referência que substitui gradualmente
--     o ENUM perfil_usuario_enum (evita ALTER TYPE a cada novo tipo).
--   - public.cobrador: tabela de extensão análoga a public.motorista.
--   - public.usuario.tipo_funcionario_id / public.usuario.cobrador_id: FKs
--     novas, convivendo com as colunas legadas.
--
-- ⚠️ AVISO DE SEGURANÇA — LEIA ANTES DE EXECUTAR ⚠️
-- Este patch roda contra o schema public do banco gestao_patio_sambaiba, que é
-- a base da v3 EM USO ATIVO NO CAMPO (não é um projeto isolado). TODO o
-- conteúdo abaixo é estritamente ADITIVO e IDEMPOTENTE:
--   - Apenas CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS,
--     INSERT ... ON CONFLICT DO NOTHING e UPDATE que só toca linhas com o
--     campo novo ainda NULL.
--   - NADA aqui remove, renomeia ou altera tipo/nullability de qualquer
--     objeto pré-existente em public. A coluna public.usuario.perfil e o
--     tipo perfil_usuario_enum continuam existindo e sendo usados pelo app
--     v3 em produção, inalterados.
--   - Pode ser executado quantas vezes for necessário sem efeito colateral.
--
-- NOTA DE EXECUÇÃO (2026-07-02): as instruções deste patch (CREATE TABLE
-- tipo_funcionario/cobrador, ADD COLUMN em usuario, INSERT dos 10 tipos,
-- backfill e comentários) já haviam sido aplicadas diretamente no banco em
-- uma execução anterior deste mesmo prompt, sem que este arquivo tivesse
-- sido salvo no projeto. Este arquivo foi reconstruído a partir do estado
-- real do banco (conferido via information_schema/pg_catalog) para deixar a
-- migração documentada e versionada. Rodá-lo agora é um no-op — serve para
-- registrar o que já existe e garantir reprodutibilidade em outros ambientes.
--
-- INSTRUÇÕES DE EXECUÇÃO (pgAdmin)
-- 1. Abra o pgAdmin, conecte no servidor local, selecione o banco
--    gestao_patio_sambaiba.
-- 2. Abra o Query Tool e cole o conteúdo deste arquivo inteiro.
-- 3. Execute (F5). Revise as queries de verificação ao final antes de
--    considerar concluído.
-- 4. Este patch NÃO precisa ser rodado dentro de uma transação explícita
--    (cada comando já é seguro de repetir), mas rodar dentro de uma única
--    transação (BEGIN/COMMIT) é aceitável caso prefira revisar antes de
--    confirmar.
-- ============================================================================


-- ─── 1. TABELA public.tipo_funcionario ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tipo_funcionario (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome       VARCHAR(30) NOT NULL UNIQUE,
    descricao  TEXT,
    ativo      BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.tipo_funcionario IS
    'Tabela de referência para o tipo/função do funcionário. Substitui gradualmente o ENUM perfil_usuario_enum — novos tipos não exigem ALTER TYPE, apenas INSERT.';
COMMENT ON COLUMN public.tipo_funcionario.nome IS
    'Nome do tipo — corresponde ao valor de usuario.perfil quando aplicável, para permitir o backfill 1:1';


-- ─── 2. Tipos padrão (idempotente) ─────────────────────────────────────────
INSERT INTO public.tipo_funcionario (nome, descricao) VALUES
    ('ADMIN',          'Administrador do sistema — acesso total'),
    ('COORDENADOR',    'Coordenador de tráfego — gestão operacional das linhas'),
    ('OPERADOR_PATIO', 'Operador de pátio — controle de veículos na garagem'),
    ('MOTORISTA',      'Motorista de ônibus'),
    ('MECANICO',       'Mecânico — manutenção da frota'),
    ('FISCAL',         'Fiscal de linha — fiscalização em campo'),
    ('COBRADOR',       'Cobrador de ônibus'),
    ('PLANTONISTA',    'Plantonista — cobertura fora do horário padrão'),
    ('ENCARREGADO',    'Encarregado de garagem'),
    ('GERENTE',        'Gerente da unidade')
ON CONFLICT (nome) DO NOTHING;


-- ─── 3. TABELA public.cobrador (mesmo padrão de public.motorista) ─────────
CREATE TABLE IF NOT EXISTS public.cobrador (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    re             VARCHAR(20) NOT NULL UNIQUE,
    nome           VARCHAR(100) NOT NULL,
    cpf            VARCHAR(14),
    status         status_motorista_enum NOT NULL DEFAULT 'ATIVO',
    codigo_externo VARCHAR(50),
    criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    criado_por     UUID,
    atualizado_em  TIMESTAMPTZ,
    atualizado_por UUID
);

COMMENT ON TABLE public.cobrador IS
    'Cadastro de cobradores — mesmo padrão de public.motorista. Substitui fiscalizacao.cobrador para uso em código novo';
COMMENT ON COLUMN public.cobrador.re IS 'Registro de Empregado';
COMMENT ON COLUMN public.cobrador.nome IS 'Opcional — preenchido progressivamente';
COMMENT ON COLUMN public.cobrador.status IS
    'Reaproveita o ENUM status_motorista_enum já existente (ATIVO/AFASTADO/FERIAS/DESLIGADO) — nenhum tipo novo criado';


-- ─── 4/5. Colunas novas em public.usuario ──────────────────────────────────
ALTER TABLE public.usuario
    ADD COLUMN IF NOT EXISTS tipo_funcionario_id UUID REFERENCES public.tipo_funcionario(id);

ALTER TABLE public.usuario
    ADD COLUMN IF NOT EXISTS cobrador_id UUID REFERENCES public.cobrador(id);

COMMENT ON COLUMN public.usuario.tipo_funcionario_id IS
    'Novo — aponta para public.tipo_funcionario. Convive com usuario.perfil (legado) durante a transição';
COMMENT ON COLUMN public.usuario.cobrador_id IS
    'Novo — aponta para public.cobrador, análogo a usuario.motorista_id';
COMMENT ON COLUMN public.usuario.perfil IS
    'Mantido por compatibilidade com o app v3 em produção — não remover sem migrar o código-fonte da v3 primeiro (fora do escopo deste patch)';


-- ─── 6. Backfill: tipo_funcionario_id a partir de perfil (só onde NULL) ────
UPDATE public.usuario
SET tipo_funcionario_id = tf.id
FROM public.tipo_funcionario tf
WHERE tf.nome = usuario.perfil::text
  AND usuario.tipo_funcionario_id IS NULL;


-- ============================================================================
-- QUERIES DE VERIFICAÇÃO
-- ============================================================================

-- Deve retornar 10 linhas
SELECT count(*) AS total_tipos FROM public.tipo_funcionario;

-- Deve retornar 0 (nenhum usuário com perfil mapeável ainda sem tipo_funcionario_id)
SELECT count(*) AS usuarios_sem_backfill
FROM public.usuario u
JOIN public.tipo_funcionario tf ON tf.nome = u.perfil::text
WHERE u.tipo_funcionario_id IS NULL;

-- Conferir estrutura final de usuario
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'usuario'
ORDER BY ordinal_position;
