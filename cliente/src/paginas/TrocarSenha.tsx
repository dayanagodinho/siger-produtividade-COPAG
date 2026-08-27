import { useState } from 'react';
import { api, mensagemDeErro } from '../servicos/api';
import { Aviso, Campo, Cartao } from '../componentes/comuns';
import { Cabecalho } from '../componentes/Layout';

export function TrocarSenha() {
  const [senhaAtual, setSenhaAtual] = useState('');
  const [senhaNova, setSenhaNova] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);

  async function submeter(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setSucesso(null);
    if (senhaNova !== confirmacao) {
      setErro('A confirmação não confere com a nova senha. Digite as duas de novo.');
      return;
    }
    try {
      await api.enviar('/autenticacao/trocar-senha', {
        senha_atual: senhaAtual,
        senha_nova: senhaNova,
      });
      setSucesso('Senha alterada.');
      setSenhaAtual('');
      setSenhaNova('');
      setConfirmacao('');
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    }
  }

  return (
    <>
      <Cabecalho titulo="Trocar senha" />
      <div className="conteudo">
        <Cartao>
          <form onSubmit={submeter} style={{ maxWidth: '420px' }}>
            {erro && <Aviso tipo="erro">{erro}</Aviso>}
            {sucesso && <Aviso tipo="sucesso">{sucesso}</Aviso>}
            <Campo rotulo="Senha atual">
              <input
                type="password"
                value={senhaAtual}
                onChange={(evento) => setSenhaAtual(evento.target.value)}
                autoComplete="current-password"
                required
              />
            </Campo>
            <Campo rotulo="Nova senha" dica="Ao menos 8 caracteres, com letras e números.">
              <input
                type="password"
                value={senhaNova}
                onChange={(evento) => setSenhaNova(evento.target.value)}
                autoComplete="new-password"
                required
              />
            </Campo>
            <Campo rotulo="Repita a nova senha">
              <input
                type="password"
                value={confirmacao}
                onChange={(evento) => setConfirmacao(evento.target.value)}
                autoComplete="new-password"
                required
              />
            </Campo>
            <button type="submit" className="botao botao-principal">
              Salvar nova senha
            </button>
          </form>
        </Cartao>
      </div>
    </>
  );
}
