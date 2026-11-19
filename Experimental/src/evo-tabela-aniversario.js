/**
 * evo-tabela-aniversario.js — lê a tabela da Segmentação "Aniversariantes" do EVO.
 *
 * Usado pelos jobs de aniversário (grupos e ex-alunas) e pela planilha.
 *
 * Por que existe: em 11/2026 o EVO passou a mostrar a coluna "Data de aniversário"
 * só com DIA/MÊS ("19/11"). Os jobs procuravam uma data COM ano na linha e acabavam
 * pegando a "Última presença" (ex.: 11/11/2026) como se fosse o aniversário — quem
 * fazia aniversário no dia não era encontrada. Aqui a data vem da COLUNA certa (pelo
 * título "aniversário"/"nascimento"), aceita "dd/mm" e "dd/mm/aaaa" e nunca usa as
 * colunas de presença, cadastro, vencimento ou contrato.
 *
 * lerLinhasAniversario roda DENTRO da página (page.evaluate(lerLinhasAniversario)):
 * não pode usar nada de fora da própria função.
 * Devolve [{ id, nome, nascimento, celular }] — nascimento "dd/mm" ou "dd/mm/aaaa";
 * celular só com dígitos, da coluna "Celular" quando a tabela tem (senão '').
 */
function lerLinhasAniversario() {
  const DATA = /(\d{2})\/(\d{2})(?:\/(\d{2,4}))?/;
  const COL_DATA = /anivers|nascim/i;
  const COL_NAO = /presen|[úu]ltim|cadastr|venc|contrat|in[íi]cio|t[ée]rmino|fim|matr[íi]cula|pagament/i;
  const limpa = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const nomeValido = (nome) => !!nome && nome.length >= 3 && !/\d/.test(nome)
    && !/(search|traffic|keyboard|arrow|unidade\s*atual|person_add|pesquis|menu|toolbar|dashboard|pular|conte[úu]do|skip)/i.test(nome)
    && !/^(saiba|salvar|novo|todos|clientes|faltantes|aniversariantes|oportunidades|modelos)\b/i.test(nome)
    && /[A-Za-zÀ-ÿ]{3,}/.test(nome);
  const soTopo = (els) => els.filter(e => !els.some(o => o !== e && o.contains(e)));
  const SEL_CEL = 'td, [role="cell"], [role="gridcell"], mat-cell, [class*="mat-cell"], [class*="cdk-cell"]';
  const SEL_CAB = 'th, [role="columnheader"], mat-header-cell, [class*="mat-header-cell"], [class*="cdk-header-cell"]';

  function lerLinha(r) {
    const cels = soTopo(Array.from(r.querySelectorAll(SEL_CEL)));
    const caixa = r.closest('table, [role="table"], [role="grid"], mat-table, [class*="mat-table"], [class*="cdk-table"]');
    const cabs = caixa ? soTopo(Array.from(caixa.querySelectorAll(SEL_CAB))) : [];
    let nasc = '', celular = '';
    if (cels.length && cabs.length === cels.length) {
      const ic = cabs.findIndex(h => /celular|telefone|whats/i.test(h.textContent || ''));
      if (ic >= 0) { const d = String(cels[ic].innerText || cels[ic].textContent || '').replace(/\D/g, ''); if (d.length >= 10 && d.length <= 13) celular = d; }
      const i = cabs.findIndex(h => COL_DATA.test(h.textContent || ''));
      if (i >= 0) { const m = DATA.exec(cels[i].innerText || cels[i].textContent || ''); if (m) nasc = m[0]; }
      if (!nasc) {
        for (let c = 0; c < cels.length && !nasc; c++) {
          if (COL_NAO.test(cabs[c].textContent || '')) continue;
          const m = DATA.exec(cels[c].innerText || cels[c].textContent || ''); if (m) nasc = m[0];
        }
      }
    } else {
      // Sem colunas reconhecíveis: a 1ª data da linha (a de aniversário vem antes da
      // última presença na tela do EVO).
      const m = DATA.exec(r.innerText || r.textContent || ''); if (m) nasc = m[0];
    }
    if (!nasc) return null;

    // Nome: o link (azul) da cliente; senão a 1ª célula com texto que não é data.
    let nome = '';
    const a = r.querySelector('a');
    if (a) nome = limpa(a.textContent);
    if (!nomeValido(nome)) {
      nome = '';
      for (const c of (cels.length ? cels : [r])) {
        const linhas = String(c.innerText || c.textContent || '').split('\n').map(limpa).filter(Boolean);
        const cand = linhas.filter(t => nomeValido(t.replace(/\bCL\b/g, '').trim())).pop();
        if (cand) { nome = cand.replace(/\bCL\b/g, '').trim(); break; }
      }
    }
    if (!nomeValido(nome)) return null;

    // ID (o número no "selo" antes do nome).
    //    Procura só ANTES do nome (na célula do nome, se houver) — o resto da linha tem
    //    idade, datas e celular, que não são o código.
    const celNome = (a && cels.find(c => c.contains(a))) || r;
    const txt = String(celNome.innerText || celNome.textContent || '');
    const pos = txt.indexOf(nome);
    const antes = pos >= 0 ? txt.slice(0, pos) : '';
    const idm = antes.match(/(?<!\d)(\d{3,6})(?!\d)/);
    return { id: idm ? idm[1] : '', nome, nascimento: nasc, celular };
  }

  // Testa vários jeitos de achar as linhas e fica com o que lê mais pessoas.
  const SELS = ['table tbody tr', 'mat-row', 'tr.mat-row', '[role="row"]', 'tr[class*="row"]', '[class*="row"]'];
  let melhor = [];
  for (const sel of SELS) {
    let linhas = [];
    try { linhas = soTopo(Array.from(document.querySelectorAll(sel))); } catch (_) { continue; }
    const res = [], vistos = new Set();
    for (const r of linhas) {
      if (r.querySelector(SEL_CAB)) continue; // linha de títulos
      const l = lerLinha(r);
      if (!l) continue;
      const k = (l.id || '') + '|' + l.nome;
      if (vistos.has(k)) continue;
      vistos.add(k); res.push(l);
    }
    if (res.length > melhor.length) melhor = res;
  }
  return melhor;
}

/** "19/11", "19/11/1990" ou "1990-11-19" → { dia, mes } (ou null). */
function diaMes(valor) {
  const s = String(valor || '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return { dia: +m[3], mes: +m[2] };
  m = /^(\d{2})\/(\d{2})(?:\/\d{2,4})?$/.exec(s);
  if (m) return { dia: +m[1], mes: +m[2] };
  return null;
}

/**
 * Trava: a Segmentação vem filtrada no MÊS de aniversário atual. Se boa parte das
 * datas lidas não é deste mês, a leitura pegou a coluna errada — melhor parar e
 * avisar do que dizer "ninguém faz aniversário hoje".
 */
function conferirMes(linhas, mes) {
  const datas = linhas.map(l => diaMes(l.nascimento)).filter(Boolean);
  if (datas.length < 5) return;
  const doMes = datas.filter(d => d.mes === mes).length;
  if (doMes / datas.length < 0.6) {
    throw new Error(`as datas lidas da lista do EVO não batem com o mês de aniversário (${doMes} de ${datas.length} são do mês ${mes}) — o EVO deve ter mudado a tabela; nada foi enviado.`);
  }
}

module.exports = { lerLinhasAniversario, diaMes, conferirMes };
