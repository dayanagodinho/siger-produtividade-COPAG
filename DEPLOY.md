# Colocar o SIGAP no ar (passo a passo)

Guia para quem nunca usou Railway. Do zero até a tela de entrada funcionando,
sem precisar abrir terminal em momento algum.

Antes de começar, tenha em mãos:

- a conta do GitHub onde está o repositório `siger-produtividade-COPAG`;
- uma senha que você vai usar no primeiro acesso (mínimo 8 caracteres, com
  letras e números — anote, você vai digitar nas variáveis);
- um valor aleatório e longo para assinar as sessões (qualquer sequência de
  40+ caracteres embaralhados serve; ela nunca aparece para o usuário).

---

## 1. Criar o projeto no Railway

1. Acesse **railway.com** e entre com a conta do GitHub.
2. Clique em **New Project**.
3. Escolha **Deploy from GitHub repo**.
4. Selecione **siger-produtividade-COPAG** na lista.
   - Se o repositório não aparecer, clique em **Configure GitHub App** e
     autorize o Railway a enxergar esse repositório. Volte e ele estará lá.

O Railway começa a construir sozinho. **Vai falhar nessa primeira tentativa** —
é esperado: ainda não existe banco de dados. Siga para o passo 2.

## 2. Adicionar o banco de dados

1. Dentro do projeto, clique em **+ New** (ou **Create**).
2. Escolha **Database** e depois **Add PostgreSQL**.

Um segundo bloco aparece no painel, chamado **Postgres**. Não precisa
configurar nada dentro dele.

## 3. Preencher as variáveis

Clique no bloco do **aplicativo** (o que tem o nome do repositório, não o do
Postgres) e abra a aba **Variables**. Adicione uma por uma:

| Nome | Valor |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `SESSION_SECRET` | sua sequência aleatória longa |
| `NODE_ENV` | `production` |
| `ADMIN_NOME` | seu nome completo |
| `ADMIN_EMAIL` | seu e-mail institucional |
| `ADMIN_SENHA` | a senha do primeiro acesso |
| `ADMIN_MATRICULA` | sua matrícula (se deixar vazio, vira `000001`) |
| `SETOR_NOME` | nome do setor por extenso |
| `SETOR_SIGLA` | sigla do setor |

O valor de `DATABASE_URL` é literalmente `${{Postgres.DATABASE_URL}}`, com as
chaves e o cifrão. Isso é uma referência: o Railway substitui pelo endereço real
do banco. Se o seu bloco de banco tiver outro nome, troque `Postgres` por ele.

## 4. Publicar e abrir

1. Salve as variáveis. O Railway reconstrói sozinho.
2. Abra a aba **Settings** do aplicativo, seção **Networking**, e clique em
   **Generate Domain**.
3. O endereço gerado (algo como `seu-projeto.up.railway.app`) é o sistema.

Na primeira subida o sistema cria sozinho o banco de dados, o setor que você
informou e o seu usuário administrador. Entre com a matrícula (ou o e-mail) e a
senha que você colocou em `ADMIN_SENHA`.

**Troque a senha logo no primeiro acesso**, em *Trocar senha* no rodapé do menu.
Depois disso você pode apagar a variável `ADMIN_SENHA` das configurações — ela
só é lida quando o banco está vazio.

## 5. Deu erro? Onde olhar

Clique no bloco do aplicativo e abra a aba **Deployments** → o deploy mais
recente → **View Logs**. As mensagens estão em português:

| Mensagem | O que fazer |
|---|---|
| `Variável de ambiente DATABASE_URL não definida` | Falta o passo 3, ou o nome do bloco do banco não é `Postgres` |
| `Primeiro acesso não criado: A senha precisa...` | A `ADMIN_SENHA` é fraca. Corrija e o Railway reconstrói |
| `Nada a fazer: o banco já tem servidores cadastrados` | Normal a partir da segunda subida — o administrador já existe |
| `SIGAP no ar` | Deu certo |

---

## Depois que estiver no ar

A ordem que faz o sistema começar a produzir número:

1. **Cadastros → Setores**: confira o setor criado e indique o chefe responsável
   (só depois de cadastrar a pessoa, no passo 3).
2. **Cadastros → Grupos**: crie os grupos do setor. Deixe a meta em branco para
   o sistema usar a mediana do próprio grupo como referência do mês.
3. **Cadastros → Servidores**: cadastre as pessoas, com perfil e grupo. Cada uma
   recebe uma senha inicial que você define e troca no primeiro acesso.
4. **Cadastros → Tabela de complexidade**: ajuste os critérios dos níveis 1 a 4
   para a realidade do setor. Esse texto aparece na tela de lançamento e é o que
   sustenta a autodeclaração.
5. **Cadastros → Feriados**: cadastre os feriados do ano. Eles entram no cálculo
   dos dias úteis.
6. **Cadastros → Parâmetros**: revise os pesos de revisão (40%) e homologação
   (20%) se quiser outro valor.
7. **Ausências**: registre férias e licenças conforme forem acontecendo.

A partir daí os servidores lançam, a chefia valida na fila, e no fim do mês o
**Painel do setor → Fechar competência** congela o resultado.

## Testar com dados de exemplo antes de valer

Se quiser ver o sistema cheio antes de usar para valer, rode uma vez o comando
`npm run semear -- --recriar` — ele apaga tudo e cria um setor completo com sete
pessoas, dois meses de lançamentos, ausências e uma fila de validação. **Não
rode isso depois que houver dado real**: o comando limpa o banco.
