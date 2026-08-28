-- =====================================================================
-- 007 - Marca de demonstracao
-- Permite povoar o sistema com gente ficticia para mostrar a chefia como
-- tudo funciona, sem confundir com quem trabalha de verdade. A marca e o
-- que torna a limpeza possivel depois, sem sobra e sem duvida.
-- =====================================================================

ALTER TABLE servidores ADD COLUMN demonstracao BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX servidores_de_demonstracao ON servidores (demonstracao) WHERE demonstracao;
