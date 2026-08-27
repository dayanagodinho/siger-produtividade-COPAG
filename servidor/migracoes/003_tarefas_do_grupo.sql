-- =====================================================================
-- 003 - Catalogo de tarefas por grupo
-- Cada grupo tem a sua lista de tarefas tipicas, com o nivel sugerido.
-- O servidor escolhe a tarefa no lancamento em vez de descrever do zero,
-- e o nivel ja vem preenchido pelo catalogo.
-- =====================================================================

CREATE TABLE tarefas (
  id             SERIAL PRIMARY KEY,
  grupo_id       INTEGER     NOT NULL REFERENCES grupos (id),
  nome           TEXT        NOT NULL,
  descricao      TEXT,
  nivel_sugerido SMALLINT    NOT NULL CHECK (nivel_sugerido BETWEEN 1 AND 4),
  ativa          BOOLEAN     NOT NULL DEFAULT TRUE,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  excluido_em    TIMESTAMPTZ
);

CREATE UNIQUE INDEX tarefas_nome_unico_por_grupo
  ON tarefas (grupo_id, lower(nome)) WHERE excluido_em IS NULL;
CREATE INDEX tarefas_por_grupo ON tarefas (grupo_id) WHERE excluido_em IS NULL AND ativa;

-- O lancamento guarda de qual tarefa do catalogo veio, quando veio de uma.
-- O nivel continua no proprio lancamento: o catalogo sugere, o servidor
-- confirma ou ajusta, e a chefia valida.
ALTER TABLE lancamentos
  ADD COLUMN tarefa_id INTEGER REFERENCES tarefas (id);

CREATE INDEX lancamentos_por_tarefa ON lancamentos (tarefa_id) WHERE excluido_em IS NULL;
