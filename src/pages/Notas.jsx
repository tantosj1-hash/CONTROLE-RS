import React, { useCallback, useMemo, useState } from 'react';
import { useDados } from '../Principal';
import {
  Modal, AreaArquivos, SeloEmpresa, SeloStatus, Progresso, confirmar, ListaAnexos,
} from '../components/ui';
import { FormNota, FormBaixa, CamposNota } from '../components/NotaForm';
import {
  brl, dataBR, statusNota, semAcento, formatarDoc, hojeISO, somarDias,
} from '../lib/format';
import { formatarLinhaDigitavel } from '../lib/parsers';
import { processarArquivosNotas, criarEnviador } from '../lib/importacao';
import {
  salvarNota, darBaixa, estornarBaixa, excluirNota,
} from '../lib/data';

export default function Notas() {
  const dados = useDados();
  const { notasFiltradas, empresa, avisar } = dados;
  const [filtro, setFiltro] = useState({
    tipo: 'todos', status: 'pendentes', de: '', ate: '', busca: '', campoData: 'vencimento',
  });
  const [editar, setEditar] = useState(null);
  const [baixa, setBaixa] = useState(null);
  const [detalhe, setDetalhe] = useState(null);
  const [importacao, setImportacao] = useState(null);
  const [lendo, setLendo] = useState('');

  const lista = useMemo(() => {
    const b = semAcento(filtro.busca);
    return notasFiltradas
      .map((n) => ({ ...n, _status: statusNota(n) }))
      .filter((n) => filtro.tipo === 'todos' || n.tipo === filtro.tipo)
      .filter((n) => {
        if (filtro.status === 'todos') return true;
        if (filtro.status === 'pendentes') return n._status === 'aberto' || n._status === 'vencido';
        return n._status === filtro.status;
      })
      .filter((n) => {
        const d = n[filtro.campoData] || '';
        return (!filtro.de || d >= filtro.de) && (!filtro.ate || d <= filtro.ate);
      })
      .filter((n) => !b || semAcento(`${n.numero} ${n.parteNome} ${n.parteDoc} ${n.descricao} ${n.categoria} ${n.valor}`).includes(b))
      .sort((a, c) => (a.vencimento || a.dataEmissao || '9').localeCompare(c.vencimento || c.dataEmissao || '9'));
  }, [notasFiltradas, filtro]);

  const totais = useMemo(() => {
    const t = { pagar: 0, receber: 0 };
    lista.forEach((n) => { if (n.status !== 'cancelado') t[n.tipo] += Number(n.valor) || 0; });
    return t;
  }, [lista]);

  const receberArquivos = useCallback(async (arquivos) => {
    try {
      setLendo('Lendo arquivos…');
      const itens = await processarArquivosNotas(arquivos, {
        configEmpresas: dados.configEmpresas,
        empresaPadrao: dados.empresaPadrao,
        notas: dados.notas,
        aoProgredir: setLendo,
      });
      setImportacao(itens);
    } catch (e) {
      avisar(e.message, 'erro');
    } finally {
      setLendo('');
    }
  }, [dados.configEmpresas, dados.empresaPadrao, dados.notas, avisar]);

  async function estornar(n) {
    if (!confirmar(`Desfazer o pagamento da NF ${n.numero || 's/n'}? Ela voltará para "em aberto".`)) return;
    try { await estornarBaixa(n, dados.movimentos); avisar('Baixa desfeita.'); } catch (e) { avisar(e.message, 'erro'); }
  }
  async function excluir(n) {
    if (!confirmar(`Excluir a NF ${n.numero || 's/n'} de ${n.parteNome || ''} (${brl(n.valor)})? Os anexos também serão apagados.`)) return;
    try { await excluirNota(n, dados); avisar('Nota excluída.'); } catch (e) { avisar(e.message, 'erro'); }
  }
  async function copiar(texto) {
    try { await navigator.clipboard.writeText(texto); avisar('Linha digitável copiada.'); } catch { avisar('Não foi possível copiar.', 'erro'); }
  }

  const f = (campo) => (e) => setFiltro((x) => ({ ...x, [campo]: e.target.value }));

  return (
    <div className="pagina">
      <div className="titulo-pagina">
        <div>
          <h1>Notas Fiscais e Contas</h1>
          <p className="sub">Notas que entram (a pagar) e notas emitidas (a receber), com boletos e situação de pagamento.</p>
        </div>
        <button className="btn primario" onClick={() => setEditar({})}>+ Lançar manualmente</button>
      </div>

      <AreaArquivos
        onArquivos={receberArquivos}
        aceitar=".pdf,.xml,.xlsx,.xls,.csv,.ods,image/*"
        texto={<><b>Cole ou arraste aqui as notas fiscais e boletos</b><br />PDF, XML da NF-e/NFS-e, Excel/CSV ou foto — o sistema identifica a nota, a empresa e o boleto automaticamente</>}
      />
      <Progresso texto={lendo} />

      <div className="filtros">
        <select value={filtro.tipo} onChange={f('tipo')}>
          <option value="todos">Pagar e receber</option>
          <option value="pagar">Contas a pagar</option>
          <option value="receber">Contas a receber</option>
        </select>
        <select value={filtro.status} onChange={f('status')}>
          <option value="pendentes">Pendentes (em aberto + vencidas)</option>
          <option value="vencido">Somente vencidas</option>
          <option value="pago">Pagas / recebidas</option>
          <option value="cancelado">Canceladas</option>
          <option value="todos">Todas</option>
        </select>
        <select value={filtro.campoData} onChange={f('campoData')}>
          <option value="vencimento">Por vencimento</option>
          <option value="dataEmissao">Por emissão</option>
          <option value="dataPagamento">Por pagamento</option>
        </select>
        <input type="date" value={filtro.de} onChange={f('de')} title="De" />
        <input type="date" value={filtro.ate} onChange={f('ate')} title="Até" />
        <input type="search" placeholder="Buscar fornecedor, nº, valor…" value={filtro.busca} onChange={f('busca')} />
        <div className="atalhos">
          <button className="btn mini" onClick={() => setFiltro((x) => ({ ...x, status: 'pendentes', campoData: 'vencimento', de: '', ate: somarDias(hojeISO(), 7) }))}>Vencem em 7 dias</button>
          <button className="btn mini" onClick={() => setFiltro({ tipo: 'todos', status: 'pendentes', de: '', ate: '', busca: '', campoData: 'vencimento' })}>Limpar</button>
        </div>
      </div>

      <div className="totais-linha">
        <span>{lista.length} registro(s)</span>
        <span>A pagar: <b className="neg">{brl(totais.pagar)}</b></span>
        <span>A receber: <b className="pos">{brl(totais.receber)}</b></span>
      </div>

      <div className="tabela-wrap">
        <table className="tabela">
          <thead>
            <tr>
              {empresa === 'todas' && <th>Empresa</th>}
              <th>Tipo</th><th>Nº NF</th><th>Fornecedor / Cliente</th><th>Emissão</th><th>Vencimento</th>
              <th className="dir">Valor</th><th>Situação</th><th>Boleto</th><th>Anexos</th><th />
            </tr>
          </thead>
          <tbody>
            {lista.map((n) => (
              <tr key={n.id} className={n._status === 'vencido' ? 'linha-vencida' : ''}>
                {empresa === 'todas' && <td><SeloEmpresa id={n.empresa} /></td>}
                <td><span className={`tipo t-${n.tipo}`}>{n.tipo === 'pagar' ? 'Pagar' : 'Receber'}</span></td>
                <td>{n.numero || '—'}</td>
                <td>
                  <button className="link forte" onClick={() => setDetalhe(n)}>{n.parteNome || '(sem nome)'}</button>
                  <div className="mini-texto">{n.categoria}{n.categoria && n.descricao ? ' · ' : ''}{n.descricao?.slice(0, 60)}</div>
                </td>
                <td>{dataBR(n.dataEmissao)}</td>
                <td>{dataBR(n.vencimento)}</td>
                <td className="dir nowrap">{brl(n.valor)}</td>
                <td><SeloStatus status={n._status} />{n.dataPagamento && <div className="mini-texto">em {dataBR(n.dataPagamento)}</div>}</td>
                <td>{n.linhaDigitavel ? <button className="btn mini" title={formatarLinhaDigitavel(n.linhaDigitavel)} onClick={() => copiar(n.linhaDigitavel)}>Copiar</button> : '—'}</td>
                <td>{(n.arquivos || []).length || '—'}</td>
                <td className="acoes">
                  {n.status === 'aberto' && <button className="btn mini sucesso" onClick={() => setBaixa(n)}>{n.tipo === 'pagar' ? 'Pagar' : 'Receber'}</button>}
                  {n.status === 'pago' && <button className="btn mini" onClick={() => estornar(n)}>Desfazer</button>}
                  <button className="btn mini" onClick={() => setEditar(n)}>Editar</button>
                  <button className="btn mini perigo" onClick={() => excluir(n)} aria-label="Excluir">✕</button>
                </td>
              </tr>
            ))}
            {!lista.length && <tr><td colSpan={11} className="vazio">Nenhuma nota encontrada com esses filtros.</td></tr>}
          </tbody>
        </table>
      </div>

      {editar && <FormNota inicial={editar.id ? editar : null} onFechar={() => setEditar(null)} />}
      {baixa && <FormBaixa nota={baixa} onFechar={() => setBaixa(null)} />}
      {detalhe && <DetalheNota nota={detalhe} onFechar={() => setDetalhe(null)} onEditar={() => { setEditar(detalhe); setDetalhe(null); }} />}
      {importacao && <RevisaoImportacao itensIniciais={importacao} onFechar={() => setImportacao(null)} />}
    </div>
  );
}

function DetalheNota({ nota, onFechar, onEditar }) {
  const { movimentos } = useDados();
  const mov = movimentos.find((m) => m.id === nota.movimentoId);
  return (
    <Modal titulo={`NF ${nota.numero || 's/n'} – ${nota.parteNome || ''}`} onFechar={onFechar} largo>
      <dl className="detalhes">
        <dt>Empresa</dt><dd><SeloEmpresa id={nota.empresa} /></dd>
        <dt>Tipo</dt><dd>{nota.tipo === 'pagar' ? 'Conta a pagar' : 'Conta a receber'}</dd>
        <dt>Fornecedor/Cliente</dt><dd>{nota.parteNome} {nota.parteDoc && `(${formatarDoc(nota.parteDoc)})`}</dd>
        <dt>Valor</dt><dd><b>{brl(nota.valor)}</b></dd>
        <dt>Emissão / Vencimento</dt><dd>{dataBR(nota.dataEmissao) || '—'} / {dataBR(nota.vencimento) || '—'}</dd>
        <dt>Situação</dt><dd><SeloStatus status={statusNota(nota)} /> {nota.dataPagamento && `em ${dataBR(nota.dataPagamento)} – ${brl(nota.valorPago ?? nota.valor)}`}</dd>
        {mov && <><dt>Lançamento</dt><dd>{dataBR(mov.data)} · {mov.descricao} · {mov.formaPagamento}</dd></>}
        <dt>Categoria</dt><dd>{nota.categoria || '—'}</dd>
        <dt>Descrição</dt><dd>{nota.descricao || '—'}</dd>
        {nota.linhaDigitavel && <><dt>Boleto</dt><dd className="mono">{formatarLinhaDigitavel(nota.linhaDigitavel)}</dd></>}
        {nota.chave && <><dt>Chave de acesso</dt><dd className="mono">{nota.chave}</dd></>}
        <dt>Cadastrado por</dt><dd>{nota.criadoPor} {nota.atualizadoPor && nota.atualizadoPor !== nota.criadoPor && `· alterado por ${nota.atualizadoPor}`}</dd>
      </dl>
      <h4>Anexos</h4>
      <ListaAnexos arquivos={[...(nota.arquivos || []), ...((mov?.arquivos) || [])]} />
      <div className="acoes-form"><button className="btn" onClick={onFechar}>Fechar</button><button className="btn primario" onClick={onEditar}>Editar</button></div>
    </Modal>
  );
}

function RevisaoImportacao({ itensIniciais, onFechar }) {
  const { avisar } = useDados();
  const [itens, setItens] = useState(itensIniciais);
  const [ocupado, setOcupado] = useState('');
  const alterarItem = (chave, mudancas) => setItens((lst) => lst.map((it) => (it.chave === chave ? { ...it, ...mudancas } : it)));
  const alterarNota = (chave, m) => setItens((lst) => lst.map((it) => (it.chave === chave ? { ...it, nota: { ...it.nota, ...m } } : it)));
  const selecionados = itens.filter((i) => i.incluir);

  async function salvarTudo() {
    const semValor = selecionados.find((i) => !(Number(i.nota.valor) > 0));
    if (semValor) { avisar(`Preencha o valor de "${semValor.origem}".`, 'erro'); return; }
    const enviar = criarEnviador(setOcupado);
    let ok = 0;
    try {
      for (const it of selecionados) {
        setOcupado(`Salvando ${ok + 1} de ${selecionados.length}…`);
        const metas = await enviar(it.arquivos || [], it.nota.empresa);
        if (it.atualizarNota) {
          const { id, ...resto } = it.nota;
          const arquivos = [...(it.atualizarNota.arquivos || []), ...metas];
          await salvarNota({ ...resto, arquivos }, it.atualizarNota.id);
        } else {
          const nota = { ...it.nota, valor: Number(it.nota.valor), arquivos: metas, status: it.nota.status === 'cancelado' ? 'cancelado' : 'aberto' };
          const id = await salvarNota(nota);
          if (it.pago || it.nota.status === 'pago') {
            await darBaixa({ ...nota, id }, { data: it.dataPagamento || it.nota.vencimento || hojeISO(), valor: nota.valor });
          }
        }
        ok += 1;
      }
      avisar(`${ok} registro(s) salvo(s).`);
      onFechar();
    } catch (e) {
      avisar(`Erro após salvar ${ok}: ${e.message}`, 'erro');
      setItens((lst) => lst.filter((x) => !selecionados.slice(0, ok).includes(x)));
      setOcupado('');
    }
  }

  return (
    <Modal titulo={`Conferir leitura automática (${itens.length})`} onFechar={() => !ocupado && onFechar()} largo>
      <p className="sub">Confira os dados lidos de cada arquivo. Você pode corrigir qualquer campo antes de salvar. Itens com alerta foram desmarcados ou precisam de atenção.</p>
      <div className="lista-revisao">
        {itens.map((it) => (
          <div key={it.chave} className={`revisao ${it.incluir ? '' : 'desmarcado'}`}>
            <div className="revisao-topo">
              <label className="check"><input type="checkbox" checked={it.incluir} onChange={(e) => alterarItem(it.chave, { incluir: e.target.checked })} /> Salvar</label>
              <span className="origem">{it.origem}</span>
              {it.atualizarNota && <span className="selo-info">Atualiza nota existente</span>}
              <label className="check direita">
                <input type="checkbox" checked={!!it.pago} disabled={!!it.atualizarNota} onChange={(e) => alterarItem(it.chave, { pago: e.target.checked })} /> Já está paga
              </label>
              {it.pago && <input type="date" value={it.dataPagamento || ''} onChange={(e) => alterarItem(it.chave, { dataPagamento: e.target.value })} title="Data do pagamento" />}
            </div>
            {(it.avisos || []).map((a) => <div key={a} className="alerta">{a}</div>)}
            <CamposNota compacto nota={it.nota} alterar={(m) => alterarNota(it.chave, m)} />
          </div>
        ))}
      </div>
      <Progresso texto={ocupado} />
      <div className="acoes-form fixo">
        <span>{selecionados.length} de {itens.length} selecionado(s)</span>
        <button className="btn" onClick={onFechar} disabled={!!ocupado}>Cancelar</button>
        <button className="btn primario" onClick={salvarTudo} disabled={!!ocupado || !selecionados.length}>Salvar selecionados</button>
      </div>
    </Modal>
  );
}
