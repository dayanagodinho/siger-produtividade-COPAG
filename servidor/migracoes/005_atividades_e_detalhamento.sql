-- =====================================================================
-- 005 - Atividades e detalhamento
-- A pontuacao e por atividade. O detalhamento descreve o que cai dentro
-- de cada atividade e serve de apoio na hora de lancar, mas nao pontua.
-- O nivel de cada atividade pode ficar em aberto ate o setor definir.
-- =====================================================================

ALTER TABLE tarefas RENAME TO atividades;
ALTER SEQUENCE tarefas_id_seq RENAME TO atividades_id_seq;

ALTER INDEX tarefas_nome_unico_por_grupo RENAME TO atividades_nome_unico_por_grupo;
ALTER INDEX tarefas_por_grupo RENAME TO atividades_por_grupo;

ALTER TABLE atividades RENAME CONSTRAINT tarefas_pkey TO atividades_pkey;

-- Numero da atividade na lista do setor e o resultado que ela entrega.
ALTER TABLE atividades ADD COLUMN numero TEXT;
ALTER TABLE atividades ADD COLUMN entrega TEXT;

-- O peso de cada atividade ainda sera definido em reuniao: ate la fica nulo,
-- e o lancamento nao chega com nivel preenchido.
ALTER TABLE atividades ALTER COLUMN nivel_sugerido DROP NOT NULL;

CREATE TABLE detalhamentos (
  id           SERIAL PRIMARY KEY,
  atividade_id INTEGER     NOT NULL REFERENCES atividades (id) ON DELETE CASCADE,
  numero       TEXT,
  texto        TEXT        NOT NULL,
  ordem        INTEGER     NOT NULL DEFAULT 0,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX detalhamentos_por_atividade ON detalhamentos (atividade_id, ordem);

ALTER TABLE lancamentos RENAME COLUMN tarefa_id TO atividade_id;
ALTER INDEX lancamentos_por_tarefa RENAME TO lancamentos_por_atividade;
