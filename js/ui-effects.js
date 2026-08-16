/* ==========================================================================
   TeraBoard · Efeitos de UI — barra de leitura, contadores e cards com inclinacao

   NOTA DE DESEMPENHO — por que este arquivo parece mais complicado do que o
   efeito que ele produz.

   Medir o tamanho ou a posicao de um elemento (getBoundingClientRect,
   scrollHeight) obriga o navegador a parar e recalcular o layout na hora, se
   houver estilo pendente. Escrever um transform deixa estilo pendente. Fazer
   as duas coisas alternadas, dentro de um evento que dispara a cada movimento
   do mouse — e mouse moderno dispara 120 vezes por segundo ou mais — poe o
   navegador num vai-e-vem em que ele nunca consegue agrupar trabalho. E o
   chamado "layout thrashing", e o sintoma e exatamente este: a pagina engasga
   NO COMPUTADOR e roda lisa NO CELULAR, porque os dois efeitos de ponteiro
   abaixo so existem onde ha ponteiro fino.

   A cura tem duas partes, e as duas aparecem repetidas aqui embaixo:
     1. medir uma vez e guardar, refazendo a conta so quando ela pode ter
        mudado (rolagem, redimensionamento);
     2. escrever no maximo uma vez por quadro, dentro de requestAnimationFrame,
        e nao uma vez por evento.
   ========================================================================== */

const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* --------------------------------------------------------------------------
   Barra de progresso de leitura

   scrollHeight sai do evento de scroll e passa a ser medido so quando a altura
   do documento pode ter mudado: ao redimensionar, ao terminar de carregar (as
   imagens mudam a altura) e quando o proprio corpo muda de tamanho — que e o
   que acontece quando uma secao com animacao de entrada se expande.
   -------------------------------------------------------------------------- */
(function(){
  const bar=document.createElement('div');bar.className='sprog';document.body.appendChild(bar);

  let alturaRolavel=0, agendado=false;

  const pintar=()=>{
    agendado=false;
    bar.style.width=(alturaRolavel>0?(scrollY/alturaRolavel)*100:0)+'%';
  };
  const agendar=()=>{if(!agendado){agendado=true;requestAnimationFrame(pintar)}};
  const medir=()=>{alturaRolavel=document.documentElement.scrollHeight-innerHeight;agendar()};

  addEventListener('scroll',agendar,{passive:true});
  addEventListener('resize',medir);
  addEventListener('load',medir);
  /* A barra e position:fixed, entao escrever a largura dela nao mexe no
     tamanho do corpo — nao ha risco de o observador se realimentar. */
  if(window.ResizeObserver)new ResizeObserver(medir).observe(document.body);
  medir();
})();

/* --------------------------------------------------------------------------
   Contadores animados: [data-count] / [data-suffix] / [data-prefix]
   -------------------------------------------------------------------------- */
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

/* --------------------------------------------------------------------------
   Inclinacao dos cards .tilt + botoes magneticos (so em ponteiro fino)

   Este bloco e o que mais pesava, e e o unico do arquivo que nao roda no
   celular — dai o computador engasgar mais que o telefone numa pagina que,
   no papel, e a mesma.
   -------------------------------------------------------------------------- */
if(!RM && matchMedia('(pointer:fine)').matches){

  /* A medida de um elemento so muda quando a pagina rola ou muda de tamanho.
     Em vez de cada elemento escutar esses dois eventos, um contador comum sobe
     e cada um percebe sozinho que a medida guardada envelheceu. Passar o mouse
     por cima de uma pagina parada nao custa nenhuma medicao. */
  let geracao=0;
  const envelhecer=()=>{geracao++};
  addEventListener('scroll',envelhecer,{passive:true});
  addEventListener('resize',envelhecer);

  const seguirPonteiro=(el,transformar)=>{
    let r=null, rGer=-1, cx=0, cy=0, agendado=false;

    const aplicar=()=>{
      agendado=false;
      if(!r)return;
      el.style.transform=transformar(cx,cy,r);
    };

    el.addEventListener('mousemove',e=>{
      if(!r||rGer!==geracao){r=el.getBoundingClientRect();rGer=geracao}
      cx=e.clientX;cy=e.clientY;
      if(!agendado){agendado=true;requestAnimationFrame(aplicar)}
    });

    el.addEventListener('mouseleave',()=>{
      r=null;rGer=-1;
      el.style.transform='';
    });
  };

  document.querySelectorAll('.tilt').forEach(card=>{
    seguirPonteiro(card,(cx,cy,r)=>{
      const x=(cx-r.left)/r.width-.5, y=(cy-r.top)/r.height-.5;
      return `perspective(900px) rotateX(${-y*5}deg) rotateY(${x*5}deg) translateY(-5px)`;
    });
  });

  document.querySelectorAll('.btn').forEach(b=>{
    seguirPonteiro(b,(cx,cy,r)=>
      `translate(${(cx-r.left-r.width/2)*.18}px,${(cy-r.top-r.height/2)*.3}px)`);
  });
}
