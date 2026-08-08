/* ==========================================================================
   TeraBoard · TeraSmart — interacoes da pagina
   ========================================================================== */

/* ==========================================================================
   VITRINE DO APP — altura do iframe
   A vitrine (assets/app demo/) muda de altura sozinha: quando a apresentacao
   abre, quando uma ficha expande, quando a tela e estreita e as colunas
   empilham. Ela mede e avisa; aqui so obedecemos. Sem isto sobraria um
   pedaco vazio embaixo ou uma barra de rolagem dentro do iframe.
   ========================================================================== */
(function(){
  var frame = document.getElementById('appDemo');
  if (!frame) return;

  addEventListener('message', function(ev){
    if (!ev.data || ev.data.type !== 'teraboard:altura') return;
    if (ev.source !== frame.contentWindow) return;      // so a nossa vitrine

    var altura = Number(ev.data.altura);
    if (altura > 0) frame.style.height = Math.ceil(altura) + 'px';
  });
})();

/* ==========================================================================
   TERASMART CORE — modelo 3D do painel
   Portado do demo avulso para dentro da pagina, no molde do TeraSensor:
   - palco e uma <div> (#coreStage), nao a janela inteira;
   - o id #canvas-container NAO pode ser reusado (ja e da logo 3D de fundo);
   - three.js e carregado no fim do <body>, entao esperamos com pronto();
   - alpha:true e sem scene.background: quem da o fundo e o card escuro;
   - laco de render pausa fora da tela (a logo 3D ja gasta uma GPU).
   ========================================================================== */
(function(){
  var HOST = document.getElementById('coreStage');
  if (!HOST) return;

  var tentativas = 0;
  function pronto(){ return typeof THREE !== 'undefined' && THREE.WebGLRenderer; }
  function iniciar(){
    if (!pronto()){
      if (tentativas++ < 120) return setTimeout(iniciar, 80);   // ate ~10s
      falhar('Nao foi possivel carregar o motor 3D.');
      return;
    }
    try { montar(); }
    catch (err){ console.error(err); falhar('Erro ao montar o modelo 3D.'); }
  }
  function falhar(msg){
    HOST.innerHTML = '<div class="core-fallback"><i class="ph-duotone ph-cube-transparent"></i><p>' +
      msg + ' Recarregue a pagina para tentar de novo.</p></div>';
  }

  function montar(){
    /* ---------- dimensoes (caixa 300x200x150mm, 1 unidade = 10mm) ---------- */
    var UNIT = 0.1, W = 200*UNIT, H = 300*UNIT, D = 150*UNIT, WALL = 0.35;
    var TRANCA_X = -17.5;
    var corCaixa = 0xF0F1E3, corPlaca = 0x0A4D36, corMetal = 0x111111;
    var MENTA = 0x1DC78B, MEDIO = 0x1F8F67;

    var scene, camera, renderer;
    var doorPivot, portaAberta = false, anguloAlvo = 0, anguloAtual = 0;
    var girando = false;
    var cpuMat, nodeMat, nodeLidoMat, cpuLight, circuito, circuitoZ = 0;
    var circuitoFora = false, timerCircuito = null;
    var telaCanvas, telaCtx, telaTex, pontos = 1, ultimoPonto = 0;

    var esf = { r: 55, theta: Math.PI/4, phi: Math.PI/2.4 };
    var alvo = { r: 55, theta: Math.PI/4, phi: Math.PI/2.4 };
    var arrastando = false, moveu = false, prev = { x:0, y:0 };

    /* balanco: vai e volta lento no eixo vertical, sem dar a volta.
       Roda so com a porta fechada — aberta, a caixa precisa ficar parada
       para o dedo acertar os nos. Sai de cena quando o usuario assume o
       controle (arrasto ou auto-rotacao) e volta depois de um tempo parado. */
    var balancando = true, timerBalanco = null;
    var thetaBase = Math.PI/4, tBalanco = Date.now();
    var BAL_AMP = 0.42;      // ~24 graus para cada lado
    var BAL_VEL = 0.0004;    // ciclo completo em ~16s
    var semAnim = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (semAnim) balancando = false;

    function pausarBalanco(){ balancando = false; clearTimeout(timerBalanco); }
    /* rebaseia no angulo atual: sin(0)=0, entao a retomada nao da salto */
    function retomarBalanco(atraso){
      if (semAnim || girando || portaAberta) return;
      clearTimeout(timerBalanco);
      timerBalanco = setTimeout(function(){
        if (girando || portaAberta || arrastando) return;
        thetaBase = esf.theta; tBalanco = Date.now(); balancando = true;
      }, atraso || 0);
    }

    var raycaster = new THREE.Raycaster(), ponteiro = new THREE.Vector2();
    var nos = [], hits = [], lidos = 0;
    var visivel = true, rodando = false;

    var elPainel = document.getElementById('corePanel');
    var elTitulo = document.getElementById('coreTitle');
    var elDesc   = document.getElementById('coreDesc');
    var elCont   = document.getElementById('coreCount');
    var elBarra  = document.getElementById('coreBar');
    var btPorta  = document.getElementById('coreDoor');
    var btGirar  = document.getElementById('coreSpin');

    /* ---------- cena ---------- */
    scene = new THREE.Scene();                       // sem background: fica transparente
    camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
    renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));  // 2 ja basta; 3 derruba fps
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    HOST.appendChild(renderer.domElement);

    luzes(); chao(); caixa(); porta(); placa();
    controles(); cliques(); reenquadrar();

    /* ---------- luz e chao ---------- */
    function luzes(){
      scene.add(new THREE.AmbientLight(0xffffff, 0.45));
      var key = new THREE.DirectionalLight(0xffffff, 0.62);
      key.position.set(6, 10, 8); key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      scene.add(key);
      var fill = new THREE.DirectionalLight(MENTA, 0.22);
      fill.position.set(-8, 4, -6); scene.add(fill);
    }
    function chao(){
      var piso = new THREE.Mesh(new THREE.CircleGeometry(30, 48),
                                new THREE.ShadowMaterial({ opacity:0.3 }));
      piso.rotation.x = -Math.PI/2;
      piso.position.y = -H/2 - 0.01;
      piso.receiveShadow = true;
      scene.add(piso);
    }
    function mat(cor, rug, met){ return new THREE.MeshStandardMaterial({ color:cor, roughness:rug, metalness:met }); }

    /* ---------- gabinete ---------- */
    function caixa(){
      var g = new THREE.Group(), m = mat(corCaixa, 0.6, 0.1);
      var fundo  = new THREE.Mesh(new THREE.BoxGeometry(W, H, WALL), m);
      fundo.position.set(0, 0, -D/2 + WALL/2);
      var topo   = new THREE.Mesh(new THREE.BoxGeometry(W, WALL, D), m);
      topo.position.set(0, H/2 - WALL/2, 0);
      var base   = new THREE.Mesh(new THREE.BoxGeometry(W, WALL, D), m);
      base.position.set(0, -H/2 + WALL/2, 0);
      var esq    = new THREE.Mesh(new THREE.BoxGeometry(WALL, H, D), m);
      esq.position.set(-W/2 + WALL/2, 0, 0);
      var dir    = new THREE.Mesh(new THREE.BoxGeometry(WALL, H, D), m);
      dir.position.set(W/2 - WALL/2, 0, 0);
      [fundo,topo,base,esq,dir].forEach(function(p){ p.castShadow = true; p.receiveShadow = true; g.add(p); });
      scene.add(g);

      var chapa = new THREE.Mesh(new THREE.BoxGeometry(150*UNIT, 250*UNIT, 0.25), mat(corPlaca, 0.8, 0.1));
      chapa.position.set(0, 0, -D/2 + 1.6);
      chapa.receiveShadow = true;
      scene.add(chapa);
    }

    /* ---------- trilha de cobre entre CPU e no ---------- */
    function trilha(p1, p2, material){
      var d = p1.distanceTo(p2);
      var t = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, d, 8), material);
      t.position.copy(p2.clone().add(p1).divideScalar(2));
      t.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), p2.clone().sub(p1).normalize());
      return t;
    }

    /* ---------- placa logica ---------- */
    function placa(){
      circuitoZ = -D/2 + 1.6 + 0.13;
      circuito = new THREE.Group();
      circuito.position.set(0, 0, circuitoZ);

      cpuMat = new THREE.MeshPhongMaterial({ color:corPlaca, specular:MENTA, shininess:100,
                                             emissive:MENTA, emissiveIntensity:0.3 });
      var cpu = new THREE.Mesh(new THREE.BoxGeometry(3.5, 3.5, 0.4), cpuMat);
      cpu.position.set(0, 0, 0.2); cpu.castShadow = true;
      circuito.add(cpu);

      cpuLight = new THREE.PointLight(MENTA, 1.0, 20);
      cpuLight.position.set(0, 0, 1.5);
      circuito.add(cpuLight);

      var dados = [
        { a: 0,             t:'Leitura do solo 24h',        d:'Umidade, temperatura e condutividade eletrica monitoradas sem interrupcao pelos sensores do setor.' },
        { a: Math.PI/4,     t:'Leitura de nivel',           d:'Acompanhamento do volume das caixas de abastecimento, com alerta antes de faltar.' },
        { a: Math.PI/2,     t:'Irrigacao e fertirrigacao',  d:'Acionamento das valvulas para dosagem de agua e de nutrientes em cada setor da estufa.' },
        { a: 3*Math.PI/4,   t:'Dosagem de nutrientes',      d:'Injecao individualizada dos tanques A, B e C direto na linha principal, proporcional a vazao.' },
        { a: Math.PI,       t:'Ambiente da estufa',         d:'Leitura das variaveis climaticas dimensionadas para o microclima interno.' },
        { a: -3*Math.PI/4,  t:'Controle em malha fechada',  d:'Ajuste autonomo a partir do retorno continuo dos sensores, sem intervencao manual.' },
        { a: -Math.PI/2,    t:'Calculo de consumo',         d:'Processamento deterministico do quanto de agua e de adubo cada setor consumiu.' },
        { a: -Math.PI/4,    t:'Aplicativo e alertas',       d:'Sincronizacao em tempo real, historico em grafico e notificacao de anomalia.' }
      ];

      var fioMat = new THREE.MeshPhongMaterial({ color:MEDIO, specular:MENTA, shininess:100,
                                                 emissive:MEDIO, emissiveIntensity:0.6 });
      nodeMat = new THREE.MeshPhongMaterial({ color:corPlaca, specular:MEDIO, shininess:50,
                                              emissive:corPlaca, emissiveIntensity:0.2 });
      nodeLidoMat = new THREE.MeshPhongMaterial({ color:MENTA, specular:0xffffff, shininess:100,
                                                  emissive:MENTA, emissiveIntensity:0.6 });

      var raio = 6.5;
      dados.forEach(function(dado){
        var nx = Math.cos(dado.a)*raio, ny = Math.sin(dado.a)*raio;
        var pts = [ new THREE.Vector3(0, 0, 0.05) ];
        if (Math.abs(nx) > Math.abs(ny)){
          pts.push(new THREE.Vector3(nx*0.5, 0, 0.05));
          pts.push(new THREE.Vector3(nx*0.5, ny, 0.05));
        } else {
          pts.push(new THREE.Vector3(0, ny*0.5, 0.05));
          pts.push(new THREE.Vector3(nx, ny*0.5, 0.05));
        }
        pts.push(new THREE.Vector3(nx, ny, 0.05));

        var caminho = new THREE.CurvePath();
        for (var i = 0; i < pts.length-1; i++){
          circuito.add(trilha(pts[i], pts[i+1], fioMat));
          caminho.add(new THREE.LineCurve3(pts[i], pts[i+1]));
        }

        var pulso = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 12),
                                   new THREE.MeshBasicMaterial({ color:0xffffff }));
        pulso.visible = false;
        circuito.add(pulso);

        var no = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.25, 24), nodeMat);
        no.rotation.x = Math.PI/2;
        no.position.set(nx, ny, 0.12);
        no.userData = { titulo:dado.t, desc:dado.d, lido:false,
                        caminho:caminho, pulso:pulso, off:Math.random()*Math.PI*2 };
        nos.push(no);
        circuito.add(no);

        /* alvo de clique maior que o disco visivel — o disco fica pequeno
           de proposito (escala real), mas mirar nele com o dedo era dificil.
           O hitbox e invisivel e so existe para o raycaster; aponta de volta
           para o "no" visual, que e quem realmente muda de material/estado. */
        var hit = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 1.4, 16),
                                 new THREE.MeshBasicMaterial({ visible:false }));
        hit.rotation.x = Math.PI/2;
        hit.position.copy(no.position);
        hit.userData = { alvo: no };
        hits.push(hit);
        circuito.add(hit);
      });

      scene.add(circuito);
    }

    /* ---------- LCD desenhado em canvas ---------- */
    function iniciarTela(){
      telaCanvas = document.createElement('canvas');
      telaCanvas.width = 512; telaCanvas.height = 256;
      telaCtx = telaCanvas.getContext('2d');
      telaTex = new THREE.CanvasTexture(telaCanvas);
      desenharTela(pontos);
      return telaTex;
    }
    function desenharTela(n){
      if (!telaCtx) return;
      telaCtx.fillStyle = '#06180F';
      telaCtx.fillRect(0, 0, telaCanvas.width, telaCanvas.height);
      telaCtx.strokeStyle = '#0C2A1D'; telaCtx.lineWidth = 2;
      for (var i = 0; i < telaCanvas.height; i += 6){
        telaCtx.beginPath(); telaCtx.moveTo(0, i); telaCtx.lineTo(telaCanvas.width, i); telaCtx.stroke();
      }
      telaCtx.fillStyle = '#1DC78B';
      telaCtx.shadowColor = '#1DC78B'; telaCtx.shadowBlur = 8;
      telaCtx.font = 'bold 36px "Courier New", Courier, monospace';
      telaCtx.textAlign = 'left'; telaCtx.textBaseline = 'top';
      var p = '.'.repeat(n);
      telaCtx.fillText('SETOR 01:', 30, 30);
      telaCtx.fillText('FERTIRRIGANDO' + p, 30, 80);
      telaCtx.fillText('SETOR 02:', 30, 150);
      telaCtx.fillText('IRRIGANDO' + p, 30, 200);
      telaTex.needsUpdate = true;
    }

    /* ---------- porta ---------- */
    function porta(){
      doorPivot = new THREE.Object3D();
      doorPivot.position.set(W/2 - 0.1, 0, D/2);
      scene.add(doorPivot);

      var esp = 0.3;
      var loader = new THREE.TextureLoader();
      var capa = loader.load('assets/img/produtos/terasmart-capa.webp');

      var mBase = mat(corCaixa, 0.6, 0.1);
      var mFrente = new THREE.MeshStandardMaterial({ color:0xffffff, map:capa, roughness:0.5, metalness:0.1 });
      var painel = new THREE.Mesh(new THREE.BoxGeometry(W-0.1, H-0.1, esp),
                                  [mBase,mBase,mBase,mBase,mFrente,mBase]);
      painel.position.set(-(W/2 - 0.1), 0, esp/2);
      painel.castShadow = true;
      doorPivot.add(painel);

      var tex = iniciarTela();
      var mTela = new THREE.MeshPhongMaterial({ color:0x06180F, map:tex, emissive:0xffffff,
                                                emissiveMap:tex, emissiveIntensity:0.9,
                                                specular:MENTA, shininess:90 });
      var tela = new THREE.Mesh(new THREE.BoxGeometry(12, 5, 0.2), mTela);
      tela.position.set(-(W/2 - 0.1), 7, esp/2 + 0.1);
      tela.castShadow = true;
      doorPivot.add(tela);

      var maca = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, 0.35, 24), mat(corMetal, 0.5, 0.8));
      maca.rotation.x = Math.PI/2;
      var gMaca = new THREE.Group();
      gMaca.position.set(TRANCA_X, 0, esp);
      gMaca.add(maca);
      doorPivot.add(gMaca);
    }

    /* ---------- enquadramento: a peca cabe seja o palco largo ou estreito ---- */
    /* alvoZ compensa o fato de a placa avancar 4 unidades na direcao da camera
       quando a porta abre: o calculo supoe o objeto na origem, e sem descontar
       isso a placa ficava menor do que o espaco disponivel. */
    function distancia(alt, larg, preenche, alvoZ){
      var vHalf = Math.tan(camera.fov * Math.PI/360);
      var d = Math.max(alt/2  / (preenche*vHalf),
                       larg/2 / (preenche*vHalf*camera.aspect));
      return Math.max(15, d - (alvoZ || 0));
    }
    function raioDoEstado(){
      return portaAberta ? distancia(14.6, 14.6, 0.88, 1.8)   // placa em destaque
                         : distancia(34,   24,   0.92, 0);    // gabinete inteiro
    }

    function reenquadrar(){
      var L = HOST.clientWidth || 480, A = HOST.clientHeight || 420;
      camera.aspect = L/A;
      camera.updateProjectionMatrix();
      renderer.setSize(L, A);
      alvo.r = raioDoEstado();
    }
    addEventListener('resize', reenquadrar);
    if (window.ResizeObserver) new ResizeObserver(reenquadrar).observe(HOST);

    /* ---------- controles ----------
       Pointer Events cobrem mouse e toque no mesmo caminho. O CSS poe
       touch-action:pan-y no palco: arrasto na horizontal gira o modelo,
       arrasto na vertical continua rolando a pagina (senao o dedo fica
       preso num bloco de 400px no meio da leitura). */
    function controles(){
      HOST.addEventListener('pointerdown', function(e){
        arrastando = true; moveu = false; pausarBalanco();
        prev = { x:e.clientX, y:e.clientY };
        HOST.classList.add('dragging');
        if (HOST.setPointerCapture) HOST.setPointerCapture(e.pointerId);
      });
      HOST.addEventListener('pointermove', function(e){
        if (!arrastando) return;
        var dx = e.clientX - prev.x, dy = e.clientY - prev.y;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moveu = true;
        alvo.theta -= dx*0.008;
        alvo.phi = Math.max(0.3, Math.min(Math.PI-0.3, alvo.phi - dy*0.008));
        prev = { x:e.clientX, y:e.clientY };
      });
      function soltar(e){
        arrastando = false;
        retomarBalanco(4000);          // volta depois de 4s parado

        HOST.classList.remove('dragging');
        if (HOST.releasePointerCapture && e.pointerId != null){
          try { HOST.releasePointerCapture(e.pointerId); } catch(_){}
        }
      }
      HOST.addEventListener('pointerup', soltar);
      HOST.addEventListener('pointercancel', soltar);

      /* zoom so com Ctrl/Cmd. Roda pura continua rolando a pagina — capturar
         o scroll no meio de uma pagina longa prende o leitor. */
      HOST.addEventListener('wheel', function(e){
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        alvo.r = Math.max(15, Math.min(90, alvo.r + e.deltaY*0.03));
      }, { passive:false });

      var zi = document.getElementById('coreZoomIn'), zo = document.getElementById('coreZoomOut');
      if (zi) zi.addEventListener('click', function(){ alvo.r = Math.max(15, alvo.r - 7); });
      if (zo) zo.addEventListener('click', function(){ alvo.r = Math.min(90, alvo.r + 7); });

      if (btPorta) btPorta.addEventListener('click', alternarPorta);
      if (btGirar) btGirar.addEventListener('click', function(){
        girando = !girando;
        if (girando) pausarBalanco(); else retomarBalanco(0);
        btGirar.classList.toggle('is-on', girando);
        btGirar.setAttribute('aria-pressed', girando ? 'true' : 'false');
      });
    }

    function alternarPorta(){
      portaAberta = !portaAberta;
      anguloAlvo = portaAberta ? 1.95 : 0;
      if (btPorta) btPorta.innerHTML = portaAberta
        ? '<i class="ph-bold ph-door"></i> Fechar painel'
        : '<i class="ph-bold ph-door-open"></i> Abrir painel';

      alvo.theta = portaAberta ? 0.1 : Math.PI/4;
      alvo.phi   = portaAberta ? Math.PI/2 : Math.PI/2.4;
      alvo.r     = raioDoEstado();

      clearTimeout(timerCircuito);
      if (portaAberta){
        pausarBalanco();                 // aberta, a caixa fica parada
        timerCircuito = setTimeout(function(){ circuitoFora = true; }, 1500);
        dizer('Escolha um no', 'A placa se destaca em instantes. Toque em cada no verde para ler o que aquela parte da malha faz.');
      } else {
        circuitoFora = false;
        thetaBase = Math.PI/4; tBalanco = Date.now();
        if (!semAnim && !girando) balancando = true;
        lidos = 0;
        nos.forEach(function(n){ n.userData.lido = false; n.material = nodeMat; });
        progresso();
        dizer('Abra o painel', 'Toque em <strong>Abrir painel</strong>. A placa se destaca e os oito nos da malha ficam acessiveis.');
      }
    }

    function dizer(titulo, html){
      if (elTitulo) elTitulo.textContent = titulo;
      if (elDesc) elDesc.innerHTML = html;
      if (elPainel){ elPainel.classList.remove('flash'); void elPainel.offsetWidth; elPainel.classList.add('flash'); }
    }
    function progresso(){
      if (elCont) elCont.textContent = lidos;
      if (elBarra) elBarra.style.width = (lidos/nos.length*100) + '%';
    }

    /* ---------- clique nos nos: coordenadas relativas ao palco ---------- */
    function cliques(){
      HOST.addEventListener('click', function(e){
        if (moveu) return;                       // foi arrasto, nao clique
        var r = HOST.getBoundingClientRect();
        ponteiro.x =  ((e.clientX - r.left) / r.width)  * 2 - 1;
        ponteiro.y = -((e.clientY - r.top)  / r.height) * 2 + 1;
        raycaster.setFromCamera(ponteiro, camera);
        var acertos = raycaster.intersectObjects(hits);
        if (!acertos.length) return;

        var no = acertos[0].object.userData.alvo;
        if (!no.userData.lido){
          no.userData.lido = true;
          no.material = nodeLidoMat;
          lidos++; progresso();
        }
        dizer(no.userData.titulo, no.userData.desc);
        no.scale.set(1.4, 1.4, 1.4);
        setTimeout(function(){ no.scale.set(1,1,1); }, 150);
      });
    }

    /* ---------- laco: pausa fora da tela ---------- */
    if (window.IntersectionObserver){
      new IntersectionObserver(function(es){
        visivel = es[0].isIntersecting;
        if (visivel && !rodando) laco();
      }, { threshold:0.01 }).observe(HOST);
    }

    function laco(){
      if (!visivel){ rodando = false; return; }
      rodando = true;
      requestAnimationFrame(laco);
      var agora = Date.now();

      if (agora - ultimoPonto > 400){
        pontos = (pontos % 5) + 1;
        desenharTela(pontos);
        ultimoPonto = agora;
      }

      anguloAtual += (anguloAlvo - anguloAtual) * 0.04;
      doorPivot.rotation.y = anguloAtual;

      esf.r     += (alvo.r     - esf.r)     * 0.035;
      esf.theta += (alvo.theta - esf.theta) * 0.035;
      esf.phi   += (alvo.phi   - esf.phi)   * 0.035;
      if (girando && !arrastando) alvo.theta += 0.003;
      else if (balancando && !arrastando && !portaAberta){
        alvo.theta = thetaBase + Math.sin((agora - tBalanco) * BAL_VEL) * BAL_AMP;
      }

      var t = agora * 0.0025, p = 0.5 + Math.sin(t)*0.4;
      cpuMat.emissiveIntensity = 0.2 + p*0.4;
      nodeLidoMat.emissiveIntensity = 0.4 + p*0.6;
      cpuLight.intensity = 0.5 + p*1.0;

      var tp = agora * 0.002;
      nos.forEach(function(n){
        if (n.userData.lido){
          n.userData.pulso.visible = true;
          var k = (Math.sin(tp + n.userData.off) + 1) / 2;
          n.userData.pulso.position.copy(n.userData.caminho.getPoint(k));
        } else n.userData.pulso.visible = false;
      });

      if (circuitoFora){
        circuito.position.z += (circuitoZ + 4.0 - circuito.position.z) * 0.03;
        var w = agora * 0.0015;
        circuito.rotation.x += (Math.sin(w)*0.15 - circuito.rotation.x) * 0.03;
        circuito.rotation.y += (Math.cos(w)*0.15 - circuito.rotation.y) * 0.03;
      } else {
        circuito.position.z += (circuitoZ - circuito.position.z) * 0.04;
        circuito.rotation.x += (0 - circuito.rotation.x) * 0.04;
        circuito.rotation.y += (0 - circuito.rotation.y) * 0.04;
      }

      var x = esf.r * Math.sin(esf.phi) * Math.sin(esf.theta);
      var y = esf.r * Math.cos(esf.phi);
      var z = esf.r * Math.sin(esf.phi) * Math.cos(esf.theta);
      camera.position.set(x, y, z);
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
    }

    progresso();
    laco();
  }

  iniciar();
})();
