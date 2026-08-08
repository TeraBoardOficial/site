/* ==========================================================================
   TeraBoard · TeraSensor — simulacao do fluxo do solo ate a receita
   ========================================================================== */

/* ---- simulação: do solo à receita (preservada) ---- */
let rxRunning=false;
function runRxSim(){
  if(rxRunning)return;rxRunning=true;
  const btn=document.getElementById('btn-rx');
  const diag=document.getElementById('diag-box');
  const rx=document.getElementById('rx-box');
  const hint=document.getElementById('rx-hint'); if(hint)hint.style.display='none';
  btn.disabled=true;
  btn.innerHTML='<i class="ph-fill ph-spinner" style="animation:spin 1s linear infinite"></i> Analisando…';
  setTimeout(()=>{
    diag.style.textAlign='left';
    diag.innerHTML=`
      <div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span style="width:9px;height:9px;border-radius:9999px;background:var(--clay)"></span>
          <span class="kicker" style="color:var(--clay)">Fora do padrão</span>
        </div>
        <p class="display" style="font-size:1.15rem;margin-bottom:4px">Solo ácido · pH 4,8</p>
        <p class="muted" style="font-size:.88rem;line-height:1.5">A acidez bloqueia a absorção de nutrientes. Sem corrigir o pH, todo adubo aplicado é desperdiçado.</p>
        <p class="kicker" style="margin-top:10px;color:var(--sage)">Parecer assinado pelo agrônomo</p>
      </div>`;
    diag.style.boxShadow='inset 0 0 0 1.5px rgba(192,96,63,.4)';
  },900);
  setTimeout(()=>{
    btn.innerHTML='<i class="ph-fill ph-spinner" style="animation:spin 1s linear infinite"></i> Gerando receita…';
    rx.style.textAlign='left';
    rx.innerHTML=`
      <div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
          <i class="ph-fill ph-receipt" style="color:var(--signal-deep)"></i>
          <span class="kicker" style="color:var(--signal-deep)">Receituário · agropecuária</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <div style="display:flex;align-items:center;gap:8px;background:rgba(27,190,134,.08);border:1px solid rgba(27,190,134,.25);border-radius:6px;padding:9px 12px">
            <i class="ph-fill ph-check-circle" style="color:var(--signal-deep)"></i><span style="font-size:.9rem;font-weight:500">Calcário / corretivo de pH</span></div>
          <div style="display:flex;align-items:center;gap:8px;background:rgba(27,190,134,.08);border:1px solid rgba(27,190,134,.25);border-radius:6px;padding:9px 12px">
            <i class="ph-fill ph-check-circle" style="color:var(--signal-deep)"></i><span style="font-size:.9rem;font-weight:500">Fertilizante de base</span></div>
        </div>
        <p class="kicker" style="margin-top:12px;color:var(--signal-deep);text-align:center">↓ PDF enviado ao produtor por WhatsApp</p>
      </div>`;
    rx.style.boxShadow='inset 0 0 0 1.5px rgba(27,190,134,.45)';
  },2100);
  setTimeout(()=>{
    btn.disabled=false;
    btn.innerHTML='<i class="ph-bold ph-arrow-counter-clockwise"></i> Rodar de novo';
    btn.onclick=resetRxSim;rxRunning=false;
  },2900);
}
function resetRxSim(){
  const btn=document.getElementById('btn-rx'),diag=document.getElementById('diag-box'),rx=document.getElementById('rx-box');
  diag.style.boxShadow='none';rx.style.boxShadow='none';diag.style.textAlign='center';rx.style.textAlign='center';
  diag.innerHTML='<i class="ph-fill ph-magnifying-glass" style="font-size:2.2rem;color:var(--hair);margin:0 auto 10px"></i><p class="muted" style="font-size:.9rem">Aguardando análise…</p>';
  rx.innerHTML='<i class="ph-fill ph-shopping-cart-simple" style="font-size:2.2rem;color:var(--hair);margin:0 auto 10px"></i><p class="muted" style="font-size:.9rem">A lista de compras aparece aqui.</p>';
  btn.innerHTML='<i class="ph-bold ph-flask"></i> Simular diagnóstico → receita';btn.onclick=runRxSim;
}

/* ==========================================================================
   VISUALIZADOR DO LAUDO

   O laudo e para ser LIDO na pagina, nao levado. Entao:

     - a pagina entra como `background-image` de uma <div>, nao como <img>:
       o menu de contexto de um fundo nao tem "Salvar imagem como";
     - nao existe <a href> para o arquivo nem botao de baixar em lugar nenhum;
     - o PDF nao e embutido — o visualizador nativo do navegador traz os
       proprios botoes de download e impressao, que e o oposto do pedido.

   Isso e ATRITO, nao protecao: os bytes chegam ao navegador do visitante e
   quem abrir as ferramentas de desenvolvedor acha a URL. O que da para fazer
   e nao oferecer o download; impedir, nao da.
   ========================================================================== */
/* O botao "Exportar PDF" do app nao gera arquivo: ele avisa a pagina, e a
   pagina desce ate o laudo. E a continuacao honesta do gesto — o documento
   que o app diz que produz esta ali embaixo, de verdade. */
(function(){
  var frame = document.getElementById('tsApp');
  var alvo  = document.getElementById('laudo');
  if (!frame || !alvo) return;

  addEventListener('message', function(ev){
    if (!ev.data || ev.data.type !== 'terasensor:verLaudo') return;
    if (ev.source !== frame.contentWindow) return;      // so o nosso aparelho

    alvo.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Um pisca no quadro do laudo, para o olho achar o que mudou depois da
    // rolagem — a pagina e longa e o documento nasce parado.
    var quadro = document.querySelector('.laudo-quadro');
    if (!quadro) return;
    quadro.classList.remove('chegou');
    void quadro.offsetWidth;                            // reinicia a animacao
    quadro.classList.add('chegou');
  });
})();

(function(){
  var palco = document.getElementById('laudoPalco');
  if (!palco) return;

  var pagina = document.getElementById('laudoPagina');
  var pc     = document.getElementById('laudoPc');
  var LAUDO  = 'assets/TeraSensor%20App/laudo-amostra.webp';

  var zoom = 1, MIN = 1, MAX = 3.2;

  /* Carrega antes de pintar: sem isto o quadro fica branco e depois salta
     quando a imagem chega. */
  var pronta = new Image();
  pronta.onload = function(){ pagina.style.backgroundImage = 'url("' + LAUDO + '")'; aplicar(); };
  pronta.onerror = function(){
    pagina.style.background = '#F3F5EE';
    pagina.innerHTML = '<p style="padding:32px;color:#3C5A4A;font-size:.95rem">' +
      'Nao foi possivel carregar a amostra do laudo.</p>';
  };

  /* So baixa quando a secao chega perto: sao 167 KB que ninguem precisa
     no topo da pagina. */
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function(linhas){
      if (!linhas[0].isIntersecting) return;
      io.disconnect();
      pronta.src = LAUDO;
    }, { rootMargin: '400px' });
    io.observe(palco);
  } else {
    pronta.src = LAUDO;
  }

  function aplicar(){
    pagina.style.width = (zoom * 100) + '%';
    pagina.style.maxWidth = (820 * zoom) + 'px';
    pc.textContent = Math.round(zoom * 100) + '%';
  }

  function mudar(passo, ancora){
    var antes = zoom;
    zoom = Math.min(MAX, Math.max(MIN, +(zoom + passo).toFixed(2)));
    if (zoom === antes) return;

    /* Mantem sob o cursor (ou no centro) o mesmo ponto do documento — sem
       isto, ampliar joga o leitor para outro trecho da pagina. */
    var r = palco.getBoundingClientRect();
    var ax = ancora ? ancora.x - r.left : r.width / 2;
    var ay = ancora ? ancora.y - r.top  : r.height / 2;
    var k = zoom / antes;
    aplicar();
    palco.scrollLeft = (palco.scrollLeft + ax) * k - ax;
    palco.scrollTop  = (palco.scrollTop  + ay) * k - ay;
  }

  document.getElementById('laudoMais').addEventListener('click', function(){ mudar(0.4); });
  document.getElementById('laudoMenos').addEventListener('click', function(){ mudar(-0.4); });

  // Ctrl + roda amplia o documento, como num leitor de PDF. Sem Ctrl a roda
  // continua rolando a pagina do site, que e o que a mao espera.
  palco.addEventListener('wheel', function(e){
    if (!e.ctrlKey) return;
    e.preventDefault();
    mudar(e.deltaY < 0 ? 0.25 : -0.25, { x: e.clientX, y: e.clientY });
  }, { passive: false });

  // Arrastar para deslocar, quando ampliado.
  var arrastando = false, x0 = 0, y0 = 0, sl = 0, st = 0;
  palco.addEventListener('pointerdown', function(e){
    if (e.button !== 0) return;
    arrastando = true; x0 = e.clientX; y0 = e.clientY;
    sl = palco.scrollLeft; st = palco.scrollTop;
    palco.setPointerCapture(e.pointerId);
  });
  palco.addEventListener('pointermove', function(e){
    if (!arrastando) return;
    palco.scrollLeft = sl - (e.clientX - x0);
    palco.scrollTop  = st - (e.clientY - y0);
  });
  ['pointerup','pointercancel'].forEach(function(ev){
    palco.addEventListener(ev, function(){ arrastando = false; });
  });

  // Teclado: +/- ampliam, as setas deslocam (o palco tem tabindex).
  palco.addEventListener('keydown', function(e){
    if (e.key === '+' || e.key === '=') { e.preventDefault(); mudar(0.4); }
    if (e.key === '-' || e.key === '_') { e.preventDefault(); mudar(-0.4); }
  });

  // Tira o "Salvar imagem como" do caminho de quem tenta pelo botao direito.
  palco.addEventListener('contextmenu', function(e){ e.preventDefault(); });
  palco.addEventListener('dragstart', function(e){ e.preventDefault(); });

  aplicar();
})();
