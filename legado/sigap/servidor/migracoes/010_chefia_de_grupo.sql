-- =====================================================================
-- 010 - Dois niveis de chefia, fechamento por grupo e origem do lancamento
--
-- A COPAG tem chefia do setor inteiro e chefia de cada grupo, e o perfil
-- CHEFE nao distinguia os dois. Esta migracao prepara o terreno: os tipos,
-- as colunas e as tabelas. As regras de visibilidade que separam um do
-- outro vem na etapa seguinte.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Perfis
-- ---------------------------------------------------------------------
-- Postgres nao remove valor de enum, entao o tipo e refeito. Quem era CHEFE
-- vira CHEFE_SETOR: e o que essas pessoas de fato exercem hoje, e rebaixa-las
-- em silencio tiraria acesso de quem trabalha.
CREATE TYPE perfil_acesso_novo AS ENUM ('SERVIDOR', 'CHEFE_GRUPO', 'CHEFE_SETOR', 'ADMIN');

ALTER TABLE servidores ALTER COLUMN perfil DROP DEFAULT;
ALTER TABLE servidores
  ALTER COLUMN perfil TYPE perfil_acesso_novo
  USING (CASE perfil::text WHEN 'CHEFE' THEN 'CHEFE_SETOR' ELSE perfil::text END)::perfil_acesso_novo;
ALTER TABLE servidores ALTER COLUMN perfil SET DEFAULT 'SERVIDOR';

DROP TYPE perfil_acesso;
ALTER TYPE perfil_acesso_novo RENAME TO perfil_acesso;

-- ---------------------------------------------------------------------
-- Chefe de cada grupo
-- ---------------------------------------------------------------------
-- Um grupo tem no maximo um chefe; um servidor pode chefiar mais de um grupo.
-- O chefe de grupo continua sendo servidor de um grupo e continua apurado
-- normalmente — chefiar nao tira ninguem da propria producao.
ALTER TABLE grupos ADD COLUMN chefe_id INTEGER REFERENCES servidores (id);
CREATE INDEX grupos_por_chefe
  ON grupos (chefe_id) WHERE excluido_em IS NULL AND chefe_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- Fechamento de grupo
-- ---------------------------------------------------------------------
-- Tabela propria, e nao coluna em fechamento_grupos: aquela guarda as linhas
-- congeladas de um fechamento de setor ja existente, e o fechamento de grupo
-- precisa acontecer antes, sozinho. O de setor so e permitido depois que
-- todos os grupos fecharem.
CREATE TABLE fechamentos_grupo (
  id            SERIAL PRIMARY KEY,
  grupo_id      INTEGER     NOT NULL REFERENCES grupos (id),
  competencia   DATE        NOT NULL,
  versao        INTEGER     NOT NULL DEFAULT 1,
  vigente       BOOLEAN     NOT NULL DEFAULT TRUE,
  fechado_por   INTEGER     NOT NULL REFERENCES servidores (id),
  fechado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Reabertura so pelo administrador, e sempre com justificativa: e o que
  -- permite explicar depois por que um mes fechado mudou.
  reaberto_por  INTEGER REFERENCES servidores (id),
  reaberto_em   TIMESTAMPTZ,
  justificativa TEXT,
  CONSTRAINT fechamentos_grupo_reabertura_justificada
    CHECK (reaberto_em IS NULL OR btrim(coalesce(justificativa, '')) <> '')
);

CREATE UNIQUE INDEX fechamentos_grupo_vigente
  ON fechamentos_grupo (grupo_id, competencia) WHERE vigente AND reaberto_em IS NULL;
CREATE INDEX fechamentos_grupo_por_competencia ON fechamentos_grupo (competencia);

-- ---------------------------------------------------------------------
-- Origem do lancamento
-- ---------------------------------------------------------------------
-- A conferencia da equipe e a principal producao do chefe de grupo, e ele nao
-- pode ter de validar na fila e depois lancar isso a mao. O lancamento gerado
-- pela validacao precisa ser reconhecivel como automatico, para nao se
-- confundir com producao lancada por alguem.
CREATE TYPE origem_lancamento AS ENUM ('MANUAL', 'AUTOMATICO');
ALTER TABLE lancamentos ADD COLUMN origem origem_lancamento NOT NULL DEFAULT 'MANUAL';
ALTER TABLE lancamentos ADD COLUMN lancamento_origem_id BIGINT REFERENCES lancamentos (id);

CREATE INDEX lancamentos_por_origem
  ON lancamentos (lancamento_origem_id) WHERE lancamento_origem_id IS NOT NULL;

-- Um lancamento de origem gera no maximo uma conferencia viva. Sem isto,
-- validar, desfazer e validar de novo acumularia pontos para a chefia.
CREATE UNIQUE INDEX lancamentos_conferencia_unica
  ON lancamentos (lancamento_origem_id)
  WHERE lancamento_origem_id IS NOT NULL AND excluido_em IS NULL;
