import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  apurarServidor,
  apurarSetor,
  calcularAtingimento,
  calcularPontos,
  calcularReferenciaDoGrupo,
  faixaDeAtingimento,
  mediana,
  taxaDeCorrecao,
  type LancamentoParaApuracao,
} from '../src/dominio/calculo';

function lancamento(parcial: Partial<LancamentoParaApuracao>): LancamentoParaApuracao {
  return {
    servidor_id: 1,
    processo: '856481/2026',
    papel: 'EXECUCAO',
    status: 'CONCLUIDO',
    situacao: 'VALIDADO',
    pontos: 3,
    nivel: 3,
    ...parcial,
  };
}

test('pontos aplicam o percentual do papel sobre o nivel', () => {
  assert.equal(calcularPontos(3, 1, 100), 3);
  assert.equal(calcularPontos(3, 1, 40), 1.2);
  assert.equal(calcularPontos(4, 2, 20), 1.6);
});

test('mediana usa o valor central e nao a media', () => {
  assert.equal(mediana([1, 2, 30]), 2);
  assert.equal(mediana([1, 2, 3, 4]), 2.5);
  assert.equal(mediana([]), null);
});

test('o ponto conta desde o lancamento; so a devolucao tira da media', () => {
  const lancamentos = [
    lancamento({ pontos: 4 }),
    lancamento({ processo: 'A/1', situacao: 'PENDENTE', pontos: 10 }),
    lancamento({ processo: 'B/1', status: 'EM_ANDAMENTO', pontos: 10 }),
    lancamento({ processo: 'C/1', situacao: 'DEVOLVIDO', pontos: 10 }),
  ];
  const apuracao = apurarServidor(1, lancamentos, 20, 0);
  // 4 validados + 10 pendentes entram; o devolvido e o em andamento ficam fora.
  assert.equal(apuracao.pontos_total, 14);
  assert.equal(apuracao.pontos_pendentes, 10);
  assert.equal(apuracao.pontos_devolvidos, 10);
  assert.equal(apuracao.lancamentos_em_andamento, 1);
  assert.equal(apuracao.lancamentos_devolvidos, 1);
  assert.equal(apuracao.media, 0.7);
});

test('devolver um lancamento derruba a media; validar nao muda nada', () => {
  const antes = apurarServidor(1, [lancamento({ situacao: 'PENDENTE', pontos: 6 })], 10, 0);
  const validado = apurarServidor(1, [lancamento({ situacao: 'VALIDADO', pontos: 6 })], 10, 0);
  const devolvido = apurarServidor(1, [lancamento({ situacao: 'DEVOLVIDO', pontos: 6 })], 10, 0);

  assert.equal(antes.media, 0.6);
  assert.equal(validado.media, 0.6);
  assert.equal(devolvido.media, 0);
  assert.equal(devolvido.pontos_devolvidos, 6);
});

test('homologacao conta para o individuo mas fica fora da base do grupo', () => {
  const lancamentos = [
    lancamento({ pontos: 4 }),
    lancamento({ processo: 'X/1', papel: 'HOMOLOGACAO', pontos: 0.8 }),
  ];
  const apuracao = apurarServidor(1, lancamentos, 10, 0);
  assert.equal(apuracao.pontos_total, 4.8);
  assert.equal(apuracao.pontos_base, 4);
  assert.equal(apuracao.media, 0.48);
  assert.equal(apuracao.media_base, 0.4);
});

test('dias efetivos zerados marcam SEM_APURACAO em vez de media zero', () => {
  const apuracao = apurarServidor(1, [lancamento({})], 21, 21);
  assert.equal(apuracao.situacao, 'SEM_APURACAO');
  assert.equal(apuracao.media, null);
  assert.equal(apuracao.dias_efetivos, 0);
});

test('servidor sem apuracao nao entra na referencia nem na media do setor', () => {
  const trabalhou = apurarServidor(1, [lancamento({ servidor_id: 1, pontos: 20 })], 20, 0);
  const afastado = apurarServidor(2, [], 20, 20);

  const referencia = calcularReferenciaDoGrupo(null, [trabalhou.media_base, afastado.media_base]);
  assert.equal(referencia.servidores_considerados, 1);
  assert.equal(referencia.referencia, 1);

  const setor = apurarSetor([trabalhou, afastado], [lancamento({ servidor_id: 1, pontos: 20 })]);
  assert.equal(setor.media_oficial, 1);
  assert.equal(setor.servidores_sem_apuracao, 1);
  assert.equal(setor.total_dias_efetivos, 20);
});

test('meta fixa prevalece sobre a mediana apurada', () => {
  const comMeta = calcularReferenciaDoGrupo(2.5, [1, 1, 1]);
  assert.equal(comMeta.origem, 'META_FIXA');
  assert.equal(comMeta.referencia, 2.5);

  const semMeta = calcularReferenciaDoGrupo(null, [1, 2, 9]);
  assert.equal(semMeta.origem, 'MEDIANA_APURADA');
  assert.equal(semMeta.referencia, 2);

  const semNinguem = calcularReferenciaDoGrupo(null, []);
  assert.equal(semNinguem.origem, 'INDISPONIVEL');
  assert.equal(semNinguem.referencia, null);
});

test('faixas de atingimento seguem os limites de 85% e 115%', () => {
  assert.equal(faixaDeAtingimento(0.849), 'ABAIXO');
  assert.equal(faixaDeAtingimento(0.85), 'DENTRO');
  assert.equal(faixaDeAtingimento(1.15), 'DENTRO');
  assert.equal(faixaDeAtingimento(1.1501), 'ACIMA');
  assert.equal(calcularAtingimento(1.2, 1), 1.2);
  assert.equal(calcularAtingimento(1.2, null), null);
});

test('media oficial e contraprova divergem quando os dias efetivos diferem', () => {
  const rapido = apurarServidor(1, [lancamento({ servidor_id: 1, pontos: 10 })], 5, 0);
  const lento = apurarServidor(2, [lancamento({ servidor_id: 2, processo: 'B/2', pontos: 10 })], 20, 0);
  const setor = apurarSetor([rapido, lento], [
    lancamento({ servidor_id: 1, pontos: 10 }),
    lancamento({ servidor_id: 2, processo: 'B/2', pontos: 10 }),
  ]);
  assert.equal(setor.media_oficial, 1.25); // (2 + 0.5) / 2
  assert.equal(setor.media_contraprova, 0.8); // 20 / 25
  assert.equal(setor.processos_distintos, 2);
});

test('o mesmo processo em papeis diferentes conta uma vez como processo distinto', () => {
  const lancamentos = [
    lancamento({ servidor_id: 1, papel: 'EXECUCAO', pontos: 3 }),
    lancamento({ servidor_id: 2, papel: 'REVISAO', pontos: 1.2 }),
    lancamento({ servidor_id: 3, papel: 'HOMOLOGACAO', pontos: 0.6 }),
  ];
  const apuracoes = [1, 2, 3].map((id) => apurarServidor(id, lancamentos, 20, 0));
  const setor = apurarSetor(apuracoes, lancamentos);
  assert.equal(setor.processos_distintos, 1);
  assert.equal(setor.total_pontos, 4.8);
});

test('taxa de correcao ignora divisao por zero', () => {
  assert.equal(taxaDeCorrecao(10, 3), 0.3);
  assert.equal(taxaDeCorrecao(0, 0), null);
});
