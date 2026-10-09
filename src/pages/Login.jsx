import React, { useState } from 'react';
import {
  signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification,
  sendPasswordResetEmail, signOut, setPersistence, browserSessionPersistence, browserLocalPersistence,
} from 'firebase/auth';
import { auth } from '../firebase';
import Logo from '../components/Logo';

const MENSAGENS = {
  'auth/invalid-credential': 'E-mail ou senha incorretos.',
  'auth/wrong-password': 'E-mail ou senha incorretos.',
  'auth/user-not-found': 'E-mail ou senha incorretos.',
  'auth/invalid-email': 'E-mail inválido.',
  'auth/email-already-in-use': 'Este e-mail já tem cadastro. Use "Entrar" ou "Esqueci minha senha".',
  'auth/weak-password': 'A senha precisa ter pelo menos 8 caracteres.',
  'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
  'auth/network-request-failed': 'Sem conexão com a internet.',
};
export const msgErro = (e) => MENSAGENS[e?.code] || e?.message || 'Erro inesperado.';

export default function Login() {
  const [modo, setModo] = useState('entrar');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [senha2, setSenha2] = useState('');
  const [lembrar, setLembrar] = useState(false);
  const [msg, setMsg] = useState('');
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function enviar(e) {
    e.preventDefault();
    setErro('');
    setMsg('');
    setOcupado(true);
    try {
      if (modo === 'entrar') {
        await setPersistence(auth, lembrar ? browserLocalPersistence : browserSessionPersistence);
        await signInWithEmailAndPassword(auth, email.trim(), senha);
      } else if (modo === 'criar') {
        if (senha.length < 8) throw Object.assign(new Error(), { code: 'auth/weak-password' });
        if (senha !== senha2) throw new Error('As senhas não conferem.');
        await setPersistence(auth, browserSessionPersistence);
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), senha);
        await sendEmailVerification(cred.user);
      } else {
        await sendPasswordResetEmail(auth, email.trim());
        setMsg('Se o e-mail estiver cadastrado, você receberá um link para criar uma nova senha. Confira também a caixa de spam.');
        setModo('entrar');
      }
    } catch (err) {
      setErro(msgErro(err));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="tela-login">
      <form className="cartao login" onSubmit={enviar}>
        <div className="login-logo"><Logo tamanho={46} /></div>
        <div className="faixa-titulo">Controle Financeiro</div>
        <p className="sub">RS Serviços · RS Gestões</p>
        {modo === 'criar' && <p className="aviso">Primeiro acesso: use o e-mail liberado pelo administrador e crie sua senha. Você receberá um e-mail de confirmação.</p>}
        <label>E-mail<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        {modo !== 'recuperar' && (
          <label>Senha<input type="password" autoComplete={modo === 'criar' ? 'new-password' : 'current-password'} value={senha} onChange={(e) => setSenha(e.target.value)} required minLength={modo === 'criar' ? 8 : undefined} /></label>
        )}
        {modo === 'criar' && <label>Repita a senha<input type="password" autoComplete="new-password" value={senha2} onChange={(e) => setSenha2(e.target.value)} required /></label>}
        {modo === 'entrar' && (
          <label className="check"><input type="checkbox" checked={lembrar} onChange={(e) => setLembrar(e.target.checked)} /> Manter conectado neste computador</label>
        )}
        {erro && <div className="erro">{erro}</div>}
        {msg && <div className="ok">{msg}</div>}
        <button className="btn primario largo" disabled={ocupado}>
          {ocupado ? 'Aguarde…' : modo === 'entrar' ? 'Entrar' : modo === 'criar' ? 'Criar senha' : 'Enviar link'}
        </button>
        <div className="links">
          {modo !== 'entrar' && <button type="button" className="link" onClick={() => setModo('entrar')}>Voltar para o login</button>}
          {modo === 'entrar' && <button type="button" className="link" onClick={() => setModo('criar')}>Primeiro acesso</button>}
          {modo === 'entrar' && <button type="button" className="link" onClick={() => setModo('recuperar')}>Esqueci minha senha</button>}
        </div>
      </form>
    </div>
  );
}

export function VerificarEmail({ usuario }) {
  const [msg, setMsg] = useState('');
  async function reenviar() {
    try {
      await sendEmailVerification(usuario);
      setMsg('E-mail reenviado. Confira também a caixa de spam.');
    } catch (e) {
      setMsg(msgErro(e));
    }
  }
  async function jaConfirmei() {
    await usuario.reload();
    await usuario.getIdToken(true);
    if (auth.currentUser?.emailVerified) window.location.reload();
    else setMsg('Ainda não consta a confirmação. Clique no link enviado para o seu e-mail.');
  }
  return (
    <div className="tela-login">
      <div className="cartao login">
        <div className="login-logo"><Logo tamanho={46} /></div>
        <h2>Confirme seu e-mail</h2>
        <p>Enviamos um link de confirmação para <b>{usuario.email}</b>. Por segurança, o acesso aos dados só é liberado depois da confirmação.</p>
        {msg && <div className="ok">{msg}</div>}
        <button className="btn primario largo" onClick={jaConfirmei}>Já confirmei</button>
        <div className="links">
          <button className="link" onClick={reenviar}>Reenviar e-mail</button>
          <button className="link" onClick={() => signOut(auth)}>Sair</button>
        </div>
      </div>
    </div>
  );
}
