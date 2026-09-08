-- =====================================================================
-- 001 - Estrutura inicial do SIGAP (Sistema de Gestao de Atividades e Produtividade)
-- =====================================================================

CREATE TYPE perfil_acesso        AS ENUM ('SERVIDOR', 'CHEFE', 'ADMIN');
CREATE TYPE regime_trabalho      AS ENUM ('INTEGRAL', 'PARCIAL', 'PRESENCIAL');
CREATE TYPE situacao_servidor    AS ENUM ('ATIVO', 'INATIVO');
CREATE TYPE papel_lancamento     AS ENUM ('EXECUCAO', 'REVISAO', 'HOMOLOGACAO');
CREATE TYPE status_lancamento    AS ENUM ('EM_ANDAMENTO', 'CONCLUIDO');
CREATE TYPE situacao_validacao   AS ENUM ('PENDENTE', 'VALIDADO', 'DEVOLVIDO');
CREATE TYPE tipo_ausencia        AS ENUM ('FERIAS', 'LICENCA', 'AFASTAMENTO', 'OUTRO');
CREATE TYPE acao_auditoria       AS ENUM ('CRIACAO', 'ALTERACAO', 'EXCLUSAO');
CREATE TYPE origem_referencia    AS ENUM ('META_FIXA', 'MEDIANA_APURADA', 'INDISPONIVEL');
CREATE TYPE situacao_apuracao    AS ENUM ('APURADO', 'SEM_APURACAO');

-- ---------------------------------------------------------------------
-- Setores
-- ---------------------------------------------------------------------
CREATE TABLE setores (
  id                SERIAL PRIMARY KEY,
  nome              TEXT        NOT NULL,
  sigla             TEXT        NOT NULL,
  chefe_servidor_id INTEGER,
  criado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  excluido_em       TIMESTAMPTZ
);
CREATE UNIQUE INDEX setores_sigla_unica ON setores (upper(sigla)) WHERE excluido_em IS NULL;

-- ---------------------------------------------------------------------
-- Servidores
-- ---------------------------------------------------------------------
CREATE TABLE servidores (
  id                 SERIAL PRIMARY KEY,
  matricula          TEXT              NOT NULL,
  nome               TEXT              NOT NULL,
  email              TEXT              NOT NULL,
  senha_hash         TEXT              NOT NULL,
  setor_id           INTEGER           NOT NULL REFERENCES setores (id),
  grupo_id           INTEGER,
  perfil             perfil_acesso     NOT NULL DEFAULT 'SERVIDOR',
  regime             regime_trabalho   NOT NULL DEFAULT 'INTEGRAL',
  situacao           situacao_servidor NOT NULL DEFAULT 'ATIVO',
  data_admissao      DATE              NOT NULL,
  data_desligamento  DATE,
  criado_em          TIMESTAMPTZ       NOT NULL DEFAULT now(),
  atualizado_em      TIMESTAMPTZ       NOT NULL DEFAULT now(),
  excluido_em        TIMESTAMPTZ,
  CONSTRAINT servidores_desligamento_coerente
    CHECK (data_desligamento IS NULL OR data_desligamento >= data_admissao)
);
CREATE UNIQUE INDEX servidores_matricula_unica ON servidores (matricula) WHERE excluido_em IS NULL;
CREATE UNIQUE INDEX servidores_email_unico     ON servidores (lower(email)) WHERE excluido_em IS NULL;
CREATE INDEX servidores_por_setor ON servidores (setor_id) WHERE excluido_em IS NULL;

ALTER TABLE setores
  ADD CONSTRAINT setores_chefe_fk FOREIGN KEY (chefe_servidor_id) REFERENCES servidores (id);

-- ---------------------------------------------------------------------
-- Grupos
-- ---------------------------------------------------------------------
CREATE TABLE grupos (
  id               SERIAL PRIMARY KEY,
  setor_id         INTEGER     NOT NULL REFERENCES setores (id),
  nome             TEXT        NOT NULL,
  descricao        TEXT,
  meta_referencia  NUMERIC(10, 4),
  meta_definida_em TIMESTAMPTZ,
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  excluido_em      TIMESTAMPTZ,
  CONSTRAINT grupos_meta_positiva CHECK (meta_referencia IS NULL OR meta_referencia > 0)
);
CREATE UNIQUE INDEX grupos_nome_unico_por_setor
  ON grupos (setor_id, lower(nome)) WHERE excluido_em IS NULL;

ALTER TABLE servidores
  ADD CONSTRAINT servidores_grupo_fk FOREIGN KEY (grupo_id) REFERENCES grupos (id);

-- ---------------------------------------------------------------------
-- Tabela de complexidade (niveis 1 a 4)
-- ---------------------------------------------------------------------
CREATE TABLE niveis_complexidade (
  nivel         SMALLINT PRIMARY KEY CHECK (nivel BETWEEN 1 AND 4),
  rotulo        TEXT        NOT NULL,
  criterio      TEXT        NOT NULL,
  ativo         BOOLEAN     NOT NULL DEFAULT TRUE,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Parametros do sistema (pesos por papel, faixas de atingimento)
-- ---------------------------------------------------------------------
CREATE TABLE parametros (
  chave          TEXT PRIMARY KEY,
  valor          NUMERIC(10, 4) NOT NULL,
  descricao      TEXT           NOT NULL,
  atualizado_em  TIMESTAMPTZ    NOT NULL DEFAULT now(),
  atualizado_por INTEGER REFERENCES servidores (id)
);

-- ---------------------------------------------------------------------
-- Feriados
-- ---------------------------------------------------------------------
CREATE TABLE feriados (
  id        SERIAL PRIMARY KEY,
  data      DATE NOT NULL UNIQUE,
  descricao TEXT NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Lancamentos de producao
-- ---------------------------------------------------------------------
CREATE TABLE lancamentos (
  id                 BIGSERIAL PRIMARY KEY,
  servidor_id        INTEGER            NOT NULL REFERENCES servidores (id),
  processo           TEXT               NOT NULL,
  descricao          TEXT,
  nivel              SMALLINT           NOT NULL CHECK (nivel BETWEEN 1 AND 4),
  papel              papel_lancamento   NOT NULL,
  quantidade         NUMERIC(10, 2)     NOT NULL DEFAULT 1 CHECK (quantidade > 0),
  data_conclusao     DATE               NOT NULL,
  competencia        DATE GENERATED ALWAYS AS (
                       make_date(
                         EXTRACT(YEAR  FROM data_conclusao)::INT,
                         EXTRACT(MONTH FROM data_conclusao)::INT,
                         1
                       )
                     ) STORED,
  periodo_inicio     DATE,
  periodo_fim        DATE,
  link_externo       TEXT,
  status             status_lancamento  NOT NULL DEFAULT 'CONCLUIDO',
  situacao           situacao_validacao NOT NULL DEFAULT 'PENDENTE',
  -- valores congelados no momento do registro
  nivel_aplicado     SMALLINT           NOT NULL CHECK (nivel_aplicado BETWEEN 1 AND 4),
  percentual_papel   NUMERIC(6, 2)      NOT NULL CHECK (percentual_papel >= 0),
  pontos             NUMERIC(12, 4) GENERATED ALWAYS AS (
                       nivel_aplicado::NUMERIC * quantidade * percentual_papel / 100
                     ) STORED,
  -- trilha da correcao de nivel feita pela chefia
  nivel_original     SMALLINT,
  nivel_alterado_por INTEGER REFERENCES servidores (id),
  nivel_alterado_em  TIMESTAMPTZ,
  -- trilha da validacao
  justificativa      TEXT,
  validado_por       INTEGER REFERENCES servidores (id),
  validado_em        TIMESTAMPTZ,
  criado_por         INTEGER            NOT NULL REFERENCES servidores (id),
  criado_em          TIMESTAMPTZ        NOT NULL DEFAULT now(),
  atualizado_em      TIMESTAMPTZ        NOT NULL DEFAULT now(),
  excluido_em        TIMESTAMPTZ,
  CONSTRAINT lancamentos_periodo_coerente
    CHECK (periodo_inicio IS NULL OR periodo_fim IS NULL OR periodo_fim >= periodo_inicio)
);

-- Regra 2.3: processo + nivel + servidor + papel e unico entre os lancamentos vivos
CREATE UNIQUE INDEX lancamentos_sem_duplicidade
  ON lancamentos (upper(processo), nivel, servidor_id, papel)
  WHERE excluido_em IS NULL;

CREATE INDEX lancamentos_por_competencia ON lancamentos (competencia) WHERE excluido_em IS NULL;
CREATE INDEX lancamentos_por_servidor    ON lancamentos (servidor_id, competencia) WHERE excluido_em IS NULL;
CREATE INDEX lancamentos_por_processo    ON lancamentos (upper(processo)) WHERE excluido_em IS NULL;

-- ---------------------------------------------------------------------
-- Ausencias
-- ---------------------------------------------------------------------
CREATE TABLE ausencias (
  id          BIGSERIAL PRIMARY KEY,
  servidor_id INTEGER       NOT NULL REFERENCES servidores (id),
  tipo        tipo_ausencia NOT NULL,
  data_inicio DATE          NOT NULL,
  data_fim    DATE          NOT NULL,
  observacao  TEXT,
  criado_por  INTEGER       NOT NULL REFERENCES servidores (id),
  criado_em   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  excluido_em TIMESTAMPTZ,
  CONSTRAINT ausencias_intervalo_coerente CHECK (data_fim >= data_inicio)
);
CREATE INDEX ausencias_por_servidor ON ausencias (servidor_id, data_inicio, data_fim) WHERE excluido_em IS NULL;

-- ---------------------------------------------------------------------
-- Fechamento mensal (consolidado congelado)
-- ---------------------------------------------------------------------
CREATE TABLE fechamentos (
  id                       SERIAL PRIMARY KEY,
  setor_id                 INTEGER     NOT NULL REFERENCES setores (id),
  competencia              DATE        NOT NULL,
  versao                   INTEGER     NOT NULL DEFAULT 1,
  vigente                  BOOLEAN     NOT NULL DEFAULT TRUE,
  media_setor_oficial      NUMERIC(12, 4),
  media_setor_contraprova  NUMERIC(12, 4),
  total_pontos             NUMERIC(14, 4),
  total_dias_efetivos      NUMERIC(10, 2),
  processos_distintos      INTEGER,
  servidores_apurados      INTEGER,
  servidores_sem_apuracao  INTEGER,
  fechado_por              INTEGER     NOT NULL REFERENCES servidores (id),
  fechado_em               TIMESTAMPTZ NOT NULL DEFAULT now(),
  reaberto_por             INTEGER REFERENCES servidores (id),
  reaberto_em              TIMESTAMPTZ,
  justificativa_reabertura TEXT,
  CONSTRAINT fechamentos_versao_unica UNIQUE (setor_id, competencia, versao)
);
CREATE INDEX fechamentos_vigentes ON fechamentos (setor_id, competencia) WHERE vigente AND reaberto_em IS NULL;

CREATE TABLE fechamento_grupos (
  id             BIGSERIAL PRIMARY KEY,
  fechamento_id  INTEGER           NOT NULL REFERENCES fechamentos (id) ON DELETE CASCADE,
  grupo_id       INTEGER           NOT NULL REFERENCES grupos (id),
  referencia     NUMERIC(12, 4),
  origem         origem_referencia NOT NULL,
  meta_definida_em TIMESTAMPTZ,
  servidores_considerados INTEGER  NOT NULL DEFAULT 0,
  UNIQUE (fechamento_id, grupo_id)
);

CREATE TABLE fechamento_servidores (
  id                BIGSERIAL PRIMARY KEY,
  fechamento_id     INTEGER           NOT NULL REFERENCES fechamentos (id) ON DELETE CASCADE,
  servidor_id       INTEGER           NOT NULL REFERENCES servidores (id),
  grupo_id          INTEGER REFERENCES grupos (id),
  situacao          situacao_apuracao NOT NULL,
  pontos_total      NUMERIC(12, 4)    NOT NULL DEFAULT 0,
  pontos_base       NUMERIC(12, 4)    NOT NULL DEFAULT 0,
  pontos_pendentes  NUMERIC(12, 4)    NOT NULL DEFAULT 0,
  dias_uteis        INTEGER           NOT NULL DEFAULT 0,
  dias_ausencia     INTEGER           NOT NULL DEFAULT 0,
  dias_efetivos     INTEGER           NOT NULL DEFAULT 0,
  media             NUMERIC(12, 4),
  media_base        NUMERIC(12, 4),
  referencia        NUMERIC(12, 4),
  origem_referencia origem_referencia NOT NULL DEFAULT 'INDISPONIVEL',
  atingimento       NUMERIC(12, 4),
  faixa             TEXT,
  UNIQUE (fechamento_id, servidor_id)
);

-- ---------------------------------------------------------------------
-- Auditoria
-- ---------------------------------------------------------------------
CREATE TABLE auditoria (
  id             BIGSERIAL PRIMARY KEY,
  entidade       TEXT           NOT NULL,
  entidade_id    TEXT,
  acao           acao_auditoria NOT NULL,
  usuario_id     INTEGER REFERENCES servidores (id),
  usuario_nome   TEXT,
  valor_anterior JSONB,
  valor_novo     JSONB,
  contexto       TEXT,
  ocorrido_em    TIMESTAMPTZ    NOT NULL DEFAULT now()
);
CREATE INDEX auditoria_por_entidade ON auditoria (entidade, entidade_id, ocorrido_em DESC);
CREATE INDEX auditoria_por_usuario  ON auditoria (usuario_id, ocorrido_em DESC);

-- ---------------------------------------------------------------------
-- Sessoes (connect-pg-simple)
-- ---------------------------------------------------------------------
CREATE TABLE sessoes (
  sid    VARCHAR PRIMARY KEY,
  sess   JSON        NOT NULL,
  expire TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessoes_expiram ON sessoes (expire);
