/* ==========================================================================
   TeraBoard · Nav — encolhe no scroll, menu mobile e revelacao das secoes
   ========================================================================== */

// nav shrink + mobile menu
const topnav=document.getElementById('topnav');
// ~380px de rolagem = umas 3-4 "roladas" de mouse. --p vai de 0 a 1 nesse trecho,
// controlando padding, glow e a troca pra logo bege, tudo em conjunto.
const NAV_SCROLL_RANGE=380;
function updateNavScroll(){
  const p=Math.min(Math.max(scrollY/NAV_SCROLL_RANGE,0),1);
  topnav.style.setProperty('--p',p);
  topnav.classList.toggle('shrunk',p>0.5);
}
addEventListener('scroll',updateNavScroll,{passive:true});
updateNavScroll();
const burger=document.getElementById('burger'),mm=document.getElementById('mobileMenu');

/* O menu ocupa a tela inteira. Enquanto ele esta aberto a pagina atras nao
   pode rolar — no celular o dedo pegava o fundo e o menu ficava boiando
   sobre um conteudo em movimento. O aria-expanded acompanha para quem
   navega por leitor de tela ouvir o estado, nao so ver. */
function alternarMenu(aberto){
  if(!mm) return;
  mm.classList.toggle('open',aberto);
  burger.classList.toggle('x',aberto);
  burger.setAttribute('aria-expanded',aberto?'true':'false');
  document.body.classList.toggle('menu-aberto',aberto);
}
burger&&burger.addEventListener('click',()=>alternarMenu(!mm.classList.contains('open')));
mm&&mm.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>alternarMenu(false)));
// Esc fecha, como qualquer camada que cobre a pagina.
addEventListener('keydown',e=>{if(e.key==='Escape'&&mm&&mm.classList.contains('open'))alternarMenu(false)});
// reveal
const io=new IntersectionObserver((es)=>{es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('vis');io.unobserve(e.target)}})},{threshold:.12});
document.querySelectorAll('.reveal').forEach(el=>io.observe(el));
