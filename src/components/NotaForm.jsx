import React, { useState } from 'react';
import { Modal, AreaArquivos, ListaAnexos, Progresso } from './ui';
import { useDados } from '../Principal';
import {
  LISTA_EMPRESAS, CATEGORIAS, FORMAS_PAGAMENTO, hojeISO, soDigitos, brl, dataBR,
} from '../lib/format';
import { salvarNota, darBaixa, notaPadrao } from '../lib/data';
import { enviarArquivo, excluirArquivo } from '../lib/files';
import { decodificarBoleto, formatarLinhaDigitavel } from '../lib/parsers';
import { sugerirNotas } from '../lib/conciliacao';

export function CamposNota({ nota, alterar, compacto }) {
  const set = (campo) => (e) => alterar({ [campo]: e.target.type === 'number' ? e.target.value : e.target.value });
  const aoMudarLinha = (e) => {
    const linha = e.target.value;
    const mudancas = { linhaDigitavel: soDigitos(linha) };
    const b = decodificarBoleto(linha);
    if (b) {
      if (b.valor && !Number(nota.valor)) mudancas.valor = b.valor;
      if (b.vencimento && !nota.vencimento) mudancas.vencimento = b.vencimento;
    }
    alterar(mudancas);
  };
  return (
    <div className={`grade-form ${compacto ? 'compacto' : ''}`}>
      <label>Empresa
        <select value={nota.empresa} onChange={set('empresa')}>
          {LISTA_EMPRESAS.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
        </select>
      </label>
      <label>Tipo
        <select value={nota.tipo} onChange={set('tipo')}>
          <option value="pagar">Conta a pagar (NF recebida)</option>
          <option value="receber">Conta a receber (NF emitida)</option>
        </select>
      </label>
      <label>Nº da nota<input value={nota.numero} onChange={set('numero')} /></label>
      <label>Série<input value={nota.serie || ''} onChange={set('serie')} /></label>
      <label className="col2">{nota.tipo === 'pagar' ? 'Fornecedor / Emitente' : 'Cliente / Tomador'}
        <input value={nota.parteNome} onChange={set('parteNome')} />
      </label>
      <label>CNPJ / CPF<input value={nota.parteDoc} onChange={(e) => alterar({ parteDoc: soDigitos(e.target.value) })} /></label>
      <label>Valor (R$)<input type="number" step="0.01" min="0" value={nota.valor} onChange={set('valor')} required /></label>
      <label>Emissão<input type="date" value={nota.dataEmissao} onChange={set('dataEmissao')} /></label>
      <label>Vencimento<input type="date" value={nota.vencimento} onChange={set('vencimento')} /></label>
      <label>Categoria
        <input list="lista-categorias" value={nota.categoria} onChange={set('categoria')} placeholder="Ex.: Aluguel" />
      </label>
      <label>Situação
        <select value={nota.status} onChange={set('status')}>
          <option value="aberto">Em aberto</option>
          <option value="pago">Pago</option>
          <option value="cancelado">Cancelado</option>
        </select>
      </label>
      <label className="col4">Boleto – linha digitável / código de barras
        <input value={formatarLinhaDigitavel(nota.linhaDigitavel)} onChange={aoMudarLinha} placeholder="Cole aqui a linha digitável do boleto (se houver)" />
      </label>
      {!compacto && <label className="col4">Chave de acesso<input value={nota.chave || ''} onChange={set('chave')} /></label>}
      <label className="col4">Descrição / a que se refere
        <textarea rows={compacto ? 1 : 2} value={nota.descricao} onChange={set('descricao')} />
      </label>
      <datalist id="lista-categorias">{CATEGORIAS.map((c) => <option key={c} value={c} />)}</datalist>
    </div>
  );
}

export function FormNota({ inicial, onFechar }) {
  const { empresaPadrao, avisar } = useDados();
  const [nota, setNota] = useState(() => ({ ...notaPadrao(empresaPadrao), ...(inicial || {}) }));
  const [novos, setNovos] = useState([]);
  const [removidos, setRemovidos] = useState([]);
  const [ocupado, setOcupado] = useState('');
  const editando = !!inicial?.id;

  async function salvar(e) {
    e.preventDefault();
    if (!(Number(nota.valor) > 0)) { avisar('Informe o valor da nota.', 'erro'); return; }
    try {
      setOcupado('Salvando…');
      const enviados = [];
      for (const f of novos) {
        setOcupado(`Enviando ${f.name}…`);
        enviados.push(await enviarArquivo(f, nota.empresa));
      }
      const arquivos = [...(nota.arquivos || []).filter((a) => !removidos.includes(a.id)), ...enviados];
      const dados = { ...nota, valor: Number(nota.valor), arquivos };
      if (dados.status === 'pago' && !dados.dataPagamento) dados.dataPagamento = hojeISO();
      if (dados.status !== 'pago') { dados.dataPagamento = ''; }
      const statusAnterior = inicial?.status;
      const virouPago = dados.status === 'pago' && statusAnterior !== 'pago' && !dados.movimentoId;
      if (virouPago) dados.status = 'aberto';
      const id = await salvarNota(dados, inicial?.id);
      if (virouPago) await darBaixa({ ...dados, id }, { data: dados.dataPagamento, valor: dados.valor });
      for (const idArq of removidos) { try { await excluirArquivo(idArq); } catch { /* ignora */ } }
      avisar(editando ? 'Nota atualizada.' : 'Nota cadastrada.');
      onFechar();
    } catch (err) {
      avisar(err.message, 'erro');
      setOcupado('');
    }
  }

  return (
    <Modal titulo={editando ? `Editar nota ${nota.numero || ''}` : 'Nova nota / conta (manual)'} onFechar={onFechar} largo>
      <form onSubmit={salvar}>
        <CamposNota nota={nota} alterar={(m) => setNota((n) => ({ ...n, ...m }))} />
        <h4>Anexos (nota, boleto, comprovante…)</h4>
        <ListaAnexos
          arquivos={(nota.arquivos || []).filter((a) => !removidos.includes(a.id))}
          onRemover={(a) => setRemovidos((r) => [...r, a.id])}
          pendentes={novos}
          onRemoverPendente={(i) => setNovos((n) => n.filter((_, j) => j !== i))}
        />
        <AreaArquivos compacta onArquivos={(fs) => setNovos((n) => [...n, ...fs])} texto="Adicionar anexos: arraste, clique ou cole (Ctrl+V)" />
        <Progresso texto={ocupado} />
        <div className="acoes-form">
          <button type="button" className="btn" onClick={onFechar}>Cancelar</button>
          <button className="btn primario" disabled={!!ocupado}>Salvar</button>
        </div>
      </form>
    </Modal>
  );
}

export function FormBaixa({ nota, onFechar }) {
  const { avisar, movimentos } = useDados();
  const [data, setData] = useState(hojeISO());
  const [valor, setValor] = useState(nota.valor);
  const [forma, setForma] = useState(nota.linhaDigitavel ? 'Boleto' : 'PIX');
  const [arquivos, setArquivos] = useState([]);
  const [movExistente, setMovExistente] = useState('');
  const [ocupado, setOcupado] = useState('');
  const tipoMov = nota.tipo === 'pagar' ? 'saida' : 'entrada';
  // lançamentos de extrato/comprovante ainda sem nota com valor parecido
  const candidatos = movimentos.filter((m) => m.empresa === nota.empresa && m.tipo === tipoMov && !m.notaId
    && Math.abs((m.valor || 0) - (nota.valor || 0)) / (nota.valor || 1) < 0.05);

  async function confirmarBaixa(e) {
    e.preventDefault();
    try {
      setOcupado('Registrando…');
      const metas = [];
      for (const f of arquivos) {
        setOcupado(`Enviando ${f.name}…`);
        metas.push(await enviarArquivo(f, nota.empresa));
      }
      await darBaixa(nota, {
        data, valor: Number(valor), formaPagamento: forma, arquivos: metas, movimentoExistenteId: movExistente || null, movExistente: candidatos.find((m) => m.id === movExistente),
      });
      avisar(nota.tipo === 'pagar' ? 'Pagamento registrado.' : 'Recebimento registrado.');
      onFechar();
    } catch (err) {
      avisar(err.message, 'erro');
      setOcupado('');
    }
  }

  return (
    <Modal titulo={nota.tipo === 'pagar' ? 'Registrar pagamento' : 'Registrar recebimento'} onFechar={onFechar}>
      <form onSubmit={confirmarBaixa}>
        <p className="resumo-nota">NF {nota.numero || 's/n'} · {nota.parteNome} · <b>{brl(nota.valor)}</b> {nota.vencimento && `· venc. ${dataBR(nota.vencimento)}`}</p>
        {candidatos.length > 0 && (
          <label>Já está no extrato/comprovantes?
            <select value={movExistente} onChange={(e) => setMovExistente(e.target.value)}>
              <option value="">Não – criar novo lançamento</option>
              {candidatos.map((m) => <option key={m.id} value={m.id}>{dataBR(m.data)} · {m.descricao} · {brl(m.valor)}</option>)}
            </select>
          </label>
        )}
        {!movExistente && (
          <div className="grade-form">
            <label>Data<input type="date" value={data} onChange={(e) => setData(e.target.value)} required /></label>
            <label>Valor (R$)<input type="number" step="0.01" min="0" value={valor} onChange={(e) => setValor(e.target.value)} required /></label>
            <label className="col2">Forma
              <select value={forma} onChange={(e) => setForma(e.target.value)}>{FORMAS_PAGAMENTO.map((f) => <option key={f}>{f}</option>)}</select>
            </label>
          </div>
        )}
        {!movExistente && (
          <>
            <h4>Comprovante (opcional)</h4>
            <ListaAnexos arquivos={[]} pendentes={arquivos} onRemoverPendente={(i) => setArquivos((a) => a.filter((_, j) => j !== i))} />
            <AreaArquivos compacta onArquivos={(fs) => setArquivos((a) => [...a, ...fs])} texto="Anexe o comprovante: arraste, clique ou cole (Ctrl+V)" />
          </>
        )}
        <Progresso texto={ocupado} />
        <div className="acoes-form">
          <button type="button" className="btn" onClick={onFechar}>Cancelar</button>
          <button className="btn primario" disabled={!!ocupado}>Confirmar</button>
        </div>
      </form>
    </Modal>
  );
}

export function SeletorNota({ mov, notas, valor, onChange, reservadas }) {
  const sugestoes = sugerirNotas(mov, notas, { reservadas });
  const tipoNota = mov.tipo === 'saida' ? 'pagar' : 'receber';
  const outras = notas.filter((n) => n.status === 'aberto' && n.tipo === tipoNota && n.empresa === mov.empresa
    && !sugestoes.some((s) => s.nota.id === n.id));
  const atual = valor ? notas.find((n) => n.id === valor) : null;
  return (
    <select value={valor || ''} onChange={(e) => onChange(e.target.value)} className="sel-nota">
      <option value="">— Sem nota vinculada —</option>
      {atual && !sugestoes.some((s) => s.nota.id === atual.id) && !outras.some((n) => n.id === atual.id) && (
        <option value={atual.id}>NF {atual.numero || 's/n'} · {atual.parteNome} · {brl(atual.valor)}</option>
      )}
      {sugestoes.length > 0 && (
        <optgroup label="Sugestões (mesmo valor)">
          {sugestoes.map(({ nota: n }) => <option key={n.id} value={n.id}>NF {n.numero || 's/n'} · {n.parteNome} · {brl(n.valor)} · venc. {dataBR(n.vencimento)}</option>)}
        </optgroup>
      )}
      {outras.length > 0 && (
        <optgroup label={`Outras contas ${tipoNota === 'pagar' ? 'a pagar' : 'a receber'} em aberto`}>
          {outras.slice(0, 200).map((n) => <option key={n.id} value={n.id}>NF {n.numero || 's/n'} · {n.parteNome} · {brl(n.valor)}</option>)}
        </optgroup>
      )}
    </select>
  );
}
