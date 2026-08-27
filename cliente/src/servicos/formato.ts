export function numero(valor: number | null | undefined, casas = 2): string {
  if (valor === null || valor === undefined) return '—';
  return valor.toLocaleString('pt-BR', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

export function percentual(valor: number | null | undefined, casas = 0): string {
  if (valor === null || valor === undefined) return '—';
  return `${(valor * 100).toLocaleString('pt-BR', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  })}%`;
}

export function data(valor: string | null | undefined): string {
  if (!valor) return '—';
  const somenteData = valor.slice(0, 10);
  const [ano, mes, dia] = somenteData.split('-');
  if (!ano || !mes || !dia) return valor;
  return `${dia}/${mes}/${ano}`;
}

export function dataHora(valor: string | null | undefined): string {
  if (!valor) return '—';
  const instante = new Date(valor);
  return instante.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

export function competenciaLegivel(competencia: string): string {
  const [ano, mes] = competencia.split('-').map(Number);
  return `${MESES[mes - 1]} de ${ano}`;
}

export function competenciaAtual(): string {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
}

export function listarCompetencias(quantidade = 18): string[] {
  const lista: string[] = [];
  const hoje = new Date();
  for (let recuo = 0; recuo < quantidade; recuo += 1) {
    const referencia = new Date(hoje.getFullYear(), hoje.getMonth() - recuo, 1);
    lista.push(
      `${referencia.getFullYear()}-${String(referencia.getMonth() + 1).padStart(2, '0')}`,
    );
  }
  return lista;
}

export const ROTULO_DO_PAPEL: Record<string, string> = {
  EXECUCAO: 'Execução',
  REVISAO: 'Revisão',
  HOMOLOGACAO: 'Homologação',
};

export const ROTULO_DA_SITUACAO: Record<string, string> = {
  PENDENTE: 'Aguardando validação',
  VALIDADO: 'Validado',
  DEVOLVIDO: 'Devolvido',
};

export const ROTULO_DO_STATUS: Record<string, string> = {
  EM_ANDAMENTO: 'Em andamento',
  CONCLUIDO: 'Concluído',
};

export const ROTULO_DO_PERFIL: Record<string, string> = {
  SERVIDOR: 'Servidor',
  CHEFE: 'Chefe',
  ADMIN: 'Administrador',
};

export const ROTULO_DO_REGIME: Record<string, string> = {
  INTEGRAL: 'Integral',
  PARCIAL: 'Parcial',
  PRESENCIAL: 'Presencial',
};

export const ROTULO_DO_TIPO_AUSENCIA: Record<string, string> = {
  FERIAS: 'Férias',
  LICENCA: 'Licença',
  AFASTAMENTO: 'Afastamento',
  OUTRO: 'Outro',
};
