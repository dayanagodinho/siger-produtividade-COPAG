-- =====================================================================
-- 004 - Numero do processo passa a ser opcional
-- Nem toda producao do setor esta amarrada a um processo. Quem informa
-- entra na contagem de processos distintos e na trava de duplicidade;
-- quem nao informa, nao. O indice unico ja ignora nulos, entao a regra
-- passa a valer apenas para os lancamentos que trazem o numero.
-- =====================================================================

ALTER TABLE lancamentos ALTER COLUMN processo DROP NOT NULL;

-- Texto vazio vindo do formulario vira nulo, para nao competir com o nulo
-- de verdade na contagem de processos distintos.
UPDATE lancamentos SET processo = NULL WHERE btrim(processo) = '';

ALTER TABLE lancamentos
  ADD CONSTRAINT lancamentos_processo_nao_vazio
  CHECK (processo IS NULL OR btrim(processo) <> '');
