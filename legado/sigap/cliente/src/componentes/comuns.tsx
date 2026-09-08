import { useEffect, type ReactNode } from 'react';
import { Icone } from './icones';
import { competenciaLegivel, listarCompetencias, numero, percentual } from '../servicos/formato';

export function Cartao({
  titulo,
  descricao,
  acoes,
  children,
}: {
  titulo?: ReactNode;
  descricao?: ReactNode;
  acoes?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="cartao">
      {(titulo || acoes) && (
        <div className="cartao-titulo">
          <div>
            {titulo && <h2>{titulo}</h2>}
            {descricao && <p>{descricao}</p>}
          </div>
          {acoes && <div className="acoes">{acoes}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Medida({
  rotulo,
  valor,
  apoio,
}: {
  rotulo: string;
  valor: ReactNode;
  apoio?: ReactNode;
}) {
  return (
    <div className="medida">
      <span className="medida-rotulo">{rotulo}</span>
      <span className="medida-valor">{valor}</span>
      {apoio && <span className="medida-apoio">{apoio}</span>}
    </div>
  );
}

export function Aviso({
  tipo = 'informativo',
  children,
}: {
  tipo?: 'informativo' | 'atencao' | 'erro' | 'sucesso';
  children: ReactNode;
}) {
  if (!children) return null;
  return <div className={`aviso aviso-${tipo}`}>{children}</div>;
}

/** Estado vazio diz o que fazer; nao pede desculpa. */
export function Vazio({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className="vazio">
      <strong>{titulo}</strong>
      {children}
    </div>
  );
}

export function Carregando({ texto = 'Carregando...' }: { texto?: string }) {
  return <div className="carregando">{texto}</div>;
}

export function Campo({
  rotulo,
  dica,
  children,
}: {
  rotulo: string;
  dica?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="campo">
      <span>{rotulo}</span>
      {children}
      {dica && <span className="campo-dica">{dica}</span>}
    </label>
  );
}

export function Modal({
  titulo,
  aoFechar,
  rodape,
  children,
}: {
  titulo: string;
  aoFechar: () => void;
  rodape?: ReactNode;
  children: ReactNode;
}) {
  // Esc fecha; clique na cortina nao. O modal quase sempre guarda um
  // formulario pela metade, e perder o preenchimento por um clique de raspao
  // fora da caixa custa muito mais caro do que um clique a mais no Fechar.
  useEffect(() => {
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === 'Escape') aoFechar();
    }
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [aoFechar]);

  return (
    <div className="cortina" role="presentation">
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-titulo">
          <h2>{titulo}</h2>
          <button
            type="button"
            className="botao botao-discreto"
            onClick={aoFechar}
            aria-label="Fechar"
          >
            {Icone.fecha} Fechar
          </button>
        </div>
        {children}
        {rodape && <div className="modal-rodape">{rodape}</div>}
      </div>
    </div>
  );
}

/** Iniciais em círculo, para dar rosto às listas por pessoa. */
export function Avatar({ nome, tom }: { nome: string; tom?: 'proprio' }) {
  const iniciais = nome
    .trim()
    .split(/\s+/)
    .filter((parte) => parte.length > 2)
    .slice(0, 2)
    .map((parte) => parte[0])
    .join('')
    .toUpperCase();
  return (
    <span className="avatar" data-tom={tom} aria-hidden="true">
      {iniciais || nome.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function MarcaSituacao({ situacao }: { situacao: string }) {
  const classe =
    situacao === 'VALIDADO' ? 'marca-validado'
    : situacao === 'DEVOLVIDO' ? 'marca-devolvido'
    : situacao === 'PENDENTE' ? 'marca-pendente'
    : 'marca-neutra';
  const texto =
    situacao === 'VALIDADO' ? 'Conferido'
    : situacao === 'DEVOLVIDO' ? 'Devolvido · fora da média'
    : situacao === 'PENDENTE' ? 'Contando, a conferir'
    : situacao;
  return <span className={`marca ${classe}`}>{texto}</span>;
}

/* Âmbar e verde não se separam sob daltonismo: cada faixa carrega um símbolo
   além da cor e do texto. */
export const SIMBOLO_DA_FAIXA: Record<string, string> = {
  ABAIXO: '▼',
  DENTRO: '●',
  ACIMA: '▲',
};

export function RotuloFaixa({ faixa, texto }: { faixa: string | null; texto?: string | null }) {
  const classe = faixa ? `faixa-${faixa}` : 'faixa-NENHUMA';
  return (
    <span className={`rotulo-faixa ${classe}`}>
      {faixa && (
        <i className="simbolo-faixa" aria-hidden="true">
          {SIMBOLO_DA_FAIXA[faixa]}
        </i>
      )}
      {texto ?? 'Sem referência'}
    </span>
  );
}

/**
 * O numero de atingimento e o elemento principal da tela do servidor, e vem
 * sempre acompanhado da referencia: a media isolada nao informa nada.
 */
export function IndicadorAtingimento({
  atingimento,
  faixa,
  faixaRotulo,
  media,
  referencia,
  origemRotulo,
  limites = { abaixo: 85, acima: 115 },
}: {
  atingimento: number | null;
  faixa: string | null;
  faixaRotulo: string | null;
  media: number | null;
  referencia: number | null;
  origemRotulo: string;
  limites?: { abaixo: number; acima: number };
}) {
  return (
    <div className={`atingimento ${faixa ? `faixa-${faixa}` : 'faixa-NENHUMA'}`}>
      <span className="medida-rotulo">Atingimento no mês</span>
      <span className="atingimento-numero">{percentual(atingimento, 0)}</span>
      <span className="atingimento-faixa">
        {faixa && (
          <i className="simbolo-faixa" aria-hidden="true">
            {SIMBOLO_DA_FAIXA[faixa]}
          </i>
        )}
        {faixaRotulo ?? 'Sem referência definida'}
      </span>
      <span className="atingimento-referencia">
        Sua média: <strong>{numero(media, 2)}</strong> ponto(s) por dia efetivo · Referência do
        grupo: <strong>{numero(referencia, 2)}</strong>
      </span>
      <span className="campo-dica">{origemRotulo}</span>
      <EscalaDeFaixas atingimento={atingimento} faixa={faixa} limites={limites} />
    </div>
  );
}

/** Situa o resultado entre as tres faixas, sem transformar em aprovado ou reprovado. */
function EscalaDeFaixas({
  atingimento,
  faixa,
  limites,
}: {
  atingimento: number | null;
  faixa: string | null;
  limites: { abaixo: number; acima: number };
}) {
  const percentualAtual = atingimento === null ? null : atingimento * 100;
  const teto = Math.max(limites.acima + 40, (percentualAtual ?? 0) + 15);
  const posicao =
    percentualAtual === null ? null : Math.min(100, Math.max(0, (percentualAtual / teto) * 100));

  const trechos = [
    { chave: 'ABAIXO', rotulo: 'Abaixo', largura: (limites.abaixo / teto) * 100 },
    { chave: 'DENTRO', rotulo: 'Dentro', largura: ((limites.acima - limites.abaixo) / teto) * 100 },
    { chave: 'ACIMA', rotulo: 'Acima', largura: ((teto - limites.acima) / teto) * 100 },
  ];

  return (
    <div className="escala" style={{ marginTop: '1rem' }}>
      <div className="barra-faixas">
        {trechos.map((trecho) => (
          <span
            key={trecho.chave}
            className={`trecho-${trecho.chave}`}
            style={{ width: `${trecho.largura}%` }}
            title={trecho.rotulo}
          />
        ))}
      </div>
      {posicao !== null && (
        <div className="marcador-escala" style={{ left: `${posicao}%` }} aria-hidden="true" />
      )}
      <div className="legenda-escala">
        <span className={faixa === 'ABAIXO' ? 'faixa-ABAIXO' : undefined}>
          Abaixo · menos de {limites.abaixo}%
        </span>
        <span className={faixa === 'DENTRO' ? 'faixa-DENTRO' : undefined}>
          Dentro · {limites.abaixo}% a {limites.acima}%
        </span>
        <span className={faixa === 'ACIMA' ? 'faixa-ACIMA' : undefined}>
          Acima · mais de {limites.acima}%
        </span>
      </div>
    </div>
  );
}

export function DistribuicaoNiveis({ niveis }: { niveis: Record<string, number> }) {
  const total = Object.values(niveis).reduce((soma, valor) => soma + valor, 0);
  return (
    <span className="pontos-nivel" title="Quantidade de lançamentos por nível de complexidade">
      {[1, 2, 3, 4].map((nivel) => {
        const quantidade = niveis[String(nivel)] ?? 0;
        const proporcao = total === 0 ? 0 : quantidade / total;
        return (
          <i key={nivel} data-uso={proporcao >= 0.4 && quantidade > 0 ? 'alto' : 'normal'}>
            {quantidade}
          </i>
        );
      })}
    </span>
  );
}

export function SeletorCompetencia({
  valor,
  aoMudar,
}: {
  valor: string;
  aoMudar: (competencia: string) => void;
}) {
  const opcoes = listarCompetencias();
  const lista = opcoes.includes(valor) ? opcoes : [valor, ...opcoes];
  return (
    <Campo rotulo="Competência">
      <select value={valor} onChange={(evento) => aoMudar(evento.target.value)}>
        {lista.map((competencia) => (
          <option key={competencia} value={competencia}>
            {competenciaLegivel(competencia)}
          </option>
        ))}
      </select>
    </Campo>
  );
}

export function Abas({
  abas,
  ativa,
  aoMudar,
}: {
  abas: Array<{ chave: string; rotulo: string }>;
  ativa: string;
  aoMudar: (chave: string) => void;
}) {
  return (
    <div className="abas">
      {abas.map((aba) => (
        <button
          key={aba.chave}
          type="button"
          className={aba.chave === ativa ? 'ativa' : ''}
          onClick={() => aoMudar(aba.chave)}
        >
          {aba.rotulo}
        </button>
      ))}
    </div>
  );
}
