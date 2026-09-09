# SEPIN - COPAG · Escala Híbrida

> Este repositório era do SIGAP (produtividade). O SIGAP foi aposentado e o código
> dele está guardado em `legado/sigap/`, sem rodar. O bloco do Railway e o Postgres
> que eram dele agora servem o Escala Híbrida; as tabelas antigas continuam no
> banco, intactas, no schema `public` — o Escala usa o schema `escala`.

Sistema web para o setor controlar a escala de trabalho híbrido: quem está **presencial (P)**, quem está **à distância (D)** e quem está **afastado**, com **alerta automático de horário descoberto** e visões **diária, semanal e mensal**.

Substitui a planilha `CONTROLE ESCALA HÍBRIDO 2026.xlsx` — cuja escala já vem carregada no primeiro `npm run seed`.

## O que ele faz

- **Cada servidor entra com o primeiro nome e a senha inicial dada pela chefia**, define a própria senha no primeiro acesso e depois pode trocar o login (nome de usuário ou e-mail) **e a senha** quando quiser, e lança os próprios turnos (a chefia lança os de qualquer um). Em "Minha conta" a pessoa muda o login, o nome e a senha quando quiser, confirmando a senha atual.
- Um dia pode ter **mais de um turno** — ex.: `07:30–14:30 presencial + 15:00–18:00 à distância`, como o Marcelo faz na planilha.
- **Turno e afastamento se alteram clicando neles**: abre o formulário preenchido, com Salvar e Excluir.
- **Alerta de cobertura**: o sistema varre o expediente (padrão 07:00–18:00) em faixas de 30 minutos e avisa toda faixa em que **ninguém está presencial**. Alguém precisa ficar presencial até as 18:00; ficar depois é permitido, só não é exigido. O mínimo por faixa, o horário, o tamanho da faixa e os dias com expediente são configuráveis pela chefia em "Regras".
- **Barra de cobertura do dia**: azul onde há alguém presencial (mais forte com duas ou mais pessoas), listrado com borda vermelha onde não há ninguém. A mesma barra aparece, menor, no cabeçalho de cada dia da semana e em cada dia do mês.
- **Férias e afastamentos** (férias, licença, capacitação, folga): nos dias marcados a pessoa deixa de contar para a cobertura, e o alerta recalcula na hora — é assim que aparece quem precisa cobrir.
- **Configurações** (só chefia), em quatro abas: **Período híbrido** (início e fim; começou em 09/09/2026, e dias fora dele não geram alerta), **Pessoas** (quem entra no acompanhamento, cadastro, perfil, metas e redefinição de senha; tirar alguém não apaga nada), **Feriados** e **Regras de cobertura**.
- **Feriados**: os nacionais de 2026 já vêm carregados na primeira subida; a chefia inclui os locais e apaga os que não valem para o setor. Em feriado não há exigência de cobertura e as horas não contam.
- **Aviso à chefia a cada furo**: toda mudança (turno, afastamento, feriado, regra) é comparada antes e depois; se abriu faixa sem ninguém presencial, quem mudou vê o alerta na hora e a chefia recebe um aviso no menu ("Avisos", com contador) e, se o Railway tiver `RESEND_API_KEY` e `EMAIL_REMETENTE`, um e-mail para cada chefia cujo login é um e-mail.
- **Fim de semana não entra na escala**: a semana mostra segunda a sexta, o mês só os dias com expediente, e as setas do dia pulam sábado e domingo.
- **Tela inicial**: saudação, quem está hoje (presencial, à distância, afastados, sem lançamento) com a barra de cobertura, o **mural** de recados do setor (qualquer pessoa escreve; alterar e apagar é de quem escreveu ou da chefia; validade opcional; só a chefia fixa no topo), os próximos 7 dias (furos, feriados e afastamentos que começam) e, para a chefia, os avisos pendentes; para os demais, um lembrete se a semana ainda não foi lançada.
- **Três visões**: linha do tempo do dia, grade da semana (parecida com a planilha, com totais P/D por pessoa contra a meta de 20h+20h) e calendário do mês com a cobertura de cada dia.
- **Copiar semana**: cria, nas semanas seguintes, cópias dos turnos da semana base (padrão da planilha antiga). Pede confirmação com a contagem de semanas e deixa um botão "Desfazer cópia" que remove exatamente o que criou. Alterar um dia na grade nunca copia nada.
- **Tema claro ou escuro**, à escolha de cada pessoa (botão "Tema escuro" / "Tema claro" no cabeçalho e na tela de entrada), lembrado no navegador.

## Rodando na sua máquina

```bash
npm install
cp .env.example .env      # preencha DATABASE_URL e JWT_SECRET
npm run migrate           # cria as tabelas
npm run seed              # cria os 7 servidores e importa a escala da planilha
npm start                 # http://localhost:3000
```

O seed é idempotente: rodar de novo não duplica nada. Com `npm run seed -- --so-se-vazio`
ele só age quando ainda não existe servidor nenhum (é assim que o deploy o chama).

O seed cria os usuários com o **primeiro nome** como login (`dayana`, `luiz`…) e a senha de `SENHA_PADRAO` (padrão `12345678`), marcada como provisória: a pessoa entra, o sistema pede uma senha nova e não libera nenhuma tela até ela definir. O mesmo vale para quem a chefia cadastra ou cuja senha a chefia redefine. **Dayana** entra como `chefia`; os demais como `servidor`.

Para mudar quem é chefia, edite a constante `CHEFIA` em `scripts/seed.js` antes de rodar o seed, ou ajuste depois pela API (`PUT /api/servidores/:id` com `{"perfil":"chefia"}`).

## Subindo no Railway (no lugar do SIGAP)

Nada para criar: é o mesmo bloco e o mesmo Postgres que o SIGAP usava.

1. Faça o merge da branch na `main`. O Railway constrói e sobe sozinho.
2. O `npm start` migra (cria o schema `escala` e as tabelas) e, **só na primeira subida com o
   schema vazio**, roda o seed com a escala da planilha. Nas seguintes o seed é pulado, para não
   ressuscitar turno que a chefia apagou. Ninguém precisa abrir terminal. (`npm run
   start:so-servidor` sobe sem migrar, para uso local.)
3. Variáveis: `DATABASE_URL` e `SESSION_SECRET` já existem no bloco (o Escala aceita
   `SESSION_SECRET` no lugar de `JWT_SECRET`). `SENHA_PADRAO` é opcional (padrão `12345678`).
   Para o aviso por e-mail, crie `RESEND_API_KEY` e `EMAIL_REMETENTE` (remetente verificado no Resend);
   sem elas o aviso fica só no painel.
   As variáveis `ADMIN_*`, `SETOR_*` e `IMPORTAR_CATALOGO` eram do SIGAP e podem ser apagadas.
4. O painel do Railway (**Settings** do bloco `sigap`) guardava dois comandos do SIGAP
   gravados à mão, e o painel manda acima do `railway.json`: **Build → Custom Build Command**
   (`npm run build --workspace=@siger/servidor`) e **Deploy → Custom Start Command**
   (`npm run start --workspace=@siger/servidor`). O primeiro derrubava o build; o segundo
   subia um pacote sem `start` e o serviço caía em `CRASHED`. Os dois foram apagados em
   08/09/2026 e o deploy passou a ler o `railway.json`. Se algum dia voltarem a aparecer
   preenchidos, apague-os de novo e clique em **Deploy**. **Root Directory** fica vazio.
   Nunca use `npm ci` no build: ele apaga `node_modules`, e o Railway monta um cache em
   `node_modules/.cache` — dá `EBUSY` e o deploy falha na construção (aconteceu em 08/09/2026).

**Como saber que a versão nova está no ar:** abra `/api/saude` no domínio.

- Escala Híbrida responde `{"sistema":"escala-hibrida", "schema":"escala", "capacidades":{...}}`.
- O SIGAP antigo respondia `{"situacao":"no ar", ...}`. Se ainda for isso, o deploy não subiu.

A chave `capacidades` lista o que **este build** sabe fazer; uma versão antiga não traz a chave.

## Estrutura

```
server.js              entrada da aplicação
db/schema.sql          tabelas (servidores, turnos, afastamentos, feriados, config)
db/seed-escala.json    escala extraída da planilha de 2026
src/cobertura.js       motor que encontra as faixas sem presencial
src/avisos.js          fotografa a cobertura antes e depois de cada mudança e avisa a chefia
src/email.js           envio pelo Resend (só com RESEND_API_KEY e EMAIL_REMETENTE)
src/validar.js         checagem de data, hora, número e e-mail antes do banco
src/auth.js            login por cookie assinado (JWT) e regras de permissão
src/routes/            auth, servidores, escala, cobertura
public/                interface (HTML + CSS + JavaScript puro, sem build); simbolo.svg e icone.svg são o símbolo da COPAG, o mesmo do SIGAP
scripts/migrate.js     cria/atualiza as tabelas e aplica ajustes de dados uma vez só (18h, feriados de 2026)
scripts/seed.js        carrega servidores e a escala inicial
test/unit/             motor de cobertura, validação e TLS, sem banco (`npm test`)
test/banco/            rotas de ponta a ponta contra um Postgres de teste
legado/sigap/          o SIGAP aposentado, guardado; não roda
compat/build-do-sigap/ pacote vazio com o nome que o painel do Railway ainda chama no build
```

## Testes

```bash
npm test                                                    # unitários, sem banco
DATABASE_URL_TESTE=postgresql://.../escala_teste npm run test:banco   # apaga e recria esse banco
```

O teste de banco planta tabelas `servidores` e `feriados` no schema `public` imitando o
SIGAP, sobe o servidor, migra, roda o seed três vezes (tem que dar o mesmo banco), confere
que as tabelas do SIGAP ficaram intactas, e exercita cada rota com entrada boa e com lixo — data `ontem`, hora `abc`,
e-mail duplicado com maiúscula, "repetir semana" até `abc` e até 2099.

## API

| Método | Rota | O que faz |
|---|---|---|
| POST | `/api/auth/login` | entra (e-mail + senha) |
| POST | `/api/auth/logout` | sai |
| GET | `/api/auth/eu` | dados de quem está logado |
| PUT | `/api/auth/conta` | muda o próprio login, nome e senha (exige a senha atual) |
| POST | `/api/auth/senha` | troca a própria senha |
| GET | `/api/servidores` | lista servidores |
| POST/PUT | `/api/servidores` | cadastra/edita (só chefia) |
| GET | `/api/escala?inicio=&fim=` | turnos, afastamentos e feriados do período |
| POST | `/api/escala/turnos` | lança turno |
| PUT | `/api/escala/turnos/:id` | altera turno |
| DELETE | `/api/escala/turnos/:id` | remove turno |
| POST | `/api/escala/replicar` | repete a semana base nas seguintes |
| POST/PUT/DELETE | `/api/escala/afastamentos` | registra/altera/remove afastamento |
| GET | `/api/escala/feriados?ano=` | feriados do ano |
| POST/DELETE | `/api/escala/feriados` | cadastra/remove feriado (só chefia) |
| GET | `/api/cobertura?inicio=&fim=` | análise de cobertura + horas por servidor |
| GET/PUT | `/api/cobertura/config` | regras de cobertura e período híbrido (PUT só chefia) |
| GET | `/api/mural` | recados válidos do mural |
| POST/PUT/DELETE | `/api/mural`, `/api/mural/:id` | escreve recado (todos); altera e apaga (quem escreveu ou chefia) |
| GET | `/api/avisos` | avisos pendentes (`?todos=1` inclui os lidos); só chefia |
| GET | `/api/avisos/contagem` | quantos avisos pendentes |
| POST | `/api/avisos/:id/lido`, `/api/avisos/lidos` | marca como lido |

## Regras de permissão

- Cada pessoa só edita a própria escala e o próprio afastamento.
- A chefia edita a de qualquer um, cadastra servidores, feriados e altera as regras de cobertura.
- Não há fluxo de aprovação: o que a pessoa marca já vale, e a chefia acompanha pelo alerta.

## Detalhes que valem saber

- Entrada inválida (data fora de `YYYY-MM-DD`, hora fora de `HH:MM`, meta que não é número)
  volta como erro 400 dizendo o que veio errado e o formato esperado — nunca "Erro interno".
- Turnos sobrepostos da mesma pessoa no mesmo dia são recusados (erro 409).
- O login (e-mail ou nome de usuário) é guardado e comparado em minúsculas; `Teste@x` e `teste@x` são a mesma conta.
- "Repetir semana" vai no máximo até 53 semanas depois da semana base.
- Se alguma regra de cobertura no banco estiver inválida, a análise usa o padrão (07:00–18:00,
  1 pessoa, faixas de 30 min, segunda a sexta) e **avisa no alerta** em vez de mostrar
  "cobertura em ordem" com zero dias úteis.
- Sábado e domingo não entram na checagem de cobertura; para excluir um feriado, cadastre-o em `/api/escala/feriados`.
- As horas semanais são comparadas com a meta de cada servidor (`meta_presencial_semanal` / `meta_distancia_semanal`, padrão 20h + 20h) e ficam em vermelho quando abaixo.
- Senhas são guardadas com bcrypt; a sessão é um cookie `httpOnly` válido por 30 dias.
