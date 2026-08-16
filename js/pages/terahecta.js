/* ==========================================================================
   TeraBoard · TeraHecta — tela cheia da maquete

   O botao continua sendo um link para terahecta/, que e o caminho de quem
   esta sem JavaScript. COM JavaScript ele nunca mais navega, e o motivo e um
   bug que custou caro no celular:

     iOS Safari nao expande elemento nenhum em tela cheia — so <video>. Ali
     requestFullscreen e webkitRequestFullscreen simplesmente nao existem, a
     versao antiga deste arquivo desistia na primeira linha e deixava o clique
     seguir para o link. O link abre terahecta/ em ABA NOVA, e aba nova com
     rel="noopener" nasce com sessionStorage VAZIO. Do outro lado, a maquete
     confere sessionStorage['tb:investidor'] e, sem encontrar, manda a pessoa
     para investidor.html. Resultado: no celular, "Abrir em tela cheia" jogava
     o visitante de volta no portao de senha que ele ja tinha passado.

   Por isso agora ha dois caminhos, e nenhum deles troca de pagina:
     1. onde o navegador expande elemento, tela cheia de verdade (Esc sai —
        e o proprio navegador anuncia isso);
     2. onde nao expande, o bloco vira position:fixed e cobre a tela por CSS.
        Como nao ha Esc no celular, esse caminho — e so ele — ganha um botao
        de sair visivel. A parte visual esta em css/pages/terahecta.css.

   Nos dois casos a cena NAO recarrega, que era a intencao original: sao cerca
   de 5 MB de modelos e 27 MB de audio para buscar de novo.
   ========================================================================== */

(function () {
  var bloco = document.getElementById('maqueteBloco');
  var botao = document.getElementById('maqueteFs');
  if (!bloco || !botao) return;

  var expandir = bloco.requestFullscreen || bloco.webkitRequestFullscreen;
  /* Ter o metodo nao basta: dentro de iframe sem allow="fullscreen", ou com a
     politica desligada, ele existe e recusa. fullscreenEnabled e quem responde
     se a chamada tem chance de dar certo. */
  var temNativa = !!expandir &&
    (document.fullscreenEnabled || document.webkitFullscreenEnabled || false);

  /* ------------------------------------------------------------------------
     Caminho 2: tela cheia por CSS
     ------------------------------------------------------------------------ */
  var botaoSair = null;

  function aoTeclar(e) {
    if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); sairNaMarra(); }
  }

  function entrarNaMarra() {
    bloco.classList.add('tb-tela-cheia');
    document.documentElement.classList.add('tb-tela-cheia-ativa');

    if (!botaoSair) {
      botaoSair = document.createElement('button');
      botaoSair.type = 'button';
      botaoSair.className = 'maquete-sair';
      botaoSair.innerHTML = '<i class="ph-bold ph-x" aria-hidden="true"></i> Sair da tela cheia';
      botaoSair.addEventListener('click', sairNaMarra);
      bloco.appendChild(botaoSair);
    }
    botaoSair.hidden = false;
    botaoSair.focus();

    document.addEventListener('keydown', aoTeclar, true);
  }

  function sairNaMarra() {
    bloco.classList.remove('tb-tela-cheia');
    document.documentElement.classList.remove('tb-tela-cheia-ativa');
    if (botaoSair) botaoSair.hidden = true;
    document.removeEventListener('keydown', aoTeclar, true);
    /* Devolve o foco a quem abriu: sem isto, quem navega por teclado volta
       para o topo do documento e perde o lugar na pagina. */
    botao.focus();
  }

  /* ------------------------------------------------------------------------
     Avisar a maquete quando ela sai e volta ao campo de visao

     A cena la dentro renderiza a lavoura inteira, com sombras, a 60 quadros
     por segundo. Rolada para fora da tela ela continuava fazendo isso: o
     requestAnimationFrame so desacelera sozinho quando a ABA fica oculta, e um
     iframe fora do campo de visao, para o navegador, e conteudo visivel.

     O aviso tem de sair DAQUI. Um IntersectionObserver dentro do iframe
     enxergaria o viewport do proprio iframe, onde o canvas esta sempre a
     mostra — e nunca perceberia que a pagina de fora rolou.

     A margem de 300px acende a cena um pouco antes de ela aparecer, para que
     nao se veja o primeiro quadro chegando atrasado.
     ------------------------------------------------------------------------ */
  (function () {
    var quadro = bloco.querySelector('iframe');
    if (!quadro || !window.IntersectionObserver) return;

    var ultimo = null;

    function avisar(visivel) {
      ultimo = visivel;
      /* Origem explicita, e nunca "*": a maquete e conteudo fechado, e um "*"
         entregaria a mensagem a qualquer documento que viesse a ocupar o
         quadro. Aberto de file://, origin e "null" e o envio falha — dai o
         try, e dai o lado de la assumir "visivel" quando nao recebe aviso. */
      try { quadro.contentWindow.postMessage(
        { tb: 'maquete-visivel', visivel: visivel }, location.origin); } catch (e) {}
    }

    new IntersectionObserver(function (entradas) {
      avisar(entradas[entradas.length - 1].isIntersecting);
    }, { rootMargin: '300px' }).observe(quadro);

    /* O iframe e loading="lazy": quando o observador falou pela primeira vez,
       provavelmente ainda nao havia documento do outro lado para escutar.
       Repete o recado assim que ele termina de carregar. */
    quadro.addEventListener('load', function () {
      if (ultimo !== null) avisar(ultimo);
    });
  })();

  /* ------------------------------------------------------------------------
     O clique
     ------------------------------------------------------------------------ */
  botao.addEventListener('click', function (e) {
    e.preventDefault();          // com JS, nunca navega — ver o comentario do topo

    if (!temNativa) { entrarNaMarra(); return; }

    try {
      var p = expandir.call(bloco);
      // Recusou em tempo de execucao (gesto nao reconhecido, permissao negada):
      // cai no caminho por CSS em vez de deixar o visitante sem nada.
      if (p && p.catch) p.catch(entrarNaMarra);
    } catch (err) {
      entrarNaMarra();
    }
  });
})();
