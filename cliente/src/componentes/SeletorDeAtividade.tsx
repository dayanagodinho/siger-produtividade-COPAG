import { useEffect, useMemo, useRef, useState } from 'react';
import { Icone } from './icones';

/**
 * Escolha da atividade entre as 244 lançáveis do plano de trabalho.
 *
 * Lista rolável não serve nesse tamanho: ninguém encontra "Valor Líquido
 * Negativo" descendo a barra. A busca é por texto e varre o rótulo, a redação
 * oficial, o código e o caminho até a raiz — quem lembra "pró-saúde" acha,
 * quem lembra "1.7" também.
 *
 * Os agrupadores aparecem no caminho, em letra menor, mas nunca como opção:
 * lançar num agrupador faria a mesma entrega contar duas vezes.
 */

export interface AtividadeDoSeletor {
  id: number;
  numero: string | null;
  nome: string;
  texto_completo: string | null;
  entrega: string | null;
  grupo_nome: string;
  lancavel: boolean;
  usa_tipo_folha: boolean;
  caminho: string[];
}

const MAXIMO_NA_TELA = 60;

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export function SeletorDeAtividade<T extends AtividadeDoSeletor>({
  atividades,
  valor,
  aoEscolher,
  variosGrupos,
}: {
  atividades: T[];
  valor: T | null;
  aoEscolher: (atividade: T | null) => void;
  variosGrupos: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const [destacada, setDestacada] = useState(0);
  const caixa = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLInputElement>(null);

  const lancaveis = useMemo(() => atividades.filter((a) => a.lancavel), [atividades]);

  const encontradas = useMemo(() => {
    const termos = normalizar(busca).split(/\s+/).filter(Boolean);
    if (!termos.length) return lancaveis;
    return lancaveis.filter((a) => {
      const alvo = normalizar(
        [a.numero ?? '', a.nome, a.texto_completo ?? '', a.caminho.join(' '), a.grupo_nome].join(' '),
      );
      return termos.every((termo) => alvo.includes(termo));
    });
  }, [lancaveis, busca]);

  const visiveis = encontradas.slice(0, MAXIMO_NA_TELA);

  useEffect(() => setDestacada(0), [busca]);

  useEffect(() => {
    if (!aberto) return;
    function aoClicarFora(evento: MouseEvent) {
      if (caixa.current && !caixa.current.contains(evento.target as Node)) setAberto(false);
    }
    document.addEventListener('mousedown', aoClicarFora);
    return () => document.removeEventListener('mousedown', aoClicarFora);
  }, [aberto]);

  function abrir() {
    setAberto(true);
    setBusca('');
    window.setTimeout(() => campo.current?.focus(), 0);
  }

  /**
   * Escolher fecha a lista, e o botao de abrir renasce exatamente onde estava
   * a opcao clicada. Sem barrar a propagacao, o mesmo clique segue subindo e
   * cai nesse botao recem-nascido, reabrindo a lista na cara de quem acabou
   * de escolher.
   */
  function escolher(evento: React.MouseEvent, atividade: T) {
    evento.preventDefault();
    evento.stopPropagation();
    aoEscolher(atividade);
    setAberto(false);
  }

  function aoTeclar(evento: React.KeyboardEvent) {
    if (evento.key === 'ArrowDown') {
      evento.preventDefault();
      setDestacada((i) => Math.min(i + 1, visiveis.length - 1));
    } else if (evento.key === 'ArrowUp') {
      evento.preventDefault();
      setDestacada((i) => Math.max(i - 1, 0));
    } else if (evento.key === 'Enter') {
      evento.preventDefault();
      if (visiveis[destacada]) {
        aoEscolher(visiveis[destacada]);
        setAberto(false);
      }
    } else if (evento.key === 'Escape') {
      evento.preventDefault();
      setAberto(false);
    }
  }

  return (
    <div className="seletor-arvore" ref={caixa}>
      {!aberto && (
        <button type="button" className="seletor-escolhido" onClick={abrir}>
          {valor ? (
            <span className="escolhido-texto">
              <strong>
                {valor.numero ? `${valor.numero}. ` : ''}
                {valor.nome}
              </strong>
              {valor.caminho.length > 0 && (
                <span className="escolhido-caminho">{valor.caminho.join(' › ')}</span>
              )}
            </span>
          ) : (
            <span className="escolhido-vazio">Escolha a atividade…</span>
          )}
          {Icone.lupa}
        </button>
      )}

      {aberto && (
        <>
          <input
            ref={campo}
            className="seletor-busca"
            value={busca}
            placeholder="Digite parte do nome, do código ou do texto"
            onChange={(evento) => setBusca(evento.target.value)}
            onKeyDown={aoTeclar}
          />
          <div className="seletor-resultados" role="listbox">
            {visiveis.length === 0 ? (
              <p className="seletor-nada">
                Nada encontrado para “{busca}”. Tente outra palavra — a busca olha o texto
                completo da atividade, não só o título.
              </p>
            ) : (
              visiveis.map((atividade, indice) => (
                <button
                  type="button"
                  key={atividade.id}
                  role="option"
                  aria-selected={indice === destacada}
                  className={`seletor-opcao${indice === destacada ? ' destacada' : ''}`}
                  onMouseEnter={() => setDestacada(indice)}
                  onMouseDown={(evento) => evento.preventDefault()}
                  onClick={(evento) => escolher(evento, atividade)}
                >
                  <span className="opcao-nome">
                    {atividade.numero && <em className="opcao-codigo">{atividade.numero}</em>}
                    {atividade.nome}
                  </span>
                  {(atividade.caminho.length > 0 || variosGrupos) && (
                    <span className="opcao-caminho">
                      {variosGrupos && <b>{atividade.grupo_nome}</b>}
                      {variosGrupos && atividade.caminho.length > 0 && ' › '}
                      {atividade.caminho.join(' › ')}
                    </span>
                  )}
                </button>
              ))
            )}
            {encontradas.length > MAXIMO_NA_TELA && (
              <p className="seletor-nada">
                Mostrando {MAXIMO_NA_TELA} de {encontradas.length}. Digite mais para estreitar.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
