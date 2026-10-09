import React from 'react';

// Selo "RS" no formato de folha, nas cores da RS Gestões & Participações.
export function SeloRS({ tamanho = 40 }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 64 64" aria-hidden="true" className="selo-rs">
      <path d="M22 2h36a4 4 0 0 1 4 4v36c0 11-9 20-20 20H6a4 4 0 0 1-4-4V22C2 11 11 2 22 2z" fill="#9c2b28" />
      <text x="32" y="44" textAnchor="middle" fontFamily="'Playfair Display', Georgia, serif" fontWeight="700" fontSize="30" fill="#fff" letterSpacing="-1">RS</text>
    </svg>
  );
}

export default function Logo({ tamanho = 40, claro = false, subtitulo }) {
  return (
    <div className={`logo-rs ${claro ? 'claro' : ''}`}>
      <SeloRS tamanho={tamanho} />
      <div>
        <div className="logo-nome" style={{ fontSize: tamanho * 0.45 }}>Gestões &amp; Participações</div>
        {subtitulo && <div className="logo-sub">{subtitulo}</div>}
      </div>
    </div>
  );
}
