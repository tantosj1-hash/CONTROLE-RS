// Transforma arquivos enviados em registros prontos para revisão.
import {
  tipoDoArquivo, lerArquivoComoTexto, interpretarNotaTexto, interpretarNotaXML, lerPlanilha,
  notasDaPlanilha, extratoDaPlanilha, extratoDoTexto, extratoOFX, interpretarComprovante, decodificarBoleto,
} from './parsers';
import {
  empresaPorDocumentos, ehNossoDocumento, notaDuplicada, melhorNota, movimentoDuplicado, semelhancaNomes,
} from './conciliacao';
import { notaPadrao, movimentoPadrao } from './data';
import { enviarArquivo } from './files';
import { soDigitos, hojeISO } from './format';

let seq = 0;
const novaChave = () => `i${Date.now()}_${seq += 1}`;

function notaDoResultado(r, { configEmpresas, empresaPadrao }) {
  let tipo = 'pagar';
  let parteNome = r.emitenteNome || '';
  let parteDoc = r.emitenteDoc || '';
  if (ehNossoDocumento(r.emitenteDoc, configEmpresas)) {
    tipo = 'receber';
    parteNome = r.destNome || '';
    parteDoc = r.destDoc || '';
  }
  const docsEmpresa = tipo === 'receber' ? [r.emitenteDoc] : [r.destDoc, ...(r.documentos || [])];
  const empresaDetectada = empresaPorDocumentos(docsEmpresa, configEmpresas);
  return {
    nota: {
      ...notaPadrao(empresaDetectada || empresaPadrao || 'rs_servicos'),
      tipo,
      numero: r.numero || '',
      serie: r.serie || '',
      chave: r.chave || '',
      parteNome,
      parteDoc: soDigitos(parteDoc),
      dataEmissao: r.dataEmissao || '',
      vencimento: r.vencimento || '',
      valor: r.valor || 0,
      linhaDigitavel: r.linhaDigitavel || '',
      descricao: r.descricao || '',
    },
    empresaDetectada: !!empresaDetectada,
  };
}

function avisosNota(item, notas) {
  const avisos = [];
  const n = item.nota;
  if (!item.empresaDetectada) avisos.push('Empresa não identificada pelo CNPJ — confira se é RS Serviços ou RS Gestões.');
  if (!n.valor) avisos.push('Valor não encontrado no documento — preencha manualmente.');
  if (!n.vencimento && n.tipo === 'pagar') avisos.push('Sem data de vencimento.');
  const dup = notaDuplicada(n, notas);
  if (dup) avisos.push(`Parece já estar cadastrada (NF ${dup.numero || 's/n'} – ${dup.parteNome || ''}).`);
  return { avisos, duplicada: dup };
}

export async function processarArquivosNotas(arquivos, ctx) {
  const { aoProgredir, notas } = ctx;
  const itens = [];
  const boletos = [];
  for (const [i, file] of arquivos.entries()) {
    aoProgredir?.(`Lendo ${file.name} (${i + 1}/${arquivos.length})…`);
    const tipo = tipoDoArquivo(file);
    try {
      if (tipo === 'planilha') {
        const linhas = notasDaPlanilha(await lerPlanilha(await file.arrayBuffer()));
        if (!linhas.length) throw new Error('Não encontrei colunas de nota/valor nesta planilha.');
        linhas.forEach((l) => {
          const empresaDetectada = empresaPorDocumentos([l.parteDoc], ctx.configEmpresas);
          const nota = {
            ...notaPadrao(ctx.empresaPadrao || 'rs_servicos'),
            ...l,
            tipo: l.tipo || (ehNossoDocumento(l.parteDoc, ctx.configEmpresas) ? 'receber' : 'pagar'),
          };
          delete nota.pago; delete nota.origem; delete nota.dataPagamento;
          itens.push({
            chave: novaChave(), arquivos: [file], origem: `${file.name} – ${l.origem}`, nota,
            empresaDetectada: !!empresaDetectada || !!ctx.empresaPadrao,
            pago: l.pago, dataPagamento: l.dataPagamento || '',
          });
        });
      } else if (tipo === 'xml') {
        const r = interpretarNotaXML(await file.text());
        itens.push({ chave: novaChave(), arquivos: [file], origem: file.name, ...notaDoResultado(r, ctx) });
      } else if (tipo === 'pdf' || tipo === 'imagem' || tipo === 'texto') {
        const leitura = await lerArquivoComoTexto(file, aoProgredir);
        const r = interpretarNotaTexto(leitura);
        const item = { chave: novaChave(), arquivos: [file], origem: file.name + (leitura.usouOCR ? ' (lido por imagem)' : ''), ...notaDoResultado(r, ctx) };
        if (r.ehBoleto && !r.ehNota) boletos.push({ item, r });
        else itens.push(item);
      } else {
        throw new Error('Formato não reconhecido. Use PDF, XML, Excel, CSV ou imagem.');
      }
    } catch (e) {
      itens.push({
        chave: novaChave(), arquivos: [file], origem: file.name, erro: e.message,
        nota: { ...notaPadrao(ctx.empresaPadrao || 'rs_servicos') }, empresaDetectada: !!ctx.empresaPadrao,
      });
    }
  }

  // Junta boletos com a nota correspondente (mesmo lote ou já cadastrada)
  boletos.forEach(({ item, r }) => {
    const valorBoleto = r.valorBoleto || item.nota.valor;
    const parceiro = itens.find((it) => !it.erro && !soDigitos(it.nota.linhaDigitavel) && (
      (valorBoleto && Math.abs((it.nota.valor || 0) - valorBoleto) < 0.01)
      || (item.nota.parteDoc && soDigitos(it.nota.parteDoc) === soDigitos(item.nota.parteDoc))
      || (item.nota.parteNome && semelhancaNomes(it.nota.parteNome, item.nota.parteNome) >= 0.6)
    ));
    if (parceiro) {
      parceiro.nota.linhaDigitavel = item.nota.linhaDigitavel;
      if (item.nota.vencimento) parceiro.nota.vencimento = item.nota.vencimento;
      parceiro.arquivos.push(...item.arquivos);
      parceiro.origem += ` + boleto ${item.origem}`;
      return;
    }
    const existente = notas.find((n) => n.status === 'aberto' && n.tipo === 'pagar' && !soDigitos(n.linhaDigitavel)
      && valorBoleto && Math.abs((n.valor || 0) - valorBoleto) < 0.01
      && (!item.nota.parteNome || !n.parteNome || semelhancaNomes(n.parteNome, item.nota.parteNome) > 0 || soDigitos(n.parteDoc) === soDigitos(item.nota.parteDoc)));
    if (existente) {
      itens.push({
        ...item,
        atualizarNota: existente,
        origem: `${item.origem} (boleto da NF ${existente.numero || 's/n'} já cadastrada)`,
        nota: {
          ...existente,
          linhaDigitavel: item.nota.linhaDigitavel,
          vencimento: item.nota.vencimento || existente.vencimento,
        },
        empresaDetectada: true,
      });
      return;
    }
    item.nota.descricao = item.nota.descricao || 'Boleto';
    itens.push(item);
  });

  return itens.map((it) => {
    if (it.atualizarNota) return { ...it, avisos: ['O boleto será vinculado a esta nota já cadastrada.'], incluir: true };
    const { avisos, duplicada } = avisosNota(it, notas);
    if (it.erro) avisos.unshift(`Não foi possível ler automaticamente: ${it.erro}. Preencha manualmente.`);
    return { ...it, avisos, duplicada, incluir: !duplicada };
  });
}

// Envia cada arquivo uma única vez, mesmo que vários registros o usem.
export function criarEnviador(aoProgredir) {
  const cache = new Map();
  return async (files, empresa) => {
    const metas = [];
    for (const f of files) {
      if (!cache.has(f)) {
        aoProgredir?.(`Enviando ${f.name}…`);
        cache.set(f, enviarArquivo(f, empresa));
      }
      metas.push(await cache.get(f));
    }
    return metas;
  };
}

/* ---------------------- Extrato bancário ---------------------- */

export async function processarExtrato(arquivos, ctx) {
  const { aoProgredir, empresa, notas, movimentos } = ctx;
  const linhas = [];
  for (const file of arquivos) {
    aoProgredir?.(`Lendo ${file.name}…`);
    const tipo = tipoDoArquivo(file);
    let movs = [];
    if (tipo === 'planilha') movs = extratoDaPlanilha(await lerPlanilha(await file.arrayBuffer()));
    else if (tipo === 'ofx') movs = extratoOFX(await file.text());
    else if (tipo === 'pdf' || tipo === 'imagem' || tipo === 'texto') movs = extratoDoTexto(await lerArquivoComoTexto(file, aoProgredir));
    else throw new Error(`Formato de "${file.name}" não suportado para extrato.`);
    movs.forEach((m) => linhas.push({ ...m, arquivo: file }));
  }
  const reservadas = new Set();
  return linhas.map((m) => {
    const mov = { ...movimentoPadrao(empresa, m.tipo), ...m, empresa, origem: 'extrato' };
    delete mov.arquivo;
    const dup = movimentoDuplicado(mov, movimentos);
    const nota = melhorNota(mov, notas, { reservadas });
    if (nota) reservadas.add(nota.id);
    if (nota && !mov.categoria) mov.categoria = nota.categoria || '';
    return {
      chave: novaChave(), mov, arquivo: m.arquivo, duplicado: dup, notaId: nota?.id || '', incluir: !dup,
    };
  });
}

/* ---------------------- Comprovantes ---------------------- */

export async function processarComprovantes(arquivos, ctx) {
  const { aoProgredir, empresaPadrao, notas, movimentos, configEmpresas } = ctx;
  const itens = [];
  for (const [i, file] of arquivos.entries()) {
    aoProgredir?.(`Lendo ${file.name} (${i + 1}/${arquivos.length})…`);
    let r = {};
    let erro = '';
    try {
      const tipo = tipoDoArquivo(file);
      if (['pdf', 'imagem', 'texto'].includes(tipo)) r = interpretarComprovante(await lerArquivoComoTexto(file, aoProgredir));
      else erro = 'Leitura automática disponível para PDF e fotos. Preencha os dados.';
    } catch (e) {
      erro = e.message;
    }
    const docs = r.documentos || [];
    const empresa = empresaPorDocumentos(docs, configEmpresas) || empresaPadrao || 'rs_servicos';
    r.documento = docs.find((d) => !ehNossoDocumento(d, configEmpresas)) || '';
    const mov = {
      ...movimentoPadrao(empresa, r.tipo || 'saida'),
      data: r.data || hojeISO(),
      valor: r.valor || 0,
      descricao: r.descricao || '',
      favorecido: r.favorecido || '',
      documento: soDigitos(r.documento),
      formaPagamento: r.formaPagamento || '',
      origem: 'comprovante',
      linhaDigitavel: r.linhaDigitavel || '',
    };
    if (mov.linhaDigitavel) {
      const b = decodificarBoleto(mov.linhaDigitavel);
      if (b?.valor && !mov.valor) mov.valor = b.valor;
    }
    const nota = mov.valor ? melhorNota(mov, notas) : null;
    if (nota) {
      if (!mov.descricao) mov.descricao = `${nota.tipo === 'pagar' ? 'Pagamento' : 'Recebimento'} NF ${nota.numero || ''} - ${nota.parteNome || ''}`.trim();
      mov.categoria = nota.categoria || '';
    }
    const dup = mov.valor ? movimentoDuplicado(mov, movimentos) : null;
    itens.push({
      chave: novaChave(), arquivo: file, mov, notaId: nota?.id || '', duplicado: dup,
      anexarEm: dup && !(dup.arquivos || []).length ? dup.id : '',
      erro, incluir: true,
    });
  }
  return itens;
}
