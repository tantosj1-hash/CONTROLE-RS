import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { db, auth, DONOS } from './firebase';
import { EMPRESAS, LISTA_EMPRESAS } from './lib/format';
import Painel from './pages/Painel';
import Notas from './pages/Notas';
import Extrato from './pages/Extrato';
import Pagamentos from './pages/Pagamentos';
import Relatorios from './pages/Relatorios';
import Configuracoes from './pages/Configuracoes';

const Ctx = createContext(null);
export const useDados = () => useContext(Ctx);

const PAGINAS = [
  { id: 'painel', nome: 'Painel', icone: '▦' },
  { id: 'notas', nome: 'Notas Fiscais / Contas', icone: '🧾' },
  { id: 'extrato', nome: 'Extrato Bancário', icone: '🏦' },
  { id: 'pagamentos', nome: 'Pagamentos e Comprovantes', icone: '📎' },
  { id: 'relatorios', nome: 'Relatórios (PDF / Excel)', icone: '📄' },
  { id: 'config', nome: 'Configurações e Usuários', icone: '⚙' },
];

function lerPreferencia(chave, padrao) {
  try { return localStorage.getItem(chave) || padrao; } catch { return padrao; }
}
function gravarPreferencia(chave, valor) {
  try { localStorage.setItem(chave, valor); } catch { /* ignora */ }
}

export default function Principal({ usuario }) {
  const [notas, setNotas] = useState([]);
  const [movimentos, setMovimentos] = useState([]);
  const [configEmpresas, setConfigEmpresas] = useState({});
  const [cadastro, setCadastro] = useState(null);
  const [carregado, setCarregado] = useState({ notas: false, movimentos: false });
  const [semAcesso, setSemAcesso] = useState(false);
  const [empresa, setEmpresaState] = useState(() => lerPreferencia('rs-empresa', 'todas'));
  const [pagina, setPagina] = useState(() => lerPreferencia('rs-pagina', 'painel'));
  const [menuAberto, setMenuAberto] = useState(false);
  const [toast, setToast] = useState(null);

  const email = usuario.email.toLowerCase();
  const ehDono = DONOS.includes(email);

  useEffect(() => {
    const erro = (e) => {
      if (e.code === 'permission-denied') setSemAcesso(true);
      else console.error(e);
    };
    const mapear = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const u1 = onSnapshot(collection(db, 'notas'), (s) => { setNotas(mapear(s)); setCarregado((c) => ({ ...c, notas: true })); }, erro);
    const u2 = onSnapshot(collection(db, 'movimentos'), (s) => { setMovimentos(mapear(s)); setCarregado((c) => ({ ...c, movimentos: true })); }, erro);
    // CNPJs cadastrados no sistema; o que for salvo em Configurações tem prioridade.
    const u3 = onSnapshot(doc(db, 'config', 'empresas'), (s) => {
      const salvo = s.data() || {};
      const cfg = {};
      LISTA_EMPRESAS.forEach((e) => {
        cfg[e.id] = { razaoSocial: salvo[e.id]?.razaoSocial || '', cnpj: salvo[e.id]?.cnpj || e.cnpj };
      });
      setConfigEmpresas(cfg);
    }, erro);
    const u4 = onSnapshot(doc(db, 'usuarios', email), (s) => setCadastro(s.data() || null), () => {});
    return () => { u1(); u2(); u3(); u4(); };
  }, [email]);

  const setEmpresa = (e) => { setEmpresaState(e); gravarPreferencia('rs-empresa', e); };
  const irPara = (p) => { setPagina(p); gravarPreferencia('rs-pagina', p); setMenuAberto(false); window.scrollTo(0, 0); };

  const avisar = (texto, tipo = 'ok') => {
    setToast({ texto, tipo });
    setTimeout(() => setToast(null), tipo === 'erro' ? 7000 : 3500);
  };

  const valor = useMemo(() => {
    const filtrar = (lista) => (empresa === 'todas' ? lista : lista.filter((x) => x.empresa === empresa));
    return {
      usuario,
      email,
      admin: ehDono || cadastro?.admin === true,
      empresa,
      setEmpresa,
      empresaPadrao: empresa === 'todas' ? null : empresa,
      notas,
      movimentos,
      notasFiltradas: filtrar(notas),
      movimentosFiltrados: filtrar(movimentos),
      configEmpresas,
      avisar,
      irPara,
    };
  }, [usuario, email, ehDono, cadastro, empresa, notas, movimentos, configEmpresas]);

  if (semAcesso) {
    return (
      <div className="tela-login">
        <div className="cartao login">
          <div className="logo-grande">RS</div>
          <h2>Acesso não liberado</h2>
          <p>O e-mail <b>{usuario.email}</b> ainda não foi autorizado. Peça a um administrador para incluir seu e-mail em <i>Configurações e Usuários</i>.</p>
          <button className="btn primario largo" onClick={() => signOut(auth)}>Sair</button>
        </div>
      </div>
    );
  }

  const nomeEmpresaAtual = empresa === 'todas' ? 'Consolidado (todas)' : EMPRESAS[empresa]?.nome;
  const Pagina = { painel: Painel, notas: Notas, extrato: Extrato, pagamentos: Pagamentos, relatorios: Relatorios, config: Configuracoes }[pagina] || Painel;

  return (
    <Ctx.Provider value={valor}>
      <div className="layout">
        <aside className={`lateral ${menuAberto ? 'aberto' : ''}`}>
          <div className="marca"><span className="logo">RS</span> Controle RS</div>
          <nav>
            {PAGINAS.map((p) => (
              <button key={p.id} className={`nav-item ${pagina === p.id ? 'ativo' : ''}`} onClick={() => irPara(p.id)}>
                <span className="nav-icone">{p.icone}</span>{p.nome}
              </button>
            ))}
          </nav>
          <div className="lateral-rodape">
            <div className="usuario-email" title={usuario.email}>{usuario.email}</div>
            <button className="btn fantasma pequeno" onClick={() => signOut(auth)}>Sair</button>
          </div>
        </aside>
        {menuAberto && <div className="sombra-menu" onClick={() => setMenuAberto(false)} />}
        <main className="conteudo">
          <header className="topo">
            <button className="btn-menu" onClick={() => setMenuAberto(true)} aria-label="Menu">☰</button>
            <div className="seletor-empresa" role="tablist" aria-label="Empresa">
              {[{ id: 'todas', nome: 'Todas' }, ...LISTA_EMPRESAS].map((e) => (
                <button
                  key={e.id}
                  role="tab"
                  aria-selected={empresa === e.id}
                  className={`aba-empresa ${empresa === e.id ? 'ativa' : ''}`}
                  style={empresa === e.id && e.cor ? { background: e.cor, borderColor: e.cor } : undefined}
                  onClick={() => setEmpresa(e.id)}
                >
                  {e.nome}
                </button>
              ))}
            </div>
            <div className="topo-info">Visualizando: <b>{nomeEmpresaAtual}</b></div>
          </header>
          {!carregado.notas || !carregado.movimentos ? <div className="carregando">Carregando dados…</div> : <Pagina />}
        </main>
        {toast && <div className={`toast ${toast.tipo}`}>{toast.texto}</div>}
      </div>
    </Ctx.Provider>
  );
}
