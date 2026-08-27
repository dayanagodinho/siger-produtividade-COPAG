import { useCallback, useState, type ReactNode } from 'react';
import { numero, percentual } from '../servicos/formato';

/* ==========================================================================
   Gráficos em SVG, sem biblioteca externa.
   Marcas finas, extremidade do dado arredondada em 4px e ancorada na linha de
   base, grade discreta, rótulo direto onde cabe e dica no ponteiro. As escalas
   de cor são ordinais — mais escuro é mais — e vêm dos tokens do sistema.
   ========================================================================== */

interface PosicaoDaDica {
  x: number;
  y: number;
  conteudo: ReactNode;
}

function useDica() {
  const [dica, setDica] = useState<PosicaoDaDica | null>(null);

  const aoEntrar = useCallback((evento: React.MouseEvent, conteudo: ReactNode) => {
    const caixa = evento.currentTarget.closest('.grafico')?.getBoundingClientRect();
    if (!caixa) return;
    setDica({ x: evento.clientX - caixa.left, y: evento.clientY - caixa.top, conteudo });
  }, []);

  const aoSair = useCallback(() => setDica(null), []);

  const elemento = dica ? (
    <div
      className="dica-grafico"
      style={{ left: `${dica.x}px`, top: `${dica.y}px` }}
      role="tooltip"
    >
      {dica.conteudo}
    </div>
  ) : null;

  return { aoEntrar, aoSair, elemento };
}

/** Caminho de barra com a ponta do dado arredondada e a base reta. */
function barra(x: number, y: number, largura: number, altura: number, sentido: 'horizontal' | 'vertical') {
  const r = Math.min(4, sentido === 'horizontal' ? largura : altura);
  if (r <= 0) return '';
  if (sentido === 'horizontal') {
    return `M${x},${y} H${x + largura - r} A${r},${r} 0 0 1 ${x + largura},${y + r} V${y + altura - r} A${r},${r} 0 0 1 ${x + largura - r},${y + altura} H${x} Z`;
  }
  return `M${x},${y + altura} V${y + r} A${r},${r} 0 0 1 ${x + r},${y} H${x + largura - r} A${r},${r} 0 0 1 ${x + largura},${y + r} V${y + altura} Z`;
}

export function Figura({
  titulo,
  apoio,
  children,
}: {
  titulo: string;
  apoio?: ReactNode;
  children: ReactNode;
}) {
  return (
    <figure className="figura">
      <figcaption>
        <strong>{titulo}</strong>
        {apoio && <span>{apoio}</span>}
      </figcaption>
      <div className="grafico">{children}</div>
    </figure>
  );
}

// ---------------------------------------------------------------------------

export interface ItemDeBarra {
  rotulo: string;
  apoio?: string;
  valor: number | null;
  cor?: string;
  formatado?: string;
}

/**
 * Barras horizontais com linha de referência opcional. Usada para comparar
 * pessoas: o nome fica no eixo, o valor na ponta da barra.
 */
export function BarrasHorizontais({
  itens,
  referencia,
  rotuloReferencia,
  formatar = (v) => numero(v, 2),
  alturaDaBarra = 22,
}: {
  itens: ItemDeBarra[];
  referencia?: number | null;
  rotuloReferencia?: string;
  formatar?: (valor: number) => string;
  alturaDaBarra?: number;
}) {
  const { aoEntrar, aoSair, elemento } = useDica();
  const larguraRotulo = 148;
  const larguraValor = 52;
  const largura = 520;
  const espaco = 12;
  const alturaLinha = alturaDaBarra + espaco;
  const altura = itens.length * alturaLinha + 24;
  const areaPlot = largura - larguraRotulo - larguraValor;

  const maximo = Math.max(
    ...itens.map((i) => i.valor ?? 0),
    referencia ?? 0,
    0.0001,
  );
  const escala = (valor: number) => (valor / maximo) * areaPlot;

  return (
    <>
      <svg
        viewBox={`0 0 ${largura} ${altura}`}
        className="svg-grafico"
        style={{ maxWidth: `${largura}px` }}
        role="img"
      >
        {referencia !== null && referencia !== undefined && referencia > 0 && (
          <g>
            <line
              x1={larguraRotulo + escala(referencia)}
              y1={4}
              x2={larguraRotulo + escala(referencia)}
              y2={altura - 20}
              className="linha-referencia"
            />
            <text
              x={larguraRotulo + escala(referencia)}
              y={altura - 6}
              className="rotulo-eixo"
              textAnchor="middle"
            >
              {rotuloReferencia ?? `referência ${formatar(referencia)}`}
            </text>
          </g>
        )}

        {itens.map((item, indice) => {
          const y = indice * alturaLinha + 4;
          const valor = item.valor ?? 0;
          const comprimento = Math.max(item.valor === null ? 0 : 2, escala(valor));
          return (
            <g key={item.rotulo}>
              <text x={larguraRotulo - 10} y={y + alturaDaBarra / 2 + 4} className="rotulo-eixo" textAnchor="end">
                {item.rotulo}
              </text>
              {item.valor === null ? (
                <text x={larguraRotulo + 4} y={y + alturaDaBarra / 2 + 4} className="rotulo-ausente">
                  sem apuração
                </text>
              ) : (
                <>
                  <path
                    d={barra(larguraRotulo, y, comprimento, alturaDaBarra, 'horizontal')}
                    fill={item.cor ?? 'var(--verde-600)'}
                    onMouseEnter={(evento) =>
                      aoEntrar(
                        evento,
                        <>
                          <strong>{item.rotulo}</strong>
                          {item.apoio && <div>{item.apoio}</div>}
                          <div>{item.formatado ?? formatar(valor)}</div>
                        </>,
                      )
                    }
                    onMouseLeave={aoSair}
                  />
                  <text
                    x={larguraRotulo + comprimento + 8}
                    y={y + alturaDaBarra / 2 + 4}
                    className="valor-direto"
                  >
                    {item.formatado ?? formatar(valor)}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>
      {elemento}
    </>
  );
}

// ---------------------------------------------------------------------------

export interface FatiaDaRosca {
  rotulo: string;
  valor: number;
  cor: string;
}

/**
 * Rosca de composição. Só para poucas fatias e com o total no centro; cada
 * fatia é nomeada na legenda, nunca apenas pela cor.
 */
export function Rosca({
  fatias,
  totalRotulo,
  formatar = (v) => numero(v, 1),
}: {
  fatias: FatiaDaRosca[];
  totalRotulo?: string;
  formatar?: (valor: number) => string;
}) {
  const { aoEntrar, aoSair, elemento } = useDica();
  const total = fatias.reduce((soma, f) => soma + f.valor, 0);
  const raio = 78;
  const espessura = 26;
  const centro = 92;

  if (total <= 0) {
    return <p className="campo-dica">Ainda não há pontos validados para compor este gráfico.</p>;
  }

  let anguloAtual = -Math.PI / 2;
  const vaoRadianos = 0.035; // afastamento de 2px entre fatias

  const arcos = fatias
    .filter((fatia) => fatia.valor > 0)
    .map((fatia) => {
      const proporcao = fatia.valor / total;
      const varredura = proporcao * Math.PI * 2;
      const inicio = anguloAtual + vaoRadianos / 2;
      const fim = anguloAtual + varredura - vaoRadianos / 2;
      anguloAtual += varredura;

      const ponto = (angulo: number, r: number) => [
        centro + r * Math.cos(angulo),
        centro + r * Math.sin(angulo),
      ];
      const [x1, y1] = ponto(inicio, raio);
      const [x2, y2] = ponto(fim, raio);
      const [x3, y3] = ponto(fim, raio - espessura);
      const [x4, y4] = ponto(inicio, raio - espessura);
      const maior = fim - inicio > Math.PI ? 1 : 0;

      return {
        ...fatia,
        proporcao,
        d: `M${x1},${y1} A${raio},${raio} 0 ${maior} 1 ${x2},${y2} L${x3},${y3} A${raio - espessura},${raio - espessura} 0 ${maior} 0 ${x4},${y4} Z`,
      };
    });

  return (
    <div className="rosca">
      <svg viewBox="0 0 184 184" className="svg-rosca" role="img">
        {arcos.map((arco) => (
          <path
            key={arco.rotulo}
            d={arco.d}
            fill={arco.cor}
            onMouseEnter={(evento) =>
              aoEntrar(
                evento,
                <>
                  <strong>{arco.rotulo}</strong>
                  <div>
                    {formatar(arco.valor)} · {percentual(arco.proporcao, 0)}
                  </div>
                </>,
              )
            }
            onMouseLeave={aoSair}
          />
        ))}
        <text x={centro} y={centro - 2} className="rosca-total" textAnchor="middle">
          {formatar(total)}
        </text>
        {totalRotulo && (
          <text x={centro} y={centro + 16} className="rosca-legenda" textAnchor="middle">
            {totalRotulo}
          </text>
        )}
      </svg>
      <ul className="legenda">
        {arcos.map((arco) => (
          <li key={arco.rotulo}>
            <i style={{ background: arco.cor }} aria-hidden="true" />
            <span>{arco.rotulo}</span>
            <strong>{formatar(arco.valor)}</strong>
            <em>{percentual(arco.proporcao, 0)}</em>
          </li>
        ))}
      </ul>
      {elemento}
    </div>
  );
}

// ---------------------------------------------------------------------------

export interface ColunaDoPeriodo {
  rotulo: string;
  valor: number | null;
  referencia?: number | null;
  destaque?: boolean;
}

/** Colunas por competência, com a referência do grupo como linha de apoio. */
export function ColunasDoPeriodo({
  colunas,
  formatar = (v) => numero(v, 2),
}: {
  colunas: ColunaDoPeriodo[];
  formatar?: (valor: number) => string;
}) {
  const { aoEntrar, aoSair, elemento } = useDica();
  const largura = 620;
  const altura = 220;
  const margem = { topo: 16, base: 40, esquerda: 12, direita: 12 };
  const areaAltura = altura - margem.topo - margem.base;
  const areaLargura = largura - margem.esquerda - margem.direita;
  const larguraColuna = Math.min(46, (areaLargura / Math.max(colunas.length, 1)) * 0.55);
  const passo = areaLargura / Math.max(colunas.length, 1);

  const maximo = Math.max(
    ...colunas.map((c) => Math.max(c.valor ?? 0, c.referencia ?? 0)),
    0.0001,
  );
  const y = (valor: number) => margem.topo + areaAltura - (valor / maximo) * areaAltura;

  return (
    <>
      <svg
        viewBox={`0 0 ${largura} ${altura}`}
        className="svg-grafico"
        style={{ maxWidth: `${largura}px` }}
        role="img"
      >
        {[0.5, 1].map((fracao) => (
          <line
            key={fracao}
            x1={margem.esquerda}
            x2={largura - margem.direita}
            y1={y(maximo * fracao)}
            y2={y(maximo * fracao)}
            className="grade"
          />
        ))}
        <line
          x1={margem.esquerda}
          x2={largura - margem.direita}
          y1={margem.topo + areaAltura}
          y2={margem.topo + areaAltura}
          className="eixo"
        />

        {colunas.map((coluna, indice) => {
          const centro = margem.esquerda + passo * indice + passo / 2;
          const x = centro - larguraColuna / 2;
          const valor = coluna.valor ?? 0;
          const topo = y(valor);
          const alturaColuna = margem.topo + areaAltura - topo;

          return (
            <g key={coluna.rotulo}>
              {coluna.valor !== null && alturaColuna > 0 && (
                <path
                  d={barra(x, topo, larguraColuna, alturaColuna, 'vertical')}
                  fill={coluna.destaque ? 'var(--verde-600)' : 'var(--verde-300)'}
                  onMouseEnter={(evento) =>
                    aoEntrar(
                      evento,
                      <>
                        <strong>{coluna.rotulo}</strong>
                        <div>média {formatar(valor)}</div>
                        {coluna.referencia ? <div>referência {formatar(coluna.referencia)}</div> : null}
                      </>,
                    )
                  }
                  onMouseLeave={aoSair}
                />
              )}
              {coluna.referencia ? (
                <line
                  x1={centro - larguraColuna / 2 - 5}
                  x2={centro + larguraColuna / 2 + 5}
                  y1={y(coluna.referencia)}
                  y2={y(coluna.referencia)}
                  className="marca-referencia"
                />
              ) : null}
              {coluna.valor === null && (
                <text x={centro} y={margem.topo + areaAltura - 8} className="rotulo-ausente" textAnchor="middle">
                  —
                </text>
              )}
              <text x={centro} y={altura - 22} className="rotulo-eixo" textAnchor="middle">
                {coluna.rotulo}
              </text>
              {coluna.valor !== null && (
                <text x={centro} y={altura - 6} className="valor-direto" textAnchor="middle">
                  {formatar(valor)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <p className="legenda-linha">
        <span className="amostra-coluna" aria-hidden="true" /> média do mês
        <span className="amostra-referencia" aria-hidden="true" /> referência do grupo
      </p>
      {elemento}
    </>
  );
}

// ---------------------------------------------------------------------------

export const CORES_DOS_NIVEIS = [
  'var(--nivel-1)',
  'var(--nivel-2)',
  'var(--nivel-3)',
  'var(--nivel-4)',
];

/** Distribuição dos níveis N1 a N4 como barra única, por pessoa ou total. */
export function BarraDeNiveis({
  niveis,
  compacta = false,
}: {
  niveis: Record<string, number>;
  compacta?: boolean;
}) {
  const { aoEntrar, aoSair, elemento } = useDica();
  const valores = [1, 2, 3, 4].map((nivel) => niveis[String(nivel)] ?? 0);
  const total = valores.reduce((soma, valor) => soma + valor, 0);
  const largura = 240;
  const altura = compacta ? 10 : 16;

  if (total === 0) {
    return <span className="campo-dica">sem lançamentos</span>;
  }

  let deslocamento = 0;
  return (
    <>
      <svg
        viewBox={`0 0 ${largura} ${altura}`}
        className="svg-niveis"
        data-compacta={compacta ? 'sim' : undefined}
        role="img"
        preserveAspectRatio="none"
      >
        {valores.map((valor, indice) => {
          if (valor === 0) return null;
          const comprimento = (valor / total) * largura;
          const x = deslocamento;
          deslocamento += comprimento;
          return (
            <rect
              key={indice}
              x={x}
              y={0}
              width={Math.max(0, comprimento - 2)}
              height={altura}
              rx={2}
              fill={CORES_DOS_NIVEIS[indice]}
              onMouseEnter={(evento) =>
                aoEntrar(
                  evento,
                  <>
                    <strong>N{indice + 1}</strong>
                    <div>
                      {valor} lançamento(s) · {percentual(valor / total, 0)}
                    </div>
                  </>,
                )
              }
              onMouseLeave={aoSair}
            />
          );
        })}
      </svg>
      {elemento}
    </>
  );
}

export function LegendaDeNiveis({
  rotulos,
  contagem,
}: {
  rotulos: Record<number, string>;
  contagem?: Record<string, number>;
}) {
  const total = contagem
    ? [1, 2, 3, 4].reduce((soma, nivel) => soma + (contagem[String(nivel)] ?? 0), 0)
    : 0;
  return (
    <ul className="legenda legenda-niveis">
      {[1, 2, 3, 4].map((nivel) => {
        const quantidade = contagem?.[String(nivel)] ?? 0;
        return (
          <li key={nivel}>
            <i style={{ background: CORES_DOS_NIVEIS[nivel - 1] }} aria-hidden="true" />
            <span>
              N{nivel} · {rotulos[nivel] ?? ''}
            </span>
            {contagem && (
              <>
                <strong>{quantidade}</strong>
                <em>{total > 0 ? percentual(quantidade / total, 0) : '—'}</em>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}
