import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './estilo.css';
import { ProvedorDeSessao, useSessao } from './servicos/sessao';
import { Layout } from './componentes/Layout';
import { Carregando } from './componentes/comuns';
import { Entrada } from './paginas/Entrada';
import { PainelServidor } from './paginas/PainelServidor';
import { MeusLancamentos } from './paginas/MeusLancamentos';
import { FilaValidacao } from './paginas/FilaValidacao';
import { Ausencias } from './paginas/Ausencias';
import { PainelSetor } from './paginas/PainelSetor';
import { Historico } from './paginas/Historico';
import { Administracao } from './paginas/Administracao';
import { Auditoria } from './paginas/Auditoria';
import { TrocarSenha } from './paginas/TrocarSenha';

function Rotas() {
  const { usuario, carregando, ehChefia, ehAdmin } = useSessao();

  if (carregando) return <Carregando texto="Abrindo o sistema..." />;
  if (!usuario) return <Entrada />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<PainelServidor />} />
        <Route path="/lancamentos" element={<MeusLancamentos />} />
        <Route path="/senha" element={<TrocarSenha />} />
        {ehChefia && <Route path="/validacao" element={<FilaValidacao />} />}
        {ehChefia && <Route path="/ausencias" element={<Ausencias />} />}
        {ehChefia && <Route path="/setor" element={<PainelSetor />} />}
        {ehChefia && <Route path="/historico" element={<Historico />} />}
        {ehAdmin && <Route path="/administracao" element={<Administracao />} />}
        {ehAdmin && <Route path="/auditoria" element={<Auditoria />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('raiz')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ProvedorDeSessao>
        <Rotas />
      </ProvedorDeSessao>
    </BrowserRouter>
  </React.StrictMode>,
);
