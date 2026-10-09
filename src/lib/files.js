import {
  collection, doc, setDoc, getDoc, getDocs, deleteDoc, serverTimestamp,
} from 'firebase/firestore';
import { db, auth } from '../firebase';

// Os anexos ficam no próprio Firestore, divididos em partes de ~700 KB.
// Assim o sistema funciona no plano gratuito do Firebase e herda as mesmas
// regras de segurança dos demais dados.
const TAM_PARTE = 700_000;
export const LIMITE_ARQUIVO = 20 * 1024 * 1024;

function lerBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function comprimirImagem(file) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.size < 400_000) return file;
  try {
    const bmp = await createImageBitmap(file);
    const escala = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * escala);
    canvas.height = Math.round(bmp.height * escala);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.82));
    if (!blob || blob.size >= file.size) return file;
    const nome = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], nome, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

export async function enviarArquivo(arquivoOriginal, empresa) {
  const file = await comprimirImagem(arquivoOriginal);
  if (file.size > LIMITE_ARQUIVO) {
    throw new Error(`O arquivo "${file.name}" passa de 20 MB.`);
  }
  const base64 = await lerBase64(file);
  const ref = doc(collection(db, 'arquivos'));
  const partes = Math.max(1, Math.ceil(base64.length / TAM_PARTE));
  for (let i = 0; i < partes; i += 1) {
    await setDoc(doc(db, 'arquivos', ref.id, 'partes', String(i).padStart(4, '0')), {
      i, dados: base64.slice(i * TAM_PARTE, (i + 1) * TAM_PARTE),
    });
  }
  const meta = {
    nome: file.name || 'arquivo',
    tipo: file.type || 'application/octet-stream',
    tamanho: file.size,
    partes,
    empresa: empresa || null,
    criadoPor: auth.currentUser?.email ?? null,
    criadoEm: serverTimestamp(),
  };
  await setDoc(ref, meta);
  return { id: ref.id, nome: meta.nome, tipo: meta.tipo, tamanho: meta.tamanho };
}

export async function baixarArquivo(id) {
  const meta = await getDoc(doc(db, 'arquivos', id));
  if (!meta.exists()) throw new Error('Arquivo não encontrado.');
  const snap = await getDocs(collection(db, 'arquivos', id, 'partes'));
  const partes = snap.docs.map((d) => d.data()).sort((a, b) => a.i - b.i);
  const base64 = partes.map((p) => p.dados).join('');
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return { blob: new Blob([bytes], { type: meta.data().tipo }), nome: meta.data().nome };
}

export async function abrirArquivo(id) {
  const janela = window.open('', '_blank');
  try {
    const { blob } = await baixarArquivo(id);
    const url = URL.createObjectURL(blob);
    if (janela) janela.location.href = url;
    else window.location.assign(url);
    setTimeout(() => URL.revokeObjectURL(url), 120_000);
  } catch (e) {
    janela?.close();
    throw e;
  }
}

export async function salvarArquivoLocal(id) {
  const { blob, nome } = await baixarArquivo(id);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function excluirArquivo(id) {
  const snap = await getDocs(collection(db, 'arquivos', id, 'partes'));
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  await deleteDoc(doc(db, 'arquivos', id));
}
