-- =====================================================================
-- 006 - E-mail e data de admissao deixam de ser obrigatorios
-- Nem sempre quem cadastra tem o e-mail institucional e a data de
-- admissao da pessoa a mao, e exigir os dois so trava o cadastro. A
-- matricula continua sendo a identificacao obrigatoria; o e-mail vira
-- uma segunda forma de entrar, para quem tiver.
-- =====================================================================

ALTER TABLE servidores ALTER COLUMN email DROP NOT NULL;
ALTER TABLE servidores ALTER COLUMN data_admissao DROP NOT NULL;

-- Texto vazio nao e e-mail: ou tem um endereco, ou e nulo. Sem isso, duas
-- pessoas sem e-mail colidiriam no indice unico de e-mail.
ALTER TABLE servidores
  ADD CONSTRAINT servidores_email_nao_vazio
  CHECK (email IS NULL OR length(btrim(email)) > 0);
