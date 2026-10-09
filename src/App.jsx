import React, { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { iniciarFirebase, auth } from './firebase';
import Login, { VerificarEmail } from './pages/Login';
import Principal from './Principal';

const INATIVIDADE_MS = 30 * 60 * 1000;

export default function App() {
  const [pronto, setPronto] = useState(false);
  const [erro, setErro] = useState('');
  const [usuario, setUsuario] = useState(undefined);

  useEffect(() => {
    let cancelar = () => {};
    iniciarFirebase()
      .then(() => {
        setPronto(true);
        cancelar = onAuthStateChanged(auth, (u) => setUsuario(u));
      })
      .catch((e) => setErro(e.message));
    return () => cancelar();
  }, []);

  // Encerra a sessão após 30 minutos sem uso
  useEffect(() => {
    if (!usuario) return undefined;
    let timer;
    const reiniciar = () => {
      clearTimeout(timer);
      timer = setTimeout(() => signOut(auth), INATIVIDADE_MS);
    };
    const eventos = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'];
    eventos.forEach((ev) => window.addEventListener(ev, reiniciar, { passive: true }));
    reiniciar();
    return () => {
      clearTimeout(timer);
      eventos.forEach((ev) => window.removeEventListener(ev, reiniciar));
    };
  }, [usuario]);

  if (erro) return <div className="tela-centro"><div className="cartao"><h2>Erro ao iniciar</h2><p>{erro}</p></div></div>;
  if (!pronto || usuario === undefined) return <div className="tela-centro"><div className="carregando">Carregando…</div></div>;
  if (!usuario) return <Login />;
  if (!usuario.emailVerified) return <VerificarEmail usuario={usuario} />;
  return <Principal usuario={usuario} />;
}
