-- ============================================================================
-- Patch: Repontar FK fiscalizacao.turno_fiscal.usuario_id -> public.usuario
-- Projeto: backend-fiscal (Sistema de Fiscalização de Linhas — Sambaíba G3)
-- Banco:   gestao_patio_sambaiba
-- Autor:   Claude Code
-- Versão:  1.0
-- Data:    2026-07-02
-- ============================================================================
--
-- OBJETIVO
-- Com a autenticação migrando para public.usuario (ver
-- v3-schema-patch-consolidacao-usuarios-v1.0.sql), turno_fiscal.usuario_id
-- passa a referenciar public.usuario(id) em vez de fiscalizacao.usuario(id).
--
-- ⚠️ AVISO DE SEGURANÇA — LEIA ANTES DE EXECUTAR ⚠️
-- Diferente do patch anterior, este ARQUIVO ALTERA O SCHEMA fiscalizacao
-- (que é próprio deste projeto, sem uso externo) — não toca em nada do
-- schema public além de referenciá-lo. É a ÚNICA mudança de DROP/ALTER
-- destrutivo autorizada neste patch, e está restrita à constraint de FK
-- abaixo. fiscalizacao.usuario e fiscalizacao.cobrador NÃO são apagadas nem
-- alteradas estruturalmente — apenas recebem um comentário avisando que
-- estão depreciadas para código novo.
--
-- PRÉ-REQUISITO: rodar v3-schema-patch-consolidacao-usuarios-v1.0.sql antes
-- (precisa que public.usuario já exista com os dados atuais).
--
-- ⚠️ DIVERGÊNCIA ENCONTRADA EM 2026-07-02 — remapeamento necessário antes do
-- ALTER: fiscalizacao.turno_fiscal tem 5 registros históricos referenciando
-- fiscalizacao.usuario RE G3001 ("Alisson Martins", papel COORDENADOR), que
-- NÃO existe em public.usuario (só existe lá RE ADMIN001, mesmo nome, perfil
-- ADMIN). Confirmado com o usuário que as duas contas são a mesma pessoa —
-- os 5 registros são remapeados para o id de public.usuario RE ADMIN001
-- antes de trocar a constraint, para não perder histórico nem violar a FK
-- nova. Isso NÃO apaga nem altera fiscalizacao.usuario — só atualiza a FK em
-- turno_fiscal (dado do schema fiscalizacao, próprio deste projeto).
--
-- INSTRUÇÕES DE EXECUÇÃO (pgAdmin)
-- 1. Confirme o nome real da constraint antes de aplicar (pode ter mudado):
--      SELECT conname, pg_get_constraintdef(oid)
--      FROM pg_constraint
--      WHERE conrelid = 'fiscalizacao.turno_fiscal'::regclass AND contype = 'f';
-- 2. Execute os comandos abaixo no Query Tool do pgAdmin, na ordem.
-- 3. Rode as queries de verificação ao final.
-- ============================================================================

-- Nome confirmado via exploração em 2026-07-02: turno_fiscal_usuario_id_fkey
-- A constraint precisa ser derrubada ANTES do remapeamento abaixo, porque o
-- novo valor (id de ADMIN001 em public.usuario) viola a FK antiga enquanto
-- ela ainda aponta para fiscalizacao.usuario.
ALTER TABLE fiscalizacao.turno_fiscal
    DROP CONSTRAINT turno_fiscal_usuario_id_fkey;

-- Remapeia os registros históricos de G3001 (fiscalizacao.usuario) para
-- ADMIN001 (public.usuario) — mesma pessoa, confirmado com o usuário.
UPDATE fiscalizacao.turno_fiscal
SET usuario_id = (SELECT id FROM public.usuario WHERE re = 'ADMIN001')
WHERE usuario_id = (SELECT id FROM fiscalizacao.usuario WHERE re = 'G3001');

ALTER TABLE fiscalizacao.turno_fiscal
    ADD CONSTRAINT turno_fiscal_usuario_id_fkey
    FOREIGN KEY (usuario_id) REFERENCES public.usuario(id)
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Comentários de depreciação — tabelas mantidas só por histórico/rollback
COMMENT ON TABLE fiscalizacao.usuario IS
    'Não usar em código novo — substituída por public.usuario, mantida só por histórico/rollback';
COMMENT ON TABLE fiscalizacao.cobrador IS
    'Não usar em código novo — substituída por public.cobrador, mantida só por histórico/rollback';

-- ============================================================================
-- QUERIES DE VERIFICAÇÃO
-- ============================================================================

-- Deve mostrar a FK apontando para public.usuario
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'fiscalizacao.turno_fiscal'::regclass AND contype = 'f';

-- Deve mostrar os dois comentários de depreciação
SELECT c.relnamespace::regnamespace AS schema, c.relname, obj_description(c.oid) AS comment
FROM pg_class c
WHERE c.relname IN ('usuario', 'cobrador') AND c.relnamespace::regnamespace::text = 'fiscalizacao';
