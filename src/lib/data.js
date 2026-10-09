import {
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, writeBatch,
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { excluirArquivo } from './files';

const quem = () => auth.currentUser?.email?.toLowerCase() ?? 'desconhecido';

export async function auditar(acao, colecao, id, resumo) {
  try {
    await addDoc(collection(db, 'auditoria'), {
      acao, colecao, docId: id ?? null, resumo: resumo ?? '', usuario: quem(), quando: serverTimestamp(),
    });
  } catch (e) {
    console.warn('Falha ao registrar auditoria', e);
  }
}

function limpar(obj) {
  const out = {};
  Object.entries(obj).forEach(([k, v]) => {
    if (v === undefined || k === 'id' || k === '_status') return;
    out[k] = v;
  });
  return out;
}

const resumoNota = (n) => `${n.tipo === 'pagar' ? 'A pagar' : 'A receber'} NF ${n.numero || 's/n'} ${n.parteNome || ''} R$ ${Number(n.valor || 0).toFixed(2)}`;
const resumoMov = (m) => `${m.tipo} ${m.data} ${m.descricao || ''} R$ ${Number(m.valor || 0).toFixed(2)}`;

export function notaPadrao(empresa) {
  return {
    empresa: empresa || 'rs_servicos',
    tipo: 'pagar',
    numero: '',
    serie: '',
    chave: '',
    parteNome: '',
    parteDoc: '',
    dataEmissao: '',
    vencimento: '',
    valor: 0,
    linhaDigitavel: '',
    categoria: '',
    descricao: '',
    status: 'aberto',
    dataPagamento: '',
    valorPago: null,
    movimentoId: null,
    arquivos: [],
  };
}

export function movimentoPadrao(empresa, tipo = 'saida') {
  return {
    empresa: empresa || 'rs_servicos',
    tipo,
    data: '',
    valor: 0,
    descricao: '',
    categoria: '',
    favorecido: '',
    documento: '',
    formaPagamento: '',
    origem: 'manual',
    notaId: null,
    arquivos: [],
  };
}

export async function salvarNota(dados, id) {
  const d = limpar({ ...dados, valor: Number(dados.valor) || 0 });
  if (id) {
    await updateDoc(doc(db, 'notas', id), { ...d, atualizadoPor: quem(), atualizadoEm: serverTimestamp() });
    await auditar('editar', 'notas', id, resumoNota(d));
    return id;
  }
  const ref = await addDoc(collection(db, 'notas'), {
    ...d, criadoPor: quem(), criadoEm: serverTimestamp(), atualizadoPor: quem(), atualizadoEm: serverTimestamp(),
  });
  await auditar('criar', 'notas', ref.id, resumoNota(d));
  return ref.id;
}

export async function salvarMovimento(dados, id) {
  const d = limpar({ ...dados, valor: Math.abs(Number(dados.valor) || 0) });
  if (id) {
    await updateDoc(doc(db, 'movimentos', id), { ...d, atualizadoPor: quem(), atualizadoEm: serverTimestamp() });
    await auditar('editar', 'movimentos', id, resumoMov(d));
    return id;
  }
  const ref = await addDoc(collection(db, 'movimentos'), {
    ...d, criadoPor: quem(), criadoEm: serverTimestamp(), atualizadoPor: quem(), atualizadoEm: serverTimestamp(),
  });
  await auditar('criar', 'movimentos', ref.id, resumoMov(d));
  return ref.id;
}

// Registra o pagamento/recebimento de uma nota e gera o movimento de caixa.
export async function darBaixa(nota, {
  data, valor, formaPagamento, arquivos = [], descricao, movimentoExistenteId, movExistente,
}) {
  const tipoMov = nota.tipo === 'pagar' ? 'saida' : 'entrada';
  let movId = movimentoExistenteId;
  if (movId) {
    await updateDoc(doc(db, 'movimentos', movId), {
      notaId: nota.id,
      ...(nota.categoria ? { categoria: nota.categoria } : {}),
      ...(nota.parteNome && !movExistente?.favorecido ? { favorecido: nota.parteNome } : {}),
      atualizadoPor: quem(),
      atualizadoEm: serverTimestamp(),
    });
  } else {
    movId = await salvarMovimento({
      ...movimentoPadrao(nota.empresa, tipoMov),
      data,
      valor,
      descricao: descricao || `${nota.tipo === 'pagar' ? 'Pagamento' : 'Recebimento'} NF ${nota.numero || ''} - ${nota.parteNome || ''}`.trim(),
      categoria: nota.categoria || '',
      favorecido: nota.parteNome || '',
      documento: nota.parteDoc || '',
      formaPagamento: formaPagamento || '',
      origem: 'baixa',
      notaId: nota.id,
      arquivos,
    });
  }
  await updateDoc(doc(db, 'notas', nota.id), {
    status: 'pago',
    dataPagamento: data,
    valorPago: Number(valor) || 0,
    movimentoId: movId,
    atualizadoPor: quem(),
    atualizadoEm: serverTimestamp(),
  });
  await auditar('baixa', 'notas', nota.id, `${resumoNota(nota)} paga em ${data}`);
  return movId;
}

// Desfaz a baixa: volta a nota para "em aberto". Se o movimento foi criado
// pela própria baixa ele é removido; se veio do extrato/comprovante só é desvinculado.
export async function estornarBaixa(nota, movimentos) {
  const mov = movimentos.find((m) => m.id === nota.movimentoId);
  if (mov) {
    if (mov.origem === 'baixa') await deleteDoc(doc(db, 'movimentos', mov.id));
    else await updateDoc(doc(db, 'movimentos', mov.id), { notaId: null });
  }
  await updateDoc(doc(db, 'notas', nota.id), {
    status: 'aberto', dataPagamento: '', valorPago: null, movimentoId: null, atualizadoPor: quem(), atualizadoEm: serverTimestamp(),
  });
  await auditar('estorno', 'notas', nota.id, resumoNota(nota));
}

async function apagarArquivosNaoUsados(arquivos, outrosRegistros) {
  const usados = new Set();
  outrosRegistros.forEach((r) => (r.arquivos || []).forEach((a) => usados.add(a.id)));
  for (const a of arquivos || []) {
    if (!usados.has(a.id)) {
      try { await excluirArquivo(a.id); } catch (e) { console.warn(e); }
    }
  }
}

export async function excluirNota(nota, { notas, movimentos }) {
  const mov = movimentos.find((m) => m.id === nota.movimentoId);
  const batch = writeBatch(db);
  batch.delete(doc(db, 'notas', nota.id));
  if (mov) {
    if (mov.origem === 'baixa') batch.delete(doc(db, 'movimentos', mov.id));
    else batch.update(doc(db, 'movimentos', mov.id), { notaId: null });
  }
  await batch.commit();
  await auditar('excluir', 'notas', nota.id, resumoNota(nota));
  const restantes = [...notas.filter((n) => n.id !== nota.id), ...movimentos.filter((m) => m.id !== mov?.id || mov?.origem !== 'baixa')];
  const arquivos = [...(nota.arquivos || []), ...(mov?.origem === 'baixa' ? mov.arquivos || [] : [])];
  await apagarArquivosNaoUsados(arquivos, restantes);
}

export async function excluirMovimento(mov, { notas, movimentos }) {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'movimentos', mov.id));
  const nota = notas.find((n) => n.movimentoId === mov.id);
  if (nota) {
    batch.update(doc(db, 'notas', nota.id), {
      status: 'aberto', dataPagamento: '', valorPago: null, movimentoId: null,
    });
  }
  await batch.commit();
  await auditar('excluir', 'movimentos', mov.id, resumoMov(mov));
  await apagarArquivosNaoUsados(mov.arquivos, [...notas, ...movimentos.filter((m) => m.id !== mov.id)]);
}

export async function salvarConfigEmpresas(empresas) {
  await setDoc(doc(db, 'config', 'empresas'), { ...empresas, atualizadoPor: quem(), atualizadoEm: serverTimestamp() });
  await auditar('editar', 'config', 'empresas', 'Dados das empresas');
}

export async function salvarUsuario(email, dados) {
  const id = email.trim().toLowerCase();
  await setDoc(doc(db, 'usuarios', id), {
    email: id, ...dados, atualizadoPor: quem(), atualizadoEm: serverTimestamp(),
  }, { merge: true });
  await auditar('usuario', 'usuarios', id, `Acesso concedido/alterado (${dados.admin ? 'admin' : 'usuário'})`);
}

export async function removerUsuario(email) {
  await deleteDoc(doc(db, 'usuarios', email));
  await auditar('usuario', 'usuarios', email, 'Acesso removido');
}
