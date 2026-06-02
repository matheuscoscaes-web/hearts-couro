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
