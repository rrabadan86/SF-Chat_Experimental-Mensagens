/**
 * Cofre dos ENVIOS AGENDADOS pelo painel (mensagem avulsa por WhatsApp).
 *
 * Cada agendamento tem: número, mensagem, foto (opcional), data e turno
 * (manhã/tarde). O robô roda 10:45 (manhã) e 15:45 (tarde) e dispara os
 * pendentes daquele dia + turno (ver src/enviar-agendados.js).
 *
 * Guardado em data/agendamentos.json; as fotos em data/agendamentos-fotos/.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const ARQUIVO = path.join(DATA_DIR, 'agendamentos.json');
const FOTOS_DIR = path.join(DATA_DIR, 'agendamentos-fotos');
const TURNOS = ['manha', 'tarde'];

function soDigitos(s) { return String(s == null ? '' : s).replace(/\D/g, ''); }

// Normaliza telefone BR para o formato do WhatsApp: 55 + DDD + número.
// Aceita com/sem o 55 e com/sem o 9. Retorna null se claramente inválido.
function normalizarTelefone(bruto) {
  let d = soDigitos(bruto);
  if (d.startsWith('55') && d.length > 11) d = d.slice(2); // tira DDI se veio junto
  if (d.length < 10 || d.length > 11) return null;         // DDD(2) + 8 ou 9 dígitos
  return '55' + d;
}

function carregar() {
  try { const o = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8')); return Array.isArray(o) ? o : []; }
  catch (_) { return []; }
}
function salvar(lista) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(ARQUIVO, JSON.stringify(lista, null, 2), 'utf8');
}
function idNovo() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

// Salva uma foto vinda como data URL (base64) e devolve o nome do arquivo.
function salvarFoto(dataUrl) {
  const m = /^data:(image\/(png|jpe?g|webp));base64,(.+)$/i.exec(dataUrl || '');
  if (!m) throw new Error('Formato de imagem não suportado (use JPG, PNG ou WEBP).');
  const ext = m[2].toLowerCase() === 'jpeg' ? 'jpg' : m[2].toLowerCase();
  const buf = Buffer.from(m[3], 'base64');
  if (buf.length > 6 * 1024 * 1024) throw new Error('Imagem muito grande (máx. ~6 MB).');
  if (!fs.existsSync(FOTOS_DIR)) fs.mkdirSync(FOTOS_DIR, { recursive: true });
  const nome = idNovo() + '.' + ext;
  fs.writeFileSync(path.join(FOTOS_DIR, nome), buf);
  return nome;
}

// nome de arquivo seguro (sem path traversal)
function fotoValida(nome) { return /^[a-z0-9]+\.(jpg|png|webp)$/i.test(String(nome || '')); }
function caminhoFoto(nome) {
  if (!fotoValida(nome)) return null;
  return path.join(FOTOS_DIR, nome);
}

function adicionar({ telefone, mensagem, fotoDataUrl, turno, data }) {
  const tel = normalizarTelefone(telefone);
  if (!tel) throw new Error('Número inválido. Use DDD + número (ex.: 62 99999-9999).');
  const msg = String(mensagem == null ? '' : mensagem).replace(/\r\n?/g, '\n').trim();
  if (!msg && !fotoDataUrl) throw new Error('Escreva uma mensagem (ou anexe uma foto).');
  if (!TURNOS.includes(turno)) throw new Error('Turno inválido.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data || '')) throw new Error('Data inválida.');
  const foto = fotoDataUrl ? salvarFoto(fotoDataUrl) : null;
  const item = {
    id: idNovo(), telefone: tel, mensagem: msg, foto,
    turno, data, status: 'pendente', criadoEm: new Date().toISOString(),
  };
  const lista = carregar(); lista.push(item); salvar(lista);
  return item;
}

function remover(id) {
  const lista = carregar();
  const item = lista.find(x => x.id === id);
  salvar(lista.filter(x => x.id !== id));
  if (item && item.foto) { try { fs.unlinkSync(path.join(FOTOS_DIR, item.foto)); } catch (_) {} }
  return !!item;
}

function pendentesDe(data, turno) {
  return carregar().filter(x => x.data === data && x.turno === turno && x.status === 'pendente');
}

function marcar(id, status, erro) {
  const lista = carregar();
  const item = lista.find(x => x.id === id);
  if (item) {
    item.status = status;
    if (erro) item.erro = String(erro).slice(0, 300);
    item.enviadoEm = new Date().toISOString();
    salvar(lista);
  }
  return item;
}

module.exports = {
  carregar, adicionar, remover, pendentesDe, marcar,
  caminhoFoto, fotoValida, normalizarTelefone,
  TURNOS, ARQUIVO, FOTOS_DIR,
};
