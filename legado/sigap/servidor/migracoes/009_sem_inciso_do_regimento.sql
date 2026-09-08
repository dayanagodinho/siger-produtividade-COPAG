-- =====================================================================
-- 009 - Fora o inciso do regimento na frente da redacao oficial
--
-- A planilha trouxe o numero do item do artigo colado no texto: "II -
-- realizar os calculos", "XVIII -Gerar DCAPs". A atividade ja carrega o
-- proprio codigo, que e o que aparece na tela, entao a lista dizia "2." de
-- um lado e "II -" do outro sobre a mesma coisa.
--
-- A carga do CSV ja passou a limpar isso na leitura; aqui vai o que ficou
-- gravado antes. O padrao exige um algarismo romano de verdade seguido de
-- separador, para que um texto que apenas comece com hifen fique intacto.
-- =====================================================================

UPDATE atividades
   SET texto_completo = overlay(
         btrim(regexp_replace(texto_completo, '^\s*(X{0,3})(IX|IV|V?I{0,3})\s*[-–—.)]\s*', ''))
         placing upper(left(btrim(regexp_replace(texto_completo, '^\s*(X{0,3})(IX|IV|V?I{0,3})\s*[-–—.)]\s*', '')), 1))
         from 1 for 1
       ),
       atualizado_em = now()
 WHERE texto_completo ~ '^\s*[IVXL]'
   AND texto_completo ~ '^\s*(X{0,3})(IX|IV|V?I{0,3})\s*[-–—.)]\s*.'
   AND btrim(regexp_replace(texto_completo, '^\s*(X{0,3})(IX|IV|V?I{0,3})\s*[-–—.)]\s*', '')) <> '';

UPDATE atividades
   SET nome = overlay(
         btrim(regexp_replace(nome, '^\s*(X{0,3})(IX|IV|V?I{0,3})\s*[-–—.)]\s*', ''))
         placing upper(left(btrim(regexp_replace(nome, '^\s*(X{0,3})(IX|IV|V?I{0,3})\s*[-–—.)]\s*', '')), 1))
         from 1 for 1
       ),
       atualizado_em = now()
 WHERE nome ~ '^\s*[IVXL]'
   AND nome ~ '^\s*(X{0,3})(IX|IV|V?I{0,3})\s*[-–—.)]\s*.'
   AND btrim(regexp_replace(nome, '^\s*(X{0,3})(IX|IV|V?I{0,3})\s*[-–—.)]\s*', '')) <> '';
