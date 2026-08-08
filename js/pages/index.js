/* ==========================================================================
   TeraBoard · Inicio — leitura ao vivo do hero + simulador de pH/umidade/EC

   Os dois blocos abaixo so existem nesta pagina. Cada um confere se o seu
   HTML esta presente antes de se ligar, entao o arquivo e inofensivo se um
   dia for incluido em outra pagina.
   ========================================================================== */

(function(){
  const btn=document.getElementById('heroBtn'),hint=document.getElementById('heroHint');
  if(!btn)return;
  const line=document.getElementById('hpLine'),dots=document.getElementById('hpDots');
  const rpH=document.getElementById('rpH'),rUm=document.getElementById('rUm'),rEC=document.getElementById('rEC');
  const state=document.getElementById('hpState'),dot=document.getElementById('hpDot');
  let busy=false, measured=false;
  function paint(color){line.setAttribute('stroke',color);dots.querySelectorAll('circle').forEach(c=>c.setAttribute('fill',color));rpH.style.color=color;}
  btn.addEventListener('click',()=>{
    if(busy)return;busy=true;hint&&(hint.style.display='none');
    if(measured){ // reset
      btn.innerHTML='<i class="ph-bold ph-scan"></i> Medir agora';
      line.setAttribute('points','24,84 90,80 156,86 222,82 276,84');paint('var(--clay)');
      rpH.textContent='4.8';rUm.innerHTML='21<span style="font-size:.9rem">%</span>';rEC.innerHTML='0.4<span style="font-size:.85rem">mS</span>';
      state.textContent='em espera';dot.style.background='var(--sage)';measured=false;busy=false;return;
    }
    btn.innerHTML='<i class="ph-fill ph-spinner" style="animation:spin 1s linear infinite"></i> Lendo o solo…';
    state.textContent='lendo…';dot.style.background='var(--amber)';
    // settle the reading toward the ideal line
    setTimeout(()=>{
      line.setAttribute('points','24,44 90,40 156,42 222,39 276,41');paint('var(--signal)');
      let ph=4.8,um=21,ec=0.4;const iv=setInterval(()=>{
        ph=Math.min(6.0,ph+0.09);um=Math.min(63,um+2.4);ec=Math.min(1.3,ec+0.05);
        rpH.textContent=ph.toFixed(1);rUm.innerHTML=Math.round(um)+'<span style="font-size:.9rem">%</span>';rEC.innerHTML=ec.toFixed(1)+'<span style="font-size:.85rem">mS</span>';
        if(ph>=6.0&&um>=63){clearInterval(iv);state.textContent='no alvo';dot.style.background='var(--signal)';
          btn.innerHTML='<i class="ph-bold ph-arrow-counter-clockwise"></i> Medir de novo';measured=true;busy=false;}
      },55);
    },850);
  });
})();

/* ---- simulador de solo (arraste) ---- */
(function(){
  const sPh=document.getElementById('sPh'),sUm=document.getElementById('sUm'),sEc=document.getElementById('sEc');
  if(!sPh)return;
  const oPh=document.getElementById('oPh'),oUm=document.getElementById('oUm'),oEc=document.getElementById('oEc'),oScore=document.getElementById('oScore');
  const box=document.getElementById('verdict'),vI=document.getElementById('vIcon'),vT=document.getElementById('vTitle'),vX=document.getElementById('vText');

  /* A planta e uma cena em three.js (js/pages/index-planta-3d.js). Ela sobe
     depois deste arquivo, entao o primeiro estado fica guardado em
     TeraPlantaPendente e a cena o aplica assim que nasce. */
  function mostrarNaPlanta(leitura){
    if(window.TeraPlanta) window.TeraPlanta.atualizar(leitura);
    else window.TeraPlantaPendente = leitura;
  }

  const R={ph:[5.8,6.5],um:[55,70],ec:[1.0,1.8]};
  const inR=(v,r)=>v>=r[0]&&v<=r[1];
  const dev=(v,r)=>{ if(inR(v,r))return 0;
    const d=v<r[0]?r[0]-v:v-r[1], span=(r[1]-r[0])*2.2;
    return Math.min(1,d/span); };

  function paint(){
    const ph=parseFloat(sPh.value), um=parseFloat(sUm.value), ec=parseFloat(sEc.value);
    oPh.textContent=ph.toFixed(1);
    oUm.textContent=Math.round(um)+'%';
    oEc.textContent=ec.toFixed(1);

    const dPh=dev(ph,R.ph), dUm=dev(um,R.um), dEc=dev(ec,R.ec);
    const stress=Math.min(1,(dPh*1.05+dUm*1.15+dEc*.9)/2.2);
    const health=Math.round((1-stress)*100);
    oScore.textContent=health+'%';
    oScore.style.color = health>75?'var(--signal)' : health>45?'var(--amber)':'var(--clay)';

    mostrarNaPlanta({
      estresse: stress,
      umidade: um/100,
      encharque: um>R.um[1] ? Math.min(1,(um-R.um[1])/26) : 0,
    });

    let t,x,ic,col;
    if(dPh>0){
      const ac=ph<R.ph[0];
      t = ac?'Solo ácido':'Solo alcalino';
      x = ac?'A acidez trava a absorção de nutrientes — todo adubo aplicado vira desperdício. Receita: corretivo de pH (calcário).'
            :'O pH alto bloqueia ferro e fósforo. Receita: correção com fonte acidificante e ajuste da fertirrigação.';
      ic='ph-flask';col='clay';
    } else if(um<R.um[0]){
      t='Déficit hídrico';x='A planta está fechando os estômatos para economizar água e para de crescer. Ação: irrigar agora.';
      ic='ph-drop-half';col='amber';
    } else if(um>R.um[1]){
      t='Excesso de água';x='O solo encharcado sufoca a raiz e favorece fungos. Ação: suspender a irrigação e drenar.';
      ic='ph-drop';col='amber';
    } else if(ec<R.ec[0]){
      t='Nutrição baixa';x='Pouco sal solúvel disponível: a lavoura está com fome. Ação: fertirrigar na dose recomendada.';
      ic='ph-leaf';col='amber';
    } else if(ec>R.ec[1]){
      t='Salinidade alta';x='Excesso de sais desidrata a raiz por osmose. Ação: lixiviar com água limpa e reduzir a dose.';
      ic='ph-warning';col='clay';
    } else {
      t='Condição ideal';x='Os três parâmetros estão na faixa alvo. O TeraSmart mantém esse ponto sozinho, 24/7.';
      ic='ph-check-circle';col='signal';
    }
    vT.textContent=t;vX.textContent=x;
    vI.className='ph-fill '+ic;
    const C={signal:['rgba(29, 199, 139,.10)','rgba(29, 199, 139,.32)','var(--signal)'],
             amber:['rgba(245,184,65,.10)','rgba(245,184,65,.32)','var(--amber)'],
             clay:['rgba(226,123,88,.10)','rgba(226,123,88,.32)','var(--clay)']}[col];
    box.style.background=C[0];box.style.border='1px solid '+C[1];vI.style.color=C[2];
  }

  [sPh,sUm,sEc].forEach(s=>{s.addEventListener('input',paint)});

  document.getElementById('btnIdeal').addEventListener('click',function(){
    const targets={sPh:6.1,sUm:62,sEc:1.4}, start={sPh:+sPh.value,sUm:+sUm.value,sEc:+sEc.value};

    /* Se a correcao vai SUBIR a umidade, o que o TeraSmart faz na pratica e
       irrigar — e e ai que as gotas fazem sentido: durante a rega, nao
       quando o solo esta seco parado. Se a umidade tem que cair, o sistema
       esta drenando e nao cai gota nenhuma. */
    if(start.sUm<targets.sUm && window.TeraPlanta) window.TeraPlanta.regar(2.2);

    const t0=performance.now(),dur=800;
    const step=now=>{
      const p=Math.min(1,(now-t0)/dur),e=1-Math.pow(1-p,3);
      sPh.value=(start.sPh+(targets.sPh-start.sPh)*e).toFixed(1);
      sUm.value=Math.round(start.sUm+(targets.sUm-start.sUm)*e);
      sEc.value=(start.sEc+(targets.sEc-start.sEc)*e).toFixed(1);
      paint(); if(p<1)requestAnimationFrame(step);
    };requestAnimationFrame(step);
  });

  paint();
})();
