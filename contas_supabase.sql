-- Execute este SQL no painel do Supabase (SQL Editor)
-- https://supabase.com → seu projeto → SQL Editor

CREATE TABLE IF NOT EXISTS contas (
  id                 BIGSERIAL PRIMARY KEY,
  email              TEXT UNIQUE NOT NULL,
  senha_hash         TEXT NOT NULL,
  token_sessao       TEXT,
  nome               TEXT,
  sobrenome          TEXT,
  cpf                TEXT,
  whatsapp           TEXT,
  cep                TEXT,
  logradouro         TEXT,
  numero             TEXT,
  complemento        TEXT,
  bairro             TEXT,
  cidade             TEXT,
  estado             TEXT,
  reset_token        TEXT,
  reset_token_expiry TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- Se a tabela já existir, execute os comandos abaixo para adicionar as colunas:
-- ALTER TABLE contas ADD COLUMN IF NOT EXISTS reset_token TEXT;
-- ALTER TABLE contas ADD COLUMN IF NOT EXISTS reset_token_expiry TIMESTAMPTZ;

-- ── TABELA DE PRODUTOS ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS produtos (
  chave      TEXT PRIMARY KEY,
  nome       TEXT NOT NULL,
  preco      INTEGER NOT NULL,
  ativo      BOOLEAN DEFAULT true,
  descricao  JSONB DEFAULT '[]',
  ordem      INTEGER DEFAULT 0
);

-- Dados iniciais
INSERT INTO produtos (chave, nome, preco, ativo, descricao, ordem) VALUES
  ('Paola',   'Paola',   229, true,  '["Bolsão c/ Abertura p/ o Braço","Super Chique!","Bolso Interno","Fechamento em Ímã","Carregue tudo que precisa!"]', 1),
  ('Carol',   'Carol',   289, true,  '["Duas formas: braço e transversal","Campeã de vendas","Fechamento em Zíper","Bolso Externo","Bolso Interno"]', 2),
  ('Modelo4', 'Celina',  199, true,  '["Bolsa média com bolso frontal","Fechamento em Zíper","Alça regulável"]', 3),
  ('Miranda', 'Miranda', 259, true,  '["Couro Legítimo","Qualidade Hearts"]', 4),
  ('Lara',    'Lara',    209, false, '["Abertura principal nas costas","Bolso frontal","Fechamento nas costas, pega ladrão"]', 5),
  ('Adriana', 'Adriana', 189, true,  '["Bolsa lateral estruturada","Pode ser usada como bolsa de mão","Fechamento em zíper"]', 6),
  ('Modelo3', 'Denise',  189, true,  '["Pega ladrão mini","25x28cm","2 Bolsos externos","Abertura principal nas costas"]', 7),
  ('Julia',   'Júlia',   299, false, '["Couro Legítimo","Qualidade Hearts"]', 8),
  ('Renata',  'Renata',  279, true,  '["Couro Legítimo","Qualidade Hearts"]', 9),
  ('Megan',   'Megan',   289, true,  '["Couro Legítimo","Qualidade Hearts"]', 10),
  ('Maria',   'Maria',   269, true,  '["Couro Legítimo","Qualidade Hearts"]', 11),
  ('Manuela', 'Manuela', 259, true,  '["Couro Legítimo","Qualidade Hearts"]', 12),
  ('Michele', 'Michele', 259, true,  '["Couro Legítimo","Qualidade Hearts"]', 13)
ON CONFLICT (chave) DO NOTHING;

-- Adiciona coluna de imagens (se ainda não existir)
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS imgs JSONB DEFAULT '[]';

-- Adiciona coluna de categoria (se ainda não existir)
-- Valores: 'mochila-masculina', 'mochila-feminina', 'mala', 'bolsa-transversal',
--          'bolsa-ombro', 'carteira', 'bolsa-2em1', 'maleta', '2-alcas'
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS categoria TEXT;
