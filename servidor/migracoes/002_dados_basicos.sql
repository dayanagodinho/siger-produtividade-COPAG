-- =====================================================================
-- 002 - Conteudo basico do sistema: tabela de complexidade e parametros
-- =====================================================================

INSERT INTO niveis_complexidade (nivel, rotulo, criterio) VALUES
  (1, 'Simples',       'Rotina padronizada, documentacao completa, sem excecoes.'),
  (2, 'Intermediario', 'Volume moderado de documentos ou registros.'),
  (3, 'Complexo',      'Multiplas retencoes, maior volume, ou analise nao trivial.'),
  (4, 'Excepcional',   'Alto risco, situacao inedita ou que exige consulta/parecer.')
ON CONFLICT (nivel) DO NOTHING;

INSERT INTO parametros (chave, valor, descricao) VALUES
  ('PESO_EXECUCAO',      100, 'Percentual do nivel aplicado a lancamentos com papel Execucao.'),
  ('PESO_REVISAO',        40, 'Percentual do nivel aplicado a lancamentos com papel Revisao.'),
  ('PESO_HOMOLOGACAO',    20, 'Percentual do nivel aplicado a lancamentos com papel Homologacao.'),
  ('FAIXA_ABAIXO',        85, 'Atingimento abaixo deste percentual e classificado como Abaixo da referencia.'),
  ('FAIXA_ACIMA',        115, 'Atingimento acima deste percentual e classificado como Acima da referencia.')
ON CONFLICT (chave) DO NOTHING;
