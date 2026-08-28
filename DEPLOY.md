# Colocar o SIGAP no ar (passo a passo)

Guia para quem nunca usou Railway. Do zero até a tela de entrada funcionando,
sem precisar abrir terminal em momento algum.

Antes de começar, tenha em mãos:

- a conta do GitHub onde está o repositório `siger-produtividade-COPAG`;
- uma senha para o seu primeiro acesso (mínimo 8 caracteres, com letras e
  números — anote, você vai digitar nas variáveis);
- um valor aleatório e longo para assinar as sessões (qualquer sequência de
  40+ caracteres embaralhados serve; ela nunca aparece para o usuário).

O plano gratuito do Railway serve para experimentar. Para o setor usar de
verdade, o plano Hobby (US$ 5/mês) mantém o sistema no ar sem hibernar.

---

## 1. Criar o projeto

1. Acesse **railway.com** e entre com a conta do GitHub.
2. Clique em **New Project**.
3. Escolha **Deploy from GitHub repo**.
4. Selecione **siger-produtividade-COPAG** na lista.
   - Se o repositório não aparecer, clique em **Configure GitHub App** e
     autorize o Railway a enxergar esse repositório. Volte e ele estará lá.

O Railway começa a construir sozinho. **Vai falhar nessa primeira tentativa** —
é esperado: ainda não existe banco de dados. Siga para o passo 2.

## 2. Criar o banco de dados

1. Dentro do projeto, clique em **+ Create** (ou **+ New**).
2. Escolha **Database** e depois **Add PostgreSQL**.

Um segundo bloco aparece no painel, chamado **Postgres**. Não abra, não
configure, não crie tabela nenhuma: o próprio sistema monta as 14 tabelas na
primeira vez que subir. O nome do bloco importa — se não for `Postgres`, anote,
porque ele entra no passo 3.

## 3. Preencher as variáveis

Clique no bloco do **aplicativo** (o que tem o nome do repositório, não o do
Postgres), abra a aba **Variables** e use **+ New Variable** para cada linha:

| Nome | Valor |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `SESSION_SECRET` | sua sequência aleatória longa |
| `NODE_ENV` | `production` |
| `ADMIN_NOME` | seu nome completo |
| `ADMIN_EMAIL` | seu e-mail institucional |
| `ADMIN_SENHA` | a senha do primeiro acesso |
| `ADMIN_MATRICULA` | sua matrícula (se deixar vazio, vira `000001`) |
| `SETOR_NOME` | `Coordenação de Gestão do Pagamento de Pessoal` |
| `SETOR_SIGLA` | `COPAG` |

O valor de `DATABASE_URL` é literalmente `${{Postgres.DATABASE_URL}}`, com as
chaves e o cifrão. Isso é uma referência: o Railway substitui pelo endereço real
do banco e a atualiza sozinho se a senha do banco mudar um dia. Se o seu bloco
de banco não se chamar `Postgres`, troque essa palavra pelo nome dele.

Não é preciso definir `PORT`: o Railway define.

## 4. Publicar e abrir

1. Salve as variáveis. O Railway reconstrói sozinho (dois ou três minutos).
2. Abra a aba **Settings** do aplicativo, seção **Networking**, e clique em
   **Generate Domain**. Aceite a porta sugerida.
3. O endereço gerado (algo como `sigap-copag.up.railway.app`) é o sistema.

## 5. O que acontece sozinho na primeira subida

Você não precisa fazer nada disso à mão. Ao subir com o banco vazio, o sistema:

1. **cria as tabelas** (as cinco migrações, em ordem);
2. **cria o setor** com o nome e a sigla que você informou;
3. **cria o seu usuário administrador** com a senha de `ADMIN_SENHA`;
4. **carrega a lista de atividades da COPAG**: os 4 grupos de pagamento, as 93
   atividades e os 206 detalhamentos da planilha do Programa de Resultados;
5. **cadastra os 13 feriados** de 2026, que entram no cálculo dos dias úteis.

Nas subidas seguintes nada disso se repete — o sistema confere e passa direto,
então nenhum ajuste que o setor fizer pela tela é desfeito por um novo deploy.

Entre com a matrícula (ou o e-mail) e a senha de `ADMIN_SENHA`. **Troque a senha
no primeiro acesso**, em *Trocar senha* no rodapé do menu. Depois disso pode
apagar a variável `ADMIN_SENHA` das configurações — ela só é lida quando o banco
está vazio.

## 6. Deu erro? Onde olhar

Clique no bloco do aplicativo e abra a aba **Deployments** → o deploy mais
recente → **View Logs**. As mensagens estão em português:

| Mensagem | O que fazer |
|---|---|
| `Variável de ambiente DATABASE_URL não definida` | Falta o passo 3, ou o nome do bloco do banco não é `Postgres` |
| `password authentication failed` | O valor de `DATABASE_URL` foi colado à mão e envelheceu. Troque pela referência `${{Postgres.DATABASE_URL}}` |
| `The server does not support SSL connections` | Acrescente a variável `DATABASE_SSL` com o valor `false` |
| `self-signed certificate` ou `SSL required` | Acrescente a variável `DATABASE_SSL` com o valor `true` |
| `Primeiro acesso não criado: A senha precisa...` | A `ADMIN_SENHA` é fraca. Corrija e o Railway reconstrói |
| `tsc: not found` ou `vite: not found` | O build subiu sem as ferramentas. Acrescente a variável `NPM_CONFIG_PRODUCTION` com o valor `false` |
| `Nada a fazer: o banco já tem servidores cadastrados` | Normal a partir da segunda subida — o administrador já existe |
| `SIGAP no ar` | Deu certo |

Se precisar recomeçar do zero: apague o bloco **Postgres**, crie outro, e o
próximo deploy monta tudo de novo. Isso apaga todos os dados.

---

## Depois que estiver no ar

Grupos, atividades e feriados já estão lá. Falta o que só você sabe:

1. **Cadastros → Servidores**: cadastre as pessoas, cada uma no seu grupo, com
   o perfil (SERVIDOR, CHEFE ou ADMIN) e uma senha inicial que ela troca no
   primeiro acesso.
2. **Cadastros → Setores**: indique quem é o chefe responsável, agora que a
   pessoa existe.
3. **Cadastros → Grupos**: se o setor já tem uma meta mensal por grupo, informe.
   Deixando em branco, a referência do mês é a mediana do próprio grupo.
4. **Cadastros → Tabela de complexidade**: ajuste o critério dos níveis N1 a N4
   para a realidade da COPAG. Esse texto aparece na tela de lançamento e é o que
   sustenta a autodeclaração do peso.
5. **Cadastros → Parâmetros**: revise os pesos de revisão (40%) e homologação
   (20%), se quiser outro valor.
6. **Cadastros → Atividades**: confira a lista importada e ajuste o que a
   planilha não pegou. Dá para criar, editar e desativar atividade sem mexer em
   código.
7. **Ausências**: registre férias e licenças conforme forem acontecendo.

A partir daí os servidores lançam, os pontos já contam, a chefia acompanha a
fila e devolve o que não vale, e no fim do mês o **Painel do setor → Fechar
competência** congela o resultado.

## Recarregar a lista de atividades

Se um dia a planilha mudar e você quiser trazer as atividades novas sem perder
nada do que já está no ar, rode `npm run importar-catalogo`. Ele só acrescenta:
grupo, atividade ou feriado que já exista fica exatamente como está.

## Testar com dados de exemplo antes de valer

Para ver o sistema cheio antes de usar para valer, rode uma vez
`npm run semear -- --recriar` — ele cria a COPAG completa com onze pessoas, dois
meses de lançamentos, ausências e uma fila de validação. **Não rode isso depois
que houver dado real**: o comando limpa o banco.
