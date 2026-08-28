-- =====================================================================
-- 008 - Atividades em arvore, com rotulo curto e texto oficial
--
-- A lista da COPAG nao e plana: "Valor Liquido Negativo" so faz sentido
-- debaixo de "Gerar relatorios de conferencia", que por sua vez pende de
-- "Gerir a folha de pagamento". Os niveis de cima organizam e somam, mas
-- nao descrevem trabalho concreto: sao agrupadores, e lancar neles faria
-- o mesmo trabalho entrar duas vezes.
-- =====================================================================

-- O CSV identifica o grupo por um codigo estavel, e nao pelo nome por
-- extenso, que a Coordenacao pode reescrever a qualquer momento.
ALTER TABLE grupos ADD COLUMN codigo TEXT;
CREATE UNIQUE INDEX grupos_codigo_unico
  ON grupos (setor_id, upper(codigo)) WHERE excluido_em IS NULL AND codigo IS NOT NULL;

UPDATE grupos SET codigo = 'EFETIVOS'
  WHERE codigo IS NULL AND excluido_em IS NULL AND nome ILIKE '%efetivos%';
UPDATE grupos SET codigo = 'INATIVOS_PENSIONISTAS'
  WHERE codigo IS NULL AND excluido_em IS NULL AND nome ILIKE '%inativos%';
UPDATE grupos SET codigo = 'PARLAMENTARES'
  WHERE codigo IS NULL AND excluido_em IS NULL AND nome ILIKE '%parlamentares%';
UPDATE grupos SET codigo = 'COMISSIONADOS'
  WHERE codigo IS NULL AND excluido_em IS NULL AND nome ILIKE '%comissionados%';

-- ---------------------------------------------------------------------
-- A arvore
-- ---------------------------------------------------------------------
ALTER TABLE atividades ADD COLUMN atividade_pai_id INTEGER REFERENCES atividades (id);
ALTER TABLE atividades ADD COLUMN nivel_hierarquia SMALLINT NOT NULL DEFAULT 1
  CHECK (nivel_hierarquia BETWEEN 1 AND 5);

-- Agrupador organiza; so a folha recebe lancamento.
ALTER TABLE atividades ADD COLUMN lancavel BOOLEAN NOT NULL DEFAULT TRUE;

-- Quinze atividades de folha pedem de qual folha se trata. As demais nem
-- mostram o campo.
ALTER TABLE atividades ADD COLUMN usa_tipo_folha BOOLEAN NOT NULL DEFAULT FALSE;

-- `nome` passa a ser o rotulo curto, que cabe em lista e seletor; a redacao
-- oficial do plano de trabalho fica inteira ao lado, para o detalhe e a
-- exportacao. Nada e descartado.
ALTER TABLE atividades ADD COLUMN texto_completo TEXT;
UPDATE atividades SET texto_completo = nome WHERE texto_completo IS NULL;

-- O mesmo rotulo curto se repete dentro de um grupo — "Prestar informacoes
-- aos interessados" aparece sob dois pais diferentes, e sao doze casos
-- assim na lista da COPAG. Exigir nome unico por grupo impediria a carga.
DROP INDEX atividades_nome_unico_por_grupo;

-- O codigo hierarquico ("1", "1.3", "1.3.4") e que passa a identificar a
-- atividade dentro do grupo. Duplicatas herdadas da carga anterior perdem o
-- codigo em vez de travar a migracao.
UPDATE atividades a SET numero = NULL
  WHERE numero IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM atividades b
       WHERE b.grupo_id = a.grupo_id AND b.numero = a.numero
         AND b.excluido_em IS NULL AND a.excluido_em IS NULL AND b.id < a.id
    );

-- A ordem do arquivo e a ordem que a Coordenacao quer ver: "1", "1.1",
-- "1.3.1", "2". Deduzir isso do codigo em tempo de consulta exigiria quebrar
-- texto em numeros a cada busca, e quebraria no dia em que um codigo fugir do
-- formato. Gravar a posicao na carga custa uma coluna e nunca erra.
ALTER TABLE atividades ADD COLUMN ordem INTEGER NOT NULL DEFAULT 0;

-- Chave de reimportacao: e o codigo hierarquico quando existe e, quando nao,
-- o pai somado a redacao oficial. E ela que deixa a Coordenacao recarregar a
-- lista quantas vezes quiser sem duplicar o que ja esta gravado.
ALTER TABLE atividades ADD COLUMN chave_importacao TEXT;
CREATE UNIQUE INDEX atividades_chave_importacao
  ON atividades (grupo_id, chave_importacao)
  WHERE excluido_em IS NULL AND chave_importacao IS NOT NULL;

CREATE UNIQUE INDEX atividades_codigo_unico_por_grupo
  ON atividades (grupo_id, numero) WHERE excluido_em IS NULL AND numero IS NOT NULL;
CREATE INDEX atividades_por_pai ON atividades (atividade_pai_id) WHERE excluido_em IS NULL;
CREATE INDEX atividades_lancaveis
  ON atividades (grupo_id) WHERE excluido_em IS NULL AND ativa AND lancavel;

-- ---------------------------------------------------------------------
-- Tipo de folha no lancamento
-- ---------------------------------------------------------------------
-- Fica no lancamento, e nao na atividade: quatro tipos vezes cada atividade
-- de folha inchariam a lista sem necessidade, e assim o tipo vira dimensao
-- de filtro nos relatorios — util quando a gratificacao natalina concentrar
-- trabalho em novembro e dezembro.
CREATE TYPE tipo_de_folha AS ENUM (
  'NORMAL', 'COMPLEMENTAR', 'ADIANTAMENTO_GRATIFICACAO', 'GRATIFICACAO_NATALINA'
);
ALTER TABLE lancamentos ADD COLUMN tipo_folha tipo_de_folha;

-- ---------------------------------------------------------------------
-- Sem trava de duplicidade
-- ---------------------------------------------------------------------
-- A mesma atividade se repete varias vezes no mes, e isso e o trabalho
-- normal da COPAG, nao erro. O controle contra lancamento indevido e a
-- conferencia da chefia, que ja existe.
DROP INDEX lancamentos_sem_duplicidade;

-- ---------------------------------------------------------------------
-- Detalhamento vira galho da arvore
-- ---------------------------------------------------------------------
-- A tabela de detalhamentos existia porque a atividade era plana e precisava
-- de uma lista de apoio pendurada. Com a arvore, o detalhamento e uma
-- atividade filha como qualquer outra — e, ao contrario da lista de apoio,
-- pode receber lancamento, que e o que a COPAG faz na pratica.
DROP TABLE IF EXISTS detalhamentos;
