-- Execute este SQL no painel do Supabase (SQL Editor)
-- https://supabase.com → seu projeto → SQL Editor
-- Adiciona o sistema de cupom de revendedor com comissão.

-- ── Revendedor fica registrado na própria conta do cliente ──────────────────
ALTER TABLE contas ADD COLUMN IF NOT EXISTS revendedor_status TEXT; -- NULL | 'pendente' | 'aprovado' | 'rejeitado'
ALTER TABLE contas ADD COLUMN IF NOT EXISTS revendedor_codigo TEXT UNIQUE;
ALTER TABLE contas ADD COLUMN IF NOT EXISTS revendedor_desconto NUMERIC DEFAULT 50;
ALTER TABLE contas ADD COLUMN IF NOT EXISTS revendedor_solicitado_em TIMESTAMPTZ;

-- ── Rastreio do cupom usado e comissão gerada em cada pedido ────────────────
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS cupom_codigo TEXT;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS revendedor_conta_id BIGINT REFERENCES contas(id);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS comissao_valor NUMERIC;
