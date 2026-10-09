// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  paraNumero, paraISO, decodificarBoleto, interpretarNotaTexto, extratoDoTexto, extratoOFX,
  interpretarComprovante, interpretarNotaXML, notasDaPlanilha, extratoDaPlanilha,
} from '../src/lib/parsers';
import { sugerirNotas, notaDuplicada, empresaPorDocumentos } from '../src/lib/conciliacao';

const leitura = (t) => ({ texto: t, linhas: t.split('\n'), paginas: [] });

describe('números e datas', () => {
  it('converte valores no formato brasileiro', () => {
    expect(paraNumero('1.234,56')).toBe(1234.56);
    expect(paraNumero('R$ -1.234,56')).toBe(-1234.56);
    expect(paraNumero('150,00 D')).toBe(-150);
    expect(paraNumero('1234.5')).toBe(1234.5);
    expect(paraNumero('1.500')).toBe(1500);
    expect(paraNumero(99)).toBe(99);
  });
  it('converte datas', () => {
    expect(paraISO('05/03/2026')).toBe('2026-03-05');
    expect(paraISO('05/03', '2025')).toBe('2025-03-05');
    expect(paraISO('2026-01-31T10:00:00')).toBe('2026-01-31');
    expect(paraISO('31/02/2026')).toBe('');
  });
});

describe('boleto', () => {
  it('lê valor e vencimento da linha digitável (fator após 2025)', () => {
    const linha = `${'23790123016000000005325000456704'}1${'1605'}0000150000`;
    const b = decodificarBoleto(linha);
    expect(b.valor).toBe(1500);
    expect(b.vencimento).toBe('2026-10-20');
  });
});

const NFSE = `NOTA FISCAL DE SERVIÇOS ELETRÔNICA - NFS-e
Número da NFS-e: 2025123
Data e Hora de Emissão: 03/09/2026 10:22:11
PRESTADOR DE SERVIÇOS
Nome/Razão Social: LIMPEZA BOA VISTA LTDA
CPF/CNPJ: 11.222.333/0001-81
TOMADOR DE SERVIÇOS
Nome/Razão Social: RS SERVICOS LTDA
CPF/CNPJ: 45.723.174/0001-10
DISCRIMINAÇÃO DOS SERVIÇOS
Serviço de limpeza mensal
VALOR TOTAL DA NOTA = R$ 2.350,00
Vencimento: 15/09/2026`;

describe('nota fiscal', () => {
  it('interpreta NFS-e em texto', () => {
    const r = interpretarNotaTexto(leitura(NFSE));
    expect(r).toMatchObject({
      numero: '2025123', emitenteNome: 'LIMPEZA BOA VISTA LTDA', emitenteDoc: '11222333000181',
      destDoc: '45723174000110', dataEmissao: '2026-09-03', vencimento: '2026-09-15', valor: 2350, ehNota: true,
    });
  });
  it('interpreta XML de NF-e com duplicatas', () => {
    const xml = `<?xml version="1.0"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe43260911222333000181550010000045671000045678">
      <ide><serie>1</serie><nNF>4567</nNF><dhEmi>2026-09-01T10:00:00-03:00</dhEmi></ide>
      <emit><CNPJ>11222333000181</CNPJ><xNome>FORNECEDOR XYZ LTDA</xNome></emit>
      <dest><CNPJ>45723174000110</CNPJ><xNome>RS SERVICOS</xNome></dest>
      <det><prod><xProd>Papel A4</xProd></prod></det>
      <total><ICMSTot><vNF>800.50</vNF></ICMSTot></total>
      <cobr><dup><nDup>001</nDup><dVenc>2026-10-01</dVenc><vDup>800.50</vDup></dup></cobr>
    </infNFe></NFe></nfeProc>`;
    const r = interpretarNotaXML(xml);
    expect(r).toMatchObject({
      numero: '4567', serie: '1', emitenteNome: 'FORNECEDOR XYZ LTDA', destDoc: '45723174000110',
      valor: 800.5, vencimento: '2026-10-01', dataEmissao: '2026-09-01',
    });
    expect(r.chave).toHaveLength(44);
  });
  it('lê notas de uma planilha', () => {
    const abas = [{ nome: 'Plan1', linhas: [
      ['Relatório de contas'],
      ['Fornecedor', 'CNPJ', 'Nº NF', 'Emissão', 'Vencimento', 'Valor', 'Status'],
      ['Energia SA', '11.222.333/0001-81', '998', '01/09/2026', '10/09/2026', 'R$ 410,20', 'Pago'],
      ['Aluguel', '', '12', '01/09/2026', '05/09/2026', 3000, ''],
    ] }];
    const r = notasDaPlanilha(abas);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ parteNome: 'Energia SA', numero: '998', valor: 410.2, vencimento: '2026-09-10', pago: true });
    expect(r[1]).toMatchObject({ valor: 3000, pago: false });
  });
});

describe('extrato', () => {
  it('lê extrato em texto/PDF', () => {
    const t = `Data Histórico Valor Saldo
01/09/2026 SALDO ANTERIOR 10.000,00
02/09/2026 PIX RECEBIDO CLIENTE XPTO 5.000,00 15.000,00
03/09/2026 PAGAMENTO BOLETO LIMPEZA -2.350,00 12.650,00
05/09 TARIFA PACOTE 45,90 D 12.604,10`;
    const r = extratoDoTexto(leitura(t));
    expect(r.map((m) => [m.data, m.tipo, m.valor])).toEqual([
      ['2026-09-02', 'entrada', 5000], ['2026-09-03', 'saida', 2350], ['2026-09-05', 'saida', 45.9],
    ]);
  });
  it('lê OFX', () => {
    const r = extratoOFX('<STMTTRN><DTPOSTED>20260903<TRNAMT>-2350.00<MEMO>PAG</STMTTRN>');
    expect(r[0]).toMatchObject({ data: '2026-09-03', tipo: 'saida', valor: 2350 });
  });
  it('lê planilha com colunas de crédito e débito', () => {
    const r = extratoDaPlanilha([{ nome: 'x', linhas: [
      ['Data', 'Lançamento', 'Crédito (R$)', 'Débito (R$)', 'Saldo (R$)'],
      ['02/09/2026', 'PIX RECEBIDO', '5.000,00', '', '15.000,00'],
      ['03/09/2026', 'BOLETO', '', '-2.350,00', '12.650,00'],
    ] }]);
    expect(r.map((m) => [m.tipo, m.valor])).toEqual([['entrada', 5000], ['saida', 2350]]);
  });
});

describe('comprovante e conciliação', () => {
  it('lê comprovante de PIX', () => {
    const t = `Comprovante de Pix
Valor R$ 350,00
Data da transferência 07/09/2026 - 14:33
Destino
Nome POSTO SOL LTDA
CNPJ 11.222.333/0001-81
Mensagem: abastecimento carro`;
    expect(interpretarComprovante(leitura(t))).toMatchObject({
      valor: 350, data: '2026-09-07', favorecido: 'POSTO SOL LTDA', formaPagamento: 'PIX', descricao: 'abastecimento carro',
    });
  });
  it('sugere a nota em aberto de mesmo valor e nome parecido', () => {
    const notas = [
      { id: 'a', status: 'aberto', tipo: 'pagar', empresa: 'rs_servicos', valor: 2350, parteNome: 'LIMPEZA BOA VISTA LTDA', vencimento: '2026-09-15' },
      { id: 'b', status: 'aberto', tipo: 'pagar', empresa: 'rs_servicos', valor: 2350, parteNome: 'OUTRA EMPRESA', vencimento: '2026-12-15' },
      { id: 'c', status: 'aberto', tipo: 'pagar', empresa: 'rs_gestoes', valor: 2350, parteNome: 'LIMPEZA BOA VISTA LTDA' },
    ];
    const s = sugerirNotas({ tipo: 'saida', empresa: 'rs_servicos', valor: 2350, data: '2026-09-14', descricao: 'PAGTO BOLETO LIMPEZA BOA VISTA' }, notas);
    expect(s.map((x) => x.nota.id)).toEqual(['a', 'b']);
  });
  it('detecta duplicidade e empresa pelo CNPJ', () => {
    const notas = [{ id: '1', numero: '10', parteDoc: '11222333000181', empresa: 'rs_servicos', tipo: 'pagar', valor: 5 }];
    expect(notaDuplicada({ numero: '10', parteDoc: '11.222.333/0001-81', empresa: 'rs_servicos', tipo: 'pagar', valor: 5 }, notas)).toBeTruthy();
    expect(empresaPorDocumentos(['45723174000110'], { rs_gestoes: { cnpj: '45.723.174/0001-10' } })).toBe('rs_gestoes');
  });
});
