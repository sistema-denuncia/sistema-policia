-- Banco SQLite do Sistema de Denúncia / Emergência.
-- Este arquivo é apenas a referência do schema.
-- O backend também cria/atualiza as tabelas automaticamente ao iniciar.

CREATE TABLE IF NOT EXISTS alertas_policia (
  id TEXT NOT NULL PRIMARY KEY,
  protocolo TEXT NOT NULL UNIQUE,
  cliente_id TEXT NOT NULL UNIQUE,
  tipo TEXT NOT NULL DEFAULT 'EMERGENCIA',
  status TEXT NOT NULL DEFAULT 'ATIVO'
    CHECK (status IN ('ATIVO', 'EM_ATENDIMENTO', 'RESOLVIDO', 'FALSO_ALARME')),
  prioridade TEXT NOT NULL DEFAULT 'ALTA'
    CHECK (prioridade IN ('BAIXA', 'MEDIA', 'ALTA', 'CRITICA')),
  quantidade_acionamentos INTEGER NOT NULL DEFAULT 1,
  latitude REAL,
  longitude REAL,
  acuracia_metros REAL,
  dispositivo TEXT,
  ip_origem TEXT,
  origem TEXT NOT NULL DEFAULT 'botao-emergencia-web',
  observacoes TEXT,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  encerrado_em TEXT
);

CREATE INDEX IF NOT EXISTS idx_alertas_status_criado
  ON alertas_policia (status, criado_em DESC);

CREATE INDEX IF NOT EXISTS idx_alertas_tipo_criado
  ON alertas_policia (tipo, criado_em DESC);

CREATE INDEX IF NOT EXISTS idx_alertas_criado
  ON alertas_policia (criado_em DESC);
