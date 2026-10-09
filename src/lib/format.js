export const EMPRESAS = {
  rs_servicos: { id: 'rs_servicos', nome: 'RS Serviços', cor: '#2563eb' },
  rs_gestoes: { id: 'rs_gestoes', nome: 'RS Gestões', cor: '#059669' },
};
export const LISTA_EMPRESAS = Object.values(EMPRESAS);

export const CATEGORIAS = [
  'Aluguel', 'Água / Luz / Telefone / Internet', 'Combustível', 'Contabilidade', 'Fornecedores / Materiais',
  'Impostos e Taxas', 'Manutenção', 'Marketing', 'Pró-labore', 'Salários e Encargos', 'Serviços de Terceiros',
  'Software / Sistemas', 'Tarifas Bancárias', 'Transporte / Frete', 'Viagens / Alimentação',
  'Receita de Serviços', 'Receita de Vendas', 'Transferência entre contas', 'Outros',
];

export const FORMAS_PAGAMENTO = ['PIX', 'Boleto', 'TED/DOC', 'Transferência', 'Cartão', 'Dinheiro', 'Débito automático', 'Outro'];

const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const brl = (v) => fmtBRL.format(Number(v) || 0);

export function dataBR(iso) {
  if (!iso) return '';
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return d ? `${d}/${m}/${a}` : iso;
}

export function hojeISO() {
  const d = new Date();
  return isoDe(d);
}

export function isoDe(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function somarDias(iso, dias) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + dias);
  return isoDe(d);
}

export function difDias(a, b) {
  return Math.round((new Date(`${a}T12:00:00`) - new Date(`${b}T12:00:00`)) / 86400000);
}

export function soDigitos(s) {
  return String(s ?? '').replace(/\D/g, '');
}

export function formatarDoc(doc) {
  const d = soDigitos(doc);
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  return doc || '';
}

export function semAcento(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export function nomeEmpresa(id) {
  return EMPRESAS[id]?.nome ?? id ?? '';
}

export function statusNota(n) {
  if (n.status === 'aberto' && n.vencimento && n.vencimento < hojeISO()) return 'vencido';
  return n.status;
}

export const ROTULO_STATUS = {
  aberto: 'Em aberto', vencido: 'Vencido', pago: 'Pago', cancelado: 'Cancelado',
};

export function tamanhoArquivo(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}
