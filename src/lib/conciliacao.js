import { sha256 } from 'js-sha256';
import { soDigitos, semAcento, difDias } from './format';

const PALAVRAS_IGNORADAS = new Set(['ltda', 'me', 'epp', 'eireli', 'sa', 'de', 'da', 'do', 'dos', 'das', 'e', 'pix', 'ted', 'doc',
  'pagamento', 'pagto', 'pgto', 'enviado', 'recebido', 'transferencia', 'boleto', 'para', 'servicos', 'comercio']);

function tokens(s) {
  return semAcento(s).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((t) => t.length > 2 && !PALAVRAS_IGNORADAS.has(t));
}

export function semelhancaNomes(a, b) {
  const ta = new Set(tokens(a));
  const tb = tokens(b);
  if (!ta.size || !tb.length) return 0;
  const comuns = tb.filter((t) => ta.has(t)).length;
  return comuns / Math.min(ta.size, tb.length);
}

// Procura a nota em aberto que corresponde a um pagamento/recebimento.
export function sugerirNotas(mov, notas, { reservadas = new Set() } = {}) {
  const tipoNota = mov.tipo === 'saida' ? 'pagar' : 'receber';
  const texto = `${mov.descricao || ''} ${mov.favorecido || ''}`;
  const docMov = soDigitos(mov.documento);
  return notas
    .filter((n) => n.status === 'aberto' && n.tipo === tipoNota && n.empresa === mov.empresa && !reservadas.has(n.id))
    .map((n) => {
      const dif = Math.abs((Number(n.valor) || 0) - mov.valor);
      const proporcao = mov.valor ? dif / mov.valor : 1;
      let pontos = 0;
      if (dif < 0.01) pontos += 60;
      else if (proporcao < 0.05) pontos += 30; // juros/multa/desconto pequenos
      else return null;
      const sem = semelhancaNomes(n.parteNome, texto);
      pontos += sem * 30;
      if (docMov && soDigitos(n.parteDoc) === docMov) pontos += 30;
      if (n.linhaDigitavel && mov.linhaDigitavel && soDigitos(n.linhaDigitavel) === soDigitos(mov.linhaDigitavel)) pontos += 50;
      if (n.numero && new RegExp(`\\b${n.numero}\\b`).test(texto)) pontos += 15;
      if (n.vencimento && mov.data) {
        const d = Math.abs(difDias(mov.data, n.vencimento));
        pontos += d <= 3 ? 10 : d <= 15 ? 5 : d > 90 ? -10 : 0;
      }
      return { nota: n, pontos };
    })
    .filter(Boolean)
    .sort((a, b) => b.pontos - a.pontos);
}

export function melhorNota(mov, notas, opcoes) {
  const s = sugerirNotas(mov, notas, opcoes)[0];
  return s && s.pontos >= 60 ? s.nota : null;
}

export function movimentoDuplicado(mov, movimentos) {
  return movimentos.find((m) => m.empresa === mov.empresa
    && m.tipo === mov.tipo
    && Math.abs((Number(m.valor) || 0) - mov.valor) < 0.01
    && m.data && mov.data && Math.abs(difDias(m.data, mov.data)) <= 3) || null;
}

export function notaDuplicada(n, notas) {
  const chave = soDigitos(n.chave);
  const linha = soDigitos(n.linhaDigitavel);
  return notas.find((o) => o.id !== n.id && (
    (chave && chave.length >= 20 && soDigitos(o.chave) === chave)
    || (linha && soDigitos(o.linhaDigitavel) === linha)
    || (n.numero && o.numero && String(o.numero) === String(n.numero) && o.empresa === n.empresa
      && soDigitos(o.parteDoc) === soDigitos(n.parteDoc) && o.tipo === n.tipo
      && (soDigitos(n.parteDoc) || Math.abs((o.valor || 0) - (n.valor || 0)) < 0.01))
  )) || null;
}

// Descobre a empresa (RS Serviços / RS Gestões) pelo CNPJ que aparece no documento.
// O CNPJ pode estar salvo em Configurações ou só como SHA-256 (cnpjHash) no código.
function confere(doc, info) {
  const d = soDigitos(doc);
  if (!d || !info) return false;
  const cnpj = soDigitos(info.cnpj);
  if (cnpj) return cnpj === d;
  return !!info.cnpjHash && d.length === 14 && sha256(d) === info.cnpjHash;
}

export function empresaPorDocumentos(docs, configEmpresas) {
  for (const [id, info] of Object.entries(configEmpresas || {})) {
    if ((docs || []).some((d) => confere(d, info))) return id;
  }
  return null;
}

export function ehNossoDocumento(doc, configEmpresas) {
  return Object.values(configEmpresas || {}).some((e) => confere(doc, e));
}
