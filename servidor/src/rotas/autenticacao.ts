import { Router } from 'express';
import { z } from 'zod';
import { consultarUm } from '../infra/banco';
import { registrarAuditoria } from '../infra/auditoria';
import { erroDeAutenticacao, erroDeRequisicao, rota } from '../infra/erros';
import { conferirSenha, gerarHashDeSenha, validarForcaDaSenha } from '../infra/senha';
import { exigirAutenticacao } from '../infra/autorizacao';
import { validar } from '../infra/validacao';

export const rotasDeAutenticacao = Router();

const esquemaEntrada = z.object({
  identificacao: z.string().trim().min(1, 'Informe a matrícula ou o e-mail.'),
  senha: z.string().min(1, 'Informe a senha.'),
});

interface LinhaServidor {
  id: number;
  matricula: string;
  nome: string;
  email: string;
  perfil: 'SERVIDOR' | 'CHEFE' | 'ADMIN';
  setor_id: number;
  grupo_id: number | null;
  situacao: 'ATIVO' | 'INATIVO';
  senha_hash: string;
  setor_nome: string;
  grupo_nome: string | null;
}

rotasDeAutenticacao.post(
  '/entrar',
  rota(async (req, res) => {
    const dados = validar(esquemaEntrada, req.body);

    const servidor = await consultarUm<LinhaServidor>(
      `SELECT s.*, st.nome AS setor_nome, g.nome AS grupo_nome
         FROM servidores s
         JOIN setores st ON st.id = s.setor_id
         LEFT JOIN grupos g ON g.id = s.grupo_id
        WHERE s.excluido_em IS NULL
          AND (s.matricula = $1 OR lower(s.email) = lower($1))`,
      [dados.identificacao],
    );

    const senhaConfere = servidor ? await conferirSenha(dados.senha, servidor.senha_hash) : false;

    if (!servidor || !senhaConfere) {
      throw erroDeAutenticacao('Matrícula ou senha incorreta. Confira os dados e tente de novo.');
    }

    if (servidor.situacao !== 'ATIVO') {
      throw erroDeAutenticacao(
        'Este cadastro está inativo. Procure a administração do sistema para reativar o acesso.',
      );
    }

    req.session.usuarioId = servidor.id;
    await registrarAuditoria({
      entidade: 'sessao',
      entidadeId: servidor.id,
      acao: 'CRIACAO',
      usuario: servidor,
      contexto: 'Entrada no sistema',
    });

    res.json({ usuario: montarPerfil(servidor) });
  }),
);

rotasDeAutenticacao.post(
  '/sair',
  rota(async (req, res) => {
    const usuario = req.usuario;
    await new Promise<void>((resolver, rejeitar) => {
      req.session.destroy((erro) => (erro ? rejeitar(erro) : resolver()));
    });
    if (usuario) {
      await registrarAuditoria({
        entidade: 'sessao',
        entidadeId: usuario.id,
        acao: 'EXCLUSAO',
        usuario,
        contexto: 'Saída do sistema',
      });
    }
    res.json({ mensagem: 'Sessão encerrada.' });
  }),
);

rotasDeAutenticacao.get(
  '/eu',
  rota(async (req, res) => {
    if (!req.usuario) {
      res.status(401).json({ mensagem: 'Nenhuma sessão ativa.' });
      return;
    }
    const completo = await consultarUm<LinhaServidor>(
      `SELECT s.*, st.nome AS setor_nome, g.nome AS grupo_nome
         FROM servidores s
         JOIN setores st ON st.id = s.setor_id
         LEFT JOIN grupos g ON g.id = s.grupo_id
        WHERE s.id = $1`,
      [req.usuario.id],
    );
    res.json({ usuario: completo ? montarPerfil(completo) : null });
  }),
);

const esquemaTrocaDeSenha = z.object({
  senha_atual: z.string().min(1, 'Informe a senha atual.'),
  senha_nova: z.string().min(1, 'Informe a nova senha.'),
});

rotasDeAutenticacao.post(
  '/trocar-senha',
  exigirAutenticacao,
  rota(async (req, res) => {
    const dados = validar(esquemaTrocaDeSenha, req.body);
    const usuario = req.usuario!;

    const linha = await consultarUm<{ senha_hash: string }>(
      'SELECT senha_hash FROM servidores WHERE id = $1',
      [usuario.id],
    );
    if (!linha || !(await conferirSenha(dados.senha_atual, linha.senha_hash))) {
      throw erroDeRequisicao('A senha atual não confere. Digite de novo.');
    }

    const problema = validarForcaDaSenha(dados.senha_nova);
    if (problema) throw erroDeRequisicao(problema);

    const hash = await gerarHashDeSenha(dados.senha_nova);
    await consultarUm(
      'UPDATE servidores SET senha_hash = $1, atualizado_em = now() WHERE id = $2 RETURNING id',
      [hash, usuario.id],
    );

    await registrarAuditoria({
      entidade: 'servidor',
      entidadeId: usuario.id,
      acao: 'ALTERACAO',
      usuario,
      contexto: 'Troca da própria senha',
    });

    res.json({ mensagem: 'Senha alterada.' });
  }),
);

function montarPerfil(servidor: LinhaServidor) {
  return {
    id: servidor.id,
    matricula: servidor.matricula,
    nome: servidor.nome,
    email: servidor.email,
    perfil: servidor.perfil,
    setor_id: servidor.setor_id,
    setor_nome: servidor.setor_nome,
    grupo_id: servidor.grupo_id,
    grupo_nome: servidor.grupo_nome,
  };
}
