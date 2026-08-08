/* ==========================================================================
   TeraBoard · Equipe — cards que acenam e viram
   ========================================================================== */

/* ---- cards da equipe: acena e vira ----
   Em mouse: entra -> avatar acena 1s -> vira; sai -> desvira.
   Em toque nao existe hover, entao o card vira no toque (e destrava o proximo).
   Enter/Espaco fazem o mesmo, para quem navega por teclado. */
(function(){
  var cards = document.querySelectorAll('.tcard');
  if(!cards.length) return;
  var podeHover = matchMedia('(hover:hover) and (pointer:fine)').matches;
  var semAnim   = matchMedia('(prefers-reduced-motion: reduce)').matches;

  cards.forEach(function(card){
    var av = card.querySelector('.tcard-avatar');
    var t;
    function vira(on){
      card.classList.toggle('flipped', on);
      card.setAttribute('aria-expanded', on ? 'true' : 'false');
    }
    function alterna(){
      clearTimeout(t); av.classList.remove('waving');
      vira(!card.classList.contains('flipped'));
    }

    if(podeHover){
      card.addEventListener('mouseenter', function(){
        if(semAnim){ vira(true); return; }
        av.classList.add('waving');
        t = setTimeout(function(){ av.classList.remove('waving'); vira(true); }, 1000);
      });
      card.addEventListener('mouseleave', function(){
        clearTimeout(t); av.classList.remove('waving'); vira(false);
      });
    } else {
      card.addEventListener('click', alterna);
    }

    card.addEventListener('keydown', function(e){
      if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); alterna(); }
    });
  });
})();
