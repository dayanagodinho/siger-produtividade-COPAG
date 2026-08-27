import { Router } from 'express';
import { z } from 'zod';
import { consultar, consultarUm } from '../infra/banco';
import { registrarAuditoria, semSegredos } from '../infra/auditoria';
import { erroDeConflito, erroDeRequisicao, erroNaoEncontrado, rota } from '../infra/erros';
import { ehAdmin, exigirAdmin, exigirAutenticacao } from '../infra/autorizacao';
import { gerarHashDeSenha, validarForcaDaSenha } from '../infra/senha';
import { dataIso, idNumerico, textoObrigatorio, validar } from '../infra/validacao';

export const rotasDeServidores = Router();
rotasDeServidores.use(exigirAutenticacao);

const CAMPOS_PUBLICOS = `
  s.id, s.matricula, s.nome, s.email, s.setor_id, s.grupo_id, s.perfil, s.regime,
  s.situacao, s.data_admissao, s.data_desligamento, s.criado_em, s.atualizado_em,
  st.nome AS setor_nome, st.sigla AS setor_sigla, g.nome AS grupo_nome`;

const esquemaBase = z.object({
  matricula: textoObrigatorio('a matricula', 30),
  nome: textoObrigatorio('o nome'),
  email: z.string().trim().email('Informe um e-mail valido.'),
  setor_id: idNumerico('o setor'),
  grupo_id: idNumerico('o grupo').nullable().optional(),
  perfil: z.enum(['SERVIDOR', 'CHEFE', 'ADMIN'], {
    errorMap: () => ({ message: 'Selecione um perfil de acesso.' }),
  }),
  regime: z.enum(['INTEGRAL', 'PARCIAL', 'PRESENCIAL'], {
    errorMap: () => ({ message: 'Selecione o regime de trabalho.' }),
  }),
  situacao: z.enum(['ATIVO', 'INATIVO']).optional().default('ATIVO'),
  data_admissao: dataIso,
  data_desligamento: dataIso.nullable().optional(),
});

const esquemaCriacao = esquemaBase.extend({
  senha: z.string().min(1, 'Informe a senha inicial.'),
});

/** Servidor ve so a si mesmo; chefe ve o proprio setor; administrador ve todos. */
rotasDeServidores.get(
  '/',
  rota(async (req, res) => {
    const usuario = req.usuario!;
    const filtroSetor = req.query.setor_id ? Number(req.query.setor_id) : null;
    const filtroGrupo = req.query.grupo_id ? Number(req.query.grupo_id) : null;
    const incluirInativos = req.query.incluir_inativos === 'true';

    const condicoes: string[] = ['s.excluido_em IS NULL'];
    const parametros: unknown[] = [];

    if (usuario.perfil === 'SERVIDOR') {
      parametros.push(usuario.id);
      condicoes.push(`s.id = $${parametros.length}`);
    } else if (usuario.perfil === 'CHEFE') {
      parametros.push(usuario.setor_id);
      condicoes.push(`s.setor_id = $${parametros.length}`);
    }

    if (filtroSetor) {
      parametros.push(filtroSetor);
      condicoes.push(`s.setor_id = $${parametros.length}`);
    }
    if (filtroGrupo) {
      parametros.push(filtroGrupo);
      condicoes.push(`s.grupo_id = $${parametros.length}`);
    }
    if (!incluirInativos) condicoes.push(`s.situacao = 'ATIVO'`);

    const servidores = await consultar(
      `SELECT ${CAMPOS_PUBLICOS}
         FROM servidores s
         JOIN setores st ON st.id = s.setor_id
         LEFT JOIN grupos g ON g.id = s.grupo_id
        WHERE ${condicoes.join(' AND ')}
        ORDER BY s.nome`,
      parametros,
    );
    res.json({ servidores });
  }),
);

rotasDeServidores.post(
  '/',
  exigirAdmin,
  rota(async (req, res) => {
    const dados = validar(esquemaCriacao, req.body);
    const problema = validarForcaDaSenha(dados.senha);
    if (problema) throw erroDeRequisicao(problema);
    await conferirGrupoDoSetor(dados.grupo_id ?? null, dados.setor_id);

    const senhaHash = await gerarHashDeSenha(dados.senha);
    const criado = await consultarUm<{ id: number }>(
      `INSERT INTO servidores
         (matricula, nome, email, senha_hash, setor_id, grupo_id, perfil, regime,
          situacao, data_admissao, data_desligamento)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        dados.matricula, dados.nome, dados.email, senhaHash, dados.setor_id,
        dados.grupo_id ?? null, dados.perfil, dados.regime, dados.situacao,
        dados.data_admissao, dados.data_desligamento ?? null,
      ],
    );

    const servidor = await buscarPorId(criado!.id);
    await registrarAuditoria({
      entidade: 'servidor',
      entidadeId: criado!.id,
      acao: 'CRIACAO',
      usuario: req.usuario,
      valorNovo: semSegredos(servidor as Record<string, unknown>),
    });
    res.status(201).json({ servidor });
  }),
);

rotasDeServidores.get(
  '/:id',
  rota(async (req, res) => {
    const id = Number(req.params.id);
    const usuario = req.usuario!;
    const servidor = await buscarPorId(id);
    if (!servidor) throw erroNaoEncontrado('Servidor nao encontrado.');

    const proprio = usuario.id === id;
    const doSetor = usuario.perfil === 'CHEFE' && usuario.setor_id === servidor.setor_id;
    if (!proprio && !doSetor && !ehAdmin(usuario)) {
      throw erroNaoEncontrado('Servidor nao encontrado.');
    }
    res.json({ servidor });
  }),
);

rotasDeServidores.put(
  '/:id',
  exigirAdmin,
  rota(async (req, res) => {
    const id = Number(req.params.id);
    const dados = validar(esquemaBase, req.body);
    const anterior = await buscarPorId(id);
    if (!anterior) throw erroNaoEncontrado('Servidor nao encontrado.');
    await conferirGrupoDoSetor(dados.grupo_id ?? null, dados.setor_id);

    if (dados.situacao === 'INATIVO' && anterior.perfil === 'CHEFE') {
      const chefiaAtiva = await consultarUm<{ total: number }>(
        `SELECT count(*)::int AS total FROM setores
          WHERE chefe_servidor_id = $1 AND excluido_em IS NULL`,
        [id],
      );
      if (chefiaAtiva && chefiaAtiva.total > 0) {
        throw erroDeConflito(
          'Esta pessoa e a chefe responsavel por um setor. Indique outro chefe no cadastro do setor antes de inativar.',
        );
      }
    }

    await consultarUm(
      `UPDATE servidores
          SET matricula = $1, nome = $2, email = $3, setor_id = $4, grupo_id = $5,
              perfil = $6, regime = $7, situacao = $8, data_admissao = $9,
              data_desligamento = $10, atualizado_em = now()
        WHERE id = $11 AND excluido_em IS NULL
        RETURNING id`,
      [
        dados.matricula, dados.nome, dados.email, dados.setor_id, dados.grupo_id ?? null,
        dados.perfil, dados.regime, dados.situacao, dados.data_admissao,
        dados.data_desligamento ?? null, id,
      ],
    );

    const servidor = await buscarPorId(id);
    await registrarAuditoria({
      entidade: 'servidor',
      entidadeId: id,
      acao: 'ALTERACAO',
      usuario: req.usuario,
      valorAnterior: semSegredos(anterior as Record<string, unknown>),
      valorNovo: semSegredos(servidor as Record<string, unknown>),
    });
    res.json({ servidor });
  }),
);

const esquemaRedefinicao = z.object({ senha: z.string().min(1, 'Informe a nova senha.') });

rotasDeServidores.post(
  '/:id/redefinir-senha',
  exigirAdmin,
  rota(async (req, res) => {
    const id = Number(req.params.id);
    const dados = validar(esquemaRedefinicao, req.body);
    const problema = validarForcaDaSenha(dados.senha);
    if (problema) throw erroDeRequisicao(problema);

    const alvo = await buscarPorId(id);
    if (!alvo) throw erroNaoEncontrado('Servidor nao encontrado.');

    await consultarUm(
      'UPDATE servidores SET senha_hash = $1, atualizado_em = now() WHERE id = $2 RETURNING id',
      [await gerarHashDeSenha(dados.senha), id],
    );
    await registrarAuditoria({
      entidade: 'servidor',
      entidadeId: id,
      acao: 'ALTERACAO',
      usuario: req.usuario,
      contexto: 'Senha redefinida pela administracao',
    });
    res.json({ mensagem: 'Senha redefinida.' });
  }),
);

rotasDeServidores.delete(
  '/:id',
  exigirAdmin,
  rota(async (req, res) => {
    const id = Number(req.params.id);
    const anterior = await buscarPorId(id);
    if (!anterior) throw erroNaoEncontrado('Servidor nao encontrado.');
    if (id === req.usuario!.id) {
      throw erroDeConflito('Voce nao pode excluir o proprio cadastro.');
    }

    const lancamentos = await consultarUm<{ total: number }>(
      'SELECT count(*)::int AS total FROM lancamentos WHERE servidor_id = $1 AND excluido_em IS NULL',
      [id],
    );
    if (lancamentos && lancamentos.total > 0) {
      throw erroDeConflito(
        `Esta pessoa tem ${lancamentos.total} lancamento(s) registrado(s) e o historico precisa ser preservado. Mude a situacao para Inativo em vez de excluir.`,
      );
    }

    await consultarUm(
      `UPDATE servidores SET excluido_em = now(), situacao = 'INATIVO' WHERE id = $1 RETURNING id`,
      [id],
    );
    await registrarAuditoria({
      entidade: 'servidor',
      entidadeId: id,
      acao: 'EXCLUSAO',
      usuario: req.usuario,
      valorAnterior: semSegredos(anterior as Record<string, unknown>),
    });
    res.json({ mensagem: 'Servidor excluido.' });
  }),
);

interface ServidorCompleto extends Record<string, unknown> {
  id: number;
  setor_id: number;
  perfil: 'SERVIDOR' | 'CHEFE' | 'ADMIN';
}

async function buscarPorId(id: number): Promise<ServidorCompleto | null> {
  return consultarUm<ServidorCompleto>(
    `SELECT ${CAMPOS_PUBLICOS}
       FROM servidores s
       JOIN setores st ON st.id = s.setor_id
       LEFT JOIN grupos g ON g.id = s.grupo_id
      WHERE s.id = $1 AND s.excluido_em IS NULL`,
    [id],
  );
}

/** O grupo precisa pertencer ao setor do servidor, senao a apuracao mistura equipes. */
async function conferirGrupoDoSetor(grupoId: number | null, setorId: number): Promise<void> {
  if (!grupoId) return;
  const grupo = await consultarUm<{ setor_id: number }>(
    'SELECT setor_id FROM grupos WHERE id = $1 AND excluido_em IS NULL',
    [grupoId],
  );
  if (!grupo) throw erroDeRequisicao('Grupo nao encontrado.');
  if (grupo.setor_id !== setorId) {
    throw erroDeRequisicao('O grupo escolhido pertence a outro setor. Selecione um grupo do setor indicado.');
  }
}
