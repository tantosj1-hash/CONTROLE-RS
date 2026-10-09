import React, { useEffect, useRef, useState } from 'react';
import {
  EMPRESAS, ROTULO_STATUS, nomeEmpresa, tamanhoArquivo,
} from '../lib/format';
import { abrirArquivo, salvarArquivoLocal } from '../lib/files';

export function Modal({ titulo, onFechar, children, largo }) {
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onFechar();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onFechar]);
  return (
    <div className="modal-fundo" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div className={`modal ${largo ? 'largo' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-topo">
          <h3>{titulo}</h3>
          <button className="fechar" onClick={onFechar} aria-label="Fechar">×</button>
        </div>
        <div className="modal-corpo">{children}</div>
      </div>
    </div>
  );
}

export function SeloEmpresa({ id }) {
  const e = EMPRESAS[id];
  return <span className="selo" style={{ background: `${e?.cor || '#64748b'}1a`, color: e?.cor || '#64748b' }}>{nomeEmpresa(id)}</span>;
}

export function SeloStatus({ status }) {
  return <span className={`status s-${status}`}>{ROTULO_STATUS[status] || status}</span>;
}

// Só a área de arquivos mais recente (ex.: a de uma janela aberta) recebe o Ctrl+V.
const pilhaColar = [];
if (typeof window !== 'undefined') {
  window.addEventListener('paste', (e) => {
    const topo = pilhaColar[pilhaColar.length - 1];
    if (topo) topo.current(e);
  });
}

// Área para soltar, escolher ou COLAR (Ctrl+V) arquivos.
export function AreaArquivos({
  onArquivos, aceitar, texto, multiplo = true, compacta, capturarColar = true,
}) {
  const input = useRef(null);
  const [arrastando, setArrastando] = useState(false);

  const colarRef = useRef(null);
  colarRef.current = (e) => {
    const arquivos = Array.from(e.clipboardData?.files || []);
    if (arquivos.length) {
      e.preventDefault();
      onArquivos(multiplo ? arquivos : arquivos.slice(0, 1));
    }
  };
  useEffect(() => {
    if (!capturarColar) return undefined;
    pilhaColar.push(colarRef);
    return () => {
      const i = pilhaColar.indexOf(colarRef);
      if (i >= 0) pilhaColar.splice(i, 1);
    };
  }, [capturarColar]);

  return (
    <div
      className={`area-arquivos ${arrastando ? 'arrastando' : ''} ${compacta ? 'compacta' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
      onDragLeave={() => setArrastando(false)}
      onDrop={(e) => {
        e.preventDefault();
        setArrastando(false);
        const arquivos = Array.from(e.dataTransfer.files || []);
        if (arquivos.length) onArquivos(multiplo ? arquivos : arquivos.slice(0, 1));
      }}
      onClick={() => input.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
    >
      <input
        ref={input}
        type="file"
        hidden
        multiple={multiplo}
        accept={aceitar}
        onChange={(e) => {
          const arquivos = Array.from(e.target.files || []);
          e.target.value = '';
          if (arquivos.length) onArquivos(arquivos);
        }}
      />
      <div className="area-icone">⬆</div>
      <div>{texto || 'Arraste os arquivos aqui, clique para escolher ou cole com Ctrl+V'}</div>
    </div>
  );
}

export function ListaAnexos({ arquivos, onRemover, pendentes = [], onRemoverPendente }) {
  const [abrindo, setAbrindo] = useState(null);
  const [erro, setErro] = useState('');
  if (!arquivos?.length && !pendentes.length) return <div className="vazio-pequeno">Nenhum anexo.</div>;
  const acao = async (fn, id) => {
    setErro('');
    setAbrindo(id);
    try { await fn(id); } catch (e) { setErro(e.message); } finally { setAbrindo(null); }
  };
  return (
    <div className="anexos">
      {(arquivos || []).map((a) => (
        <div key={a.id} className="anexo">
          <span className="anexo-icone">{a.tipo?.includes('pdf') ? 'PDF' : a.tipo?.startsWith('image/') ? 'IMG' : 'ARQ'}</span>
          <span className="anexo-nome" title={a.nome}>{a.nome}</span>
          <span className="anexo-tam">{tamanhoArquivo(a.tamanho)}</span>
          <button type="button" className="btn mini" disabled={abrindo === a.id} onClick={() => acao(abrirArquivo, a.id)}>{abrindo === a.id ? '…' : 'Ver'}</button>
          <button type="button" className="btn mini" onClick={() => acao(salvarArquivoLocal, a.id)}>Baixar</button>
          {onRemover && <button type="button" className="btn mini perigo" onClick={() => onRemover(a)}>Remover</button>}
        </div>
      ))}
      {pendentes.map((f, i) => (
        <div key={`p${i}`} className="anexo pendente">
          <span className="anexo-icone">NOVO</span>
          <span className="anexo-nome">{f.name}</span>
          <span className="anexo-tam">{tamanhoArquivo(f.size)}</span>
          {onRemoverPendente && <button type="button" className="btn mini perigo" onClick={() => onRemoverPendente(i)}>Remover</button>}
        </div>
      ))}
      {erro && <div className="erro">{erro}</div>}
    </div>
  );
}

export function Cartao({ titulo, valor, detalhe, cor, onClick }) {
  return (
    <div className={`kpi ${onClick ? 'clicavel' : ''}`} onClick={onClick} style={cor ? { borderTopColor: cor } : undefined}>
      <div className="kpi-titulo">{titulo}</div>
      <div className="kpi-valor" style={cor ? { color: cor } : undefined}>{valor}</div>
      {detalhe && <div className="kpi-detalhe">{detalhe}</div>}
    </div>
  );
}

export function Progresso({ texto }) {
  if (!texto) return null;
  return <div className="progresso"><span className="spinner" /> {texto}</div>;
}

export function confirmar(texto) {
  return window.confirm(texto);
}
