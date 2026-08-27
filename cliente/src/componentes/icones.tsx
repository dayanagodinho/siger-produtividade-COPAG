/* Ícones em traço, no mesmo peso do texto, seguindo o padrão dos sistemas
   da Casa: um símbolo por item de menu e um por ação. */

const tracado = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function svg(children: React.ReactNode) {
  return (
    <svg viewBox="0 0 24 24" {...tracado} aria-hidden="true">
      {children}
    </svg>
  );
}

export const Icone = {
  // Navegação
  painel: svg(
    <>
      <path d="M3 12l9-8 9 8" />
      <path d="M5 10v10h14V10" />
    </>,
  ),
  lancamentos: svg(
    <>
      <path d="M7 3h10a2 2 0 012 2v14a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2z" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </>,
  ),
  validacao: svg(
    <>
      <path d="M4 6h9M4 12h9M4 18h5" />
      <path d="M15 16l2.5 2.5L22 14" />
    </>,
  ),
  ausencias: svg(
    <>
      <path d="M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z" />
      <path d="M8 3v4M16 3v4M4 10h16" />
    </>,
  ),
  setor: svg(<path d="M4 20V10M10 20V4M16 20v-8M22 20H2" />),
  historico: svg(
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7v5l3 2" />
    </>,
  ),
  cadastros: svg(
    <>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
      <path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </>,
  ),
  auditoria: svg(
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4.3-4.3" />
    </>,
  ),
  senha: svg(
    <>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 018 0v3" />
    </>,
  ),
  casa: svg(
    <>
      <path d="M3 11l9-7 9 7" />
      <path d="M6 10v9h12v-9" />
    </>,
  ),

  // Ações
  lupa: svg(
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4.3-4.3" />
    </>,
  ),
  mais: svg(<path d="M12 5v14M5 12h14" />),
  baixar: svg(
    <>
      <path d="M12 3v12" />
      <path d="M8 11l4 4 4-4" />
      <path d="M4 19h16" />
    </>,
  ),
  confere: svg(<path d="M20 6L9 17l-5-5" />),
  devolve: svg(
    <>
      <path d="M10 15l-5-5 5-5" />
      <path d="M5 10h9a5 5 0 015 5v4" />
    </>,
  ),
  ajusta: svg(
    <>
      <path d="M4 20h4L19 9a2.1 2.1 0 00-3-3L5 17v3z" />
      <path d="M14.5 6.5l3 3" />
    </>,
  ),
  limpa: svg(
    <>
      <path d="M4 20h16" />
      <path d="M13.5 4.5l6 6L11 19H5v-6z" />
    </>,
  ),
  fecha: svg(<path d="M6 6l12 12M18 6L6 18" />),
  cadeado: svg(
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 018 0v3" />
    </>,
  ),
  sair: svg(
    <>
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </>,
  ),
  seta: svg(<path d="M9 6l6 6-6 6" />),
};
