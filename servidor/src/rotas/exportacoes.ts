import { Router } from 'express';
import ExcelJS from 'exceljs';
import type { Response } from 'express';
import { consultar } from '../infra/banco';
import { rota } from '../infra/erros';
import {
  exigirAutenticacao,
  exigirChefia,
  garantirAcessoAoServidor,
  garantirSetorSobGestao,
} from '../infra/autorizacao';
import { competenciaValida, validar } from '../infra/validacao';
import { competenciaAtual, rotularCompetencia } from '../dominio/datas';
import { apurarCompetencia } from '../dominio/apuracao';
import { ROTULO_DA_FAIXA } from '../dominio/calculo';

export const rotasDeExportacao = Router();
rotasDeExportacao.use(exigirAutenticacao);

const ROTULO_DO_PAPEL: Record<string, string> = {
  EXECUCAO: 'Execução',
  REVISAO: 'Revisão',
  HOMOLOGACAO: 'Homologação',
};
const ROTULO_DA_SITUACAO: Record<string, string> = {
  PENDENTE: 'Pendente',
  VALIDADO: 'Validado',
  DEVOLVIDO: 'Devolvido',
};

function prepararPlanilha(nome: string): { livro: ExcelJS.Workbook; aba: ExcelJS.Worksheet } {
  const livro = new ExcelJS.Workbook();
  livro.creator = 'Controle de Produtividade';
  livro.created = new Date();
  const aba = livro.addWorksheet(nome, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  return { livro, aba };
}

function estilizarCabecalho(aba: ExcelJS.Worksheet): void {
  const linha = aba.getRow(1);
  linha.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  linha.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3B57' } };
  linha.alignment = { vertical: 'middle' };
  linha.height = 20;
}

async function enviar(res: Response, livro: ExcelJS.Workbook, arquivo: string): Promise<void> {
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', `attachment; filename="${arquivo}"`);
  await livro.xlsx.write(res);
  res.end();
}

/** Exportacao dos lancamentos, usada na tela do servidor e no painel do setor. */
rotasDeExportacao.get(
  '/lancamentos.xlsx',
  rota(async (req, res) => {
    const usuario = req.usuario!;
    const competencia = req.query.competencia
      ? validar(competenciaValida, req.query.competencia)
      : competenciaAtual();

    const condicoes = ['l.excluido_em IS NULL', 'l.competencia = $1'];
    const parametros: unknown[] = [competencia];

    const servidorId = req.query.servidor_id ? Number(req.query.servidor_id) : null;
    if (servidorId) {
      await garantirAcessoAoServidor(usuario, servidorId);
      parametros.push(servidorId);
      condicoes.push(`l.servidor_id = $${parametros.length}`);
    } else if (usuario.perfil === 'SERVIDOR') {
      parametros.push(usuario.id);
      condicoes.push(`l.servidor_id = $${parametros.length}`);
    } else if (usuario.perfil === 'CHEFE') {
      parametros.push(usuario.setor_id);
      condicoes.push(`s.setor_id = $${parametros.length}`);
    }

    const lancamentos = await consultar<Record<string, unknown>>(
      `SELECT l.processo, l.descricao, l.nivel, l.papel, l.quantidade, l.percentual_papel,
              l.pontos, l.data_conclusao, l.status, l.situacao, l.nivel_original,
              l.justificativa, s.nome AS servidor_nome, s.matricula, g.nome AS grupo_nome,
              v.nome AS validado_por_nome, a.numero AS atividade_numero, a.nome AS atividade_nome
         FROM lancamentos l
         LEFT JOIN atividades a ON a.id = l.atividade_id
         JOIN servidores s ON s.id = l.servidor_id
         LEFT JOIN grupos g ON g.id = s.grupo_id
         LEFT JOIN servidores v ON v.id = l.validado_por
        WHERE ${condicoes.join(' AND ')}
        ORDER BY s.nome, l.data_conclusao`,
      parametros,
    );

    const { livro, aba } = prepararPlanilha('Lançamentos');
    aba.columns = [
      { header: 'Matrícula', key: 'matricula', width: 12 },
      { header: 'Servidor', key: 'servidor_nome', width: 28 },
      { header: 'Grupo', key: 'grupo_nome', width: 22 },
      { header: 'Processo', key: 'processo', width: 18 },
      { header: 'Descrição', key: 'descricao', width: 44 },
      { header: 'Nível', key: 'nivel', width: 8 },
      { header: 'Nível declarado', key: 'nivel_original', width: 15 },
      { header: 'Papel', key: 'papel', width: 14 },
      { header: 'Quantidade', key: 'quantidade', width: 12 },
      { header: 'Peso do papel (%)', key: 'percentual_papel', width: 17 },
      { header: 'Pontos', key: 'pontos', width: 10 },
      { header: 'Conclusão', key: 'data_conclusao', width: 12 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Validação', key: 'situacao', width: 12 },
      { header: 'Validado por', key: 'validado_por_nome', width: 26 },
      { header: 'Justificativa', key: 'justificativa', width: 44 },
    ];
    estilizarCabecalho(aba);

    for (const lancamento of lancamentos) {
      aba.addRow({
        ...lancamento,
        papel: ROTULO_DO_PAPEL[String(lancamento.papel)] ?? lancamento.papel,
        situacao: ROTULO_DA_SITUACAO[String(lancamento.situacao)] ?? lancamento.situacao,
        status: lancamento.status === 'CONCLUIDO' ? 'Concluído' : 'Em andamento',
        nivel_original: lancamento.nivel_original ?? '',
      });
    }
    aba.getColumn('pontos').numFmt = '0.00';

    await enviar(res, livro, `lançamentos-${competencia.slice(0, 7)}.xlsx`);
  }),
);

/** Exportacao do painel do setor: uma aba de servidores e outra de grupos. */
rotasDeExportacao.get(
  '/painel-setor.xlsx',
  exigirChefia,
  rota(async (req, res) => {
    const usuario = req.usuario!;
    const setorId = req.query.setor_id ? Number(req.query.setor_id) : usuario.setor_id;
    garantirSetorSobGestao(usuario, setorId);
    const competencia = req.query.competencia
      ? validar(competenciaValida, req.query.competencia)
      : competenciaAtual();

    const apuracao = await apurarCompetencia(setorId, competencia);
    const { livro, aba } = prepararPlanilha('Servidores');

    aba.columns = [
      { header: 'Matrícula', key: 'matricula', width: 12 },
      { header: 'Servidor', key: 'nome', width: 28 },
      { header: 'Grupo', key: 'grupo_nome', width: 22 },
      { header: 'Situação', key: 'situacao', width: 15 },
      { header: 'Pontos que contam', key: 'pontos_total', width: 17 },
      { header: 'Pontos sem homologação', key: 'pontos_base', width: 22 },
      { header: 'Ainda não conferidos', key: 'pontos_pendentes', width: 20 },
      { header: 'Dias úteis', key: 'dias_uteis', width: 11 },
      { header: 'Dias de ausência', key: 'dias_ausencia', width: 16 },
      { header: 'Dias efetivos', key: 'dias_efetivos', width: 13 },
      { header: 'Média', key: 'media', width: 10 },
      { header: 'Referência do grupo', key: 'referencia', width: 19 },
      { header: 'Atingimento', key: 'atingimento', width: 13 },
      { header: 'Faixa', key: 'faixa', width: 22 },
      { header: 'Nível 1', key: 'n1', width: 8 },
      { header: 'Nível 2', key: 'n2', width: 8 },
      { header: 'Nível 3', key: 'n3', width: 8 },
      { header: 'Nível 4', key: 'n4', width: 8 },
      { header: 'Taxa de correção', key: 'taxa_correcao', width: 17 },
    ];
    estilizarCabecalho(aba);

    for (const servidor of apuracao.servidores) {
      aba.addRow({
        ...servidor,
        situacao: servidor.situacao === 'APURADO' ? 'Apurado' : 'Sem apuração',
        faixa: servidor.faixa ? ROTULO_DA_FAIXA[servidor.faixa] : 'Sem referência',
        n1: servidor.distribuicao_niveis[1],
        n2: servidor.distribuicao_niveis[2],
        n3: servidor.distribuicao_niveis[3],
        n4: servidor.distribuicao_niveis[4],
      });
    }
    for (const coluna of ['media', 'referencia', 'pontos_total', 'pontos_base', 'pontos_pendentes']) {
      aba.getColumn(coluna).numFmt = '0.0000';
    }
    aba.getColumn('atingimento').numFmt = '0.0%';
    aba.getColumn('taxa_correcao').numFmt = '0.0%';

    const abaGrupos = livro.addWorksheet('Grupos');
    abaGrupos.columns = [
      { header: 'Grupo', key: 'nome', width: 28 },
      { header: 'Referência', key: 'referencia', width: 14 },
      { header: 'Origem', key: 'origem', width: 26 },
      { header: 'Servidores considerados', key: 'servidores_considerados', width: 23 },
    ];
    estilizarCabecalho(abaGrupos);
    for (const grupo of apuracao.grupos) {
      abaGrupos.addRow({
        ...grupo,
        origem:
          grupo.origem === 'META_FIXA'
            ? 'Meta fixa'
            : grupo.origem === 'MEDIANA_APURADA'
              ? 'Referência apurada no mês'
              : 'Sem referência',
      });
    }

    const abaResumo = livro.addWorksheet('Resumo do setor');
    abaResumo.columns = [
      { header: 'Indicador', key: 'indicador', width: 42 },
      { header: 'Valor', key: 'valor', width: 16 },
    ];
    estilizarCabecalho(abaResumo);
    const resumo = apuracao.resumo;
    abaResumo.addRows([
      { indicador: 'Competência', valor: rotularCompetencia(competencia) },
      { indicador: 'Dias úteis do mês', valor: apuracao.dias_uteis },
      { indicador: 'Média do setor (oficial)', valor: resumo.media_oficial },
      { indicador: 'Média do setor (contraprova)', valor: resumo.media_contraprova },
      { indicador: 'Total de pontos', valor: resumo.total_pontos },
      { indicador: 'Total de dias efetivos', valor: resumo.total_dias_efetivos },
      { indicador: 'Processos distintos concluídos', valor: resumo.processos_distintos },
      { indicador: 'Servidores apurados', valor: resumo.servidores_apurados },
      { indicador: 'Servidores sem apuração', valor: resumo.servidores_sem_apuracao },
    ]);

    await enviar(res, livro, `painel-${apuracao.setor.sigla}-${competencia.slice(0, 7)}.xlsx`);
  }),
);
