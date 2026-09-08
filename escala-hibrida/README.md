# Escala Híbrida

Sistema web para o setor controlar a escala de trabalho híbrido: quem está **presencial (P)**, quem está **à distância (D)** e quem está **afastado**, com **alerta automático de horário descoberto** e visões **diária, semanal e mensal**.

Substitui a planilha `CONTROLE ESCALA HÍBRIDO 2026.xlsx` — cuja escala já vem carregada no primeiro `npm run seed`.

## O que ele faz

- **Cada servidor entra com e-mail e senha** e lança os próprios turnos (a chefia lança os de qualquer um).
- Um dia pode ter **mais de um turno** — ex.: `07:30–14:30 presencial + 15:00–18:00 à distância`, como o Marcelo faz na planilha.
- **Alerta de cobertura**: o sistema varre o expediente (padrão 07:00–19:00) em faixas de 30 minutos e avisa toda faixa em que **ninguém está presencial**. O mínimo por faixa, o horário do expediente, o tamanho da faixa e os dias úteis são configuráveis pela chefia.
- **Afastamento** (férias, licença, capacitação, folga): nos dias marcados a pessoa deixa de contar para a cobertura, e o alerta recalcula na hora — é assim que aparece quem precisa cobrir.
- **Três visões**: linha do tempo do dia, grade da semana (parecida com a planilha, com totais P/D por pessoa contra a meta de 20h+20h) e calendário do mês com marcação dos dias com lacuna.
- **Repetir semana**: copia a escala de uma semana para as seguintes, que é o padrão da planilha antiga.

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

O seed cria os usuários com o e-mail `nome@setor.local` e a senha de `SENHA_PADRAO` (padrão `mudar123`). **Dayana** entra como `chefia`; os demais como `servidor`. Peça a todos que troquem a senha no primeiro acesso (botão "Trocar senha").

Para mudar quem é chefia, edite a constante `CHEFIA` em `scripts/seed.js` antes de rodar o seed, ou ajuste depois pela API (`PUT /api/servidores/:id` com `{"perfil":"chefia"}`).

## Subindo no Railway

1. O código já está no repositório `siger-produtividade-COPAG`, pasta `escala-hibrida/`.
2. No Railway, dentro do projeto do SIGAP: **+ New → GitHub Repo → siger-produtividade-COPAG**.
3. **+ New → Database → PostgreSQL** só para este bloco (o `DATABASE_URL` é injetado sozinho).
   Não reaproveite o Postgres do SIGAP: as tabelas têm nomes parecidos (`servidores`) e
   colidiriam.
4. Em **Variables**, adicione `JWT_SECRET` (uma frase longa e aleatória) e `SENHA_PADRAO`.
5. Este app mora na pasta `escala-hibrida/` do repositório do SIGAP. Ele é um **segundo bloco**
   no Railway, separado do SIGAP: em **Settings → Source → Root Directory** informe
   `escala-hibrida`. O bloco do SIGAP continua construído da raiz, como diz o `DEPLOY.md`.
6. O deploy roda sozinho `npm run migrate` e, **só no primeiro boot com banco vazio**, o seed
   com a escala da planilha (veja `railway.json`). Nos boots seguintes o seed é pulado, para
   não ressuscitar turno que a chefia apagou. Ninguém precisa abrir terminal.
7. Em **Settings → Networking → Generate Domain** e mande o link para os colegas.

## Estrutura

```
server.js              entrada da aplicação
db/schema.sql          tabelas (servidores, turnos, afastamentos, feriados, config)
db/seed-escala.json    escala extraída da planilha de 2026
src/cobertura.js       motor que encontra as faixas sem presencial
src/validar.js         checagem de data, hora, número e e-mail antes do banco
src/auth.js            login por cookie assinado (JWT) e regras de permissão
src/routes/            auth, servidores, escala, cobertura
public/                interface (HTML + CSS + JavaScript puro, sem build)
scripts/migrate.js     cria/atualiza as tabelas
scripts/seed.js        carrega servidores e a escala inicial
test/unit/             motor de cobertura e validação, sem banco (`npm test`)
test/banco/            rotas de ponta a ponta contra um Postgres de teste
```

## Testes

```bash
npm test                                                    # unitários, sem banco
DATABASE_URL_TESTE=postgresql://.../escala_teste npm run test:banco   # apaga e recria esse banco
```

O teste de banco sobe o servidor, migra, roda o seed três vezes (tem que dar o mesmo
banco), e exercita cada rota com entrada boa e com lixo — data `ontem`, hora `abc`,
e-mail duplicado com maiúscula, "repetir semana" até `abc` e até 2099.

## API

| Método | Rota | O que faz |
|---|---|---|
| POST | `/api/auth/login` | entra (e-mail + senha) |
| POST | `/api/auth/logout` | sai |
| GET | `/api/auth/eu` | dados de quem está logado |
| POST | `/api/auth/senha` | troca a própria senha |
| GET | `/api/servidores` | lista servidores |
| POST/PUT | `/api/servidores` | cadastra/edita (só chefia) |
| GET | `/api/escala?inicio=&fim=` | turnos, afastamentos e feriados do período |
| POST | `/api/escala/turnos` | lança turno |
| DELETE | `/api/escala/turnos/:id` | remove turno |
| POST | `/api/escala/replicar` | repete a semana base nas seguintes |
| POST/DELETE | `/api/escala/afastamentos` | registra/remove afastamento |
| POST/DELETE | `/api/escala/feriados` | cadastra feriado (só chefia) |
| GET | `/api/cobertura?inicio=&fim=` | análise de cobertura + horas por servidor |
| GET/PUT | `/api/cobertura/config` | regras de cobertura (PUT só chefia) |

## Regras de permissão

- Cada pessoa só edita a própria escala e o próprio afastamento.
- A chefia edita a de qualquer um, cadastra servidores, feriados e altera as regras de cobertura.
- Não há fluxo de aprovação: o que a pessoa marca já vale, e a chefia acompanha pelo alerta.

## Detalhes que valem saber

- Entrada inválida (data fora de `YYYY-MM-DD`, hora fora de `HH:MM`, meta que não é número)
  volta como erro 400 dizendo o que veio errado e o formato esperado — nunca "Erro interno".
- Turnos sobrepostos da mesma pessoa no mesmo dia são recusados (erro 409).
- E-mail é guardado e comparado em minúsculas; `Teste@x` e `teste@x` são a mesma conta.
- "Repetir semana" vai no máximo até 53 semanas depois da semana base.
- Se alguma regra de cobertura no banco estiver inválida, a análise usa o padrão (07:00–19:00,
  1 pessoa, faixas de 30 min, segunda a sexta) e **avisa no alerta** em vez de mostrar
  "cobertura em ordem" com zero dias úteis.
- Sábado e domingo não entram na checagem de cobertura; para excluir um feriado, cadastre-o em `/api/escala/feriados`.
- As horas semanais são comparadas com a meta de cada servidor (`meta_presencial_semanal` / `meta_distancia_semanal`, padrão 20h + 20h) e ficam em vermelho quando abaixo.
- Senhas são guardadas com bcrypt; a sessão é um cookie `httpOnly` válido por 30 dias.
