/* ==========================================================================
   TeraBoard · Efeitos de UI — barra de leitura, contadores e cards com inclinacao
   ========================================================================== */

const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* barra de progresso de leitura */
(function(){
  const bar=document.createElement('div');bar.className='sprog';document.body.appendChild(bar);
  const upd=()=>{const h=document.documentElement.scrollHeight-innerHeight;
    bar.style.width=(h>0?(scrollY/h)*100:0)+'%';};
  addEventListener('scroll',upd,{passive:true});addEventListener('resize',upd);upd();
})();

/* contadores animados: [data-count] / [data-suffix] / [data-prefix] */
(function(){
  const fmt=(v,dec)=>dec>0?v.toFixed(dec).replace('.',','):Math.round(v).toString();
  const run=el=>{
    const to=parseFloat(el.dataset.count), dec=parseInt(el.dataset.dec||'0');
    const pre=el.dataset.prefix||'', suf=el.dataset.suffix||'';
    if(RM){el.textContent=pre+fmt(to,dec)+suf;return}
    const dur=1400, t0=performance.now();
    const tick=now=>{
      const p=Math.min(1,(now-t0)/dur), e=1-Math.pow(1-p,3);
      el.textContent=pre+fmt(to*e,dec)+suf;
      if(p<1)requestAnimationFrame(tick);
    };requestAnimationFrame(tick);
  };
  const co=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){run(e.target);co.unobserve(e.target)}}),{threshold:.5});
  document.querySelectorAll('[data-count]').forEach(el=>co.observe(el));
})();

/* inclinacao dos cards .tilt + botoes magneticos (so em ponteiro fino) */
if(!RM && matchMedia('(pointer:fine)').matches){
  document.querySelectorAll('.tilt').forEach(card=>{
    card.addEventListener('mousemove',e=>{
      const r=card.getBoundingClientRect();
      const x=(e.clientX-r.left)/r.width-.5, y=(e.clientY-r.top)/r.height-.5;
      card.style.transform=`perspective(900px) rotateX(${-y*5}deg) rotateY(${x*5}deg) translateY(-5px)`;
    });
    card.addEventListener('mouseleave',()=>{card.style.transform=''});
  });
  document.querySelectorAll('.btn').forEach(b=>{
    b.addEventListener('mousemove',e=>{
      const r=b.getBoundingClientRect();
      b.style.transform=`translate(${(e.clientX-r.left-r.width/2)*.18}px,${(e.clientY-r.top-r.height/2)*.3}px)`;
    });
    b.addEventListener('mouseleave',()=>{b.style.transform=''});
  });
}
