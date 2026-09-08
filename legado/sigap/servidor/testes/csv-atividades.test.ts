import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chaveDaLinha,
  lerCsvDeAtividades,
  semInciso,
  separarCampos,
} from '../src/dominio/csv-atividades';

const CABECALHO =
  'grupo;codigo;codigo_pai;nivel;lancavel;usa_tipo_folha;rotulo_curto;atividade_completa;entrega_esperada';

test('campo entre aspas guarda o ponto-e-virgula do texto', () => {
  assert.deepEqual(separarCampos('a;"b;c";d'), ['a', 'b;c', 'd']);
});

test('aspas dobradas viram uma aspa literal', () => {
  assert.deepEqual(separarCampos('a;"diz ""oi"" aqui";b'), ['a', 'diz "oi" aqui', 'b']);
});

test('o BOM da planilha nao contamina a primeira coluna', () => {
  const { linhas, problemas } = lerCsvDeAtividades(
    `﻿${CABECALHO}\nEFETIVOS;1;;1;SIM;NAO;Cálculo;Realizar cálculo retroativo;`,
  );
  assert.deepEqual(problemas, []);
  assert.equal(linhas[0].grupo, 'EFETIVOS');
});

test('SIM e NAO viram booleanos, com e sem acento', () => {
  const { linhas } = lerCsvDeAtividades(
    `${CABECALHO}\nEFETIVOS;1;;1;NÃO;SIM;Raiz;Gerir a folha;Folha fechada`,
  );
  assert.equal(linhas[0].lancavel, false);
  assert.equal(linhas[0].usaTipoFolha, true);
  assert.equal(linhas[0].entrega, 'Folha fechada');
});

test('valor fora de SIM/NAO e recusado com a linha apontada', () => {
  const { problemas } = lerCsvDeAtividades(
    `${CABECALHO}\nEFETIVOS;1;;1;TALVEZ;NAO;Raiz;Gerir a folha;`,
  );
  assert.equal(problemas.length, 1);
  assert.match(problemas[0], /Linha 2/);
  assert.match(problemas[0], /lancavel/);
});

test('pai inexistente e denunciado', () => {
  const { problemas } = lerCsvDeAtividades(
    `${CABECALHO}\nEFETIVOS;1.1;9;2;SIM;NAO;Filha;Uma filha orfa;`,
  );
  assert.match(problemas[0], /código pai "9" não existe/);
});

test('linha sem codigo se identifica pelo pai e pelo texto oficial', () => {
  const { linhas, problemas } = lerCsvDeAtividades(
    `${CABECALHO}\n` +
      'PARLAMENTARES;2;;1;NAO;NAO;Calcular;Calcular e pagar direitos;\n' +
      'PARLAMENTARES;;2;2;SIM;NAO;Realizar lançamento;Lançamento do pró-saúde;\n' +
      'PARLAMENTARES;;2;2;SIM;NAO;Realizar lançamento;Lançamento da COHAB;',
  );
  assert.deepEqual(problemas, []);
  assert.notEqual(chaveDaLinha(linhas[1]), chaveDaLinha(linhas[2]));
});

test('atividade repetida de verdade e apontada', () => {
  const { problemas } = lerCsvDeAtividades(
    `${CABECALHO}\n` +
      'EFETIVOS;1;;1;SIM;NAO;Cálculo;Realizar cálculo;\n' +
      'EFETIVOS;1;;1;SIM;NAO;Cálculo;Realizar cálculo;',
  );
  assert.match(problemas[0], /repete a atividade da linha 2/);
});

test('cabecalho incompleto para tudo antes de gravar qualquer coisa', () => {
  const { linhas, problemas } = lerCsvDeAtividades('grupo;codigo\nEFETIVOS;1');
  assert.deepEqual(linhas, []);
  assert.match(problemas[0], /Faltam colunas/);
});

test('quebra de linha dentro de aspas nao parte o registro', () => {
  const { linhas, problemas } = lerCsvDeAtividades(
    `${CABECALHO}\nEFETIVOS;1;;1;SIM;NAO;Rótulo;"Texto com\nduas linhas";`,
  );
  assert.deepEqual(problemas, []);
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].textoCompleto, 'Texto com\nduas linhas');
});

test('o inciso do regimento sai da frente da redação oficial', () => {
  assert.equal(semInciso('II - realizar os cálculos'), 'Realizar os cálculos');
  assert.equal(semInciso('XVIII -Gerar DCAPs das RAs'), 'Gerar DCAPs das RAs');
  assert.equal(semInciso('XX - atuar como parte'), 'Atuar como parte');
  assert.equal(semInciso('V. proceder ao cadastro'), 'Proceder ao cadastro');
});

test('texto que apenas começa com I, V ou X fica intacto', () => {
  assert.equal(semInciso('Importação de arquivos do pró-saúde'), 'Importação de arquivos do pró-saúde');
  assert.equal(semInciso('Verificar divergências'), 'Verificar divergências');
  assert.equal(semInciso('Indenização de Férias'), 'Indenização de Férias');
});

test('hífen solto no começo não é confundido com inciso', () => {
  assert.equal(semInciso('- alguma coisa'), '- alguma coisa');
});

test('nada sobra depois do inciso: o texto original permanece', () => {
  assert.equal(semInciso('IV -'), 'IV -');
});

test('a redação oficial chega limpa pela leitura do arquivo', () => {
  const { linhas } = lerCsvDeAtividades(
    `${CABECALHO}\nPARLAMENTARES;2;;1;NAO;NAO;Calcular e pagar;II - realizar os cálculos;`,
  );
  assert.equal(linhas[0].textoCompleto, 'Realizar os cálculos');
});
