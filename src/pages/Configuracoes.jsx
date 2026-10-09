import React, { useEffect, useState } from 'react';
import {
  collection, onSnapshot, query, orderBy, limit,
} from 'firebase/firestore';
import { sendPasswordResetEmail } from 'firebase/auth';
import { db, auth, ehDono, criarContaUsuario } from '../firebase';
import { useDados } from '../Principal';
import { msgErro } from './Login';
import { confirmar } from '../components/ui';
import { LISTA_EMPRESAS, soDigitos, formatarDoc } from '../lib/format';
import { salvarConfigEmpresas, salvarUsuario, removerUsuario } from '../lib/data';

export default function Configuracoes() {
  const { admin } = useDados();
  return (
    <div className="pagina">
      <div className="titulo-pagina"><div><h1>Configurações e Usuários</h1></div></div>
      <MinhaConta />
      <Empresas />
      {admin ? <Usuarios /> : <p className="info">Somente administradores podem gerenciar usuários.</p>}
      {admin && <Auditoria />}
    </div>
  );
}

function MinhaConta() {
  const { email, avisar } = useDados();
  async function trocarSenha() {
    try {
      await sendPasswordResetEmail(auth, email);
      avisar('Enviamos um link para você criar uma nova senha.');
    } catch (e) { avisar(msgErro(e), 'erro'); }
  }
  return (
    <section className="cartao">
      <h3>Minha conta</h3>
      <p>Conectado como <b>{email}</b>.</p>
      <button className="btn" onClick={trocarSenha}>Trocar minha senha (link por e-mail)</button>
    </section>
  );
}

function Empresas() {
  const { configEmpresas, admin, avisar } = useDados();
  const [form, setForm] = useState({});
  useEffect(() => {
    const f = {};
    LISTA_EMPRESAS.forEach((e) => { f[e.id] = { razaoSocial: configEmpresas?.[e.id]?.razaoSocial || '', cnpj: configEmpresas?.[e.id]?.cnpj || '' }; });
    setForm(f);
  }, [configEmpresas]);
  async function salvar(e) {
    e.preventDefault();
    try {
      const dados = {};
      Object.entries(form).forEach(([id, v]) => { dados[id] = { razaoSocial: v.razaoSocial.trim(), cnpj: soDigitos(v.cnpj) }; });
      await salvarConfigEmpresas(dados);
      avisar('Dados das empresas salvos.');
    } catch (err) { avisar(err.message, 'erro'); }
  }
  return (
    <section className="cartao">
      <h3>Empresas</h3>
      <p className="sub">Informe o CNPJ de cada empresa: é com ele que o sistema identifica automaticamente de qual empresa é cada nota, e se é uma nota recebida (a pagar) ou emitida (a receber).</p>
      <form onSubmit={salvar}>
        {LISTA_EMPRESAS.map((emp) => (
          <div key={emp.id} className="grade-form">
            <label className="col2">Razão social – {emp.nome}
              <input disabled={!admin} value={form[emp.id]?.razaoSocial || ''} onChange={(e) => setForm((f) => ({ ...f, [emp.id]: { ...f[emp.id], razaoSocial: e.target.value } }))} placeholder={emp.nome} />
            </label>
            <label className="col2">CNPJ – {emp.nome}
              <input disabled={!admin} value={formatarDoc(form[emp.id]?.cnpj || '')} onChange={(e) => setForm((f) => ({ ...f, [emp.id]: { ...f[emp.id], cnpj: soDigitos(e.target.value) } }))} placeholder={configEmpresas?.[emp.id]?.cnpjHash ? 'Já cadastrado (oculto) – digite para exibir nos relatórios' : '00.000.000/0000-00'} />
            </label>
          </div>
        ))}
        {admin && <div className="acoes-form"><button className="btn primario">Salvar empresas</button></div>}
      </form>
    </section>
  );
}

function Usuarios() {
  const { avisar, email: euMesmo } = useDados();
  const [lista, setLista] = useState([]);
  const [novo, setNovo] = useState({ email: '', nome: '', admin: false, senha: '' });
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => onSnapshot(collection(db, 'usuarios'), (s) => setLista(s.docs.map((d) => ({ id: d.id, ...d.data() })))), []);

  async function adicionar(e) {
    e.preventDefault();
    const email = novo.email.trim().toLowerCase();
    if (!email) return;
    setOcupado(true);
    try {
      await salvarUsuario(email, { nome: novo.nome.trim(), admin: novo.admin });
      if (novo.senha) {
        try {
          await criarContaUsuario(email, novo.senha);
          avisar(`Usuário criado. ${email} receberá um e-mail para confirmar o endereço e já pode entrar com a senha definida.`);
        } catch (err) {
          if (err.code === 'auth/email-already-in-use') avisar('Acesso liberado. Esse e-mail já tinha conta: a pessoa entra com a senha que já usa.');
          else throw err;
        }
      } else {
        avisar(`Acesso liberado. Peça para ${email} abrir o site e clicar em "Primeiro acesso" para criar a senha.`);
      }
      setNovo({ email: '', nome: '', admin: false, senha: '' });
    } catch (err) {
      avisar(msgErro(err), 'erro');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="cartao">
      <h3>Usuários com acesso</h3>
      <div className="tabela-wrap">
        <table className="tabela">
          <thead><tr><th>E-mail</th><th>Nome</th><th>Perfil</th><th /></tr></thead>
          <tbody>
            <tr><td colSpan={4} className="mini-texto">Os donos do sistema têm acesso permanente de administrador e não aparecem nesta lista.</td></tr>
            {lista.filter((u) => !ehDono(u.id)).map((u) => (
              <tr key={u.id}>
                <td>{u.id}</td>
                <td>{u.nome || '—'}</td>
                <td>
                  <select value={u.admin ? 'admin' : 'usuario'} onChange={(e) => salvarUsuario(u.id, { admin: e.target.value === 'admin' }).catch((err) => avisar(err.message, 'erro'))}>
                    <option value="usuario">Usuário</option>
                    <option value="admin">Administrador</option>
                  </select>
                </td>
                <td className="acoes">
                  {u.id !== euMesmo && (
                    <button
                      className="btn mini perigo"
                      onClick={async () => {
                        if (!confirmar(`Remover o acesso de ${u.id}?`)) return;
                        try { await removerUsuario(u.id); avisar('Acesso removido.'); } catch (err) { avisar(err.message, 'erro'); }
                      }}
                    >Remover acesso</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h4>Incluir novo usuário</h4>
      <form className="grade-form" onSubmit={adicionar}>
        <label className="col2">E-mail<input type="email" required value={novo.email} onChange={(e) => setNovo((n) => ({ ...n, email: e.target.value }))} /></label>
        <label className="col2">Nome<input value={novo.nome} onChange={(e) => setNovo((n) => ({ ...n, nome: e.target.value }))} /></label>
        <label className="col2">Senha inicial (opcional, mín. 8)
          <input type="password" autoComplete="new-password" minLength={8} value={novo.senha} onChange={(e) => setNovo((n) => ({ ...n, senha: e.target.value }))} placeholder="Deixe vazio para a pessoa criar" />
        </label>
        <label className="check col1"><input type="checkbox" checked={novo.admin} onChange={(e) => setNovo((n) => ({ ...n, admin: e.target.checked }))} /> Administrador</label>
        <div className="col1"><button className="btn primario" disabled={ocupado}>{ocupado ? 'Salvando…' : 'Liberar acesso'}</button></div>
      </form>
    </section>
  );
}

function Auditoria() {
  const [itens, setItens] = useState([]);
  useEffect(() => onSnapshot(
    query(collection(db, 'auditoria'), orderBy('quando', 'desc'), limit(100)),
    (s) => setItens(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
    () => {},
  ), []);
  return (
    <section className="cartao">
      <h3>Histórico de alterações (últimas 100)</h3>
      <div className="tabela-wrap alta">
        <table className="tabela compacta">
          <thead><tr><th>Quando</th><th>Usuário</th><th>Ação</th><th>Registro</th></tr></thead>
          <tbody>
            {itens.map((i) => (
              <tr key={i.id}>
                <td className="nowrap">{i.quando?.toDate ? i.quando.toDate().toLocaleString('pt-BR') : '…'}</td>
                <td>{i.usuario}</td>
                <td>{i.acao} ({i.colecao})</td>
                <td>{i.resumo}</td>
              </tr>
            ))}
            {!itens.length && <tr><td colSpan={4} className="vazio">Sem registros.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
