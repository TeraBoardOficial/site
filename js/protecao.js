/* ==========================================================================
   TeraBoard · Protecao de conteudo

   Bloqueia selecao, copia, menu de contexto, arrasto de imagem, impressao e
   atalhos de inspecao; cobre a pagina quando a janela perde o foco.

   Ajustes: a tabela CFG logo abaixo. A parte visual esta em css/protecao.css.

   As notas de manutencao — o que cada camada cobre, o que nao cobre, e por
   que cada decisao foi tomada — ficam em _originais-nao-publicar/
   NOTAS-PROTECAO.md, FORA da pasta publicada. Nao traga aquele conteudo para
   ca: comentario em arquivo servido pela web e conteudo publico, e descrever
   as fraquezas de uma tranca junto com a tranca entrega o servico pronto a
   quem veio tentar abri-la.
   ========================================================================== */

(function () {
  'use strict';

  /* ------------------------------------------------------------------------
     O QUE FICA LIGADO — mexa so aqui
     ------------------------------------------------------------------------ */
  var CFG = {
    bloquearMenu:       true,   // botao direito
    bloquearSelecao:    true,   // arrastar para selecionar texto
    bloquearCopia:      true,   // Ctrl+C / Ctrl+X (troca o conteudo por um aviso)
    bloquearArrasto:    true,   // arrastar imagem para fora do navegador
    bloquearAtalhos:    true,   // F12, Ctrl+U, Ctrl+S, Ctrl+P, inspetor
    escudoAoPerderFoco: true,   // cobre a pagina no alt-tab / ferramenta de recorte
    escudoAoImprimir:   true,   // cobre a pagina no Ctrl+P
    detectarInspetor:   true,   // cobre a pagina enquanto o inspetor estiver aberto
    limparPrintScreen:  true,   // reage ao PrtScn
    escaladaCaptura:    true,   // a escalada de tentativas (ver o bloco ESCALADA abaixo)
    /* Carimbo diagonal por cima da pagina. Tres valores:
         'pedido'  so nas paginas que pedem — as que tem data-marca no <html>.
                   Hoje: investidor.html, terahecta.html e terahecta/index.html.
         true      em todas as paginas.
         false     em nenhuma.
       A vitrine publica nao leva carimbo de proposito: la o conteudo e para
       ser visto e compartilhado. Carimbo so onde o material e fechado. */
    marcaDagua:         'pedido',

    textoCopia: 'Conteúdo protegido © TeraBoard — teraboard.com.br',
    textoMarca: 'TeraBoard · CONFIDENCIAL · reprodução proibida'
  };

  var MSG = {
    foco:     ['Conteúdo protegido', 'Volte para esta janela para continuar navegando.'],
    captura:  ['Captura bloqueada', 'O conteúdo desta página é confidencial e está em desenvolvimento.'],
    imprimir: ['Impressão bloqueada', 'Esta página não pode ser impressa nem salva em PDF.'],
    inspetor: ['Inspeção detectada', 'Feche as ferramentas de desenvolvedor para voltar à página.']
  };

  /* Nas paginas fechadas (as que pedem carimbo) a cortina fala mais grosso.
     Na vitrine publica, um "volte para a janela" seco basta; aqui o recado
     precisa ser o mesmo do aviso escrito na pagina. */
  if (document.documentElement.hasAttribute('data-marca')) {
    MSG.foco    = ['Material confidencial', 'Reprodução e captura de tela são proibidas. Volte para esta janela para continuar.'];
    MSG.captura = ['Captura bloqueada', 'Material confidencial da TeraBoard. Reprodução proibida — Lei nº 9.610/1998.'];
  }

  /* Dentro de um iframe (as demos do app, a maquete do TeraHecta) so valem os
     bloqueios de teclado e mouse. O escudo cobriria a telinha do celular no
     meio da pagina, e a deteccao de inspetor compara o tamanho da janela de
     cima com o do quadro — daria alarme falso o tempo todo. */
  var dentroDeIframe = (function () {
    try { return window.top !== window.self; } catch (e) { return true; }
  })();

  /* Celular nao tem inspetor acoplado, e a barra de endereco que aparece e
     some no scroll mexe na altura o suficiente para disparar alarme falso. */
  var toque = window.matchMedia && window.matchMedia('(pointer:coarse)').matches;

  var CAMPOS = 'input,textarea,select,[contenteditable="true"],[contenteditable=""]';

  /* ========================================================================
     ESCALADA DE CAPTURA

     Cada tentativa sobe um degrau: os primeiros so avisam, depois o carimbo
     passa a cobrir o site inteiro e, no ultimo, o conteudo deixa de ser
     entregue.

     O comportamento completo, o desenho dos degraus e o que cada camada
     alcanca estao em _originais-nao-publicar/NOTAS-PROTECAO.md — fora desta
     pasta, e e onde tem de continuar.
     ======================================================================== */
  var CHAVE_ESTADO = 'tb:s';
  var LIMITE_CAPTURAS = 5;
  var NIVEL_EMERGENCIA = 3;

  /* O caminho ate bloqueado.html sai do endereco DESTE arquivo, e nao de uma
     barra no comeco.

     "/bloqueado.html" so acerta quando o site mora na raiz de um dominio. Numa
     subpasta — que e onde ele esta hoje, /site/ no GitHub Pages — aquela barra
     aponta para fora do site e o degrau da escalada leva a um 404: a pessoa
     que tentou capturar a tela ganhava uma pagina de erro em vez do aviso.

     Um caminho relativo simples tambem nao serve, porque este script e
     chamado de tres profundidades diferentes (js/, ../js/, ../../js/) e o
     alvo e sempre a raiz do site. Como o nome do arquivo e fixo, apagar
     "js/protecao.js" do fim da propria URL devolve a raiz, seja ela qual for
     — e continua certo no dia em que o site mudar de endereco. */
  var RAIZ_DO_SITE = (function () {
    try {
      var esteScript = document.currentScript;
      if (!esteScript) {                       // navegador antigo: o script em
        var todos = document.getElementsByTagName('script');  // execucao e o
        esteScript = todos[todos.length - 1];  // ultimo ja presente no DOM
      }
      var src = esteScript && esteScript.src;
      if (src) return src.replace(/js\/protecao\.js(\?.*)?$/, '');
    } catch (e) {}
    return '/';                                // ultimo recurso: o de antes
  })();

  var PAGINA_BLOQUEIO = RAIZ_DO_SITE + 'bloqueado.html';

  function lerNivel() {
    try {
      var cru = sessionStorage.getItem(CHAVE_ESTADO);
      if (!cru) return 0;
      var txt = atob(cru);
      var n = parseInt(txt.replace(/^v/, ''), 10);
      return n > 0 ? n : 0;
    } catch (e) { return 0; }
  }

  function gravarNivel(n) {
    try { sessionStorage.setItem(CHAVE_ESTADO, btoa('v' + n + ':' + Date.now())); } catch (e) {}
  }

  var nivelCaptura = lerNivel();

  /* ------------------------------------------------------------------------
     Terceiro degrau: a sessão acaba.

     Roda dentro do <head>, antes de o <body> ser lido. window.stop() aborta o
     que ainda está descendo — imagens, folhas, scripts, modelos 3D — e a
     troca do documento apaga o que já tinha chegado. A tela abaixo não
     depende de arquivo nenhum (estilo embutido, sem fonte externa) justamente
     porque o download foi cortado.
     ------------------------------------------------------------------------ */
  function encerrarSessao() {
    try { window.stop(); } catch (e) {}
    var html =
      '<head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<meta name="robots" content="noindex, nofollow">' +
      '<title>Sessão encerrada · TeraBoard</title><style>' +
      'html,body{margin:0;height:100%;background:#030806;color:#F0F1E3;' +
      'font-family:ui-monospace,Menlo,Consolas,monospace;-webkit-user-select:none;user-select:none}' +
      'div{min-height:100%;display:flex;flex-direction:column;align-items:center;' +
      'justify-content:center;gap:16px;padding:32px;text-align:center;box-sizing:border-box}' +
      'h1{margin:0;font-size:clamp(1.4rem,5vw,2rem);color:#E27B58;letter-spacing:-.01em}' +
      'p{margin:0;max-width:46ch;font-size:.78rem;line-height:2;color:#A5BCAB}' +
      'b{color:#F0F1E3;font-weight:600}' +
      'hr{width:52px;height:1px;border:0;background:rgba(226,123,88,.5);margin:2px 0}' +
      '</style></head><body><div>' +
      '<h1>Sessão encerrada</h1><hr>' +
      '<p>Foram <b>cinco tentativas de captura</b> nesta visita, e o conteúdo do site ' +
      'parou de ser carregado.</p>' +
      '<p>Se a intenção era ficar com o material, existe caminho melhor: ' +
      'temos uma versão preparada para compartilhar, e ela é entregue de bom grado. ' +
      'Chame em <b>wa.me/5522998745065</b>.</p>' +
      '</div></body>';
    try { document.documentElement.innerHTML = html; } catch (e) {}
  }

  /* A verificação vem antes de tudo: se a sessão já morreu, nem faz sentido
     ligar bloqueio de menu, de cópia ou de teclado. */
  if (nivelCaptura >= LIMITE_CAPTURAS) {
    encerrarSessao();
    return;
  }

  /* ------------------------------------------------------------------------
     Primeiro e segundo degraus: fecha a página e leva para o aviso.

     O PrtScn dispara keydown E keyup, e em parte dos navegadores os dois
     chegam. Sem a janela de silêncio abaixo, uma tecla só contaria duas
     tentativas e a pessoa pularia direto para o terceiro degrau.
     ------------------------------------------------------------------------ */
  var ultimaCaptura = 0;

  function registrarCaptura() {
    var agora = Date.now();
    if (agora - ultimaCaptura < 900) return true;   // mesma tecla, evento repetido
    ultimaCaptura = agora;

    var n = nivelCaptura + 1;
    nivelCaptura = n;
    gravarNivel(n);

    if (n >= LIMITE_CAPTURAS) { encerrarSessao(); return true; }

    /* Dentro de um iframe quem tem de sair do ar é a página de fora — mandar
       o quadro embora deixaria o aviso espremido dentro da moldura do
       celular, com o site inteiro visível em volta. */
    var alvo = window;
    try { if (window.top && window.top.location) alvo = window.top; } catch (e) {}
    var de = '';
    try { de = alvo.location.pathname + alvo.location.search; } catch (e) {}
    try {
      alvo.location.replace(PAGINA_BLOQUEIO + '?v=' + n + '&de=' + encodeURIComponent(de));
    } catch (e) {
      location.replace(PAGINA_BLOQUEIO + '?v=' + n);
    }
    return true;
  }

  function ehCampo(alvo) {
    if (!alvo || !alvo.closest) return false;
    return !!alvo.closest(CAMPOS);
  }

  function barrar(e) {
    e.preventDefault();
    e.stopPropagation();
    return false;
  }

  /* ------------------------------------------------------------------------
     O escudo

     Criado na primeira vez que precisa aparecer, e nao no carregamento: se o
     visitante nunca sair da janela, o elemento nunca chega a existir.
     ------------------------------------------------------------------------ */
  var escudo = null, tituloEl = null, textoEl = null, acaoEl = null;
  var travadoPorInspetor = false;
  var travadoPorCaptura = false;

  function montarEscudo() {
    if (escudo || !document.body) return escudo;
    escudo = document.createElement('div');
    escudo.id = 'tb-escudo';
    escudo.setAttribute('aria-hidden', 'true');

    tituloEl = document.createElement('div');
    tituloEl.className = 'tb-escudo-marca';

    var risco = document.createElement('div');
    risco.className = 'tb-escudo-sel';

    textoEl = document.createElement('div');
    textoEl.className = 'tb-escudo-txt';

    acaoEl = document.createElement('div');
    acaoEl.className = 'tb-escudo-acao';
    acaoEl.textContent = 'Clique para voltar à página';

    escudo.appendChild(tituloEl);
    escudo.appendChild(risco);
    escudo.appendChild(textoEl);
    escudo.appendChild(acaoEl);

    /* So a cortina de captura sai no clique. As outras (foco, impressao,
       inspetor) sobem e descem sozinhas, e clicar nelas nao faz nada. */
    escudo.addEventListener('click', function () {
      if (!travadoPorCaptura) return;
      travadoPorCaptura = false;
      esconderEscudo();
    });

    document.body.appendChild(escudo);
    return escudo;
  }

  function mostrarEscudo(msg, exigeClique) {
    if (dentroDeIframe) return;
    if (!montarEscudo()) return;
    tituloEl.textContent = msg[0];
    textoEl.textContent = msg[1];
    escudo.classList.toggle('com-acao', !!exigeClique);
    if (exigeClique) travadoPorCaptura = true;
    escudo.classList.add('on');
  }

  function esconderEscudo(forcar) {
    /* Duas travas seguram a cortina no ar. O inspetor solta sozinho quando a
       checagem ve que ele fechou; a captura so solta no clique da pessoa.
       Sem isto, apertar PrtScn e mexer o mouse ja devolvia a pagina limpa. */
    if ((travadoPorInspetor || travadoPorCaptura) && !forcar) return;
    if (escudo) escudo.classList.remove('on');
  }

  /* Para o Ctrl+P, que ja foi cancelado antes de chegar aqui: a cortina so
     precisa dizer "nao vai imprimir" e sair. Prender a pessoa atras de um
     clique por causa de uma impressao que nem aconteceu seria birra. */
  var timerPisca = null;
  function piscarEscudo(msg) {
    mostrarEscudo(msg);
    clearTimeout(timerPisca);
    timerPisca = setTimeout(function () { esconderEscudo(); }, 1400);
  }

  /* ------------------------------------------------------------------------
     Mouse: menu de contexto, selecao e arrasto

     Tudo em fase de captura (o true no fim) para rodar antes de qualquer
     handler da pagina e nao depender da ordem dos scripts.
     ------------------------------------------------------------------------ */
  if (CFG.bloquearMenu) {
    document.addEventListener('contextmenu', function (e) {
      if (!ehCampo(e.target)) barrar(e);   // no campo o menu serve para colar
    }, true);
  }

  if (CFG.bloquearSelecao) {
    document.addEventListener('selectstart', function (e) {
      if (!ehCampo(e.target)) barrar(e);
    }, true);
    // Clique triplo e duplo clique selecionam antes do selectstart em alguns
    // navegadores; limpar depois fecha essa brecha.
    document.addEventListener('mouseup', function (e) {
      if (ehCampo(e.target)) return;
      var s = window.getSelection && window.getSelection();
      if (s && !s.isCollapsed) s.removeAllRanges();
    }, true);
  }

  if (CFG.bloquearArrasto) {
    document.addEventListener('dragstart', function (e) {
      if (!ehCampo(e.target)) barrar(e);
    }, true);
  }

  /* ------------------------------------------------------------------------
     Area de transferencia

     Em vez de so cancelar a copia, escreve o aviso: quem colar em algum lugar
     ve de onde o texto veio, e entende que foi bloqueio e nao falha.
     ------------------------------------------------------------------------ */
  if (CFG.bloquearCopia) {
    var aoCopiar = function (e) {
      if (ehCampo(e.target)) return;
      e.preventDefault();
      try {
        var cb = e.clipboardData || window.clipboardData;
        if (cb) cb.setData('text/plain', CFG.textoCopia);
      } catch (err) { /* navegador antigo: a copia so foi cancelada, ja basta */ }
    };
    document.addEventListener('copy', aoCopiar, true);
    document.addEventListener('cut', aoCopiar, true);
  }

  function limparAreaDeTransferencia() {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        var p = navigator.clipboard.writeText(CFG.textoCopia);
        if (p && p.catch) p.catch(function () {});
      }
    } catch (err) { /* sem permissao: nada a fazer */ }
  }

  /* ------------------------------------------------------------------------
     Teclado
     ------------------------------------------------------------------------ */

  /* Escuta keydown E keyup: em parte dos navegadores so um dos dois chega
     para esta tecla. O debounce em registrarCaptura cuida do caso em que os
     dois chegam. */
  function aoTentarCapturar(e) {
    var k = (e.key || '').toLowerCase();
    if (k !== 'printscreen' && e.keyCode !== 44) return;
    limparAreaDeTransferencia();
    /* A cortina sobe antes da troca de página: a navegação leva alguns
       quadros e sem ela o conteúdo ficaria à mostra nesse intervalo. */
    mostrarEscudo(MSG.captura, true);
    if (CFG.escaladaCaptura) registrarCaptura();
  }
  if (CFG.limparPrintScreen) {
    document.addEventListener('keydown', aoTentarCapturar, true);
    document.addEventListener('keyup', aoTentarCapturar, true);
  }

  if (CFG.bloquearAtalhos) {
    document.addEventListener('keydown', function (e) {
      var k = (e.key || '').toLowerCase();
      var ctrl = e.ctrlKey || e.metaKey;
      var noCampo = ehCampo(e.target);

      // macOS: Cmd+Shift+3/4/5 (tela inteira, recorte, gravacao). Sobe degrau
      // igual ao PrtScn — la a tecla chega inteira ate a pagina.
      if (e.metaKey && e.shiftKey && ['3', '4', '5', '6'].indexOf(k) >= 0) {
        mostrarEscudo(MSG.captura, true);
        if (CFG.escaladaCaptura) registrarCaptura();
        return barrar(e);
      }

      if (k === 'f12') return barrar(e);                                  // inspetor
      if (ctrl && e.shiftKey && ['i', 'j', 'c', 'k'].indexOf(k) >= 0) return barrar(e);
      if (ctrl && k === 'u') return barrar(e);                            // ver codigo-fonte
      if (ctrl && k === 's') return barrar(e);                            // salvar pagina
      if (ctrl && k === 'p') {                                            // imprimir
        piscarEscudo(MSG.imprimir);
        return barrar(e);
      }
      if (ctrl && !noCampo && ['a', 'c', 'x'].indexOf(k) >= 0) return barrar(e);
    }, true);
  }

  /* ------------------------------------------------------------------------
     Foco e visibilidade

     Saiu o foco da janela, a cortina sobe na mesma hora.
     ------------------------------------------------------------------------ */
  if (CFG.escudoAoPerderFoco && !dentroDeIframe) {
    window.addEventListener('blur', function () {
      /* Clicar dentro de um iframe da propria pagina (a demo do app, a maquete
         do TeraHecta) tambem tira o foco da janela. Cobrir a pagina nesse caso
         seria cobrir justamente quem esta usando a demo. */
      var a = document.activeElement;
      if (a && a.tagName === 'IFRAME') return;
      mostrarEscudo(MSG.foco);
    });

    window.addEventListener('focus', function () { esconderEscudo(); });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) mostrarEscudo(MSG.foco);
      else esconderEscudo();
    });
  }

  if (CFG.escudoAoImprimir && !dentroDeIframe) {
    window.addEventListener('beforeprint', function () { mostrarEscudo(MSG.imprimir); });
    window.addEventListener('afterprint', function () { esconderEscudo(); });
    // Firefox nao dispara beforeprint em todos os caminhos; a media query de
    // impressao tambem escuta e chega antes.
    if (window.matchMedia) {
      var mqp = window.matchMedia('print');
      if (mqp.addEventListener) {
        mqp.addEventListener('change', function (ev) {
          if (ev.matches) mostrarEscudo(MSG.imprimir); else esconderEscudo();
        });
      }
    }
  }

  /* ------------------------------------------------------------------------
     Inspetor de elementos

     Heuristica de tamanho: o inspetor acoplado come uma faixa da janela, e a
     diferenca entre outerWidth/Height e innerWidth/Height cresce de uma vez.
     O problema classico dessa conta e o zoom do navegador, que muda innerWidth
     do mesmo jeito — por isso a base e recalibrada sempre que o
     devicePixelRatio muda, que e o que o zoom faz e o inspetor nao.
     ------------------------------------------------------------------------ */
  if (CFG.detectarInspetor && !dentroDeIframe && !toque) {
    var LIMIAR = 170;
    var basePx, baseL, baseA;

    var calibrar = function () {
      basePx = window.devicePixelRatio;
      baseL = window.outerWidth - window.innerWidth;
      baseA = window.outerHeight - window.innerHeight;
    };

    var checar = function () {
      if (window.devicePixelRatio !== basePx) { calibrar(); return; } // foi zoom
      var cresceu = (window.outerWidth - window.innerWidth - baseL > LIMIAR) ||
                    (window.outerHeight - window.innerHeight - baseA > LIMIAR);
      if (cresceu && !travadoPorInspetor) {
        travadoPorInspetor = true;
        mostrarEscudo(MSG.inspetor);
      } else if (!cresceu && travadoPorInspetor) {
        travadoPorInspetor = false;
        esconderEscudo(true);
      }
    };

    calibrar();
    setInterval(checar, 700);
  }

  /* ------------------------------------------------------------------------
     Marca d'agua (CFG.marcaDagua)

     Carimbo diagonal repetido com a data e a hora da visita. Nao impede nada:
     serve para o print que vazar sair identificado, e para quem esta olhando
     saber, o tempo todo, que aquilo ali e material fechado.

     A pagina liga o carimbo pelo proprio HTML, com data-marca no <html>:
       <html lang="pt-BR" data-marca>                   so data e hora
       <html lang="pt-BR" data-marca="Fulano / Fundo X"> data, hora e o nome

     O segundo formato e o que muda o jogo. Enquanto o PIN for um so, o
     carimbo diz "alguem tirou este print as 14h32" — ja inibe, mas nao
     aponta. No dia em que cada investidor tiver o proprio PIN, guarde o nome
     no sessionStorage junto com 'tb:investidor' e escreva-o aqui: ai o print
     vazado aponta para uma pessoa, e o efeito e outro.
     ------------------------------------------------------------------------ */
  function querMarca() {
    /* MODO DE EMERGÊNCIA: houve tentativa de captura nesta sessão. O carimbo
       deixa de ser privilégio da Área do Investidor e passa a cobrir a
       vitrine inteira — inclusive as páginas públicas, que em condição normal
       são para ser vistas e compartilhadas à vontade. */
    if (nivelCaptura >= NIVEL_EMERGENCIA) return true;
    if (CFG.marcaDagua === true) return true;
    if (CFG.marcaDagua === 'pedido') return document.documentElement.hasAttribute('data-marca');
    return false;
  }

  function montarMarca() {
    if (dentroDeIframe || !document.body || !querMarca()) return;

    /* Refazivel: o portao do investidor chama de novo assim que sabe o codigo
       de quem entrou, e a versao sem codigo tem que sair de cena. */
    var velha = document.getElementById('tb-marca');
    if (velha) velha.parentNode.removeChild(velha);

    /* Duas origens para o identificador, nesta ordem: o valor escrito no
       data-marca da pagina, ou o codigo do convidado que o portao guardou.
       O atributo vazio (data-marca sem "=") cai no segundo caminho. */
    var quem = document.documentElement.getAttribute('data-marca');
    if (!quem) {
      try { quem = sessionStorage.getItem('tb:investidor:quem'); } catch (e) { quem = null; }
    }
    /* Sem os segundos: 'toLocaleString' sozinho devolve 18:12:34, e o segundo
       so alonga o carimbo sem dizer nada. */
    var agora = new Date().toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
    /* No modo de emergência o carimbo troca de tom: ele deixa de avisar que o
       material é fechado e passa a dizer o que aconteceu. Quem estiver
       fotografando leva o registro junto na imagem. */
    var base = nivelCaptura >= NIVEL_EMERGENCIA
      ? 'TeraBoard · CAPTURA REGISTRADA · reprodução proibida'
      : CFG.textoMarca;
    var txt = base + (quem ? ' · ' + quem : '') + ' · ' + agora;

    /* O ladrilho e calculado a partir do texto, e nao fixo: com medida fixa,
       texto mais longo que a caixa sai cortado no meio da palavra. */
    var fonte = 13;
    var ang = 22;
    var rad = ang * Math.PI / 180;
    var larguraTexto = txt.length * fonte * 0.6;      // monospace: ~0.6em por caractere
    var w = Math.ceil(larguraTexto * Math.cos(rad) + fonte * Math.sin(rad)) + 90; // +folga = espaco entre carimbos
    var h = Math.ceil(larguraTexto * Math.sin(rad) + fonte * Math.cos(rad)) + 70;

    /* Contorno escuro por baixo do preenchimento claro. A pagina do TeraHecta
       alterna faixas escuras e faixas creme; texto de uma cor so sumiria em
       metade delas. Com contorno, o claro aparece no escuro e o contorno
       aparece no claro. */
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">' +
      '<text x="' + (w / 2) + '" y="' + (h / 2) + '" dy=".35em" text-anchor="middle" ' +
      'transform="rotate(-' + ang + ' ' + (w / 2) + ' ' + (h / 2) + ')" ' +
      'font-family="monospace" font-size="' + fonte + '" letter-spacing="1" ' +
      'paint-order="stroke" stroke="#03150E" stroke-width="2.5" fill="#F0F1E3">' +
      txt.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') +
      '</text></svg>';

    var el = document.createElement('div');
    el.id = 'tb-marca';
    el.setAttribute('aria-hidden', 'true');
    el.style.backgroundImage = 'url("data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) + '")';
    document.body.appendChild(el);
  }

  if (querMarca()) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', montarMarca);
    } else {
      montarMarca();
    }
  }

  /* A unica porta para fora deste arquivo. O portao do investidor (js/pages/
     investidor.js) chama TBProtecao.marcar() depois de conferir o PIN, para
     o carimbo ser refeito ja com o codigo do convidado. */
  window.TBProtecao = { marcar: montarMarca };
})();
