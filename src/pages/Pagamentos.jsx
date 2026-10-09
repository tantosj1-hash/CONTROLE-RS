import React, { useMemo, useState } from 'react';
import { useDados } from '../Principal';
import {
  Modal, AreaArquivos, SeloEmpresa, Progresso, confirmar, ListaAnexos,
} from '../components/ui';
import { SeletorNota } from '../components/NotaForm';
import {
  brl, dataBR, LISTA_EMPRESAS, CATEGORIAS, FORMAS_PAGAMENTO, semAcento, soDigitos, formatarDoc, hojeISO,
} from '../lib/format';
import { processarComprovantes, criarEnviador } from '../lib/importacao';
import {
  salvarMovimento, darBaixa, excluirMovimento, movimentoPadrao,
} from '../lib/data';
import { enviarArquivo, excluirArquivo } from '../lib/files';

const ORIGENS = {
  manual: 'Manual', extrato: 'Extrato', comprovante: 'Comprovante', baixa: 'Baixa de nota',
};

function inicioDoMes() {
  return `${hojeISO().slice(0, 8)}01`;
}

export default function Pagamentos() {
  const dados = useDados();
  const { movimentosFiltrados, empresa, notas, avisar } = dados;
  const [filtro, setFiltro] = useState({
    tipo: 'todos', de: inicioDoMes(), ate: '', busca: '', categoria: '', comAnexo: 'todos',
  });
  const [editar, setEditar] = useState(null);
  const [revisao, setRevisao] = useState(null);
  const [lendo, setLendo] = useState('');

  const lista = useMemo(() => {
    const b = semAcento(filtro.busca);
    return movimentosFiltrados
      .filter((m) => filtro.tipo === 'todos' || m.tipo === filtro.tipo)
      .filter((m) => (!filtro.de || m.data >= filtro.de) && (!filtro.ate || m.data <= filtro.ate))
      .filter((m) => !filtro.categoria || m.categoria === filtro.categoria)
      .filter((m) => filtro.comAnexo === 'todos' || (filtro.comAnexo === 'sim' ? (m.arquivos || []).length : !(m.arquivos || []).length))
      .filter((m) => !b || semAcento(`${m.descricao} ${m.favorecido} ${m.categoria} ${m.valor} ${m.documento}`).includes(b))
      .sort((a, c) => (c.data || '').localeCompare(a.data || ''));
  }, [movimentosFiltrados, filtro]);

  const totais = lista.reduce((acc, m) => { acc[m.tipo] += Number(m.valor) || 0; return acc; }, { entrada: 0, saida: 0 });
  const categoriasUsadas = [...new Set(movimentosFiltrados.map((m) => m.categoria).filter(Boolean))].sort();

  async function receber(arquivos) {
    try {
      setLendo('Lendo comprovantes…');
      const itens = await processarComprovantes(arquivos, {
        empresaPadrao: dados.empresaPadrao, notas, movimentos: dados.movimentos, configEmpresas: dados.configEmpresas, aoProgredir: setLendo,
      });
      setRevisao(itens);
    } catch (e) {
      avisar(e.message, 'erro');
    } finally {
      setLendo('');
    }
  }

  const f = (campo) => (e) => setFiltro((x) => ({ ...x, [campo]: e.target.value }));

  return (
    <div className="pagina">
      <div className="titulo-pagina">
        <div>
          <h1>Pagamentos e Comprovantes</h1>
          <p className="sub">Todos os pagamentos realizados e valores recebidos, com foto/PDF do comprovante e a que cada gasto se refere.</p>
        </div>
        <div className="botoes">
          <button className="btn" onClick={() => setEditar(movimentoPadrao(dados.empresaPadrao, 'entrada'))}>+ Entrada manual</button>
          <button className="btn primario" onClick={() => setEditar(movimentoPadrao(dados.empresaPadrao, 'saida'))}>+ Pagamento manual</button>
        </div>
      </div>

      <AreaArquivos
        onArquivos={receber}
        aceitar=".pdf,image/*,.txt"
        texto={<><b>Cole ou arraste aqui fotos/PDF dos comprovantes de pagamento</b><br />O sistema lê valor, data, favorecido e forma de pagamento — e vincula à nota correspondente</>}
      />
      <Progresso texto={lendo} />

      <div className="filtros">
        <select value={filtro.tipo} onChange={f('tipo')}>
          <option value="todos">Entradas e saídas</option>
          <option value="saida">Somente saídas (pagamentos)</option>
          <option value="entrada">Somente entradas (recebimentos)</option>
        </select>
        <input type="date" value={filtro.de} onChange={f('de')} title="De" />
        <input type="date" value={filtro.ate} onChange={f('ate')} title="Até" />
        <select value={filtro.categoria} onChange={f('categoria')}>
          <option value="">Todas as categorias</option>
          {categoriasUsadas.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select value={filtro.comAnexo} onChange={f('comAnexo')}>
          <option value="todos">Com e sem comprovante</option>
          <option value="sim">Com comprovante</option>
          <option value="nao">Sem comprovante</option>
        </select>
        <input type="search" placeholder="Buscar…" value={filtro.busca} onChange={f('busca')} />
        <button className="btn mini" onClick={() => setFiltro({ tipo: 'todos', de: '', ate: '', busca: '', categoria: '', comAnexo: 'todos' })}>Ver tudo</button>
      </div>

      <div className="totais-linha">
        <span>{lista.length} lançamento(s)</span>
        <span>Entradas: <b className="pos">{brl(totais.entrada)}</b></span>
        <span>Saídas: <b className="neg">{brl(totais.saida)}</b></span>
        <span>Saldo: <b className={totais.entrada - totais.saida >= 0 ? 'pos' : 'neg'}>{brl(totais.entrada - totais.saida)}</b></span>
      </div>

      <div className="tabela-wrap">
        <table className="tabela">
          <thead>
            <tr>{empresa === 'todas' && <th>Empresa</th>}<th>Data</th><th>Descrição / referente a</th><th>Favorecido / Pagador</th><th>Categoria</th><th>Forma</th><th className="dir">Valor</th><th>Nota</th><th>Comprov.</th><th /></tr>
          </thead>
          <tbody>
            {lista.map((m) => {
              const n = m.notaId && notas.find((x) => x.id === m.notaId);
              return (
                <tr key={m.id}>
                  {empresa === 'todas' && <td><SeloEmpresa id={m.empresa} /></td>}
                  <td className="nowrap">{dataBR(m.data)}</td>
                  <td><button className="link forte" onClick={() => setEditar(m)}>{m.descricao || '(sem descrição)'}</button><div className="mini-texto">{ORIGENS[m.origem] || m.origem}</div></td>
                  <td>{m.favorecido}{m.documento && <div className="mini-texto">{formatarDoc(m.documento)}</div>}</td>
                  <td>{m.categoria || '—'}</td>
                  <td>{m.formaPagamento || '—'}</td>
                  <td className={`dir nowrap ${m.tipo === 'entrada' ? 'pos' : 'neg'}`}>{m.tipo === 'entrada' ? '+' : '−'} {brl(m.valor)}</td>
                  <td>{n ? `NF ${n.numero || 's/n'}` : '—'}</td>
                  <td>{(m.arquivos || []).length ? `📎 ${(m.arquivos || []).length}` : <span className="falta">falta</span>}</td>
                  <td className="acoes">
                    <button className="btn mini" onClick={() => setEditar(m)}>Editar</button>
                    <button
                      className="btn mini perigo"
                      aria-label="Excluir"
                      onClick={async () => {
                        if (!confirmar(`Excluir o lançamento "${m.descricao}" de ${brl(m.valor)}?${n ? ' A nota vinculada voltará para em aberto.' : ''}`)) return;
                        try { await excluirMovimento(m, dados); avisar('Lançamento excluído.'); } catch (e) { avisar(e.message, 'erro'); }
                      }}
                    >✕</button>
                  </td>
                </tr>
              );
            })}
            {!lista.length && <tr><td colSpan={10} className="vazio">Nenhum lançamento no período.</td></tr>}
          </tbody>
        </table>
      </div>

      {editar && <FormMovimento inicial={editar} onFechar={() => setEditar(null)} />}
      {revisao && <RevisaoComprovantes itensIniciais={revisao} onFechar={() => setRevisao(null)} />}
    </div>
  );
}

function CamposMovimento({ mov, alterar }) {
  const set = (c) => (e) => alterar({ [c]: e.target.value });
  return (
    <div className="grade-form">
      <label>Empresa
        <select value={mov.empresa} onChange={set('empresa')}>{LISTA_EMPRESAS.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}</select>
      </label>
      <label>Tipo
        <select value={mov.tipo} onChange={set('tipo')}>
          <option value="saida">Saída (pagamento)</option>
          <option value="entrada">Entrada (recebimento)</option>
        </select>
      </label>
      <label>Data<input type="date" value={mov.data} onChange={set('data')} required /></label>
      <label>Valor (R$)<input type="number" step="0.01" min="0" value={mov.valor} onChange={set('valor')} required /></label>
      <label className="col4">A que se refere (descrição)<input value={mov.descricao} onChange={set('descricao')} placeholder="Ex.: Aluguel de março, compra de material, conserto do carro…" required /></label>
      <label className="col2">{mov.tipo === 'saida' ? 'Favorecido (quem recebeu)' : 'Pagador (quem pagou)'}<input value={mov.favorecido} onChange={set('favorecido')} /></label>
      <label>CNPJ / CPF<input value={mov.documento} onChange={(e) => alterar({ documento: soDigitos(e.target.value) })} /></label>
      <label>Forma
        <select value={mov.formaPagamento} onChange={set('formaPagamento')}><option value="">—</option>{FORMAS_PAGAMENTO.map((x) => <option key={x}>{x}</option>)}</select>
      </label>
      <label className="col2">Categoria<input list="lista-categorias-mov" value={mov.categoria} onChange={set('categoria')} placeholder="Ex.: Combustível" /></label>
      <datalist id="lista-categorias-mov">{CATEGORIAS.map((c) => <option key={c} value={c} />)}</datalist>
    </div>
  );
}

function FormMovimento({ inicial, onFechar }) {
  const dados = useDados();
  const { notas, avisar } = dados;
  const [mov, setMov] = useState(() => ({ ...inicial, data: inicial.data || hojeISO() }));
  const [novos, setNovos] = useState([]);
  const [removidos, setRemovidos] = useState([]);
  const [notaId, setNotaId] = useState(inicial.notaId || '');
  const [ocupado, setOcupado] = useState('');
  const editando = !!inicial.id;

  async function salvar(e) {
    e.preventDefault();
    if (!(Number(mov.valor) > 0)) { avisar('Informe o valor.', 'erro'); return; }
    try {
      const metas = [];
      for (const f of novos) { setOcupado(`Enviando ${f.name}…`); metas.push(await enviarArquivo(f, mov.empresa)); }
      setOcupado('Salvando…');
      const arquivos = [...(mov.arquivos || []).filter((a) => !removidos.includes(a.id)), ...metas];
      const notaAnterior = inicial.notaId;
      const id = await salvarMovimento({ ...mov, valor: Number(mov.valor), arquivos, notaId: notaAnterior || null }, inicial.id);
      if (notaId && notaId !== notaAnterior) {
        const nota = notas.find((n) => n.id === notaId);
        if (nota) await darBaixa(nota, { movimentoExistenteId: id, movExistente: mov, data: mov.data, valor: Number(mov.valor) });
      }
      for (const r of removidos) { try { await excluirArquivo(r); } catch { /* ignora */ } }
      avisar(editando ? 'Lançamento atualizado.' : 'Lançamento salvo.');
      onFechar();
    } catch (err) {
      avisar(err.message, 'erro');
      setOcupado('');
    }
  }

  const notaVinculada = inicial.notaId && notas.find((n) => n.id === inicial.notaId);

  return (
    <Modal titulo={editando ? 'Editar lançamento' : (mov.tipo === 'saida' ? 'Novo pagamento' : 'Nova entrada')} onFechar={onFechar} largo>
      <form onSubmit={salvar}>
        <CamposMovimento mov={mov} alterar={(m) => setMov((x) => ({ ...x, ...m }))} />
        {notaVinculada
          ? <p className="info">Vinculado à NF {notaVinculada.numero || 's/n'} – {notaVinculada.parteNome} ({brl(notaVinculada.valor)}).</p>
          : (
            <label>Dar baixa em uma nota em aberto (opcional)
              <SeletorNota mov={{ ...mov, valor: Number(mov.valor) }} notas={notas} valor={notaId} onChange={setNotaId} />
            </label>
          )}
        <h4>Comprovantes / fotos</h4>
        <ListaAnexos
          arquivos={(mov.arquivos || []).filter((a) => !removidos.includes(a.id))}
          onRemover={(a) => setRemovidos((r) => [...r, a.id])}
          pendentes={novos}
          onRemoverPendente={(i) => setNovos((n) => n.filter((_, j) => j !== i))}
        />
        <AreaArquivos compacta onArquivos={(fs) => setNovos((n) => [...n, ...fs])} texto="Adicionar comprovante: arraste, clique, cole (Ctrl+V) ou tire uma foto" aceitar="image/*,.pdf" />
        <Progresso texto={ocupado} />
        <div className="acoes-form">
          <button type="button" className="btn" onClick={onFechar}>Cancelar</button>
          <button className="btn primario" disabled={!!ocupado}>Salvar</button>
        </div>
      </form>
    </Modal>
  );
}

function RevisaoComprovantes({ itensIniciais, onFechar }) {
  const dados = useDados();
  const { notas, movimentos, avisar } = dados;
  const [itens, setItens] = useState(itensIniciais);
  const [ocupado, setOcupado] = useState('');
  const alterar = (chave, m) => setItens((l) => l.map((x) => (x.chave === chave ? { ...x, ...m } : x)));
  const alterarMov = (chave, m) => setItens((l) => l.map((x) => (x.chave === chave ? { ...x, mov: { ...x.mov, ...m } } : x)));
  const sel = itens.filter((i) => i.incluir);

  async function salvar() {
    const falta = sel.find((i) => !(Number(i.mov.valor) > 0) || !i.mov.data);
    if (falta) { avisar(`Preencha valor e data de "${falta.arquivo.name}".`, 'erro'); return; }
    const enviar = criarEnviador(setOcupado);
    let ok = 0;
    try {
      for (const it of sel) {
        setOcupado(`Salvando ${ok + 1} de ${sel.length}…`);
        const metas = await enviar([it.arquivo], it.mov.empresa);
        if (it.anexarEm) {
          const existente = movimentos.find((m) => m.id === it.anexarEm);
          const { id, ...resto } = existente;
          await salvarMovimento({
            ...resto,
            descricao: resto.descricao || it.mov.descricao,
            categoria: resto.categoria || it.mov.categoria,
            favorecido: resto.favorecido || it.mov.favorecido,
            formaPagamento: resto.formaPagamento || it.mov.formaPagamento,
            arquivos: [...(resto.arquivos || []), ...metas],
          }, id);
          const nota = it.notaId && notas.find((n) => n.id === it.notaId);
          if (nota && nota.status === 'aberto' && !existente.notaId) await darBaixa(nota, { movimentoExistenteId: id, movExistente: existente, data: existente.data, valor: existente.valor });
        } else {
          const nota = it.notaId && notas.find((n) => n.id === it.notaId);
          const movId = await salvarMovimento({ ...it.mov, valor: Number(it.mov.valor), arquivos: metas, notaId: null });
          if (nota && nota.status === 'aberto') await darBaixa(nota, { movimentoExistenteId: movId, movExistente: it.mov, data: it.mov.data, valor: Number(it.mov.valor) });
        }
        ok += 1;
      }
      avisar(`${ok} comprovante(s) salvo(s).`);
      onFechar();
    } catch (e) {
      avisar(`Erro após salvar ${ok}: ${e.message}`, 'erro');
      setItens((l) => l.filter((x) => !sel.slice(0, ok).includes(x)));
      setOcupado('');
    }
  }

  return (
    <Modal titulo={`Conferir comprovantes (${itens.length})`} onFechar={() => !ocupado && onFechar()} largo>
      <p className="sub">Confira os dados lidos e informe a que cada pagamento se refere.</p>
      <div className="lista-revisao">
        {itens.map((it) => (
          <div key={it.chave} className={`revisao ${it.incluir ? '' : 'desmarcado'}`}>
            <div className="revisao-topo">
              <label className="check"><input type="checkbox" checked={it.incluir} onChange={(e) => alterar(it.chave, { incluir: e.target.checked })} /> Salvar</label>
              <span className="origem">{it.arquivo.name}</span>
            </div>
            {it.erro && <div className="alerta">{it.erro}</div>}
            {it.duplicado && (
              <div className="alerta">
                Já existe um lançamento parecido: {dataBR(it.duplicado.data)} · {it.duplicado.descricao} · {brl(it.duplicado.valor)}.
                <label className="check"><input type="checkbox" checked={it.anexarEm === it.duplicado.id} onChange={(e) => alterar(it.chave, { anexarEm: e.target.checked ? it.duplicado.id : '' })} /> Apenas anexar este comprovante a ele (não duplicar)</label>
              </div>
            )}
            {!it.anexarEm && <CamposMovimento mov={it.mov} alterar={(m) => alterarMov(it.chave, m)} />}
            <label>Nota em aberto correspondente (baixa automática)
              <SeletorNota mov={{ ...it.mov, valor: Number(it.mov.valor) }} notas={notas} valor={it.notaId} onChange={(v) => alterar(it.chave, { notaId: v })} />
            </label>
          </div>
        ))}
      </div>
      <Progresso texto={ocupado} />
      <div className="acoes-form fixo">
        <span>{sel.length} de {itens.length} selecionado(s)</span>
        <button className="btn" onClick={onFechar} disabled={!!ocupado}>Cancelar</button>
        <button className="btn primario" onClick={salvar} disabled={!!ocupado || !sel.length}>Salvar selecionados</button>
      </div>
    </Modal>
  );
}
