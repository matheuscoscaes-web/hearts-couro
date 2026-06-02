-- Execute este SQL no painel do Supabase (SQL Editor)
-- https://supabase.com → seu projeto → SQL Editor

CREATE TABLE IF NOT EXISTS contas (
  id          BIGSERIAL PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,
  senha_hash  TEXT NOT NULL,
  token_sessao TEXT,
  nome        TEXT,
  sobrenome   TEXT,
  cpf         TEXT,
  whatsapp    TEXT,
  cep         TEXT,
  logradouro  TEXT,
  numero      TEXT,
  complemento TEXT,
  bairro      TEXT,
  cidade      TEXT,
  estado      TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
