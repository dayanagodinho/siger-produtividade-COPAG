import { useState } from 'react';
import { useSessao } from '../servicos/sessao';
import { mensagemDeErro } from '../servicos/api';
import { Aviso, Campo } from '../componentes/comuns';

export function Entrada() {
  const { entrar } = useSessao();
  const [identificacao, setIdentificacao] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function submeter(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await entrar(identificacao.trim(), senha);
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="tela-entrada">
      <form className="caixa-entrada" onSubmit={submeter}>
        <h1>Controle de Produtividade</h1>
        <p className="subtitulo">Apuração mensal por setor, em regime híbrido.</p>

        {erro && <Aviso tipo="erro">{erro}</Aviso>}

        <Campo rotulo="Matrícula ou e-mail">
          <input
            value={identificacao}
            onChange={(evento) => setIdentificacao(evento.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </Campo>

        <Campo rotulo="Senha">
          <input
            type="password"
            value={senha}
            onChange={(evento) => setSenha(evento.target.value)}
            autoComplete="current-password"
            required
          />
        </Campo>

        <button
          type="submit"
          className="botao botao-principal"
          disabled={enviando}
          style={{ width: '100%', justifyContent: 'center', marginTop: '0.5rem' }}
        >
          {enviando ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
