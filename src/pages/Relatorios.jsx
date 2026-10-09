import React, { useMemo, useState } from 'react';
import { useDados } from '../Principal';
import { Progresso } from '../components/ui';
import { brl, hojeISO, LISTA_EMPRESAS } from '../lib/format';
import {
  dadosRelatorio, gerarPDF, gerarExcel, gerarPacoteContador, baixarBlob,
} from '../lib/relatorios';

function periodoMes(deslocamento) {
  const d = new Date();
  const ini = new Date(d.getFullYear(), d.getMonth() + deslocamento, 1);
  const fim = new Date(d.getFullYear(), d.getMonth() + deslocamento + 1, 0);
  const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  return { de: iso(ini), ate: iso(fim) };
}

export default function Relatorios() {
  const dados = useDados();
  const [empresa, setEmpresa] = useState(dados.empresa);
  const [periodo, setPeriodo] = useState(periodoMes(0));
  const [incluir, setIncluir] = useState({
    entradas: true, saidas: true, categorias: true, notas: true, abertas: true,
  });
  const [ocupado, setOcupado] = useState('');

  const opcoes = {
    notas: dados.notas,
    movimentos: dados.movimentos,
    empresa,
    de: periodo.de,
    ate: periodo.ate,
    configEmpresas: dados.configEmpresas,
    usuario: dados.email,
    incluir,
  };
  const previa = useMemo(() => dadosRelatorio(opcoes), [dados.notas, dados.movimentos, empresa, periodo.de, periodo.ate]);

  async function executar(fn, texto) {
    try {
      setOcupado(texto);
      baixarBlob(await fn(opcoes, setOcupado));
    } catch (e) {
      dados.avisar(e.message, 'erro');
    } finally {
      setOcupado('');
    }
  }

  const tog = (c) => (e) => setIncluir((x) => ({ ...x, [c]: e.target.checked }));
  const ano = new Date().getFullYear();

  return (
    <div className="pagina">
      <div className="titulo-pagina"><div><h1>Relatórios</h1><p className="sub">Extração em PDF de todas as entradas e saídas, com as informações que o contador precisa.</p></div></div>

      <section className="cartao">
        <div className="grade-form">
          <label>Empresa
            <select value={empresa} onChange={(e) => setEmpresa(e.target.value)}>
              <option value="todas">Consolidado (RS Serviços + RS Gestões)</option>
              {LISTA_EMPRESAS.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
          </label>
          <label>De<input type="date" value={periodo.de} onChange={(e) => setPeriodo((p) => ({ ...p, de: e.target.value }))} /></label>
          <label>Até<input type="date" value={periodo.ate} onChange={(e) => setPeriodo((p) => ({ ...p, ate: e.target.value }))} /></label>
          <div className="atalhos col1">
            <button className="btn mini" onClick={() => setPeriodo(periodoMes(0))}>Este mês</button>
            <button className="btn mini" onClick={() => setPeriodo(periodoMes(-1))}>Mês passado</button>
            <button className="btn mini" onClick={() => setPeriodo({ de: `${ano}-01-01`, ate: hojeISO() })}>Ano atual</button>
            <button className="btn mini" onClick={() => setPeriodo({ de: '', ate: '' })}>Tudo</button>
          </div>
        </div>
        <div className="opcoes-relatorio">
          <label className="check"><input type="checkbox" checked={incluir.entradas} onChange={tog('entradas')} /> Entradas (recebimentos)</label>
          <label className="check"><input type="checkbox" checked={incluir.saidas} onChange={tog('saidas')} /> Saídas (pagamentos)</label>
          <label className="check"><input type="checkbox" checked={incluir.categorias} onChange={tog('categorias')} /> Totais por categoria</label>
          <label className="check"><input type="checkbox" checked={incluir.notas} onChange={tog('notas')} /> Notas fiscais do período</label>
          <label className="check"><input type="checkbox" checked={incluir.abertas} onChange={tog('abertas')} /> Contas em aberto</label>
        </div>

        <div className="kpis pequenos">
          <div className="kpi"><div className="kpi-titulo">Entradas</div><div className="kpi-valor pos">{brl(previa.totalEntradas)}</div><div className="kpi-detalhe">{previa.entradas.length} lançamento(s)</div></div>
          <div className="kpi"><div className="kpi-titulo">Saídas</div><div className="kpi-valor neg">{brl(previa.totalSaidas)}</div><div className="kpi-detalhe">{previa.saidas.length} lançamento(s)</div></div>
          <div className="kpi"><div className="kpi-titulo">Saldo</div><div className="kpi-valor">{brl(previa.totalEntradas - previa.totalSaidas)}</div></div>
          <div className="kpi"><div className="kpi-titulo">Notas no período</div><div className="kpi-valor">{previa.notasPeriodo.length}</div><div className="kpi-detalhe">{previa.emAberto.length} conta(s) em aberto</div></div>
        </div>

        <div className="botoes-relatorio">
          <button className="btn primario" disabled={!!ocupado} onClick={() => executar(gerarPDF, 'Gerando PDF…')}>Baixar PDF</button>
          <button className="btn" disabled={!!ocupado} onClick={() => executar(gerarExcel, 'Gerando Excel…')}>Baixar Excel</button>
          <button className="btn" disabled={!!ocupado} onClick={() => executar(gerarPacoteContador, 'Preparando pacote…')}>Pacote para o contador (.zip com PDF, Excel e todos os anexos)</button>
        </div>
        <Progresso texto={ocupado} />
      </section>
    </div>
  );
}
