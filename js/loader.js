/* ==========================================================================
   TeraBoard · Loader — tela de abertura e a luz que viaja ate a nav

   Cada pagina configura o loader pelo proprio HTML, em #siteLoader:
     data-min-ms  tempo minimo que a tela fica no ar (ms)
     data-phrases frases que se alternam, separadas por "|"

   O fim da animacao encaixa a logo 2D exatamente sobre a logo 3D do fundo,
   e so entao dissolve o fundo — por isso a troca nao se percebe.
   ========================================================================== */

(function () {
  var loaderEl = document.getElementById('siteLoader');
  var cfg = (loaderEl && loaderEl.dataset) || {};

  /*
   * A cerimônia de abertura é um cartão de visita — e cartão de visita se
   * entrega UMA vez. Como o site tem uma página por arquivo, o visitante que
   * andava por quatro páginas assistia à mesma animação quatro vezes:
   * medido, 7,8 s na home e ~4 s em cada página seguinte, numa rede local.
   *
   * A partir da segunda página da mesma visita, e para quem pediu menos
   * movimento no sistema, o loader vira só um respiro curto.
   */
  var jaViu = false;
  try { jaViu = sessionStorage.getItem('tb:aberturaVista') === '1'; } catch (e) {}
  var poucoMovimento = matchMedia('(prefers-reduced-motion: reduce)').matches;

  window.__LOADER_RAPIDO = jaViu || poucoMovimento;
  try { sessionStorage.setItem('tb:aberturaVista', '1'); } catch (e) {}

  window.__LOADER_MIN_MS = window.__LOADER_RAPIDO
    ? 220
    : (parseInt(cfg.minMs, 10) || 1100);
  window.__loaderT0 = performance.now();

  var frases = (cfg.phrases || 'Preparando o terreno').split('|');
  var el = document.getElementById('loaderLabel');
  var bar = document.getElementById('loaderBar');
  var i = 0;

  if (el) el.textContent = frases[0];

  if (frases.length > 1) {
    window.__loaderTimer = setInterval(function () {
      i = (i + 1) % frases.length;
      el.classList.add('swap');
      setTimeout(function () { el.textContent = frases[i]; el.classList.remove('swap'); }, 350);
    }, 1000);
  }

  /* barra acompanha o tempo minimo, travando em 92% ate a cena 3D ficar pronta */
  function tick() {
    var p = Math.min(92, (performance.now() - window.__loaderT0) / window.__LOADER_MIN_MS * 100);
    if (bar) bar.style.width = p + '%';
    if (p < 92) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  /* A luz nasce centrada no viewport, mas a logo fica acima dele (o texto e a
     barra ocupam espaco abaixo). Aqui a luz e travada no centro real da marca. */
  function centralizaLuzNaLogo() {
    var halo = document.querySelector('.loader-halo');
    var luz = document.getElementById('travelLight');
    if (!halo || !luz || window.__loaderDone) return;
    var r = halo.getBoundingClientRect();
    if (!r.height) return;
    luz.style.left = (r.left + r.width / 2) + 'px';
    luz.style.top = (r.top + r.height / 2) + 'px';
  }
  centralizaLuzNaLogo();
  /* refaz quando as fontes carregarem (a altura do texto muda) e ao redimensionar */
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(centralizaLuzNaLogo);
  addEventListener('resize', centralizaLuzNaLogo);
  window.__centralizaLuz = centralizaLuzNaLogo;
})();

/* fecha o loader: so depois do tempo minimo, com a barra completando ate 100% */
window.__hideLoader = function () {
  if (window.__loaderDone) return;
  window.__loaderDone = true;
  var restante = Math.max(0, window.__LOADER_MIN_MS - (performance.now() - window.__loaderT0));

  setTimeout(function () {
    clearInterval(window.__loaderTimer);
    var loader = document.getElementById('siteLoader');
    var mark = document.getElementById('loaderMark');
    var light = document.getElementById('travelLight');
    var bar = document.getElementById('loaderBar');
    var label = document.getElementById('loaderLabel');
    var glow = document.querySelector('.logo-glow');

    // completa a barra
    if (bar) { bar.style.transition = 'width .5s cubic-bezier(.16,1,.3,1)'; bar.style.width = '100%'; }

    // Saída simples: sem GSAP (CDN fora do ar), na segunda página da visita
    // ou para quem pediu menos movimento. O site nunca trava nem se repete.
    if (typeof gsap === 'undefined' || window.__LOADER_RAPIDO) {
      if (loader) loader.classList.add('is-hidden');
      if (light) light.style.display = 'none';
      document.documentElement.classList.remove('loading');
      return;
    }

    // onde a luz da nav mora de verdade (medido na hora)
    var alvo = { cx: innerWidth * .18, cy: 70, w: 520, h: 520 };
    if (glow) {
      var r = glow.getBoundingClientRect();
      if (r.width) alvo = { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height };
    }

    // largura que a logo 3D ocupa na tela (calculada pelo proprio 3D)
    var alvoLogo = window.__logo3dWidth || (innerHeight * 0.50);

    // enquanto a luz nao chega na nav, a luz real da nav fica apagada
    document.documentElement.classList.add('light-flying');

    // le a escala em que o pulso parou, para retomar sem solavanco
    function escalaAtual(el) {
      var m = getComputedStyle(el).transform;
      if (!m || m === 'none') return 1;
      var v = m.match(/matrix\(([^)]+)\)/);
      return v ? parseFloat(v[1].split(',')[0]) : 1;
    }
    var s0 = mark ? escalaAtual(mark) : 1;
    if (mark) { mark.style.animation = 'none'; gsap.set(mark, { scale: s0 }); }
    if (light) { light.style.animation = 'none'; }

    // O loader e uma coluna flex (logo + texto + barra), entao a logo fica ACIMA
    // do centro da tela — mas a 3D esta no centro exato. Mede o desvio e corrige.
    var halo = document.querySelector('.loader-halo');
    var desvioX = 0, desvioY = 0;
    if (halo) {
      var rh = halo.getBoundingClientRect();
      desvioX = (window.innerWidth / 2) - (rh.left + rh.width / 2);
      desvioY = (window.innerHeight / 2) - (rh.top + rh.height / 2);
    }

    var tl = gsap.timeline({
      onComplete: function () {
        if (loader) loader.style.visibility = 'hidden';
        if (light) light.style.display = 'none';
      }
    });

    // 1. o pulso se acomoda em 1 e texto/barra saem de cena
    tl.to(mark, { scale: 1, duration: .45, ease: 'power2.out' }, 0)
      .to([label, bar].filter(Boolean), { opacity: 0, y: 8, duration: .35, ease: 'power2.in' }, 0)
      .to(light, { opacity: 1, duration: .45, ease: 'power2.out' }, 0)

      // 2. a logo cresce ate o tamanho exato da 3D — o fundo continua OPACO,
      //    entao neste trecho so existe UMA logo na tela.
      //    Os tempos daqui e do passo 3 sao o que separa o visitante do
      //    conteudo: encurtados de 1,25 s e 0,7 s: o efeito continua legivel,
      //    a espera cai pela metade.
      .to(mark, { width: alvoLogo, duration: .8, ease: 'power2.inOut' }, '-=.15')
      .to(halo, { x: desvioX, y: desvioY, duration: .8, ease: 'power2.inOut' }, '<')
      // a luz cresce E acompanha a logo ate o centro, sem se descolar dela
      .to(light, {
        width: alvoLogo * 1.5, height: alvoLogo * 1.5,
        marginLeft: -alvoLogo * .75, marginTop: -alvoLogo * .75,
        left: window.innerWidth / 2, top: window.innerHeight / 2,
        duration: .8, ease: 'power2.inOut'
      }, '<')

      // 3. so agora, ja do mesmo tamanho: o fundo se dissolve e a 2D se apaga
      //    sobre a 3D — as duas trocam de lugar exatamente no mesmo instante
      .to(loader, { backgroundColor: 'rgba(3,8,6,0)', duration: .45, ease: 'power2.inOut' })
      .to(mark, { opacity: 0, duration: .45, ease: 'power2.inOut' }, '<')
      .add(function () {
        document.documentElement.classList.remove('loading');
        if (loader) loader.style.pointerEvents = 'none';
      })

      // 4. a luz viaja ate a barra superior
      .to(light, {
        left: alvo.cx, top: alvo.cy,
        width: alvo.w, height: alvo.h,
        marginLeft: -alvo.w / 2, marginTop: -alvo.h / 2,
        duration: 1.05, ease: 'power2.inOut'
      }, '-=.15')

      // 5. chegou: a luz real da nav acende por baixo e a viajante se apaga em cima
      .add(function () { document.documentElement.classList.remove('light-flying'); })
      .to(light, { opacity: 0, duration: .55, ease: 'power2.out' });
  }, restante);
};

/* rede de seguranca: se algum CDN falhar, o site nao fica preso no loader */
setTimeout(function () { window.__hideLoader(); }, 9000);
