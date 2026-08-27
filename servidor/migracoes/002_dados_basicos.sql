-- =====================================================================
-- 002 - Conteudo basico do sistema: tabela de complexidade e parametros
-- =====================================================================

INSERT INTO niveis_complexidade (nivel, rotulo, criterio) VALUES
  (1, 'Simples',       'Rotina padronizada, documentação completa, sem exceções.'),
  (2, 'Intermediário', 'Volume moderado de documentos ou registros.'),
  (3, 'Complexo',      'Múltiplas retenções, maior volume, ou análise não trivial.'),
  (4, 'Excepcional',   'Alto risco, situação inédita ou que exige consulta/parecer.')
ON CONFLICT (nivel) DO NOTHING;

INSERT INTO parametros (chave, valor, descricao) VALUES
  ('PESO_EXECUCAO',      100, 'Percentual do nível aplicado a lançamentos com papel Execução.'),
  ('PESO_REVISAO',        40, 'Percentual do nível aplicado a lançamentos com papel Revisão.'),
  ('PESO_HOMOLOGACAO',    20, 'Percentual do nível aplicado a lançamentos com papel Homologação.'),
  ('FAIXA_ABAIXO',        85, 'Atingimento abaixo deste percentual é classificado como Abaixo da referência.'),
  ('FAIXA_ACIMA',        115, 'Atingimento acima deste percentual é classificado como Acima da referência.')
ON CONFLICT (chave) DO NOTHING;
