-- =====================================================================
-- 011 - A conferencia passa a valer 30%, com piso de 1 ponto
--
-- Conferir o mes inteiro de um grupo rendia menos que executar: a 20%, o
-- chefe do grupo de Parlamentares ficaria com 0,18 ponto por dia contra
-- 0,78 de quem executa. Sobe para 30% e ganha um piso, para que conferir um
-- lancamento simples nunca valha uma fracao de ponto.
-- =====================================================================

UPDATE parametros
   SET valor = 30,
       descricao = 'Percentual do nível aplicado a lançamentos com papel Homologação.',
       atualizado_em = now()
 WHERE chave = 'PESO_HOMOLOGACAO';

INSERT INTO parametros (chave, valor, descricao) VALUES
  ('MINIMO_HOMOLOGACAO', 1,
   'Pontuação mínima de um lançamento de homologação, qualquer que seja o nível conferido.')
ON CONFLICT (chave) DO NOTHING;

-- ---------------------------------------------------------------------
-- O piso e congelado no lancamento, como ja acontece com o percentual
-- ---------------------------------------------------------------------
-- Mudar parametro nunca reescreve o passado: e por isso que percentual_papel
-- mora na linha. Se o piso fosse constante na formula, subir o minimo amanha
-- recalcularia meses ja fechados. Entao ele mora na linha tambem, e os
-- lancamentos antigos ficam com piso zero — exatamente o que valia quando
-- foram feitos.
ALTER TABLE lancamentos ADD COLUMN pontos_minimos NUMERIC(6, 2) NOT NULL DEFAULT 0
  CHECK (pontos_minimos >= 0);

ALTER TABLE lancamentos DROP COLUMN pontos;
ALTER TABLE lancamentos ADD COLUMN pontos NUMERIC(12, 4) GENERATED ALWAYS AS (
  GREATEST(nivel_aplicado::NUMERIC * quantidade * percentual_papel / 100, pontos_minimos)
) STORED;
