// Leitura automática de documentos: notas fiscais (PDF/XML/Excel), boletos,
// extratos bancários (PDF/Excel/CSV/OFX) e comprovantes (PDF/foto).
import { isoDe, soDigitos, semAcento, hojeISO, difDias } from './format';

/* ------------------------------------------------------------------ */
/* Utilidades de texto                                                  */
/* ------------------------------------------------------------------ */

const RE_DINHEIRO = /-?\s?(?:R\$\s*)?\d{1,3}(?:\.\d{3})*,\d{2}(?!\d)|-?\s?(?:R\$\s*)?\d+,\d{2}(?!\d)/g;
const RE_DATA = /\b(\d{2})[/.-](\d{2})[/.-](\d{4}|\d{2})\b/;
const RE_DATA_G = /\b(\d{2})[/.-](\d{2})[/.-](\d{4}|\d{2})\b/g;
const RE_CNPJ = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
const RE_CPF = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g;

export function paraNumero(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim();
  if (!s) return null;
  let negativo = false;
  if (/^\(.*\)$/.test(s)) { negativo = true; s = s.slice(1, -1); }
  if (/[-−]/.test(s)) negativo = true;
  if (/\bD\s*$/i.test(s)) negativo = true;
  s = s.replace(/R\$|\s|[CD]\s*$|[-−+]/gi, '');
  if (!/\d/.test(s)) return null;
  const temVirgula = s.includes(',');
  const temPonto = s.includes('.');
  if (temVirgula && temPonto) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (temVirgula) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (temPonto && /^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  const n = Number(s.replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n)) return null;
  return negativo ? -n : n;
}

export function paraISO(v, anoPadrao) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) return isoDe(v);
  if (typeof v === 'number') {
    // número serial do Excel
    if (v > 20000 && v < 80000) return isoDe(new Date(Math.round((v - 25569) * 86400000) + 43200000));
    return '';
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})/);
  if (m) {
    let ano = m[3];
    if (ano.length === 2) ano = `20${ano}`;
    return validarISO(`${ano}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`);
  }
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})$/);
  if (m && anoPadrao) return validarISO(`${anoPadrao}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`);
  return '';
}

function validarISO(iso) {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime()) || isoDe(d) !== iso) return '';
  return iso;
}

function primeiroDinheiro(s) {
  const m = String(s).match(RE_DINHEIRO);
  return m ? Math.abs(paraNumero(m[0])) : null;
}

function primeiraData(s) {
  const m = String(s).match(RE_DATA);
  return m ? paraISO(m[0]) : '';
}

function limparNome(s) {
  return String(s || '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\b(CNPJ|CPF|CPF\/CNPJ|CNPJ\/CPF|INSCRI[ÇC][ÃA]O|ENDERE[ÇC]O|E-?MAIL|TELEFONE|MUNIC[IÍ]PIO|IE)\b.*$/i, '')
    .replace(/^[\s:.\-–]+|[\s:.\-–]+$/g, '')
    .trim()
    .slice(0, 120);
}

function validarCNPJ(c) {
  const d = soDigitos(c);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const calc = (base) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = base.split('').reduce((acc, n, i) => acc + Number(n) * pesos[i], 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(d.slice(0, 12)) === Number(d[12]) && calc(d.slice(0, 13)) === Number(d[13]);
}

function documentosNoTexto(texto) {
  const lista = [];
  (texto.match(RE_CNPJ) || []).forEach((c) => {
    const d = soDigitos(c);
    if (validarCNPJ(d) && !lista.includes(d)) lista.push(d);
  });
  (texto.match(RE_CPF) || []).forEach((c) => {
    const d = soDigitos(c);
    if (!lista.includes(d)) lista.push(d);
  });
  return lista;
}

/* ------------------------------------------------------------------ */
/* PDF e OCR                                                            */
/* ------------------------------------------------------------------ */

let pdfjsPromise;
async function pdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.js?url'),
    ]).then(([lib, worker]) => {
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib;
    });
  }
  return pdfjsPromise;
}

// Extrai o texto do PDF preservando linhas e posições dos trechos.
export async function lerPDF(buffer, { ocr = true, aoProgredir } = {}) {
  const lib = await pdfjs();
  const pdf = await lib.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false }).promise;
  const paginas = [];
  for (let p = 1; p <= pdf.numPages; p += 1) {
    const pagina = await pdf.getPage(p);
    const conteudo = await pagina.getTextContent();
    const itens = conteudo.items
      .filter((it) => it.str && it.str.trim())
      .map((it) => ({ str: it.str.trim(), x: it.transform[4], y: it.transform[5], w: it.width || it.str.length * 4 }));
    paginas.push({ itens, linhas: agruparLinhas(itens) });
  }
  let linhas = paginas.flatMap((pg) => pg.linhas);
  let texto = linhas.join('\n');
  let usouOCR = false;
  if (ocr && texto.replace(/\s/g, '').length < 40) {
    // PDF escaneado (imagem): usa reconhecimento de texto
    const imagens = [];
    for (let p = 1; p <= Math.min(pdf.numPages, 4); p += 1) {
      const pagina = await pdf.getPage(p);
      const vp = pagina.getViewport({ scale: 2.2 });
      const canvas = document.createElement('canvas');
      canvas.width = vp.width;
      canvas.height = vp.height;
      await pagina.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      imagens.push(canvas);
    }
    texto = await ocrImagens(imagens, aoProgredir);
    linhas = texto.split('\n').map((l) => l.trim()).filter(Boolean);
    usouOCR = true;
  }
  return { texto, linhas, paginas, usouOCR };
}

function agruparLinhas(itens) {
  const ordenados = [...itens].sort((a, b) => b.y - a.y || a.x - b.x);
  const grupos = [];
  ordenados.forEach((it) => {
    const g = grupos.find((gr) => Math.abs(gr.y - it.y) <= 2.5);
    if (g) g.itens.push(it);
    else grupos.push({ y: it.y, itens: [it] });
  });
  return grupos
    .sort((a, b) => b.y - a.y)
    .map((g) => g.itens.sort((a, b) => a.x - b.x).map((i) => i.str).join('  ').replace(/\s{3,}/g, '  ').trim());
}

let workerOCR;
export async function ocrImagens(imagens, aoProgredir) {
  const { createWorker } = await import('tesseract.js');
  if (!workerOCR) {
    workerOCR = await createWorker('por', 1, {
      logger: (m) => aoProgredir?.(m.status === 'recognizing text' ? `Lendo imagem ${Math.round(m.progress * 100)}%` : 'Preparando leitura de imagem...'),
    });
  }
  const textos = [];
  for (const img of imagens) {
    const { data } = await workerOCR.recognize(img);
    textos.push(data.text);
  }
  return textos.join('\n');
}

export async function lerImagem(file, aoProgredir) {
  const texto = await ocrImagens([file], aoProgredir);
  return { texto, linhas: texto.split('\n').map((l) => l.trim()).filter(Boolean), paginas: [], usouOCR: true };
}

// Procura um valor perto de um rótulo usando a posição na página (ex.: DANFE,
// onde o rótulo fica em cima e o valor logo abaixo).
function valorPertoDoRotulo(paginas, reRotulo, reValor = /^\s*(?:R\$\s*)?\d{1,3}(?:\.\d{3})*,\d{2}\s*$/) {
  for (const pg of paginas) {
    for (const rot of pg.itens) {
      if (!reRotulo.test(rot.str)) continue;
      // valor na mesma linha à direita, se o próprio trecho já contém o valor
      const mesmoTrecho = rot.str.replace(reRotulo, '').match(RE_DINHEIRO);
      if (mesmoTrecho) return Math.abs(paraNumero(mesmoTrecho[0]));
      let melhor = null;
      pg.itens.forEach((it) => {
        if (it === rot || !reValor.test(it.str)) return;
        const dy = rot.y - it.y;
        const centroRot = rot.x + rot.w / 2;
        const centroIt = it.x + it.w / 2;
        let dist = null;
        if (Math.abs(dy) <= 3 && it.x > rot.x) dist = it.x - (rot.x + rot.w); // mesma linha
        else if (dy > 0 && dy < 32 && it.x + it.w >= rot.x - 25 && it.x <= rot.x + rot.w + 25) {
          dist = dy * 2 + Math.abs(centroIt - centroRot) * 0.3; // logo abaixo
        }
        if (dist !== null && dist >= -5 && (melhor === null || dist < melhor.dist)) melhor = { dist, it };
      });
      if (melhor) return Math.abs(paraNumero(melhor.it.str));
    }
  }
  return null;
}

function textoPertoDoRotulo(paginas, reRotulo) {
  for (const pg of paginas) {
    for (const rot of pg.itens) {
      if (!reRotulo.test(rot.str)) continue;
      const resto = limparNome(rot.str.replace(reRotulo, ''));
      if (resto.length > 3) return resto;
      let melhor = null;
      pg.itens.forEach((it) => {
        if (it === rot || it.str.length < 4 || /\d{2}\/\d{2}\/\d{4}|^[\d.,/-]+$/.test(it.str)) return;
        const dy = rot.y - it.y;
        let dist = null;
        if (Math.abs(dy) <= 3 && it.x > rot.x) dist = it.x - rot.x;
        else if (dy > 0 && dy < 26 && Math.abs(it.x - rot.x) < 60) dist = dy * 2 + Math.abs(it.x - rot.x);
        if (dist !== null && (melhor === null || dist < melhor.dist)) melhor = { dist, it };
      });
      if (melhor) return limparNome(melhor.it.str);
    }
  }
  return '';
}

function valorAposRotulo(texto, reRotulo, distancia = 160) {
  const re = new RegExp(reRotulo.source, 'gi');
  let m;
  while ((m = re.exec(texto))) {
    const trecho = texto.slice(m.index + m[0].length, m.index + m[0].length + distancia);
    const v = primeiroDinheiro(trecho);
    if (v !== null && v > 0) return v;
  }
  return null;
}

function dataAposRotulo(texto, reRotulo, distancia = 120) {
  const re = new RegExp(reRotulo.source, 'gi');
  let m;
  while ((m = re.exec(texto))) {
    const d = primeiraData(texto.slice(m.index + m[0].length, m.index + m[0].length + distancia));
    if (d) return d;
  }
  return '';
}

/* ------------------------------------------------------------------ */
/* Boleto                                                               */
/* ------------------------------------------------------------------ */

function dataDoFator(fator) {
  if (!fator) return '';
  const base1 = new Date('1997-10-07T12:00:00');
  const c1 = new Date(base1.getTime() + fator * 86400000);
  const candidatos = [isoDe(c1)];
  if (fator >= 1000) {
    // a partir de 22/02/2025 o fator de vencimento reiniciou em 1000
    const c2 = new Date(new Date('2025-02-22T12:00:00').getTime() + (fator - 1000) * 86400000);
    candidatos.push(isoDe(c2));
  }
  const hoje = hojeISO();
  return candidatos.sort((a, b) => Math.abs(difDias(a, hoje)) - Math.abs(difDias(b, hoje)))[0];
}

export function decodificarBoleto(linhaOuCodigo) {
  const d = soDigitos(linhaOuCodigo);
  if (d.length === 47) {
    const fator = Number(d.slice(33, 37));
    const valor = Number(d.slice(37, 47)) / 100;
    return { tipo: 'bancario', linha: d, valor: valor || null, vencimento: dataDoFator(fator) };
  }
  if (d.length === 44 && d[0] !== '8') {
    const fator = Number(d.slice(5, 9));
    const valor = Number(d.slice(9, 19)) / 100;
    return { tipo: 'bancario', linha: d, valor: valor || null, vencimento: dataDoFator(fator) };
  }
  if ((d.length === 48 || d.length === 44) && d[0] === '8') {
    const codigo = d.length === 48 ? d.slice(0, 11) + d.slice(12, 23) + d.slice(24, 35) + d.slice(36, 47) : d;
    const valor = ['6', '7'].includes(codigo[2]) ? Number(codigo.slice(4, 15)) / 100 : null;
    return { tipo: 'arrecadacao', linha: d, valor: valor || null, vencimento: '' };
  }
  return null;
}

export function formatarLinhaDigitavel(l) {
  const d = soDigitos(l);
  if (d.length === 47) {
    return `${d.slice(0, 5)}.${d.slice(5, 10)} ${d.slice(10, 15)}.${d.slice(15, 21)} ${d.slice(21, 26)}.${d.slice(26, 32)} ${d[32]} ${d.slice(33)}`;
  }
  if (d.length === 48) return d.match(/.{12}/g).join(' ');
  return l || '';
}

export function encontrarBoleto(texto) {
  const plano = texto.replace(/\n/g, ' ');
  const reBanc = /\b\d{5}[.\s]?\d{5}\s*\d{5}[.\s]?\d{6}\s*\d{5}[.\s]?\d{6}\s*\d\s*\d{14}\b/;
  let m = plano.match(reBanc);
  if (m) return decodificarBoleto(m[0]);
  const reArr = /\b8\d{10}[\s-]?\d\s*\d{11}[\s-]?\d\s*\d{11}[\s-]?\d\s*\d{11}[\s-]?\d\b/;
  m = plano.match(reArr);
  if (m) return decodificarBoleto(m[0]);
  return null;
}

/* ------------------------------------------------------------------ */
/* Notas fiscais                                                        */
/* ------------------------------------------------------------------ */

function chaveNFe(texto) {
  const plano = texto.replace(/\n/g, ' ');
  const re = /(?:\d{4}[\s.]?){10}\d{4}/g;
  let m;
  while ((m = re.exec(plano))) {
    const d = soDigitos(m[0]);
    if (d.length === 44 && /^(1[1-7]|2[1-9]|3[1-35]|4[1-3]|5[0-3])/.test(d) && ['55', '65', '57'].includes(d.slice(20, 22))) return d;
  }
  return '';
}

const ROTULOS_VALOR = [
  /VALOR\s+TOTAL\s+DA\s+NOTA/i,
  /VALOR\s+L[ÍI]QUIDO(\s+DA\s+(NFS-?E|NOTA))?/i,
  /VALOR\s+TOTAL\s+DA\s+NFS-?E/i,
  /VALOR\s+TOTAL\s+D[OE]S?\s+SERVI[ÇC]OS?/i,
  /VALOR\s+D[OE]S?\s+SERVI[ÇC]OS?/i,
  /TOTAL\s+DA\s+NOTA/i,
  /VALOR\s+TOTAL/i,
  /TOTAL\s+A\s+PAGAR/i,
  /VALOR\s+DO\s+DOCUMENTO/i,
  /VALOR\s+COBRADO/i,
];

export function interpretarNotaTexto(leitura) {
  const { texto, paginas = [] } = leitura;
  const T = texto;
  const r = {
    numero: '', serie: '', chave: '', emitenteNome: '', emitenteDoc: '', destNome: '', destDoc: '',
    dataEmissao: '', vencimento: '', valor: null, linhaDigitavel: '', descricao: '', documentos: [],
    ehBoleto: false, ehNota: false,
  };

  r.chave = chaveNFe(T);
  if (r.chave) {
    r.ehNota = true;
    r.emitenteDoc = r.chave.slice(6, 20);
    r.serie = String(Number(r.chave.slice(22, 25)));
    r.numero = String(Number(r.chave.slice(25, 34)));
  }

  if (!r.numero) {
    const padroes = [
      /N[ÚU]MERO\s+DA\s+NFS-?E\s*:?\s*(\d[\d.]*)/i,
      /NFS-?E\s*(?:N[º°o.]|N[ÚU]MERO)\s*:?\s*(\d[\d.]*)/i,
      /N[ÚU]MERO\s+DA\s+NOTA\s*(?:FISCAL)?\s*:?\s*(\d[\d.]*)/i,
      /NOTA\s+FISCAL[^\n]{0,30}?N[º°o.]\s*:?\s*(\d[\d.]*)/i,
      /\bN[º°]\s*:?\s*(\d{1,3}(?:\.\d{3})+|\d{1,9})\b/i,
      /\bN[ÚU]MERO\s*:?\s*(\d{1,9})\b/i,
    ];
    for (const re of padroes) {
      const m = T.match(re);
      if (m) { r.numero = String(Number(soDigitos(m[1]))); break; }
    }
    if (!r.numero) {
      const v = textoPertoDoRotulo(paginas, /^N[ÚU]MERO\s+DA\s+NFS-?E$|^N[ÚU]MERO\s+DA\s+NOTA$/i);
      if (/^\d+$/.test(soDigitos(v)) && soDigitos(v)) r.numero = String(Number(soDigitos(v)));
    }
    if (r.numero && /NFS-?E|NOTA\s+FISCAL|PRESTADOR|DANFE/i.test(T)) r.ehNota = true;
  }
  if (!r.serie) {
    const m = T.match(/S[ÉE]RIE\s*:?\s*(\d{1,3})\b/i);
    if (m) r.serie = m[1];
  }

  // valor
  for (const re of ROTULOS_VALOR) {
    const v = valorPertoDoRotulo(paginas, re) ?? valorAposRotulo(T, re);
    if (v) { r.valor = v; break; }
  }

  // datas
  r.dataEmissao = dataAposRotulo(T, /DATA\s+(?:DE\s+|DA\s+)?EMISS[ÃA]O|EMITIDA\s+EM|EMISS[ÃA]O/)
    || (paginas.length ? paraISO(textoPertoDataRotulo(paginas, /DATA\s+(DA|DE)\s+EMISS[ÃA]O/i)) : '');
  r.vencimento = dataAposRotulo(T, /VENCIMENTO|DATA\s+DE\s+VENCIMENTO|VENC\./);

  // boleto
  const boleto = encontrarBoleto(T);
  if (boleto) {
    r.linhaDigitavel = boleto.linha;
    r.ehBoleto = true;
    if (!r.vencimento && boleto.vencimento) r.vencimento = boleto.vencimento;
    r.valorBoleto = boleto.valor;
    if (!r.valor && boleto.valor) r.valor = boleto.valor;
  }

  // nomes
  const recebemos = T.replace(/\n/g, ' ').match(/RECEBEMOS\s+DE\s+(.+?)\s+OS\s+(PRODUTOS|SERVI)/i);
  const nomes = [];
  if (recebemos) nomes.push(limparNome(recebemos[1]));
  const reNome = /(?:NOME\s*\/\s*RAZ[ÃA]O\s+SOCIAL|RAZ[ÃA]O\s+SOCIAL\s*\/\s*NOME|NOME\s+EMPRESARIAL|RAZ[ÃA]O\s+SOCIAL|BENEFICI[ÁA]RIO|CEDENTE)\s*:?\s*(.*)/gi;
  const linhas = leitura.linhas || T.split('\n');
  linhas.forEach((ln, i) => {
    reNome.lastIndex = 0;
    const m = reNome.exec(ln);
    if (!m) return;
    let nome = limparNome(m[1]);
    if (nome.length < 3 && linhas[i + 1]) nome = limparNome(linhas[i + 1]);
    if (nome.length >= 3 && !/^(CPF|CNPJ|ENDERE|INSCRI)/i.test(nome) && !nomes.includes(nome)) nomes.push(nome);
  });
  if (!nomes.length) {
    const n = textoPertoDoRotulo(paginas, /^(NOME|RAZ[ÃA]O)\s*\/?\s*(RAZ[ÃA]O\s+SOCIAL|SOCIAL|NOME)?$/i);
    if (n) nomes.push(n);
  }
  [r.emitenteNome = '', r.destNome = ''] = nomes;

  r.documentos = documentosNoTexto(T);
  if (!r.emitenteDoc) r.emitenteDoc = r.documentos[0] || '';
  r.destDoc = r.documentos.find((d) => d !== r.emitenteDoc) || '';

  // descrição
  const reDesc = /(DISCRIMINA[ÇC][ÃA]O\s+DOS\s+SERVI[ÇC]OS|DESCRI[ÇC][ÃA]O\s+DOS?\s+SERVI[ÇC]OS?|DESCRI[ÇC][ÃA]O\s+DO\s+PRODUTO|DADOS\s+ADICIONAIS|INFORMA[ÇC][ÕO]ES\s+COMPLEMENTARES)\s*:?/i;
  const md = T.match(reDesc);
  if (md) {
    r.descricao = T.slice(md.index + md[0].length, md.index + md[0].length + 400)
      .split('\n').map((s) => s.trim()).filter((s) => s && !/^(C[ÓO]DIGO|UNID|QTD|VALOR|VENC)/i.test(s)).slice(0, 4).join(' ')
      .replace(/\s{2,}/g, ' ').slice(0, 250);
  }
  return r;
}

function textoPertoDataRotulo(paginas, re) {
  for (const pg of paginas) {
    for (const rot of pg.itens) {
      if (!re.test(rot.str)) continue;
      const it = pg.itens
        .filter((i) => RE_DATA.test(i.str) && rot.y - i.y >= -3 && rot.y - i.y < 30 && Math.abs(i.x - rot.x) < 80)
        .sort((a, b) => (rot.y - a.y) - (rot.y - b.y))[0];
      if (it) return it.str.match(RE_DATA)[0];
    }
  }
  return '';
}

export function interpretarNotaXML(xmlTexto) {
  const docXml = new DOMParser().parseFromString(xmlTexto, 'text/xml');
  if (docXml.getElementsByTagName('parsererror').length) throw new Error('XML inválido');
  const todos = (raiz, nome) => Array.from((raiz || docXml).getElementsByTagNameNS('*', nome));
  const um = (raiz, ...nomes) => {
    for (const n of nomes) {
      const el = todos(raiz, n)[0];
      if (el && el.textContent.trim()) return el.textContent.trim();
    }
    return '';
  };
  const bloco = (...nomes) => {
    for (const n of nomes) { const el = todos(docXml, n)[0]; if (el) return el; }
    return null;
  };
  const r = {
    numero: '', serie: '', chave: '', emitenteNome: '', emitenteDoc: '', destNome: '', destDoc: '',
    dataEmissao: '', vencimento: '', valor: null, linhaDigitavel: '', descricao: '', parcelas: [], ehNota: true,
  };
  const infNFe = bloco('infNFe', 'infCte');
  if (infNFe) {
    r.chave = soDigitos(infNFe.getAttribute('Id'));
    const emit = bloco('emit');
    const dest = bloco('dest', 'toma3', 'toma4');
    r.numero = um(null, 'nNF', 'nCT');
    r.serie = um(null, 'serie');
    r.dataEmissao = paraISO(um(null, 'dhEmi', 'dEmi'));
    r.emitenteNome = um(emit, 'xNome');
    r.emitenteDoc = soDigitos(um(emit, 'CNPJ', 'CPF'));
    r.destNome = um(dest, 'xNome');
    r.destDoc = soDigitos(um(dest, 'CNPJ', 'CPF'));
    r.valor = paraNumero(um(bloco('ICMSTot'), 'vNF') || um(null, 'vNF', 'vTPrest'));
    r.parcelas = todos(null, 'dup').map((d) => ({
      numero: um(d, 'nDup'), vencimento: paraISO(um(d, 'dVenc')), valor: paraNumero(um(d, 'vDup')),
    }));
    const produtos = todos(null, 'xProd').map((e) => e.textContent.trim()).slice(0, 5);
    r.descricao = [produtos.join('; '), um(null, 'infCpl')].filter(Boolean).join(' | ').slice(0, 300);
  } else {
    // NFS-e (padrão nacional ou ABRASF)
    const prest = bloco('PrestadorServico', 'Prestador', 'prest', 'emit');
    const tom = bloco('TomadorServico', 'Tomador', 'toma');
    r.numero = um(null, 'nNFSe', 'Numero', 'NumeroNfse');
    r.dataEmissao = paraISO(um(null, 'dhEmi', 'DataEmissao', 'dhProc', 'Competencia'));
    r.emitenteNome = um(prest, 'RazaoSocial', 'xNome', 'NomeFantasia');
    r.emitenteDoc = soDigitos(um(prest, 'Cnpj', 'CNPJ', 'Cpf', 'CPF'));
    r.destNome = um(tom, 'RazaoSocial', 'xNome');
    r.destDoc = soDigitos(um(tom, 'Cnpj', 'CNPJ', 'Cpf', 'CPF'));
    r.valor = paraNumero(um(null, 'vLiq', 'ValorLiquidoNfse', 'vServ', 'ValorServicos', 'ValorTotal'));
    r.descricao = um(null, 'xDescServ', 'Discriminacao').slice(0, 300);
    r.chave = soDigitos(um(null, 'chNFSe', 'CodigoVerificacao')).slice(0, 50);
  }
  if (r.parcelas.length) {
    r.vencimento = r.parcelas[0].vencimento;
    if (r.parcelas.length > 1) {
      r.descricao = `${r.descricao} | Parcelas: ${r.parcelas.map((p) => `${p.numero || ''} ${p.vencimento} R$ ${p.valor?.toFixed(2)}`).join('; ')}`.slice(0, 500);
    }
  }
  return r;
}

/* ------------------------------------------------------------------ */
/* Planilhas                                                            */
/* ------------------------------------------------------------------ */

export async function lerPlanilha(buffer) {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  return wb.SheetNames.map((nome) => ({
    nome,
    linhas: XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, raw: true, defval: '' }),
  }));
}

function mapearCabecalho(linhas, campos) {
  let melhor = { idx: -1, mapa: {}, pontos: 0 };
  linhas.slice(0, 25).forEach((linha, idx) => {
    const mapa = {};
    let pontos = 0;
    linha.forEach((cel, col) => {
      const h = semAcento(cel).replace(/[^a-z0-9/ ]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!h || h.length > 40) return;
      for (const [campo, sinonimos] of Object.entries(campos)) {
        if (mapa[campo] !== undefined) continue;
        if (sinonimos.some((s) => h === s) || sinonimos.some((s) => s.length > 3 && h.includes(s))) {
          mapa[campo] = col;
          pontos += 1;
          break;
        }
      }
    });
    if (pontos > melhor.pontos) melhor = { idx, mapa, pontos };
  });
  return melhor.pontos >= 2 ? melhor : null;
}

const CAMPOS_NOTA = {
  vencimento: ['vencimento', 'venc', 'data vencimento', 'data de vencimento', 'dt venc', 'vcto'],
  dataPagamento: ['data pagamento', 'data de pagamento', 'pago em', 'dt pagamento', 'data pgto', 'pagamento'],
  dataEmissao: ['emissao', 'data emissao', 'data de emissao', 'dt emissao', 'data'],
  numero: ['numero', 'n nf', 'nf', 'nfe', 'nfse', 'nota', 'nota fiscal', 'numero nf', 'numero da nota', 'n', 'no', 'num', 'documento'],
  valor: ['valor', 'valor total', 'total', 'vlr', 'valor liquido', 'valor nf', 'valor da nota', 'montante'],
  parteDoc: ['cnpj', 'cpf', 'cnpj/cpf', 'cpf/cnpj', 'cnpj cpf'],
  parteNome: ['fornecedor', 'emitente', 'cliente', 'razao social', 'nome', 'prestador', 'tomador', 'favorecido', 'empresa', 'beneficiario'],
  descricao: ['descricao', 'historico', 'referente', 'referencia', 'obs', 'observacao', 'observacoes', 'servico', 'produto'],
  categoria: ['categoria', 'centro de custo', 'plano de contas', 'conta'],
  status: ['status', 'situacao', 'pago'],
  linhaDigitavel: ['linha digitavel', 'boleto', 'codigo de barras', 'cod barras'],
  tipo: ['tipo', 'natureza'],
  chave: ['chave', 'chave de acesso', 'chave nfe'],
};

export function notasDaPlanilha(abas) {
  const saida = [];
  abas.forEach((aba) => {
    const cab = mapearCabecalho(aba.linhas, CAMPOS_NOTA);
    if (!cab) return;
    const { mapa } = cab;
    const pega = (l, c) => (mapa[c] !== undefined ? l[mapa[c]] : '');
    aba.linhas.slice(cab.idx + 1).forEach((l) => {
      const valor = paraNumero(pega(l, 'valor'));
      if (!valor) return;
      const tipoTxt = semAcento(pega(l, 'tipo'));
      const statusTxt = semAcento(pega(l, 'status'));
      const dataPg = paraISO(pega(l, 'dataPagamento'));
      saida.push({
        numero: String(pega(l, 'numero') ?? '').trim(),
        chave: soDigitos(pega(l, 'chave')),
        parteNome: String(pega(l, 'parteNome') ?? '').trim(),
        parteDoc: soDigitos(pega(l, 'parteDoc')),
        dataEmissao: paraISO(pega(l, 'dataEmissao')),
        vencimento: paraISO(pega(l, 'vencimento')),
        valor: Math.abs(valor),
        descricao: String(pega(l, 'descricao') ?? '').trim(),
        categoria: String(pega(l, 'categoria') ?? '').trim(),
        linhaDigitavel: soDigitos(pega(l, 'linhaDigitavel')),
        tipo: /receb|receita|entrada|venda|cliente/.test(tipoTxt) ? 'receber' : (/pagar|despesa|saida|fornec/.test(tipoTxt) ? 'pagar' : null),
        pago: !!dataPg || /^(pago|paga|sim|quitad|liquidad|baixad|recebid)/.test(statusTxt),
        dataPagamento: dataPg,
        origem: `Planilha (${aba.nome})`,
      });
    });
  });
  return saida;
}

const CAMPOS_EXTRATO = {
  data: ['data', 'data lancamento', 'data do lancamento', 'dt lancamento', 'data movimento', 'data mov', 'dt', 'date'],
  descricao: ['descricao', 'historico', 'lancamento', 'lancamentos', 'memo', 'detalhes', 'descricao do lancamento', 'complemento', 'description'],
  documento: ['documento', 'doc', 'n documento', 'numero documento', 'id'],
  credito: ['credito', 'entradas', 'entrada', 'creditos', 'valor credito', 'recebimentos'],
  debito: ['debito', 'saidas', 'saida', 'debitos', 'valor debito', 'pagamentos'],
  valor: ['valor', 'valor r$', 'valor (r$)', 'montante', 'amount', 'quantia'],
  tipo: ['tipo', 'd/c', 'c/d', 'natureza', 'sinal'],
  saldo: ['saldo'],
};

export function extratoDaPlanilha(abas) {
  const saida = [];
  abas.forEach((aba) => {
    const cab = mapearCabecalho(aba.linhas, CAMPOS_EXTRATO);
    if (!cab || cab.mapa.data === undefined) return;
    const { mapa } = cab;
    const pega = (l, c) => (mapa[c] !== undefined ? l[mapa[c]] : '');
    aba.linhas.slice(cab.idx + 1).forEach((l) => {
      const data = paraISO(pega(l, 'data'));
      if (!data) return;
      const descricao = String(pega(l, 'descricao') ?? '').trim();
      if (/^saldo/i.test(semAcento(descricao))) return;
      let valor = null;
      let tipo = null;
      const cred = paraNumero(pega(l, 'credito'));
      const deb = paraNumero(pega(l, 'debito'));
      if (cred) { valor = Math.abs(cred); tipo = 'entrada'; } else if (deb) { valor = Math.abs(deb); tipo = 'saida'; } else {
        const bruto = pega(l, 'valor');
        const v = paraNumero(bruto);
        if (!v) return;
        valor = Math.abs(v);
        const t = semAcento(pega(l, 'tipo'));
        if (/^c|credit|entrada/.test(t)) tipo = 'entrada';
        else if (/^d|debit|saida/.test(t)) tipo = 'saida';
        else tipo = v < 0 ? 'saida' : 'entrada';
      }
      saida.push({ data, descricao, valor, tipo, documento: String(pega(l, 'documento') ?? '').trim() });
    });
  });
  return saida;
}

/* ------------------------------------------------------------------ */
/* Extratos                                                             */
/* ------------------------------------------------------------------ */

const PALAVRAS_SAIDA = /(PIX\s+(ENVIADO|EMITIDO|PAGO)|ENVIO\s+PIX|PAGAMENTO|PAGTO|PGTO|D[ÉE]BITO|TARIFA|SAQUE|COMPRA|TRANSF(ER[ÊE]NCIA)?\s+(ENVIADA|EMITIDA)|TED\s+ENVIADA|DOC\s+ENVIADO|BOLETO\s+PAGO|IOF|JUROS|ENCARGOS|APLICA[ÇC][ÃA]O|IMPOSTO|DARF|GPS|FGTS|CONVENIO|PAG\s+|ENVIADO)/i;
const PALAVRAS_ENTRADA = /(PIX\s+RECEBIDO|RECEBIMENTO|CR[ÉE]DITO|DEP[ÓO]SITO|TED\s+RECEBIDA|DOC\s+RECEBIDO|TRANSF(ER[ÊE]NCIA)?\s+RECEBIDA|RESGATE|ESTORNO|RENDIMENTO|RECEBIDO|LIQUIDA[ÇC][ÃA]O\s+DE\s+COBRAN|COBRAN[ÇC]A)/i;

export function extratoDoTexto(leitura) {
  const { linhas, texto } = leitura;
  const anos = (texto.match(/\b\d{2}\/\d{2}\/(20\d{2})\b/g) || []).map((d) => d.slice(-4));
  const anoPadrao = anos.length ? anos.sort((a, b) => anos.filter((x) => x === b).length - anos.filter((x) => x === a).length)[0] : String(new Date().getFullYear());
  const movs = [];
  let ultimaData = '';
  linhas.forEach((linhaOriginal) => {
    const linha = linhaOriginal.replace(/\s+/g, ' ').trim();
    if (!linha || /^SALDO|SALDO\s+(ANTERIOR|DO\s+DIA|FINAL|DISPON|EM\s+C\/C|BLOQ)|S\s*A\s*L\s*D\s*O/i.test(linha)) return;
    const md = linha.match(/^(\d{2}[/.-]\d{2}(?:[/.-]\d{2,4})?)\b/);
    let data = md ? paraISO(md[1], anoPadrao) : '';
    if (data) ultimaData = data;
    else data = ultimaData;
    if (!data) return;
    const valores = [...linha.matchAll(/(-\s?)?(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2})(\s?[-+DC*])?(?![\d])/g)];
    if (!valores.length) return;
    // quando há valor e saldo na linha, o valor do lançamento é o primeiro
    const vm = valores[0];
    const bruto = vm[0];
    const valor = Math.abs(paraNumero(vm[2]));
    if (!valor) return;
    let descricao = linha
      .slice(md ? md[0].length : 0, vm.index)
      .replace(/^\s*[-–]\s*/, '')
      .replace(/\b\d{2}[/.-]\d{2}([/.-]\d{2,4})?\b/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (!descricao) descricao = linha.slice(vm.index + bruto.length).replace(RE_DINHEIRO, '').trim();
    if (!descricao || /^(DATA|HIST[ÓO]RICO|LAN[ÇC]AMENTO)/i.test(descricao)) return;
    let tipo;
    if (/-/.test(vm[1] || '') || /[-D*]/i.test(vm[3] || '')) tipo = 'saida';
    else if (/[+C]/i.test(vm[3] || '')) tipo = 'entrada';
    else if (PALAVRAS_SAIDA.test(descricao) && !PALAVRAS_ENTRADA.test(descricao)) tipo = 'saida';
    else if (PALAVRAS_ENTRADA.test(descricao)) tipo = 'entrada';
    else tipo = 'saida';
    movs.push({ data, descricao: descricao.slice(0, 200), valor, tipo, documento: '' });
  });
  return movs;
}

export function extratoOFX(texto) {
  const movs = [];
  const blocos = texto.split(/<STMTTRN>/i).slice(1);
  blocos.forEach((b) => {
    const tag = (t) => {
      const m = b.match(new RegExp(`<${t}>([^<\\r\\n]*)`, 'i'));
      return m ? m[1].trim() : '';
    };
    const valor = Number(tag('TRNAMT').replace(',', '.'));
    if (!valor) return;
    const dt = tag('DTPOSTED');
    const data = dt ? `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}` : '';
    movs.push({
      data,
      descricao: [tag('NAME'), tag('MEMO')].filter(Boolean).join(' - ').slice(0, 200),
      valor: Math.abs(valor),
      tipo: valor < 0 ? 'saida' : 'entrada',
      documento: tag('CHECKNUM') || tag('FITID'),
    });
  });
  return movs;
}

/* ------------------------------------------------------------------ */
/* Comprovantes de pagamento                                            */
/* ------------------------------------------------------------------ */

export function interpretarComprovante(leitura) {
  const T = leitura.texto;
  const linhas = leitura.linhas || T.split('\n');
  const r = {
    valor: null, data: '', favorecido: '', documento: '', formaPagamento: '', descricao: '', linhaDigitavel: '', tipo: 'saida',
  };
  r.valor = valorAposRotulo(T, /VALOR\s+(TOTAL\s+)?(PAGO|DO\s+PAGAMENTO|DA\s+TRANSFER[ÊE]NCIA|DO\s+PIX|TRANSFERIDO|DEBITADO|COBRADO|DO\s+DOCUMENTO)|TOTAL\s+PAGO|VALOR\s*:/, 80)
    ?? valorAposRotulo(T, /VALOR|TOTAL/, 60)
    ?? primeiroDinheiro(T);
  r.data = dataAposRotulo(T, /DATA\s+(D[OAE]\s+)?(PAGAMENTO|TRANSFER[ÊE]NCIA|D[ÉE]BITO|OPERA[ÇC][ÃA]O|TRANSA[ÇC][ÃA]O|EFETIVA[ÇC][ÃA]O)|PAGO\s+EM|REALIZAD[OA]\s+EM|EFETUAD[OA]\s+EM|DATA\s*:/, 60)
    || primeiraData(T);
  const reFav = /(FAVORECIDO|BENEFICI[ÁA]RIO|RECEBEDOR|DESTINAT[ÁA]RIO|DESTINO|PARA|CEDENTE|NOME\s+DO\s+RECEBEDOR|QUEM\s+RECEBEU|RAZ[ÃA]O\s+SOCIAL)\s*:?\s*(.*)/i;
  for (let i = 0; i < linhas.length; i += 1) {
    const m = linhas[i].match(reFav);
    if (!m) continue;
    let nome = limparNome(m[2]);
    if (nome.length < 3 && linhas[i + 1]) nome = limparNome(linhas[i + 1]);
    if (nome.length >= 3 && !/^(CPF|CNPJ|AG[ÊE]NCIA|CONTA|INSTITUI)/i.test(nome) && !/\d+,\d{2}/.test(nome)) {
      r.favorecido = nome.replace(/^(NOME|RAZ[ÃA]O SOCIAL)\s*:?\s*/i, '');
      break;
    }
  }
  r.documentos = documentosNoTexto(T);
  r.documento = r.documentos[0] || '';
  if (/\bPIX\b/i.test(T)) r.formaPagamento = 'PIX';
  else if (/BOLETO|C[ÓO]DIGO\s+DE\s+BARRAS|LINHA\s+DIGIT/i.test(T)) r.formaPagamento = 'Boleto';
  else if (/\bTED\b|\bDOC\b/i.test(T)) r.formaPagamento = 'TED/DOC';
  else if (/TRANSFER[ÊE]NCIA/i.test(T)) r.formaPagamento = 'Transferência';
  else if (/CART[ÃA]O/i.test(T)) r.formaPagamento = 'Cartão';
  const boleto = encontrarBoleto(T);
  if (boleto) r.linhaDigitavel = boleto.linha;
  const md = T.match(/(DESCRI[ÇC][ÃA]O|MENSAGEM|INFORMA[ÇC][ÕO]ES?\s+(ADICIONAIS|AO\s+RECEBEDOR)?|REFERENTE\s+A|IDENTIFICA[ÇC][ÃA]O)\s*:?\s*(.+)/i);
  if (md && md[3].trim().length > 2) r.descricao = md[3].trim().slice(0, 200);
  if (/PIX\s+RECEBIDO|VOC[ÊE]\s+RECEBEU|COMPROVANTE\s+DE\s+RECEBIMENTO/i.test(T)) r.tipo = 'entrada';
  return r;
}

/* ------------------------------------------------------------------ */
/* Entrada genérica: identifica o tipo de arquivo e lê                  */
/* ------------------------------------------------------------------ */

export function tipoDoArquivo(file) {
  const nome = (file.name || '').toLowerCase();
  if (file.type === 'application/pdf' || nome.endsWith('.pdf')) return 'pdf';
  if (/\.(xlsx|xls|xlsm|ods|csv)$/.test(nome) || /sheet|excel|csv/.test(file.type)) return 'planilha';
  if (nome.endsWith('.xml') || /^(text|application)\/xml$/.test(file.type)) return 'xml';
  if (nome.endsWith('.ofx')) return 'ofx';
  if (file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|bmp|gif)$/.test(nome)) return 'imagem';
  if (nome.endsWith('.txt')) return 'texto';
  return 'outro';
}

export async function lerArquivoComoTexto(file, aoProgredir) {
  const tipo = tipoDoArquivo(file);
  if (tipo === 'pdf') return lerPDF(await file.arrayBuffer(), { aoProgredir });
  if (tipo === 'imagem') return lerImagem(file, aoProgredir);
  const texto = await file.text();
  return { texto, linhas: texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean), paginas: [] };
}
