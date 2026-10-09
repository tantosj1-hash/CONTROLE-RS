import React, { useMemo } from 'react';
import { useDados } from '../Principal';
import { Cartao, SeloEmpresa, SeloStatus } from '../components/ui';
import {
  brl, dataBR, hojeISO, somarDias, statusNota, LISTA_EMPRESAS,
} from '../lib/format';

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function resumo(notas, movimentos) {
  const hoje = hojeISO();
  const mes = hoje.slice(0, 7);
  const r = {
    aPagar: 0, qPagar: 0, vencidoPagar: 0, qVencidoPagar: 0, aReceber: 0, qReceber: 0, vencidoReceber: 0,
    entradasMes: 0, saidasMes: 0, semComprovante: 0,
  };
  notas.forEach((n) => {
    if (n.status !== 'aberto') return;
    const vencida = statusNota(n) === 'vencido';
    if (n.tipo === 'pagar') {
      r.aPagar += n.valor || 0; r.qPagar += 1;
      if (vencida) { r.vencidoPagar += n.valor || 0; r.qVencidoPagar += 1; }
    } else {
      r.aReceber += n.valor || 0; r.qReceber += 1;
      if (vencida) r.vencidoReceber += n.valor || 0;
    }
  });
  movimentos.forEach((m) => {
    if (m.data?.slice(0, 7) === mes) {
      if (m.tipo === 'entrada') r.entradasMes += m.valor || 0; else r.saidasMes += m.valor || 0;
    }
    if (m.tipo === 'saida' && !(m.arquivos || []).length) r.semComprovante += 1;
  });
  return r;
}

export default function Painel() {
  const {
    notasFiltradas, movimentosFiltrados, empresa, notas, movimentos, irPara,
  } = useDados();
  const r = useMemo(() => resumo(notasFiltradas, movimentosFiltrados), [notasFiltradas, movimentosFiltrados]);

  const proximas = useMemo(() => {
    const limite = somarDias(hojeISO(), 10);
    return notasFiltradas
      .filter((n) => n.status === 'aberto' && n.vencimento && n.vencimento <= limite)
      .sort((a, b) => a.vencimento.localeCompare(b.vencimento))
      .slice(0, 12);
  }, [notasFiltradas]);

  const meses = useMemo(() => {
    const lista = [];
    const d = new Date();
    for (let i = 5; i >= 0; i -= 1) {
      const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
      const chave = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`;
      lista.push({ chave, rotulo: `${MESES[x.getMonth()]}/${String(x.getFullYear()).slice(2)}`, entrada: 0, saida: 0 });
    }
    movimentosFiltrados.forEach((m) => {
      const item = lista.find((l) => l.chave === m.data?.slice(0, 7));
      if (item) item[m.tipo] += m.valor || 0;
    });
    return lista;
  }, [movimentosFiltrados]);
  const maximo = Math.max(1, ...meses.flatMap((m) => [m.entrada, m.saida]));

  const porEmpresa = useMemo(() => LISTA_EMPRESAS.map((e) => ({
    ...e, ...resumo(notas.filter((n) => n.empresa === e.id), movimentos.filter((m) => m.empresa === e.id)),
  })), [notas, movimentos]);

  return (
    <div className="pagina">
      <div className="titulo-pagina"><div><h1>Painel</h1><p className="sub">Resumo financeiro {empresa === 'todas' ? 'consolidado das duas empresas' : ''}</p></div></div>
      <div className="kpis">
        <Cartao titulo="A pagar (em aberto)" valor={brl(r.aPagar)} detalhe={`${r.qPagar} conta(s)`} cor="#9c2b28" onClick={() => irPara('notas')} />
        <Cartao titulo="Vencidas a pagar" valor={brl(r.vencidoPagar)} detalhe={`${r.qVencidoPagar} conta(s)`} cor="#7f2220" onClick={() => irPara('notas')} />
        <Cartao titulo="A receber (em aberto)" valor={brl(r.aReceber)} detalhe={`${r.qReceber} nota(s) · vencido ${brl(r.vencidoReceber)}`} cor="#8a6a2f" onClick={() => irPara('notas')} />
        <Cartao titulo="Entradas no mês" valor={brl(r.entradasMes)} cor="#3f7a4f" onClick={() => irPara('pagamentos')} />
        <Cartao titulo="Saídas no mês" valor={brl(r.saidasMes)} cor="#b4532a" onClick={() => irPara('pagamentos')} />
        <Cartao titulo="Saldo do mês" valor={brl(r.entradasMes - r.saidasMes)} cor={r.entradasMes - r.saidasMes >= 0 ? '#3f7a4f' : '#9c2b28'} detalhe={r.semComprovante ? `${r.semComprovante} pagamento(s) sem comprovante` : 'Todos os pagamentos com comprovante'} />
      </div>

      <div className="duas-colunas">
        <section className="cartao">
          <h3>Vencimentos próximos e atrasados</h3>
          {!proximas.length && <div className="vazio-pequeno">Nenhuma conta vencendo nos próximos 10 dias.</div>}
          <ul className="lista-simples">
            {proximas.map((n) => (
              <li key={n.id}>
                <div>
                  <b>{n.parteNome || 'Sem nome'}</b> {empresa === 'todas' && <SeloEmpresa id={n.empresa} />}
                  <div className="mini-texto">{n.tipo === 'pagar' ? 'Pagar' : 'Receber'} · NF {n.numero || 's/n'} · {dataBR(n.vencimento)}</div>
                </div>
                <div className="dir"><div>{brl(n.valor)}</div><SeloStatus status={statusNota(n)} /></div>
              </li>
            ))}
          </ul>
        </section>
        <section className="cartao">
          <h3>Entradas × Saídas (6 meses)</h3>
          <div className="grafico" role="img" aria-label="Gráfico de entradas e saídas por mês">
            {meses.map((m) => (
              <div key={m.chave} className="grafico-col" title={`${m.rotulo}: entradas ${brl(m.entrada)} · saídas ${brl(m.saida)}`}>
                <div className="barras">
                  <div className="barra ent" style={{ height: `${(m.entrada / maximo) * 100}%` }} />
                  <div className="barra sai" style={{ height: `${(m.saida / maximo) * 100}%` }} />
                </div>
                <div className="grafico-rotulo">{m.rotulo}</div>
              </div>
            ))}
          </div>
          <div className="legenda"><span><i className="ent" /> Entradas</span><span><i className="sai" /> Saídas</span></div>
        </section>
      </div>

      {empresa === 'todas' && (
        <section className="cartao">
          <h3>Comparativo por empresa</h3>
          <div className="tabela-wrap">
            <table className="tabela">
              <thead><tr><th>Empresa</th><th className="dir">A pagar</th><th className="dir">Vencido</th><th className="dir">A receber</th><th className="dir">Entradas mês</th><th className="dir">Saídas mês</th><th className="dir">Saldo mês</th></tr></thead>
              <tbody>
                {porEmpresa.map((e) => (
                  <tr key={e.id}>
                    <td><SeloEmpresa id={e.id} /></td>
                    <td className="dir">{brl(e.aPagar)}</td>
                    <td className="dir neg">{brl(e.vencidoPagar)}</td>
                    <td className="dir">{brl(e.aReceber)}</td>
                    <td className="dir pos">{brl(e.entradasMes)}</td>
                    <td className="dir neg">{brl(e.saidasMes)}</td>
                    <td className="dir"><b>{brl(e.entradasMes - e.saidasMes)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
