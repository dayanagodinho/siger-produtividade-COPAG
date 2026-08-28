# SIGAP — Sistema de Gestão de Atividades e Produtividade

Controle mensal de produtividade de servidores públicos em regime de trabalho
híbrido. A apuração é por setor e não distingue dia presencial de dia remoto: o
que conta é o resultado do mês fechado.

Cada servidor lança os processos em que trabalhou, indicando um nível de
complexidade de 1 a 4. O sistema soma os pontos, divide pelos dias efetivos e
produz a média do servidor, a referência do grupo e as duas médias do setor.

---

A logo do sistema fica em `cliente/public/marca-sigap.svg`. Para trocar, basta
substituir esse arquivo — nenhum código precisa mudar. Um `.png` ou `.jpg` também
serve, desde que mantenha o mesmo nome de arquivo ou que a referência em
`Layout.tsx` e `Entrada.tsx` seja ajustada.

## Como rodar

Requisitos: Node 20+ e PostgreSQL 14+.

```bash
cp .env.example .env          # ajuste DATABASE_URL e SESSION_SECRET
npm install
npm run migrar                # cria o schema
npm run importar-catalogo     # grupos, atividades e feriados da COPAG
npm run semear -- --recriar   # dados de exemplo (opcional)
npm run dev                   # API em http://localhost:3000
npm run dev:cliente           # interface em http://localhost:5173
```

Em produção o servidor entrega a interface compilada na mesma porta:

```bash
npm run build
npm start
```

### Verificações

```bash
npm run teste             # testes do núcleo de cálculo
npm run verificar-tipos   # TypeScript no servidor e no cliente
```

### Acessos do seed

Todos com a senha `produtividade2026`:

| Matrícula | Nome | Perfil | Situação no exemplo |
|---|---|---|---|
| 100001 | Ana Ribeiro Alves | Administrador | sem grupo, não lança produção |
| 100002 | Carlos Menezes Prado | Chefe | lança e homologa |
| 100003 | Beatriz Souza Lima | Servidor | volume alto |
| 100004 | Diego Fontes Araujo | Servidor | tem um lançamento devolvido |
| 100005 | Elaine Castro Moreira | Servidor | licença de 5 dias em agosto |
| 100006 | Fabio Nunes Teixeira | Servidor | regime presencial |
| 100007 | Gabriela Pinto Rocha | Servidor | férias o mês inteiro: sem apuração |

---

## Regras implementadas

### Lançamento

- **Competência pela conclusão.** O ponto entra no mês da data de conclusão,
  independentemente de quando a execução começou. A coluna `competencia` é
  gerada pelo banco a partir de `data_conclusao`, então não há como divergir.
- **Só concluído pontua.** Lançamento em andamento aparece no painel como
  volume, mas fica fora da média.
- **Duplicidade.** `processo + nível + servidor + papel` é único entre os
  lançamentos vivos. O mesmo processo pode receber execução de um, revisão de
  outro e homologação da chefia.
- **Aviso, não bloqueio.** Ao digitar um processo já lançado, a tela mostra quem
  lançou, em que papel e quando, antes de salvar. O usuário confirma e segue.
- **Peso por papel.** `pontos = nível × quantidade × percentual do papel`.
  Padrão: execução 100%, revisão 40%, homologação 20%, tudo editável pelo
  administrador.
- **Congelamento.** O percentual do papel é gravado no lançamento no momento do
  registro. Mudar o parâmetro depois não altera meses anteriores.

### Validação

- Todo lançamento nasce `PENDENTE`. Só `VALIDADO` entra na média oficial.
- O chefe valida, devolve com justificativa obrigatória, ou corrige o nível.
- A correção grava valor original, autor e momento, e o servidor vê isso na
  própria tela.
- Relatório de aderência mostra a taxa de correção por servidor, para expor
  calibração ruim da autodeclaração.

### Dias efetivos

```
dias_uteis    = dias do mês − sábados, domingos e feriados
dias_efetivos = dias_uteis − dias úteis de ausência
```

Com `dias_efetivos = 0` o servidor fica `SEM_APURACAO`: não gera média e não
entra no cálculo do grupo nem do setor. Nunca é tratado como zero.

Ausências sobrepostas contam uma única vez.

### Indicadores

```
media_servidor = pontos validados e concluídos ÷ dias efetivos
atingimento    = media_servidor ÷ referência do grupo
```

A referência do grupo é a `meta_referencia` quando preenchida; senão, a
**mediana** das médias dos servidores apurados do grupo naquele mês. A tela
sempre diz qual das duas está em uso.

Pontos de **homologação** contam na apuração individual de quem os lançou, mas
ficam fora da base que forma a referência do grupo — homologar não gera processo
novo.

Faixas: abaixo de 85%, entre 85% e 115%, acima de 115%. Os limites são
parâmetros do sistema.

Médias do setor:

```
oficial:     média simples das médias dos servidores com apuração
contraprova: total de pontos do setor ÷ total de dias efetivos
```

Ao lado das duas aparece o **número de processos distintos concluídos**. Como um
mesmo processo gera até três lançamentos, o total de pontos pode subir sem
entrega adicional; esse número é a contraprova.

### Fechamento

Executado pelo chefe do setor ou pelo administrador. Bloqueia lançamentos e
edições com data de conclusão naquele mês, congela pontos, dias efetivos,
médias e a **referência aplicada de cada grupo**, e gera o consolidado.

Reabertura é exclusiva do administrador, exige justificativa e fica no log.
Depois de reaberto e fechado de novo, as duas versões do consolidado ficam
preservadas lado a lado.

### Auditoria

Toda criação, alteração e exclusão de lançamento, ausência, cadastro e parâmetro
grava usuário, momento, valor anterior e valor novo. Exclusão de lançamento é
lógica (`excluido_em`), nunca física.

---

## Decisões tomadas na implementação

Pontos em que a especificação deixava margem e a escolha foi registrada aqui:

1. **Correção de nível pela chefia muda a pontuação.** O congelamento protege
   contra mudança de *parâmetro* (o percentual do papel fica gravado no
   registro). O nível aplicado acompanha a correção da chefia — se não
   acompanhasse, a validação não teria efeito sobre o resultado, e ela é o único
   controle contra inflação de nível.

2. **Ausência é cadastrada pela chefia, não pelo servidor.** Ausência reduz o
   divisor da média, então registrá-la eleva o resultado de quem faltou. Pela
   mesma lógica que sustenta a validação, o cadastro ficou restrito a chefe e
   administrador; o servidor consulta as próprias ausências.

3. **Edição pelo servidor devolve o lançamento à fila.** Alterar um lançamento
   já avaliado o traz de volta para `PENDENTE`, senão seria possível validar um
   nível 1 e reescrevê-lo como nível 4 depois.

4. **Dias efetivos não são proporcionalizados por admissão ou desligamento.** A
   fórmula da especificação desconta apenas ausências. Quem for admitido no meio
   do mês fica com o divisor cheio; se isso for relevante, o caminho é registrar
   o período anterior à admissão como ausência ou estender a regra.

5. **Servidor com dias efetivos e nenhum lançamento entra com média zero.** Só
   `dias_efetivos = 0` produz `SEM_APURACAO`. Quem trabalhou e não lançou puxa a
   média do setor para baixo — é o comportamento correto, mas significa que
   perfis administrativos que não produzem processos devem ficar em setor
   próprio ou sem grupo.

6. **Fechar o mês com fila pendente exige confirmação.** Lançamentos não
   validados ficam congelados fora da média para sempre; o sistema avisa quantos
   são e pede confirmação explícita em vez de bloquear.

---

## Organização do código

```
servidor/
  migracoes/            SQL versionado, aplicado em ordem
  src/dominio/          cálculo puro: pontos, dias, mediana, faixas, apuração
  src/rotas/            API por assunto
  src/infra/            banco, sessão, autorização, auditoria, validação
  testes/               testes do núcleo de cálculo
cliente/
  src/paginas/          uma tela por arquivo
  src/componentes/      layout e peças reutilizadas
  src/servicos/         chamadas de API, sessão e formatação pt-BR
```

O cálculo de pontuação e média roda exclusivamente no servidor. O cliente recebe
números prontos. O controle de acesso por perfil é verificado no backend em toda
rota — esconder botão no front é conveniência, não segurança.

---

## Deploy no Railway

O `railway.json` define build (`npm run build`) e start (`npm start`), com
health check em `/api/saude`.

Variáveis necessárias:

| Variável | Observação |
|---|---|
| `DATABASE_URL` | fornecida pelo plugin PostgreSQL do Railway |
| `SESSION_SECRET` | valor aleatório e longo |
| `NODE_ENV` | `production` (ativa o cookie seguro) |
| `DATABASE_SSL` | opcional; `true` ou `false` para decidir o TLS na mão |
| `MIGRAR_AO_INICIAR` | `true` por padrão; use `false` para migrar à parte |
| `IMPORTAR_CATALOGO` | `true` por padrão; use `false` para montar a lista do zero |

O TLS com o banco é decidido pelo endereço, não pelo ambiente: a rede interna do
Railway (`...railway.internal`) é privada e não atende em TLS, então exigir SSL
ali derruba a conexão logo na subida. Endereço público, de proxy ou de terceiro
sobe com TLS. `DATABASE_SSL` e o `sslmode` escrito na própria URL passam na
frente dessa decisão, nessa ordem.

### Primeiro administrador

Na primeira subida, com o banco ainda vazio, o sistema cria sozinho o setor e o
administrador a partir destas variáveis:

| Variável | Padrão |
|---|---|
| `ADMIN_EMAIL` | obrigatória |
| `ADMIN_SENHA` | obrigatória, mínimo 8 caracteres com letras e números |
| `ADMIN_NOME` | `Administrador do sistema` |
| `ADMIN_MATRICULA` | `000001` |
| `SETOR_NOME` | `Setor inicial` |
| `SETOR_SIGLA` | `GERAL` |

Com o banco já povoado nada acontece: a rotina não sobrescreve cadastro nem
senha de ninguém. O mesmo passo existe como comando avulso em
`npm run criar-admin`.

### Lista de atividades

Logo depois, ainda na primeira subida e só enquanto não houver nenhuma atividade
cadastrada, entra o catálogo da COPAG lido de `servidor/dados/atividades-copag.json`:
os 4 grupos de pagamento, as 93 atividades, os 206 detalhamentos e os feriados do
ano. Ele anexa ao setor de mesma sigla, ou ao único setor existente — o caso da
primeira subida.

A importação é somativa e pode ser repetida com `npm run importar-catalogo`
(aceita `--setor=<id>`): grupo, atividade ou feriado que já exista fica como
está, com os ajustes que o setor tiver feito pela tela. É o oposto de `semear`,
que limpa o banco e povoa com gente fictícia.

O passo a passo completo do Railway, com os cliques na ordem, está em
[DEPLOY.md](DEPLOY.md).
