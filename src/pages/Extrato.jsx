import React, { useMemo, useState } from 'react';
import { useDados } from '../Principal';
import {
  Modal, AreaArquivos, SeloEmpresa, Progresso, confirmar,
} from '../components/ui';
import { SeletorNota } from '../components/NotaForm';
import {
  brl, dataBR, LISTA_EMPRESAS, CATEGORIAS, nomeEmpresa,
} from '../lib/format';
import { processarExtrato, criarEnviador } from '../lib/importacao';
import { salvarMovimento, darBaixa, excluirMovimento } from '../lib/data';

export default function Extrato() {
  const dados = useDados();
  const { empresa, empresaPadrao, movimentosFiltrados, notas, avisar } = dados;
  const [empresaImport, setEmpresaImport] = useState(empresaPadrao || '');
  const [lendo, setLendo] = useState('');
  const [revisao, setRevisao] = useState(null);
  const [vincular, setVincular] = useState(null);
  const [soPendentes, setSoPendentes] = useState(true);

  async function receber(arquivos) {
    const emp = empresaPadrao || empresaImport;
    if (!emp) { avisar('Escolha de qual empresa é este extrato.', 'erro'); return; }
    try {
      setLendo('Lendo extrato…');
      const linhas = await processarExtrato(arquivos, {
        empresa: emp, notas, movimentos: dados.movimentos, aoProgredir: setLendo,
      });
      if (!linhas.length) avisar('Nenhum lançamento encontrado no arquivo. Verifique se é um extrato com datas e valores.', 'erro');
      else setRevisao({ linhas, empresa: emp });
    } catch (e) {
      avisar(e.message, 'erro');
    } finally {
      setLendo('');
    }
  }

  const doExtrato = useMemo(() => movimentosFiltrados
    .filter((m) => m.origem === 'extrato')
    .filter((m) => !soPendentes || !m.notaId)
    .sort((a, b) => (b.data || '').localeCompare(a.data || '')), [movimentosFiltrados, soPendentes]);

  return (
    <div className="pagina">
      <div className="titulo-pagina">
        <div>
          <h1>Extrato Bancário</h1>
          <p className="sub">Envie o extrato (PDF, Excel, CSV ou OFX). O sistema lê as entradas e saídas e dá baixa nas notas correspondentes.</p>
        </div>
      </div>

      {!empresaPadrao && (
        <div className="linha-escolha">
          <span>Este extrato é da empresa:</span>
          {LISTA_EMPRESAS.map((e) => (
            <label key={e.id} className="check"><input type="radio" name="emp-ext" checked={empresaImport === e.id} onChange={() => setEmpresaImport(e.id)} /> {e.nome}</label>
          ))}
        </div>
      )}
      <AreaArquivos
        onArquivos={receber}
        aceitar=".pdf,.xlsx,.xls,.csv,.ods,.ofx,.txt,image/*"
        texto={<><b>Cole ou arraste aqui o extrato bancário {empresaPadrao ? `da ${nomeEmpresa(empresaPadrao)}` : ''}</b><br />PDF, Excel, CSV ou OFX</>}
      />
      <Progresso texto={lendo} />

      <div className="titulo-secao">
        <h2>Lançamentos importados do extrato</h2>
        <label className="check"><input type="checkbox" checked={soPendentes} onChange={(e) => setSoPendentes(e.target.checked)} /> Mostrar só os sem nota vinculada</label>
      </div>
      <div className="tabela-wrap">
        <table className="tabela">
          <thead><tr>{empresa === 'todas' && <th>Empresa</th>}<th>Data</th><th>Descrição</th><th>Categoria</th><th className="dir">Valor</th><th>Nota</th><th /></tr></thead>
          <tbody>
            {doExtrato.map((m) => {
              const n = notas.find((x) => x.id === m.notaId);
              return (
                <tr key={m.id}>
                  {empresa === 'todas' && <td><SeloEmpresa id={m.empresa} /></td>}
                  <td>{dataBR(m.data)}</td>
                  <td>{m.descricao}</td>
                  <td>{m.categoria || '—'}</td>
                  <td className={`dir nowrap ${m.tipo === 'entrada' ? 'pos' : 'neg'}`}>{m.tipo === 'entrada' ? '+' : '−'} {brl(m.valor)}</td>
                  <td>{n ? `NF ${n.numero || 's/n'} · ${n.parteNome}` : <button className="btn mini" onClick={() => setVincular(m)}>Vincular nota</button>}</td>
                  <td className="acoes">
                    <button
                      className="btn mini perigo"
                      onClick={async () => {
                        if (!confirmar('Excluir este lançamento do extrato?')) return;
                        try { await excluirMovimento(m, dados); avisar('Lançamento excluído.'); } catch (e) { avisar(e.message, 'erro'); }
                      }}
                    >✕</button>
                  </td>
                </tr>
              );
            })}
            {!doExtrato.length && <tr><td colSpan={7} className="vazio">Nada por aqui.</td></tr>}
          </tbody>
        </table>
      </div>

      {revisao && <RevisaoExtrato revisao={revisao} onFechar={() => setRevisao(null)} />}
      {vincular && <VincularNota mov={vincular} onFechar={() => setVincular(null)} />}
    </div>
  );
}

function VincularNota({ mov, onFechar }) {
  const { notas, avisar } = useDados();
  const [notaId, setNotaId] = useState('');
  async function salvar() {
    const nota = notas.find((n) => n.id === notaId);
    if (!nota) return;
    try {
      await darBaixa(nota, { movimentoExistenteId: mov.id, movExistente: mov, data: mov.data, valor: mov.valor });
      avisar('Nota vinculada e baixada.');
      onFechar();
    } catch (e) { avisar(e.message, 'erro'); }
  }
  return (
    <Modal titulo="Vincular a uma nota em aberto" onFechar={onFechar}>
      <p>{dataBR(mov.data)} · {mov.descricao} · <b>{brl(mov.valor)}</b></p>
      <SeletorNota mov={mov} notas={notas} valor={notaId} onChange={setNotaId} />
      <div className="acoes-form">
        <button className="btn" onClick={onFechar}>Cancelar</button>
        <button className="btn primario" disabled={!notaId} onClick={salvar}>Vincular e dar baixa</button>
      </div>
    </Modal>
  );
}

function RevisaoExtrato({ revisao, onFechar }) {
  const { notas, avisar } = useDados();
  const [linhas, setLinhas] = useState(revisao.linhas);
  const [ocupado, setOcupado] = useState('');
  const alterar = (chave, m) => setLinhas((l) => l.map((x) => (x.chave === chave ? { ...x, ...m } : x)));
  const alterarMov = (chave, m) => setLinhas((l) => l.map((x) => (x.chave === chave ? { ...x, mov: { ...x.mov, ...m } } : x)));
  const sel = linhas.filter((l) => l.incluir);
  const tot = sel.reduce((acc, l) => { acc[l.mov.tipo] += l.mov.valor; return acc; }, { entrada: 0, saida: 0 });
  const vinculadas = sel.filter((l) => l.notaId).length;

  async function salvar() {
    const enviar = criarEnviador(setOcupado);
    let ok = 0;
    try {
      for (const l of sel) {
        setOcupado(`Salvando ${ok + 1} de ${sel.length}…`);
        const arquivos = l.arquivo ? await enviar([l.arquivo], l.mov.empresa) : [];
        const movId = await salvarMovimento({ ...l.mov, arquivos, notaId: null });
        const nota = l.notaId && notas.find((n) => n.id === l.notaId);
        if (nota && nota.status === 'aberto') await darBaixa(nota, { movimentoExistenteId: movId, movExistente: l.mov, data: l.mov.data, valor: l.mov.valor });
        ok += 1;
      }
      avisar(`${ok} lançamento(s) importado(s), ${vinculadas} nota(s) baixada(s).`);
      onFechar();
    } catch (e) {
      avisar(`Erro após salvar ${ok}: ${e.message}`, 'erro');
      setLinhas((l) => l.filter((x) => !sel.slice(0, ok).includes(x)));
      setOcupado('');
    }
  }

  const reservadasPara = (chave) => new Set(linhas.filter((x) => x.chave !== chave && x.incluir && x.notaId).map((x) => x.notaId));

  return (
    <Modal titulo={`Conferir extrato – ${nomeEmpresa(revisao.empresa)} (${linhas.length} lançamentos)`} onFechar={() => !ocupado && onFechar()} largo>
      <p className="sub">Confira tipo, valor e a nota vinculada. Ao salvar, as notas vinculadas recebem baixa automaticamente. Lançamentos que parecem já registrados vêm desmarcados.</p>
      <div className="tabela-wrap alta">
        <table className="tabela compacta">
          <thead><tr><th /><th>Data</th><th>Descrição</th><th>Tipo</th><th className="dir">Valor</th><th>Categoria</th><th>Nota vinculada (baixa automática)</th></tr></thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.chave} className={l.incluir ? '' : 'desmarcado'}>
                <td><input type="checkbox" checked={l.incluir} onChange={(e) => alterar(l.chave, { incluir: e.target.checked })} /></td>
                <td><input type="date" value={l.mov.data} onChange={(e) => alterarMov(l.chave, { data: e.target.value })} /></td>
                <td>
                  <input className="larga" value={l.mov.descricao} onChange={(e) => alterarMov(l.chave, { descricao: e.target.value })} />
                  {l.duplicado && <div className="alerta mini">Possível duplicado: {dataBR(l.duplicado.data)} {l.duplicado.descricao}</div>}
                </td>
                <td>
                  <select value={l.mov.tipo} onChange={(e) => alterar(l.chave, { mov: { ...l.mov, tipo: e.target.value }, notaId: '' })}>
                    <option value="entrada">Entrada</option><option value="saida">Saída</option>
                  </select>
                </td>
                <td className="dir"><input type="number" step="0.01" className="num" value={l.mov.valor} onChange={(e) => alterarMov(l.chave, { valor: Number(e.target.value) })} /></td>
                <td><input list="lista-categorias-ext" value={l.mov.categoria} onChange={(e) => alterarMov(l.chave, { categoria: e.target.value })} /></td>
                <td><SeletorNota mov={l.mov} notas={notas} valor={l.notaId} reservadas={reservadasPara(l.chave)} onChange={(v) => alterar(l.chave, { notaId: v })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <datalist id="lista-categorias-ext">{CATEGORIAS.map((c) => <option key={c} value={c} />)}</datalist>
      </div>
      <Progresso texto={ocupado} />
      <div className="acoes-form fixo">
        <span>{sel.length} selecionado(s) · entradas <b className="pos">{brl(tot.entrada)}</b> · saídas <b className="neg">{brl(tot.saida)}</b> · {vinculadas} com nota</span>
        <button className="btn" onClick={onFechar} disabled={!!ocupado}>Cancelar</button>
        <button className="btn primario" onClick={salvar} disabled={!!ocupado || !sel.length}>Importar selecionados</button>
      </div>
    </Modal>
  );
}
