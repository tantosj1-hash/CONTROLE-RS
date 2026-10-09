import {
  brl, dataBR, nomeEmpresa, formatarDoc, statusNota, ROTULO_STATUS, LISTA_EMPRESAS,
} from './format';
import { baixarArquivo } from './files';

export function dadosRelatorio({
  notas, movimentos, empresa, de, ate,
}) {
  const daEmpresa = (x) => empresa === 'todas' || x.empresa === empresa;
  const noPeriodo = (d) => !!d && (!de || d >= de) && (!ate || d <= ate);
  const movs = movimentos.filter((m) => daEmpresa(m) && noPeriodo(m.data)).sort((a, b) => a.data.localeCompare(b.data));
  const entradas = movs.filter((m) => m.tipo === 'entrada');
  const saidas = movs.filter((m) => m.tipo === 'saida');
  const notasPeriodo = notas.filter((n) => daEmpresa(n) && noPeriodo(n.dataEmissao || n.vencimento))
    .sort((a, b) => (a.dataEmissao || a.vencimento).localeCompare(b.dataEmissao || b.vencimento));
  const emAberto = notas.filter((n) => daEmpresa(n) && n.status === 'aberto' && (!ate || !n.dataEmissao || n.dataEmissao <= ate))
    .sort((a, b) => (a.vencimento || '').localeCompare(b.vencimento || ''));
  const soma = (l) => l.reduce((acc, x) => acc + (Number(x.valor) || 0), 0);
  const porCategoria = (l) => {
    const mapa = {};
    l.forEach((m) => { const c = m.categoria || 'Sem categoria'; mapa[c] = (mapa[c] || 0) + (Number(m.valor) || 0); });
    return Object.entries(mapa).sort((a, b) => b[1] - a[1]);
  };
  return {
    entradas, saidas, notasPeriodo, emAberto,
    totalEntradas: soma(entradas),
    totalSaidas: soma(saidas),
    catEntradas: porCategoria(entradas),
    catSaidas: porCategoria(saidas),
    porEmpresa: LISTA_EMPRESAS.map((e) => ({
      ...e,
      entradas: soma(entradas.filter((m) => m.empresa === e.id)),
      saidas: soma(saidas.filter((m) => m.empresa === e.id)),
    })),
  };
}

const nomeNota = (notas, id) => {
  const n = id && notas.find((x) => x.id === id);
  return n ? `NF ${n.numero || 's/n'}` : '';
};

function textoPeriodo(de, ate) {
  if (de && ate) return `${dataBR(de)} a ${dataBR(ate)}`;
  if (de) return `a partir de ${dataBR(de)}`;
  if (ate) return `até ${dataBR(ate)}`;
  return 'Todo o período';
}

function nomeArquivoBase(empresa, de, ate) {
  const emp = empresa === 'todas' ? 'RS-consolidado' : nomeEmpresa(empresa).replace(/\s+/g, '-');
  return `Relatorio-${emp}-${de || 'inicio'}_a_${ate || 'hoje'}`.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export async function gerarPDF(opcoes) {
  const {
    notas, empresa, de, ate, configEmpresas, usuario, incluir,
  } = opcoes;
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const r = dadosRelatorio(opcoes);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const larg = doc.internal.pageSize.getWidth();
  const azul = [156, 43, 40]; // vermelho RS
  let y = 14;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...azul);
  doc.text('Relatório Financeiro – Entradas e Saídas', 14, y);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(60);
  y += 7;
  const empresas = empresa === 'todas' ? LISTA_EMPRESAS.map((e) => e.id) : [empresa];
  empresas.forEach((id) => {
    const cfg = configEmpresas?.[id] || {};
    doc.text(`${cfg.razaoSocial || nomeEmpresa(id)}${cfg.cnpj ? ` – CNPJ ${formatarDoc(cfg.cnpj)}` : ''}`, 14, y);
    y += 5;
  });
  doc.text(`Período: ${textoPeriodo(de, ate)}`, 14, y);
  doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')} por ${usuario}`, larg - 14, y, { align: 'right' });
  y += 4;

  const estilo = {
    styles: { fontSize: 8, cellPadding: 1.5 },
    headStyles: { fillColor: azul, textColor: 255 },
    alternateRowStyles: { fillColor: [247, 243, 238] },
    margin: { left: 14, right: 14 },
  };
  const titulo = (t) => {
    let yy = (doc.lastAutoTable?.finalY ?? y) + 9;
    if (yy > doc.internal.pageSize.getHeight() - 30) { doc.addPage(); yy = 16; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...azul);
    doc.text(t, 14, yy);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0);
    return yy + 2;
  };

  // Resumo
  autoTable(doc, {
    ...estilo,
    startY: titulo('Resumo'),
    head: [['', 'Entradas', 'Saídas', 'Saldo']],
    body: [
      ...(empresa === 'todas' ? r.porEmpresa.map((e) => [e.nome, brl(e.entradas), brl(e.saidas), brl(e.entradas - e.saidas)]) : []),
      [{ content: 'TOTAL', styles: { fontStyle: 'bold' } }, brl(r.totalEntradas), brl(r.totalSaidas), { content: brl(r.totalEntradas - r.totalSaidas), styles: { fontStyle: 'bold' } }],
    ],
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    tableWidth: 180,
  });

  if (incluir.categorias) {
    const linhas = Math.max(r.catEntradas.length, r.catSaidas.length);
    const body = [];
    for (let i = 0; i < linhas; i += 1) {
      const e = r.catEntradas[i];
      const s = r.catSaidas[i];
      body.push([e?.[0] || '', e ? brl(e[1]) : '', s?.[0] || '', s ? brl(s[1]) : '']);
    }
    autoTable(doc, {
      ...estilo,
      startY: titulo('Totais por categoria'),
      head: [['Categoria (entradas)', 'Valor', 'Categoria (saídas)', 'Valor']],
      body: body.length ? body : [[{ content: 'Sem lançamentos', colSpan: 4 }]],
      columnStyles: { 1: { halign: 'right' }, 3: { halign: 'right' } },
    });
  }

  const colEmp = empresa === 'todas';
  const linhaMov = (m) => [
    dataBR(m.data),
    ...(colEmp ? [nomeEmpresa(m.empresa)] : []),
    m.descricao || '',
    m.favorecido ? `${m.favorecido}${m.documento ? ` (${formatarDoc(m.documento)})` : ''}` : '',
    m.categoria || '',
    m.formaPagamento || '',
    nomeNota(notas, m.notaId),
    (m.arquivos || []).length ? 'Sim' : 'Não',
    brl(m.valor),
  ];
  const cabMov = (quem) => [['Data', ...(colEmp ? ['Empresa'] : []), 'Descrição / referente a', quem, 'Categoria', 'Forma', 'Nota', 'Comprov.', 'Valor']];
  const alinhar = { [colEmp ? 8 : 7]: { halign: 'right', cellWidth: 26 }, 0: { cellWidth: 20 } };

  if (incluir.entradas) {
    autoTable(doc, {
      ...estilo,
      startY: titulo(`Entradas (recebimentos) – ${brl(r.totalEntradas)}`),
      head: cabMov('Pagador'),
      body: r.entradas.length ? r.entradas.map(linhaMov) : [[{ content: 'Nenhuma entrada no período', colSpan: colEmp ? 9 : 8 }]],
      foot: r.entradas.length ? [[{ content: 'Total de entradas', colSpan: colEmp ? 8 : 7 }, brl(r.totalEntradas)]] : undefined,
      footStyles: { fillColor: [220, 252, 231], textColor: 0, fontStyle: 'bold', halign: 'right' },
      columnStyles: alinhar,
    });
  }
  if (incluir.saidas) {
    autoTable(doc, {
      ...estilo,
      startY: titulo(`Saídas (pagamentos) – ${brl(r.totalSaidas)}`),
      head: cabMov('Favorecido'),
      body: r.saidas.length ? r.saidas.map(linhaMov) : [[{ content: 'Nenhuma saída no período', colSpan: colEmp ? 9 : 8 }]],
      foot: r.saidas.length ? [[{ content: 'Total de saídas', colSpan: colEmp ? 8 : 7 }, brl(r.totalSaidas)]] : undefined,
      footStyles: { fillColor: [254, 226, 226], textColor: 0, fontStyle: 'bold', halign: 'right' },
      columnStyles: alinhar,
    });
  }
  const linhaNota = (n) => [
    ...(colEmp ? [nomeEmpresa(n.empresa)] : []),
    n.tipo === 'pagar' ? 'Recebida (a pagar)' : 'Emitida (a receber)',
    n.numero || '',
    `${n.parteNome || ''}${n.parteDoc ? ` (${formatarDoc(n.parteDoc)})` : ''}`,
    dataBR(n.dataEmissao),
    dataBR(n.vencimento),
    `${ROTULO_STATUS[statusNota(n)]}${n.dataPagamento ? ` ${dataBR(n.dataPagamento)}` : ''}`,
    n.descricao?.slice(0, 80) || n.categoria || '',
    brl(n.valor),
  ];
  const cabNota = [[...(colEmp ? ['Empresa'] : []), 'Tipo', 'Nº', 'Fornecedor / Cliente', 'Emissão', 'Vencimento', 'Situação', 'Descrição', 'Valor']];
  if (incluir.notas) {
    autoTable(doc, {
      ...estilo,
      startY: titulo('Notas fiscais do período (por data de emissão)'),
      head: cabNota,
      body: r.notasPeriodo.length ? r.notasPeriodo.map(linhaNota) : [[{ content: 'Nenhuma nota no período', colSpan: colEmp ? 9 : 8 }]],
      columnStyles: { [colEmp ? 8 : 7]: { halign: 'right', cellWidth: 26 } },
    });
  }
  if (incluir.abertas) {
    autoTable(doc, {
      ...estilo,
      startY: titulo('Contas em aberto (a pagar e a receber)'),
      head: cabNota,
      body: r.emAberto.length ? r.emAberto.map(linhaNota) : [[{ content: 'Nenhuma conta em aberto', colSpan: colEmp ? 9 : 8 }]],
      columnStyles: { [colEmp ? 8 : 7]: { halign: 'right', cellWidth: 26 } },
    });
  }

  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i += 1) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(`Controle RS · página ${i} de ${total}`, larg - 14, doc.internal.pageSize.getHeight() - 6, { align: 'right' });
  }
  const nome = `${nomeArquivoBase(empresa, de, ate)}.pdf`;
  return { blob: doc.output('blob'), nome };
}

export async function gerarExcel(opcoes) {
  const XLSX = await import('xlsx');
  const { notas, empresa, de, ate } = opcoes;
  const r = dadosRelatorio(opcoes);
  const movLinha = (m) => ({
    Data: dataBR(m.data),
    Empresa: nomeEmpresa(m.empresa),
    Tipo: m.tipo === 'entrada' ? 'Entrada' : 'Saída',
    Descrição: m.descricao || '',
    'Favorecido/Pagador': m.favorecido || '',
    'CNPJ/CPF': formatarDoc(m.documento),
    Categoria: m.categoria || '',
    Forma: m.formaPagamento || '',
    Nota: nomeNota(notas, m.notaId),
    Comprovante: (m.arquivos || []).map((a) => a.nome).join('; '),
    Valor: Number(m.valor) || 0,
  });
  const notaLinha = (n) => ({
    Empresa: nomeEmpresa(n.empresa),
    Tipo: n.tipo === 'pagar' ? 'Recebida (a pagar)' : 'Emitida (a receber)',
    Número: n.numero || '',
    Série: n.serie || '',
    'Fornecedor/Cliente': n.parteNome || '',
    'CNPJ/CPF': formatarDoc(n.parteDoc),
    Emissão: dataBR(n.dataEmissao),
    Vencimento: dataBR(n.vencimento),
    Situação: ROTULO_STATUS[statusNota(n)],
    'Data pagamento': dataBR(n.dataPagamento),
    Categoria: n.categoria || '',
    Descrição: n.descricao || '',
    'Chave de acesso': n.chave || '',
    'Linha digitável': n.linhaDigitavel || '',
    Valor: Number(n.valor) || 0,
  });
  const wb = XLSX.utils.book_new();
  const resumo = [
    { Item: 'Período', Valor: textoPeriodo(de, ate) },
    { Item: 'Empresa', Valor: empresa === 'todas' ? 'RS Serviços + RS Gestões' : nomeEmpresa(empresa) },
    ...r.porEmpresa.flatMap((e) => (empresa === 'todas' || e.id === empresa
      ? [{ Item: `${e.nome} – entradas`, Valor: e.entradas }, { Item: `${e.nome} – saídas`, Valor: e.saidas }] : [])),
    { Item: 'Total de entradas', Valor: r.totalEntradas },
    { Item: 'Total de saídas', Valor: r.totalSaidas },
    { Item: 'Saldo', Valor: r.totalEntradas - r.totalSaidas },
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumo), 'Resumo');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([...r.entradas, ...r.saidas].sort((a, b) => a.data.localeCompare(b.data)).map(movLinha)), 'Entradas e Saídas');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(r.notasPeriodo.map(notaLinha)), 'Notas do período');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(r.emAberto.map(notaLinha)), 'Em aberto');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return { blob: new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), nome: `${nomeArquivoBase(empresa, de, ate)}.xlsx` };
}

// Pacote para o contador: relatório PDF + planilha + todos os anexos do período.
export async function gerarPacoteContador(opcoes, aoProgredir) {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  aoProgredir?.('Gerando relatório PDF…');
  const pdf = await gerarPDF(opcoes);
  zip.file(pdf.nome, pdf.blob);
  aoProgredir?.('Gerando planilha…');
  const xls = await gerarExcel(opcoes);
  zip.file(xls.nome, xls.blob);
  const r = dadosRelatorio(opcoes);
  const registros = [
    ...r.entradas.map((m) => ({ pasta: 'Entradas', ref: m })),
    ...r.saidas.map((m) => ({ pasta: 'Saidas', ref: m })),
    ...r.notasPeriodo.map((n) => ({ pasta: 'Notas fiscais', ref: n })),
  ];
  const vistos = new Set();
  let n = 0;
  const total = registros.reduce((acc, x) => acc + (x.ref.arquivos || []).length, 0);
  for (const { pasta, ref } of registros) {
    for (const a of ref.arquivos || []) {
      n += 1;
      if (vistos.has(`${pasta}/${a.id}`)) continue;
      vistos.add(`${pasta}/${a.id}`);
      aoProgredir?.(`Baixando anexos ${n}/${total}…`);
      try {
        const { blob, nome } = await baixarArquivo(a.id);
        const prefixo = `${ref.data || ref.dataEmissao || ref.vencimento || 'sem-data'}_${nomeEmpresa(ref.empresa).replace(/\s/g, '')}_${(ref.descricao || ref.parteNome || '').slice(0, 30)}`
          .replace(/[\\/:*?"<>|]/g, '-').trim();
        zip.file(`Anexos/${pasta}/${prefixo}_${a.id.slice(0, 5)}_${nome}`, blob);
      } catch (e) {
        console.warn('Anexo não incluído', a, e);
      }
    }
  }
  aoProgredir?.('Compactando…');
  const blob = await zip.generateAsync({ type: 'blob' });
  return { blob, nome: `${nomeArquivoBase(opcoes.empresa, opcoes.de, opcoes.ate)}-contador.zip` };
}

export function baixarBlob({ blob, nome }) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
