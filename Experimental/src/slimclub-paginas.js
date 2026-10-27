/**
 * slimclub-paginas.js — páginas PÚBLICAS do Slim Club (sem login do painel):
 *   /SlimClubCadastro → a aluna empresária cadastra o negócio (vai para validação)
 *   /slimclub         → login da aluna (nome + telefone) e listagem dos negócios
 *   /slimclub/meu-anuncio → a dona edita o próprio anúncio (mesmo formulário)
 *
 * Páginas independentes do layout do painel (sem menu da equipe), pensadas para
 * o celular. Mesma identidade visual do painel (verde-petróleo + Inter).
 */
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const LOGO = 'https://drive.google.com/thumbnail?id=1pl1mh709FGcitG9uHo0J6nzMUKFYqg-w&sz=w400';

const CSS = `
:root{
  color-scheme:light;
  --teal:#0e6e6b;--teal-esc:#0a5250;--teal-soft:#e4efee;--teal-linha:#c6dedc;
  --tinta:#1d1d1f;--cinza:#5f6066;--faint:#8e8e95;--bg:#f4f5f5;--card:#fff;--linha:#e2e4e4;
  --erro:#a12626;--erro-soft:#fbecec;--ok:#1a7f37;--ok-soft:#e8f5ec;--ambar:#8a5a00;--ambar-soft:#fdf3dc;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--tinta);font:16px/1.5 "Inter",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-text-size-adjust:100%}
a{color:var(--teal)}
.topo{background:var(--card);border-bottom:1px solid var(--linha)}
.topo .in{max-width:960px;margin:0 auto;padding:12px 16px;display:flex;align-items:center;gap:12px}
.topo img{height:26px;width:auto}
.topo .marca{font-weight:800;letter-spacing:.02em;color:var(--teal);font-size:.95rem}
.topo .sep{width:1px;height:20px;background:var(--linha)}
.topo .dir{margin-left:auto;font-size:.88rem;color:var(--cinza);display:flex;gap:12px;align-items:center}
.wrap{max-width:640px;margin:0 auto;padding:22px 16px 48px}
.wrap.largo{max-width:960px}
.eyebrow{font-size:.74rem;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--teal)}
h1{font-size:1.65rem;line-height:1.2;margin:6px 0 8px;text-wrap:balance}
.lead{color:var(--cinza);margin:0 0 22px;max-width:62ch}
.card{background:var(--card);border:1px solid var(--linha);border-radius:14px;padding:18px 16px;margin-bottom:14px}
.card h2{font-size:1rem;margin:0 0 14px;display:flex;align-items:center;gap:8px}
.card h2 .n{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--teal-soft);color:var(--teal-esc);font-size:.75rem;font-weight:800}
.campo{display:flex;flex-direction:column;gap:6px;margin-bottom:14px}
.campo:last-child{margin-bottom:0}
label,.rot{font-weight:600;font-size:.9rem}
.opc{font-weight:400;color:var(--faint)}
.dica{font-size:.8rem;color:var(--cinza);margin:0}
input[type=text],input[type=tel],input[type=date],select,textarea{
  width:100%;font:inherit;font-size:1rem;color:var(--tinta);background:#fff;border:1px solid #cfd3d3;border-radius:10px;padding:11px 12px}
textarea{min-height:84px;resize:vertical}
input:focus,select:focus,textarea:focus,button:focus-visible,a:focus-visible,.alc input:focus-visible+span{outline:3px solid var(--teal-linha);outline-offset:1px;border-color:var(--teal)}
.ig{display:flex;align-items:stretch}
.ig span{display:grid;place-items:center;padding:0 12px;border:1px solid #cfd3d3;border-right:0;border-radius:10px 0 0 10px;background:var(--bg);color:var(--cinza)}
.ig input{border-radius:0 10px 10px 0}
.foto{display:flex;align-items:center;gap:14px}
.foto .av{width:84px;height:84px;border-radius:50%;background:var(--teal-soft) center/cover no-repeat;border:2px dashed var(--teal-linha);flex:0 0 auto;display:grid;place-items:center;color:var(--teal);font-size:.72rem;text-align:center;line-height:1.2}
.foto .av.tem{border-style:solid;border-color:var(--teal)}
.btn2{font:inherit;font-weight:600;font-size:.9rem;color:var(--teal-esc);background:var(--teal-soft);border:1px solid var(--teal-linha);border-radius:999px;padding:9px 16px;cursor:pointer}
.alc{display:grid;gap:10px}
@media(min-width:520px){.alc{grid-template-columns:1fr 1fr}}
.alc label{display:block;cursor:pointer}
.alc input{position:absolute;opacity:0;pointer-events:none}
.alc span{display:block;border:1px solid #cfd3d3;border-radius:12px;padding:12px;font-weight:400;font-size:.88rem;color:var(--cinza)}
.alc span b{display:block;color:var(--tinta);font-size:.95rem;margin-bottom:2px}
.alc input:checked+span{border-color:var(--teal);background:var(--teal-soft);box-shadow:inset 0 0 0 1px var(--teal)}
.consent{display:flex;gap:10px;align-items:flex-start;font-weight:400;font-size:.9rem;color:var(--cinza)}
.consent input{width:20px;height:20px;margin:2px 0 0;accent-color:var(--teal);flex:0 0 auto}
.btn{display:block;width:100%;font:inherit;font-weight:700;font-size:1rem;color:#fff;background:var(--teal);border:0;border-radius:12px;padding:14px 18px;cursor:pointer}
.btn:hover{background:var(--teal-esc)}
.btn[disabled]{opacity:.6;cursor:progress}
.msg{border-radius:10px;padding:11px 13px;font-size:.92rem;margin:0 0 14px}
.msg.erro{background:var(--erro-soft);color:var(--erro)}
.msg.ok{background:var(--ok-soft);color:var(--ok)}
.pronto{text-align:center;padding:30px 18px}
.pronto .ic{width:56px;height:56px;border-radius:50%;background:var(--ok-soft);color:var(--ok);display:grid;place-items:center;margin:0 auto 12px;font-size:1.6rem;font-weight:800}
.fixo{background:var(--bg);border:1px solid var(--linha);border-radius:10px;padding:11px 12px;font-weight:600}
.rodape{text-align:center;font-size:.85rem;color:var(--cinza);margin-top:26px}
/* listagem */
.busca{display:flex;flex-direction:column;gap:10px;margin:0 0 18px}
.chips{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;scrollbar-width:none}
.chips::-webkit-scrollbar{display:none}
.chip{flex:0 0 auto;font:inherit;font-size:.84rem;font-weight:600;color:var(--cinza);background:var(--card);border:1px solid var(--linha);border-radius:999px;padding:7px 14px;cursor:pointer}
.chip.on{color:#fff;background:var(--teal);border-color:var(--teal)}
.grade{display:grid;gap:14px}
@media(min-width:760px){.grade{grid-template-columns:1fr 1fr}}
.emp{background:var(--card);border:1px solid var(--linha);border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:12px}
.emp .dona{display:flex;align-items:center;gap:12px}
.emp .dona img{width:56px;height:56px;border-radius:50%;object-fit:cover;background:var(--teal-soft);flex:0 0 auto}
.emp .dona .q{font-size:.78rem;color:var(--faint)}
.emp .dona .nm{font-weight:600;font-size:.92rem}
.emp h3{margin:0;font-size:1.15rem;line-height:1.25}
.emp .tags{display:flex;flex-wrap:wrap;gap:6px}
.tg{font-size:.74rem;font-weight:600;border-radius:999px;padding:3px 10px;background:var(--bg);color:var(--cinza);border:1px solid var(--linha)}
.tg.nac{background:var(--ambar-soft);color:var(--ambar);border-color:#f0dcae}
.beneficio{background:var(--teal-soft);border-radius:12px;padding:12px 13px;color:var(--teal-esc);font-weight:600;white-space:pre-line}
.det{font-size:.88rem;color:var(--cinza);margin:0;white-space:pre-line}
.det b{color:var(--tinta);font-weight:600}
.emp .rodp{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;border-top:1px solid var(--linha);padding-top:10px;font-size:.84rem;color:var(--cinza)}
.emp .rodp a{font-weight:600;text-decoration:none}
.ig-link{display:inline-flex;align-items:center;gap:7px;color:var(--teal-esc);overflow-wrap:anywhere}
.ig-link svg{flex:0 0 auto}
.ig-link:hover span{text-decoration:underline}
.vazio{text-align:center;color:var(--cinza);padding:34px 16px;background:var(--card);border:1px dashed var(--linha);border-radius:16px}
.btn-cart{display:inline-flex;align-items:center;gap:8px;font-weight:700;font-size:.95rem;color:var(--teal-esc);background:var(--card);border:1.5px solid var(--teal);border-radius:12px;padding:11px 16px;text-decoration:none;margin:0 0 20px}
.btn-cart svg{flex:0 0 auto}
.meu{display:flex;align-items:center;gap:14px;flex-wrap:wrap;background:var(--card);border:1px solid var(--linha);border-radius:16px;padding:14px 16px;margin:0 0 22px}
.meu img{width:48px;height:48px;border-radius:50%;object-fit:cover;background:var(--teal-soft);flex:0 0 auto}
.meu .info{flex:1 1 220px;min-width:0}
.meu .q{font-size:.74rem;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--faint)}
.meu .neg{font-weight:700;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.meu .txt{font-size:.88rem;color:var(--cinza);margin:2px 0 0}
.pill{font-size:.72rem;font-weight:700;border-radius:999px;padding:2px 9px}
.pill.ok{background:var(--ok-soft);color:var(--ok)}
.pill.esp{background:var(--ambar-soft);color:var(--ambar)}
.pill.no{background:var(--erro-soft);color:var(--erro)}
.meu .btn2{text-decoration:none;flex:0 0 auto}
/* carteira */
.cart{position:relative;overflow:hidden;color:#fff;border-radius:22px;padding:20px 20px 16px;max-width:440px;margin:0 auto;
  background:radial-gradient(120% 90% at 100% 0%,#14908b 0%,rgba(20,144,139,0) 55%),linear-gradient(160deg,#0e6e6b 0%,#09504e 100%);
  box-shadow:0 14px 30px -14px rgba(9,80,78,.55)}
.cart::after{content:"";position:absolute;right:-60px;bottom:-60px;width:200px;height:200px;border-radius:50%;border:28px solid rgba(255,255,255,.05);pointer-events:none}
.cart-top{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
.cart-marca{font-weight:800;letter-spacing:.12em;font-size:.95rem}
.cart-tipo{font-size:.66rem;font-weight:700;letter-spacing:.12em;opacity:.75;text-transform:uppercase}
.cart-studio{font-size:.82rem;opacity:.8;margin-top:2px}
.cart-nome{font-size:1.45rem;font-weight:700;line-height:1.2;margin:22px 0 4px;text-wrap:balance}
.cart-tel{font-size:1.02rem;opacity:.9;font-variant-numeric:tabular-nums;letter-spacing:.02em}
.cart-meio{display:flex;justify-content:space-between;align-items:flex-end;gap:14px;margin-top:20px}
.cart-rot{font-size:.66rem;font-weight:700;letter-spacing:.12em;opacity:.75;text-transform:uppercase;margin-bottom:6px}
.cart-status{display:inline-flex;align-items:center;gap:7px;background:#d6f5df;color:#0b5d2a;font-weight:800;letter-spacing:.06em;border-radius:999px;padding:6px 13px;font-size:.92rem}
.cart-status i{width:9px;height:9px;border-radius:50%;background:#1a9e48;display:block}
.cart-qr{background:#fff;border-radius:12px;padding:6px;width:112px;height:112px;flex:0 0 auto}
.cart-qr img{width:100%;height:100%;display:block}
.cart-datas{margin-top:16px;padding-top:12px;border-top:1px solid rgba(255,255,255,.18);font-size:.8rem;line-height:1.55;font-variant-numeric:tabular-nums}
.cart-datas b{font-weight:600}
.cart-agora{display:flex;align-items:center;gap:8px;margin-top:6px;font-weight:700}
.cart-agora i,.ver-agora i{width:8px;height:8px;border-radius:50%;background:#7ef0a8;display:block;flex:0 0 auto}
.cart-dica{text-align:center;font-size:.86rem;color:var(--cinza);margin:16px auto 0;max-width:440px}
/* conferência do parceiro */
.ver{max-width:440px;margin:0 auto;text-align:center}
.ver-sel{width:84px;height:84px;border-radius:50%;display:grid;place-items:center;margin:4px auto 14px;font-size:2.4rem;font-weight:800}
.ver.ok .ver-sel{background:var(--ok-soft);color:var(--ok)}
.ver.no .ver-sel{background:var(--erro-soft);color:var(--erro)}
.ver-st{font-size:1.7rem;font-weight:800;letter-spacing:.04em;margin:0}
.ver.ok .ver-st{color:var(--ok)}
.ver.no .ver-st{color:var(--erro)}
.ver-nome{font-size:1.15rem;font-weight:600;margin:6px 0 14px}
.ver-txt{color:var(--cinza);margin:0 0 18px}
.ver-dl{text-align:left;background:var(--card);border:1px solid var(--linha);border-radius:14px;padding:12px 14px;margin:0;font-size:.9rem;font-variant-numeric:tabular-nums}
.ver-dl div{display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-top:1px solid var(--linha)}
.ver-dl div:first-child{border-top:0}
.ver-dl dt{color:var(--cinza)}
.ver-dl dd{margin:0;font-weight:600;text-align:right}
.ver-agora{display:inline-flex;align-items:center;gap:8px;margin-top:14px;font-size:.9rem;color:var(--cinza);font-variant-numeric:tabular-nums}
.ver-agora i{background:var(--ok)}
@media (prefers-reduced-motion:no-preference){
  .btn,.chip,.btn2{transition:background-color .15s,border-color .15s}
  .cart-agora i,.ver-agora i{animation:pulso 1.6s ease-in-out infinite}
  @keyframes pulso{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.8)}}
}
`;

function casca({ titulo, studio, dir = '', corpo, largo = false, script = '' }) {
  return `<!doctype html><html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(titulo)}</title>
<link rel="icon" type="image/png" sizes="32x32" href="https://slimfitbrasil.com.br/wp-content/uploads/2025/09/cropped-Untitled-1-32x32.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<!-- fonte sem bloquear: se o Google Fonts demorar (rede ruim), os scripts e o relógio não esperam -->
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" media="print" onload="this.media='all'">
<noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"></noscript>
<style>${CSS}</style></head><body>
<header class="topo"><div class="in">
  <img src="${LOGO}" alt="SlimFit">
  <span class="sep" aria-hidden="true"></span>
  <span class="marca">SLIM CLUB</span>
  <div class="dir">${dir || esc(studio)}</div>
</div></header>
<main class="wrap${largo ? ' largo' : ''}">${corpo}</main>
${script}
</body></html>`;
}

// ── /SlimClubCadastro (e /slimclub/meu-anuncio, com `edicao`) ───────────────
// edicao = { r, fotoUrl, telefone }: r é o anúncio atual (ou a alteração em
// análise, se houver), para o formulário já vir preenchido.
function paginaCadastro({ studio, categorias, avisar, comprovacao, edicao }) {
  const r = edicao ? edicao.r : {};
  const val = k => esc(r[k] || '');
  const outra = !!(r.categoria && !categorias.includes(r.categoria));
  const opts = categorias.map(c => `<option${r.categoria === c ? ' selected' : ''}>${esc(c)}</option>`).join('')
    + `<option value="__outra"${outra ? ' selected' : ''}>Outra</option>`;
  const marca = v => (r.alcance === v ? ' checked' : '');
  const aprovado = edicao && edicao.aprovado;
  const topo = edicao ? `
  <p class="eyebrow">Meu anúncio</p>
  <h1>Editar meu anúncio</h1>
  <p class="lead">${aprovado
    ? 'Seu anúncio está no ar. As mudanças vão para a recepção aprovar e, até lá, as alunas continuam vendo a versão atual.'
    : 'Corrija o que precisar e envie de novo. A recepção confere antes de o anúncio aparecer para as alunas.'}</p>` : `
  <p class="eyebrow">Para alunas empreendedoras</p>
  <h1>Cadastre seu negócio no Slim Club</h1>
  <p class="lead">Ofereça um benefício exclusivo para as alunas do ${esc(studio)}. A recepção confere o cadastro e, depois de aprovado, seu negócio aparece para as alunas.</p>`;
  const okTxt = edicao
    ? `<h2 style="justify-content:center;font-size:1.2rem">Alterações enviadas!</h2>
    <p class="lead" style="margin:0 auto">A recepção vai conferir. ${aprovado ? 'Até a aprovação, as alunas continuam vendo a versão atual do seu anúncio.' : (avisar ? 'Você recebe um aviso no WhatsApp quando for aprovado.' : 'Assim que for aprovado, seu negócio aparece no Slim Club.')}</p>
    <p style="margin:14px 0 0"><a href="/slimclub">Voltar ao Slim Club</a></p>`
    : `<h2 style="justify-content:center;font-size:1.2rem">Cadastro enviado!</h2>
    <p class="lead" style="margin:0 auto">A recepção vai conferir as informações. ${avisar ? 'Você recebe um aviso no WhatsApp quando for aprovado.' : 'Assim que for aprovado, seu negócio aparece no Slim Club.'}</p>`;
  const corpo = `${topo}

  <div id="ok" class="card pronto" hidden>
    <div class="ic" aria-hidden="true">✓</div>
    ${okTxt}
  </div>

  <form id="f" novalidate>
    <section class="card">
      <h2><span class="n">1</span>Sobre você</h2>
      <div class="campo">
        <span class="rot">Sua foto</span>
        <div class="foto">
          ${edicao && edicao.fotoUrl ? `<div class="av tem" id="av" style="background-image:url('${esc(edicao.fotoUrl)}')"></div>` : '<div class="av" id="av">sem foto</div>'}
          <div style="display:flex;flex-direction:column;gap:6px">
            <button type="button" class="btn2" id="btFoto">${edicao ? 'Trocar foto' : 'Escolher foto'}</button>
            <p class="dica">Para as alunas reconhecerem você. JPG ou PNG, tamanho máximo de <b>1 MB</b> — fotos maiores do celular são reduzidas automaticamente.</p>
            <p class="dica" id="tamFoto" aria-live="polite"></p>
          </div>
          <input type="file" id="arq" accept="image/*" hidden>
        </div>
      </div>
      <div class="campo"><label for="nome">Nome completo</label>
        <input type="text" id="nome" autocomplete="name" maxlength="120" value="${val('nome')}" required></div>
      <div class="campo"><label for="telefone">Telefone (WhatsApp)</label>
        ${edicao ? `<input type="tel" id="telefone" value="${esc(edicao.telefone)}" readonly aria-describedby="dicaTel">
        <p class="dica" id="dicaTel">O telefone identifica o seu anúncio e não pode ser trocado aqui. Se mudou de número, fale com a recepção.</p>` : `<input type="tel" id="telefone" autocomplete="tel" inputmode="tel" placeholder="(00) 90000-0000" maxlength="20" required>
        <p class="dica">Use o mesmo telefone cadastrado no Studio — é por ele que confirmamos que você é aluna.</p>`}</div>
    </section>

    <section class="card">
      <h2><span class="n">2</span>Seu negócio</h2>
      <div class="campo"><label for="negocio">Nome do negócio</label>
        <input type="text" id="negocio" maxlength="80" value="${val('negocio')}" required></div>
      <div class="campo"><label for="categoria">Categoria</label>
        <select id="categoria" required><option value="">Escolha…</option>${opts}</select>
        <input type="text" id="categoriaOutra" maxlength="40" placeholder="Qual categoria?" value="${outra ? val('categoria') : ''}"${outra ? '' : ' hidden'}></div>
      <div class="campo"><label for="documento">CNPJ</label>
        <input type="text" id="documento" maxlength="20" autocapitalize="characters" placeholder="00.000.000/0000-00" value="${edicao ? esc(edicao.documento) : ''}" required>
        <p class="dica">O MEI também tem CNPJ.</p></div>
      <div class="campo"><label for="instagram">Instagram do negócio <span class="opc">(opcional)</span></label>
        <div class="ig"><span>@</span><input type="text" id="instagram" maxlength="60" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="seunegocio" value="${val('instagram')}" oninput="if(this.value.charAt(0)==='@')this.value=this.value.slice(1)"></div></div>
    </section>

    <section class="card">
      <h2><span class="n">3</span>O benefício</h2>
      <div class="campo"><label for="beneficio">Benefício exclusivo para alunas SlimFit</label>
        <textarea id="beneficio" maxlength="600" required aria-describedby="dicaBeneficio" placeholder="Ex.: 15% de desconto em qualquer serviço, só para alunas SlimFit">${val('beneficio')}</textarea>
        <p class="dica" id="dicaBeneficio">O benefício precisa ser <b>real e exclusivo</b>: uma vantagem que só as alunas SlimFit recebem, e não a mesma promoção que qualquer cliente já tem. É isso que fortalece a nossa comunidade. Benefícios genéricos (como "condições especiais") não entram na listagem.</p></div>
      <div class="campo"><span class="rot" id="rotAlc">Alcance</span>
        <div class="alc" role="radiogroup" aria-labelledby="rotAlc">
          <label><input type="radio" name="alcance" value="local"${marca('local')}><span><b>Local</b>Vale só no seu negócio aqui da cidade</span></label>
          <label><input type="radio" name="alcance" value="nacional"${marca('nacional')}><span><b>Nacional</b>Vale em todas as unidades do seu negócio no Brasil</span></label>
        </div></div>
      <div class="campo"><span class="rot">Como a aluna comprova que é do Studio</span>
        <div class="fixo">${esc(comprovacao)}</div>
        <p class="dica">Vale para todos os negócios do Slim Club.</p></div>
      <div class="campo"><label for="fim">Término da promoção <span class="opc">(opcional)</span></label>
        <input type="date" id="fim" value="${val('fimVigencia')}">
        <p class="dica">Deixe em branco se a oferta não tiver prazo.</p></div>
    </section>

    <section class="card">
      <label class="consent"><input type="checkbox" id="consent"${edicao ? ' checked' : ''}><span>Autorizo exibir meu nome, minha foto e as informações do meu negócio para as alunas do ${esc(studio)}.</span></label>
    </section>

    <div id="erro" class="msg erro" role="alert" hidden></div>
    <button class="btn" id="enviar" type="submit">${edicao ? 'Enviar alterações' : 'Enviar para validação'}</button>
  </form>
  <p class="rodape">${edicao ? '<a href="/slimclub">Voltar sem alterar</a>' : 'Já é aluna? <a href="/slimclub">Veja os negócios do Slim Club</a>'}</p>`;

  const script = `<script>
(function(){
  var EDICAO=${edicao ? 'true' : 'false'}, ROTULO=${edicao ? "'Enviar alterações'" : "'Enviar para validação'"};
  var foto='', f=document.getElementById('f'), erro=document.getElementById('erro'), bt=document.getElementById('enviar');
  var arq=document.getElementById('arq'), av=document.getElementById('av');
  document.getElementById('btFoto').onclick=function(){ arq.click(); };
  av.onclick=function(){ arq.click(); };
  var cat=document.getElementById('categoria'), catO=document.getElementById('categoriaOutra');
  cat.onchange=function(){ catO.hidden = cat.value!=='__outra'; if(!catO.hidden) catO.focus(); };
  function mostrarErro(t){ erro.textContent=t; erro.hidden=false; erro.scrollIntoView({block:'center',behavior:'smooth'}); }
  // Reduz a foto no próprio celular (JPEG, até 800px) para caber no limite de 1 MB.
  var MAX=1024*1024, tam=document.getElementById('tamFoto');
  function bytes(d){ return Math.floor((d.length-d.indexOf(',')-1)*3/4); }
  function fmt(n){ return n<MAX ? Math.max(1,Math.round(n/1024))+' KB' : (n/MAX).toFixed(1).replace('.',',')+' MB'; }
  arq.onchange=function(){
    var file=arq.files&&arq.files[0]; if(!file) return;
    erro.hidden=true;
    var img=new Image(), url=URL.createObjectURL(file);
    img.onload=function(){
      URL.revokeObjectURL(url);
      var lado=800, d='';
      for(var t=0;t<4;t++){ // baixa a qualidade e, se ainda não couber, as dimensões
        var k=Math.min(1,lado/Math.max(img.naturalWidth,img.naturalHeight));
        var c=document.createElement('canvas'); c.width=Math.round(img.naturalWidth*k); c.height=Math.round(img.naturalHeight*k);
        c.getContext('2d').drawImage(img,0,0,c.width,c.height);
        for(var q=.85;q>=.45;q-=.1){ d=c.toDataURL('image/jpeg',q); if(bytes(d)<=MAX) break; }
        if(bytes(d)<=MAX) break;
        lado=Math.round(lado*.75);
      }
      if(d.indexOf('data:image/jpeg')!==0 || bytes(d)>MAX){ foto=''; tam.textContent=''; return mostrarErro('Essa foto passa de 1 MB mesmo reduzida. Escolha outra foto.'); }
      foto=d; av.style.backgroundImage='url('+d+')'; av.textContent=''; av.classList.add('tem');
      document.getElementById('btFoto').textContent='Trocar foto';
      tam.textContent='Foto pronta: '+fmt(bytes(d))+(file.size>MAX ? ' (reduzida de '+fmt(file.size)+')' : '')+'.';
    };
    img.onerror=function(){ mostrarErro('Não consegui abrir essa imagem. Tente outra foto (JPG ou PNG).'); };
    img.src=url;
  };
  f.onsubmit=function(ev){
    ev.preventDefault(); erro.hidden=true;
    var v=function(id){ return document.getElementById(id).value; };
    var alc=document.querySelector('input[name=alcance]:checked');
    var dados={ nome:v('nome'), telefone:v('telefone'), negocio:v('negocio'),
      categoria: cat.value==='__outra' ? catO.value : cat.value,
      documento:v('documento'), instagram:v('instagram'), beneficio:v('beneficio'),
      alcance: alc?alc.value:'', fimVigencia:v('fim'),
      consentimento: document.getElementById('consent').checked, foto: foto };
    if(!foto && !EDICAO) return mostrarErro('Escolha uma foto sua.'); // na edição, sem foto nova fica a atual
    bt.disabled=true; bt.textContent='Enviando…';
    fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(dados)})
      .then(function(r){ return r.json().catch(function(){ return {erro:'Falha no envio (código '+r.status+').'}; }); })
      .then(function(j){
        if(j&&j.ok){ f.hidden=true; var ok=document.getElementById('ok'); ok.hidden=false; ok.scrollIntoView({block:'start'}); return; }
        mostrarErro((j&&j.erro)||'Não consegui enviar. Tente de novo.');
      })
      .catch(function(){ mostrarErro('Sem conexão. Confira a internet e tente de novo.'); })
      .then(function(){ bt.disabled=false; bt.textContent=ROTULO; });
  };
})();
</script>`;
  return casca({ titulo: edicao ? 'Meu anúncio · Slim Club' : 'Cadastro · Slim Club', studio, corpo, script,
    dir: edicao ? '<a href="/slimclub/sair">Sair</a>' : '' });
}

// ── /slimclub (sem sessão): entrar com nome + telefone ─────────────────────
function paginaEntrar({ studio, erro, nome, telefone }) {
  const corpo = `
  <p class="eyebrow">Exclusivo para alunas</p>
  <h1>Benefícios de alunas para alunas</h1>
  <p class="lead">Descontos e vantagens oferecidos por alunas do ${esc(studio)} que têm o próprio negócio. Entre com seus dados para ver.</p>
  <form class="card" method="POST" action="/slimclub/entrar">
    ${erro ? `<div class="msg erro" role="alert">${esc(erro)}</div>` : ''}
    <div class="campo"><label for="nome">Nome completo</label>
      <input type="text" id="nome" name="nome" autocomplete="name" maxlength="120" value="${esc(nome)}" required></div>
    <div class="campo"><label for="telefone">Telefone (WhatsApp)</label>
      <input type="tel" id="telefone" name="telefone" autocomplete="tel" inputmode="tel" placeholder="(00) 90000-0000" maxlength="20" value="${esc(telefone)}" required>
      <p class="dica">O mesmo telefone cadastrado no Studio.</p></div>
    <button class="btn" type="submit">Entrar</button>
  </form>
  <p class="rodape">Tem um negócio? <a href="/SlimClubCadastro">Cadastre no Slim Club</a></p>`;
  return casca({ titulo: 'Slim Club', studio, corpo });
}

// Ícone do Instagram (gradiente da marca, definido uma vez na página: #igGrad).
const ICONE_IG = '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
  + '<rect width="24" height="24" rx="6.5" fill="url(#igGrad)"/>'
  + '<rect x="5" y="5" width="14" height="14" rx="4.2" fill="none" stroke="#fff" stroke-width="1.9"/>'
  + '<circle cx="12" cy="12" r="3.4" fill="none" stroke="#fff" stroke-width="1.9"/>'
  + '<circle cx="16.4" cy="7.6" r="1.15" fill="#fff"/></svg>';

// ── /slimclub (aluna conectada): listagem ───────────────────────────────────
function paginaListagem({ studio, aluna, empresas, fmtData, fmtDocumento, primeiroNome, comprovacao, meu }) {
  const cats = [...new Set(empresas.map(e => e.categoria))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const chips = cats.length > 1
    ? `<div class="chips" role="group" aria-label="Filtrar por categoria"><button type="button" class="chip on" data-cat="">Todas</button>${cats.map(c => `<button type="button" class="chip" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>`
    : '';
  const cards = empresas.map(e => {
    const busca = [e.negocio, e.nome, e.categoria, e.beneficio, e.documento].join(' ').toLowerCase();
    return `<article class="emp" data-cat="${esc(e.categoria)}" data-busca="${esc(busca)}">
      <div class="dona"><img src="/slimclub/foto/${esc(e.id)}" alt="Foto de ${esc(e.nome)}" loading="lazy" width="56" height="56">
        <div><div class="q">Empresa da aluna</div><div class="nm">${esc(e.nome)}</div></div></div>
      <h3>${esc(e.negocio)}</h3>
      <div class="tags"><span class="tg">${esc(e.categoria)}</span>${e.alcance === 'nacional' ? '<span class="tg nac">Nacional · todas as unidades</span>' : '<span class="tg">Local · só nesta cidade</span>'}</div>
      <div class="beneficio">${esc(e.beneficio)}</div>
      <p class="det"><b>Como comprovar:</b> ${esc(comprovacao)}</p>
      <p class="det"><b>CNPJ:</b> ${esc(fmtDocumento(e.documento))}</p>
      <div class="rodp"><span>${e.fimVigencia ? 'Válido até ' + esc(fmtData(e.fimVigencia)) : 'Sem prazo de término'}</span>
        ${e.instagram ? `<a class="ig-link" href="https://instagram.com/${encodeURIComponent(e.instagram)}" target="_blank" rel="noopener" aria-label="Instagram de ${esc(e.negocio)}: @${esc(e.instagram)}">${ICONE_IG}<span>@${esc(e.instagram)}</span></a>` : ''}</div>
    </article>`;
  }).join('');
  const corpo = `
  <p class="eyebrow">Exclusivo para alunas</p>
  <h1>Olá, ${esc(primeiroNome(aluna.nome) || 'aluna')}!</h1>
  <p class="lead">Benefícios oferecidos por alunas do ${esc(studio)}. Para usar, apresente a sua carteira SlimClub no negócio.</p>
  ${meu ? `<section class="meu" aria-label="Meu anúncio">
    <img src="/slimclub/foto/${esc(meu.r.id)}" alt="" width="48" height="48">
    <div class="info"><div class="q">Meu anúncio</div>
      <div class="neg">${esc(meu.r.negocio)} <span class="pill ${meu.estado.cls}">${esc(meu.estado.titulo)}</span></div>
      <p class="txt">${esc(meu.estado.texto)}</p></div>
    <a class="btn2" href="/slimclub/meu-anuncio">${esc(meu.estado.botao)}</a>
  </section>` : ''}
  <a class="btn-cart" href="/slimclub/carteira"><svg width="20" height="16" viewBox="0 0 20 16" fill="none" aria-hidden="true"><rect x="1" y="1" width="18" height="14" rx="3" stroke="currentColor" stroke-width="2"/><path d="M5 6h6M5 10h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>Minha carteira SlimClub</a>
  ${empresas.length ? `<div class="busca">
    <input type="text" id="q" placeholder="Buscar por negócio, aluna ou benefício" aria-label="Buscar">
    ${chips}</div>
  <svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs><radialGradient id="igGrad" cx="30%" cy="107%" r="150%"><stop offset="0" stop-color="#fdf497"/><stop offset=".05" stop-color="#fdf497"/><stop offset=".45" stop-color="#fd5949"/><stop offset=".6" stop-color="#d6249f"/><stop offset=".9" stop-color="#285aeb"/></radialGradient></defs></svg>
  <div class="grade" id="grade">${cards}</div>
  <div class="vazio" id="nada" hidden>Nenhum negócio encontrado com esse filtro.</div>`
    : `<div class="vazio">Ainda não há negócios no Slim Club.${meu ? '' : '<br><a href="/SlimClubCadastro">Tem um negócio? Cadastre o seu</a>'}</div>`}
  ${meu ? '' : '<p class="rodape">Tem um negócio? <a href="/SlimClubCadastro">Cadastre no Slim Club</a></p>'}`;
  const script = empresas.length ? `<script>
(function(){
  var q=document.getElementById('q'), cat='', cards=[].slice.call(document.querySelectorAll('.emp')), nada=document.getElementById('nada');
  function filtra(){
    var t=(q.value||'').toLowerCase().trim(), n=0;
    cards.forEach(function(c){ var ok=(!cat||c.getAttribute('data-cat')===cat)&&(!t||c.getAttribute('data-busca').indexOf(t)>=0); c.hidden=!ok; if(ok)n++; });
    nada.hidden=n>0;
  }
  q.oninput=filtra;
  [].forEach.call(document.querySelectorAll('.chip'),function(b){ b.onclick=function(){
    cat=b.getAttribute('data-cat'); [].forEach.call(document.querySelectorAll('.chip'),function(x){ x.classList.toggle('on',x===b); }); filtra(); }; });
})();
</script>` : '';
  const dir = `<a href="/slimclub/sair">Sair</a>`;
  return casca({ titulo: 'Slim Club', studio, dir, corpo, largo: true, script });
}

// Relógio ao vivo (horário de Brasília). Um print fica com a hora parada.
const RELOGIO = `<script>
(function(){
  var els=[].slice.call(document.querySelectorAll('[data-agora]'));
  function t(){ var s=new Date().toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'}).replace(',',' às');
    els.forEach(function(e){ e.textContent=s; }); }
  t(); setInterval(t,1000);
})();
</script>`;

// ── /slimclub/carteira (aluna ativa conectada) ──────────────────────────────
function paginaCarteira({ studio, nome, telefone, geradaEm, verificadaEm, verificadaNoEvo, qr }) {
  const corpo = `
  <p class="eyebrow">Exclusivo para alunas</p>
  <h1>Sua carteira SlimClub</h1>
  <p class="lead">Mostre esta tela no negócio parceiro para usar o benefício.</p>
  <section class="cart" aria-label="Carteira SlimClub">
    <div class="cart-top"><span class="cart-marca">SLIM CLUB</span><span class="cart-tipo">Carteira de aluna</span></div>
    <div class="cart-studio">${esc(studio)}</div>
    <div class="cart-nome">${esc(nome)}</div>
    <div class="cart-tel">${esc(telefone)}</div>
    <div class="cart-meio">
      <div><div class="cart-rot">Status</div><span class="cart-status"><i></i>ATIVA</span></div>
      ${qr ? `<div class="cart-qr"><img src="${qr}" alt="QR code para o parceiro conferir o status"></div>` : ''}
    </div>
    <div class="cart-datas">
      <div>Gerada em <b>${esc(geradaEm)}</b></div>
      <div>${verificadaNoEvo ? 'Status verificado no EVO em' : 'Status verificado em'} <b>${esc(verificadaEm)}</b></div>
      <div class="cart-agora"><i></i><span>Agora: <span data-agora>${esc(geradaEm)}</span></span></div>
    </div>
  </section>
  <p class="cart-dica">${qr ? 'Parceiro: aponte a câmera do celular para o QR code para conferir o status na hora.' : 'Parceiro: confira se o relógio da carteira está andando.'}</p>
  <p class="rodape"><a href="/slimclub">Voltar aos benefícios</a></p>`;
  return casca({ titulo: 'Carteira · Slim Club', studio, dir: '<a href="/slimclub/sair">Sair</a>', corpo, script: RELOGIO });
}

// ── /slimclub/v/<código> (o parceiro escaneou o QR) ─────────────────────────
function paginaVerificacao({ studio, r, conferidoEm, geradaEm }) {
  const V = {
    'ativa': ['ok', '✓', 'ATIVA', 'Aluna ativa do Studio. Pode aplicar o benefício do Slim Club.'],
    'ex-aluna': ['no', '✕', 'INATIVA', 'Não é mais aluna do Studio (ex-aluna). O benefício do Slim Club não vale.'],
    'inativa': ['no', '✕', 'INATIVA', 'Não consta como aluna ativa do Studio. O benefício do Slim Club não vale.'],
  };
  const [cls, ic, st, txt] = r ? V[r.status] : ['no', '✕', 'CARTEIRA INVÁLIDA', 'Este QR code não é uma carteira SlimClub válida.'];
  const corpo = `
  <div class="ver ${cls}">
    <p class="eyebrow">Conferência da carteira SlimClub</p>
    <div class="ver-sel" aria-hidden="true">${ic}</div>
    <p class="ver-st">${st}</p>
    ${r && r.nome ? `<p class="ver-nome">${esc(r.nome)}</p>` : ''}
    <p class="ver-txt">${txt}</p>
    <dl class="ver-dl">
      <div><dt>Studio</dt><dd>${esc(studio)}</dd></div>
      <div><dt>Status conferido em</dt><dd>${esc(conferidoEm)}</dd></div>
      ${r ? `<div><dt>Carteira gerada em</dt><dd>${esc(geradaEm)}</dd></div>` : ''}
    </dl>
    <div class="ver-agora"><i></i><span>Agora: <span data-agora>${esc(conferidoEm)}</span></span></div>
  </div>`;
  return casca({ titulo: 'Conferência · Slim Club', studio, corpo, script: RELOGIO });
}

module.exports = { paginaCadastro, paginaEntrar, paginaListagem, paginaCarteira, paginaVerificacao };
