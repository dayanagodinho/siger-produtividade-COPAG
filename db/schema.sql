-- Escala Híbrida — esquema do banco

CREATE TABLE IF NOT EXISTS servidores (
  id            SERIAL PRIMARY KEY,
  nome          TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  senha_hash    TEXT NOT NULL,
  perfil        TEXT NOT NULL DEFAULT 'servidor' CHECK (perfil IN ('servidor','chefia')),
  meta_presencial_semanal  NUMERIC(5,2) NOT NULL DEFAULT 20,
  meta_distancia_semanal   NUMERIC(5,2) NOT NULL DEFAULT 20,
  ativo         BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Senha dada pela chefia (inicial ou redefinida): a pessoa entra, mas nao
-- usa nada ate definir a propria. Vira FALSE na primeira troca.
ALTER TABLE servidores ADD COLUMN IF NOT EXISTS senha_provisoria BOOLEAN NOT NULL DEFAULT FALSE;

-- Um dia pode ter mais de um turno (ex.: 7h30-14h30 presencial + 15h-18h a distancia)
-- Email e comparado sem diferenciar maiusculas no login; o banco precisa
-- recusar a duplicata do mesmo jeito. Antes, "Teste@x" e "teste@x" viravam
-- duas contas e o login pegava uma delas ao acaso.
CREATE UNIQUE INDEX IF NOT EXISTS idx_servidores_email_lower ON servidores (lower(email));

CREATE TABLE IF NOT EXISTS turnos (
  id           SERIAL PRIMARY KEY,
  servidor_id  INTEGER NOT NULL REFERENCES servidores(id) ON DELETE CASCADE,
  data         DATE NOT NULL,
  inicio       TIME NOT NULL,
  fim          TIME NOT NULL,
  modalidade   TEXT NOT NULL CHECK (modalidade IN ('P','D')),
  observacao   TEXT,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (fim > inicio)
);
CREATE INDEX IF NOT EXISTS idx_turnos_data ON turnos(data);
CREATE INDEX IF NOT EXISTS idx_turnos_servidor_data ON turnos(servidor_id, data);

CREATE TABLE IF NOT EXISTS afastamentos (
  id           SERIAL PRIMARY KEY,
  servidor_id  INTEGER NOT NULL REFERENCES servidores(id) ON DELETE CASCADE,
  data_inicio  DATE NOT NULL,
  data_fim     DATE NOT NULL,
  tipo         TEXT NOT NULL DEFAULT 'Licenca',
  observacao   TEXT,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (data_fim >= data_inicio)
);
CREATE INDEX IF NOT EXISTS idx_afast_periodo ON afastamentos(data_inicio, data_fim);

CREATE TABLE IF NOT EXISTS feriados (
  data       DATE PRIMARY KEY,
  descricao  TEXT NOT NULL
);

-- Avisos para a chefia: uma linha por dia que ficou sem presencial depois
-- de uma mudanca (turno, afastamento, feriado ou regra). Quem fez fica em
-- autor_id; "origem" descreve a mudanca em palavras.
CREATE TABLE IF NOT EXISTS avisos (
  id         SERIAL PRIMARY KEY,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  data       DATE NOT NULL,
  mensagem   TEXT NOT NULL,
  origem     TEXT,
  autor_id   INTEGER REFERENCES servidores(id) ON DELETE SET NULL,
  lido       BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_avisos_lido ON avisos(lido, criado_em DESC);

CREATE TABLE IF NOT EXISTS config (
  chave  TEXT PRIMARY KEY,
  valor  TEXT NOT NULL
);

INSERT INTO config (chave, valor) VALUES
  ('cobertura_inicio', '07:00'),
  ('cobertura_fim', '18:00'),
  ('minimo_presencial', '1'),
  ('granularidade_min', '30'),
  ('dias_uteis', '1,2,3,4,5'),
  ('periodo_inicio', '2026-09-09'),
  ('periodo_fim', '')
ON CONFLICT (chave) DO NOTHING;
