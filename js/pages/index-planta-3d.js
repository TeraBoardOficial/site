/* ==========================================================================
   TeraBoard · Index — a planta do simulador, em 3D

   Substitui o desenho em SVG que existia aqui. O motivo nao e enfeite: a
   pagina inteira ja e tridimensional (a marca girando ao fundo, o painel do
   TeraSmart, o aparelho da vitrine) e um vetor chapado no meio disso lia
   como um adesivo colado por cima.

   Como conversa com o resto:
     - a logica de faixas, veredito e nota continua em js/pages/index.js;
       aqui so entra o RESULTADO dela, por window.TeraPlanta.atualizar();
     - three.js e a versao global r128, carregada no fim do <body> — por isso
       o pronto()/espera(), igual ao painel do TeraSmart;
     - alpha:true e sem scene.background: quem da o fundo e o cartao .plate.

   O laco de render para quando a secao sai da tela. A marca 3D do fundo ja
   ocupa uma GPU e ninguem precisa de duas cenas girando as cegas.
   ========================================================================== */
(function () {
  'use strict';

  var HOST = document.getElementById('plantaStage');
  if (!HOST) return;

  /* ---------- paleta ---------- */
  // Verde saudavel -> palha estressada. As duas pontas sao interpoladas pelo
  // mesmo fator de estresse que move o caule e as folhas.
  var FOLHA_VIVA = 0x46AB6D;
  var FOLHA_SECA = 0xA9873A;
  var CAULE_VIVO = 0x2F7D4F;
  var CAULE_SECO = 0x8A7A3C;
  var TERRA_SECA = 0x8A6A45;
  var TERRA_UMIDA = 0x3A2716;

  var tentativas = 0;
  function pronto() { return typeof THREE !== 'undefined' && THREE.WebGLRenderer; }
  function espera() {
    if (!pronto()) {
      if (tentativas++ < 120) return setTimeout(espera, 80);   // ate ~10 s
      return falhar();
    }
    try { montar(); } catch (err) { console.error(err); falhar(); }
  }

  function falhar() {
    // Sem WebGL a secao ainda funciona: os controles, o veredito e a nota
    // seguem valendo. So o retrato da planta e que nao aparece.
    HOST.innerHTML = '<div class="planta-fallback">' +
      '<i class="ph-duotone ph-plant"></i>' +
      '<p>Seu navegador nao abriu a cena 3D. Os controles ao lado continuam ' +
      'valendo — a leitura e a mesma.</p></div>';
  }

  /* ---------- formas ---------- */

  /** Retangulo de cantos arredondados, base do canteiro. */
  function perfil(largura, altura, raio) {
    var x = largura / 2, y = altura / 2, r = Math.min(raio, x, y);
    var s = new THREE.Shape();
    s.moveTo(-x + r, -y);
    s.lineTo(x - r, -y);
    s.absarc(x - r, -y + r, r, -Math.PI / 2, 0, false);
    s.lineTo(x, y - r);
    s.absarc(x - r, y - r, r, 0, Math.PI / 2, false);
    s.lineTo(-x + r, y);
    s.absarc(-x + r, y - r, r, Math.PI / 2, Math.PI, false);
    s.lineTo(-x, -y + r);
    s.absarc(-x + r, -y + r, r, Math.PI, 1.5 * Math.PI, false);
    return s;
  }

  /**
   * Folha: duas beziers espelhadas, da base ate a ponta.
   *
   * Depois de extrudada ela e concava — cada vertice recua em z conforme se
   * afasta da nervura central. Uma folha perfeitamente plana pega a luz toda
   * de uma vez e vira uma mancha de cor sem volume.
   */
  function folha(comprimento, largura) {
    var s = new THREE.Shape();
    s.moveTo(0, 0);
    s.bezierCurveTo(comprimento * 0.22, largura, comprimento * 0.72, largura * 0.86, comprimento, 0);
    s.bezierCurveTo(comprimento * 0.72, -largura * 0.86, comprimento * 0.22, -largura, 0, 0);

    var geo = new THREE.ShapeGeometry(s, 22);
    var pos = geo.attributes.position;
    for (var i = 0; i < pos.count; i++) {
      var y = pos.getY(i);
      pos.setZ(i, -0.55 * y * y / largura);
    }
    geo.computeVertexNormals();
    return geo;
  }

  /** Halo do sol, gerado em canvas para nao depender de arquivo nenhum. */
  function halo() {
    var c = document.createElement('canvas');
    c.width = c.height = 128;
    var g = c.getContext('2d');
    var grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0.00, 'rgba(255,246,214,0.95)');
    grad.addColorStop(0.30, 'rgba(250,214,120,0.42)');
    grad.addColorStop(1.00, 'rgba(245,184,65,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }

  /* ---------- cena ---------- */

  function montar() {
    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    /*
     * Sem `outputEncoding` e sem tone mapping, de proposito.
     *
     * Esta versao do three.js (r128) nao tem gerenciamento de cor: uma cor
     * escrita em `setHex` entra crua no calculo da luz. Ligar a saida em sRGB
     * sem converter a entrada para linear clareia tudo duas vezes — a terra
     * umida, escrita em marrom escuro, saia bege de praia. As outras cenas do
     * site (a marca do fundo, o painel do TeraSmart) tambem rodam no padrao,
     * entao ficar no padrao e o que mantem as tres parecidas.
     */
    HOST.appendChild(renderer.domElement);

    var cena = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(34, 1, 0.1, 300);
    camera.position.set(0, 8.6, 28);
    camera.lookAt(0, 6.0, 0);

    // Somadas, as tres nao passam de ~1,4 na face mais iluminada: sem tone
    // mapping, o que passar de 1,0 vira branco chapado sem aviso.
    // A cor de baixo nao e preta: e o verde do cartao que a cena esta em
    // cima. E o que impede a face de tras das folhas de virar silhueta.
    cena.add(new THREE.HemisphereLight(0xD6EDE1, 0x184A33, 0.46));

    var solLuz = new THREE.DirectionalLight(0xFFF1CE, 0.95);
    solLuz.position.set(11, 16, 10);
    cena.add(solLuz);

    var contraluz = new THREE.DirectionalLight(0x8FCFB2, 0.3);
    contraluz.position.set(-14, 5, -11);
    cena.add(contraluz);

    /* --- Canteiro --- */
    var terraMat = new THREE.MeshStandardMaterial({ color: TERRA_UMIDA, roughness: 0.95 });
    var terraGeo = new THREE.ExtrudeGeometry(perfil(18, 10, 1.5), {
      depth: 6, bevelEnabled: true, bevelThickness: 0.45, bevelSize: 0.45,
      bevelSegments: 2, curveSegments: 12,
    });
    terraGeo.rotateX(-Math.PI / 2);
    var terra = new THREE.Mesh(terraGeo, terraMat);
    terra.position.y = -6;
    cena.add(terra);

    // Lamina de agua empoçada: so aparece quando o solo passa do encharcado.
    var pocaMat = new THREE.MeshStandardMaterial({
      color: 0x2E6E8E, roughness: 0.08, metalness: 0.1,
      transparent: true, opacity: 0,
    });
    var pocaGeo = new THREE.ShapeGeometry(perfil(16.6, 8.8, 1.2), 12);
    pocaGeo.rotateX(-Math.PI / 2);
    var poca = new THREE.Mesh(pocaGeo, pocaMat);
    poca.position.y = 0.06;
    cena.add(poca);

    /* --- Planta --- */
    var planta = new THREE.Group();
    cena.add(planta);

    var cauleMat = new THREE.MeshStandardMaterial({ color: CAULE_VIVO, roughness: 0.62 });
    var caule = new THREE.Mesh(new THREE.BufferGeometry(), cauleMat);
    planta.add(caule);

    var folhaMat = new THREE.MeshStandardMaterial({
      color: FOLHA_VIVA, roughness: 0.52, side: THREE.DoubleSide,
    });

    // Cada folha mora num pivo posicionado no caule: murchar e girar o pivo,
    // nao mexer na malha.
    /*
     * Os angulos alternam os lados e todos apontam para a FRENTE da cena.
     * Uma folha virada para tras fica de costas para o sol, que vem da
     * direita alta, e renderiza quase preta — parecia um buraco no meio da
     * planta, nao uma folha.
     */
    var FOLHAS = [
      { alturaNoCaule: 0.40, giroY: 3.75, comprimento: 6.2, largura: 2.4, tom: 0x3F9C63 },
      { alturaNoCaule: 0.66, giroY: -0.55, comprimento: 5.8, largura: 2.2, tom: 0x46AB6D },
      { alturaNoCaule: 0.92, giroY: 3.45, comprimento: 4.2, largura: 1.6, tom: 0x4FBB79 },
    ];

    var folhas = FOLHAS.map(function (f) {
      var pivo = new THREE.Group();
      var malha = new THREE.Mesh(folha(f.comprimento, f.largura), folhaMat.clone());
      malha.material.color.setHex(f.tom);
      malha.rotation.x = -0.30;
      pivo.add(malha);
      pivo.userData = f;
      planta.add(pivo);
      return pivo;
    });

    /* --- Sol --- */
    // Dentro do quadro de proposito: encostado na borda, o halo aditivo
    // mostrava a aresta do sprite e parecia um retangulo aceso.
    var sol = new THREE.Group();
    sol.position.set(7.0, 11.4, -5);
    cena.add(sol);
    sol.add(new THREE.Mesh(
      new THREE.SphereGeometry(1.25, 24, 18),
      new THREE.MeshBasicMaterial({ color: 0xFBE3A0 }),
    ));
    var brilhoSol = new THREE.Sprite(new THREE.SpriteMaterial({
      map: halo(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    brilhoSol.scale.setScalar(7.5);
    sol.add(brilhoSol);

    /* --- Gotas da rega --- */
    // Alongadas no eixo da queda: uma esfera perfeita cai como granizo, e a
    // leitura tem de ser "esta regando", nao "esta chovendo pedra".
    var gotaMat = new THREE.MeshStandardMaterial({
      color: 0x8FD3F0, roughness: 0.12, metalness: 0.0,
      transparent: true, opacity: 0.75,
    });
    var gotaGeo = new THREE.SphereGeometry(0.2, 10, 8);
    var gotas = [];
    for (var i = 0; i < 12; i++) {
      // Material proprio por gota: cada uma desaparece no seu tempo, e um
      // material compartilhado faria as doze piscarem juntas.
      var g = new THREE.Mesh(gotaGeo, gotaMat.clone());
      g.visible = false;
      g.scale.set(1, 2.6, 1);
      g.userData = {
        // Confinadas ao canteiro: gota caindo fora do vaso nao rega nada.
        x: (Math.random() - 0.5) * 15,
        z: (Math.random() - 0.5) * 7,
        fase: Math.random(),
        vel: 0.55 + Math.random() * 0.45,
      };
      cena.add(g);
      gotas.push(g);
    }

    /* ---------- estado ---------- */

    var estado = { estresse: 0, umidade: 0.62, encharque: 0 };
    var alvo = { estresse: 0, umidade: 0.62, encharque: 0 };

    // Instante em que a rega termina. Zero = seco de gota.
    var regandoAte = 0;

    var corFolhaViva = new THREE.Color();
    var corFolhaSeca = new THREE.Color(FOLHA_SECA);
    var corCaule = new THREE.Color();
    var corTerra = new THREE.Color();
    var terraSeca = new THREE.Color(TERRA_SECA);
    var terraUmida = new THREE.Color(TERRA_UMIDA);

    /**
     * Redesenha o caule para o estresse atual.
     *
     * A curva e refeita, e nao deformada: sao 3 pontos de controle e 40
     * segmentos, barato o bastante para caber num arraste de controle. O
     * caule tomba para o lado e encolhe conforme a planta sofre.
     */
    function moldarCaule(estresse, balanco) {
      // O tombo para em 3,8: mais que isso e as folhas atravessam o canteiro
      // em vez de cair sobre ele.
      var alturaTopo = 11.4 - 1.8 * estresse;
      var tombo = 3.8 * estresse + balanco;

      var curva = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(tombo * 0.18, alturaTopo * 0.42, 0.2),
        new THREE.Vector3(tombo * 0.62, alturaTopo * 0.76, 0.1),
        new THREE.Vector3(tombo, alturaTopo, 0),
      ]);

      caule.geometry.dispose();
      caule.geometry = new THREE.TubeGeometry(curva, 40, 0.42, 12, false);
      return { curva: curva, altura: alturaTopo };
    }

    function posicionarFolhas(forma, estresse) {
      folhas.forEach(function (pivo) {
        var f = pivo.userData;
        var ponto = forma.curva.getPointAt(f.alturaNoCaule);
        pivo.position.copy(ponto);
        pivo.rotation.set(0, f.giroY, 0);
        // Murcha: a folha cai para baixo em torno do proprio encaixe.
        pivo.rotation.z = 0.28 - 1.05 * estresse;
      });
    }

    var forma = moldarCaule(0, 0);
    posicionarFolhas(forma, 0);

    /* ---------- laco ---------- */

    var visivel = true;
    var reduzido = matchMedia('(prefers-reduced-motion: reduce)').matches;
    var relogio = new THREE.Clock();

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (linhas) {
        visivel = linhas[0].isIntersecting;
        if (visivel) laco();
      }, { rootMargin: '120px' }).observe(HOST);
    }

    function medir() {
      var l = HOST.clientWidth;
      var a = HOST.clientHeight;
      if (!l || !a) return;
      renderer.setSize(l, a, false);
      camera.aspect = l / a;
      camera.updateProjectionMatrix();
    }
    medir();
    addEventListener('resize', medir);

    var rodando = false;
    function laco() {
      if (rodando || !visivel) return;
      rodando = true;
      requestAnimationFrame(function passo() {
        rodando = false;
        if (!visivel) return;

        var t = relogio.getElapsedTime();

        // Os valores perseguem o alvo em vez de saltar: arrastar o controle
        // vira um movimento da planta, nao um corte seco.
        ['estresse', 'umidade', 'encharque'].forEach(function (k) {
          estado[k] += (alvo[k] - estado[k]) * 0.12;
        });

        var balanco = reduzido ? 0 : Math.sin(t * 0.9) * (0.34 + estado.estresse * 0.2);
        var f = moldarCaule(estado.estresse, balanco);
        posicionarFolhas(f, estado.estresse);

        corFolhaViva.setHex(FOLHA_VIVA);
        folhas.forEach(function (pivo, i) {
          var m = pivo.children[0].material;
          m.color.setHex(FOLHAS[i].tom).lerp(corFolhaSeca, estado.estresse);
        });
        corCaule.setHex(CAULE_VIVO).lerp(new THREE.Color(CAULE_SECO), estado.estresse * 0.85);
        cauleMat.color.copy(corCaule);

        // O canteiro escurece com a agua e o brilho aumenta junto.
        corTerra.copy(terraSeca).lerp(terraUmida, Math.min(1, estado.umidade * 1.15));
        terraMat.color.copy(corTerra);
        terraMat.roughness = 0.95 - 0.3 * estado.encharque;

        pocaMat.opacity = estado.encharque * 0.55;
        poca.visible = pocaMat.opacity > 0.01;

        /*
         * As gotas sao a REGA ACONTECENDO, e nao chuva de cenario.
         *
         * Antes elas caiam sempre que a umidade estava baixa, o que dizia
         * duas coisas contrarias no mesmo quadro: chovendo e solo seco. Agora
         * so aparecem no intervalo em que o sistema esta de fato molhando o
         * canteiro — quem dispara e o botao Corrigir, pelo regar().
         */
        var regando = t < regandoAte && !reduzido;
        gotas.forEach(function (g) {
          g.visible = regando;
          if (!regando) return;
          var d = g.userData;
          var p = (d.fase + t * d.vel) % 1;
          g.position.set(d.x, 14 - p * 14, d.z);
          // Some ao encostar na terra, em vez de sumir de uma vez.
          g.material.opacity = 0.75 * Math.min(1, (1 - p) * 4);
        });

        solLuz.intensity = 1.75;
            sol.position.y = 11.4 + (reduzido ? 0 : Math.sin(t * 0.5) * 0.35);

        renderer.render(cena, camera);
        laco();
      });
    }
    laco();

    /* ---------- porta de entrada ---------- */

    window.TeraPlanta = {
      /**
       * @param {object} l  { estresse, umidade, encharque } — todos 0..1
       */
      atualizar: function (l) {
        alvo.estresse = Math.max(0, Math.min(1, l.estresse));
        alvo.umidade = Math.max(0, Math.min(1, l.umidade));
        alvo.encharque = Math.max(0, Math.min(1, l.encharque));
        laco();
      },

      /** Liga a rega por alguns segundos. Chamado quando o sistema irriga. */
      regar: function (segundos) {
        regandoAte = relogio.getElapsedTime() + (segundos || 1.8);
        laco();
      },
    };

    // O index.js roda antes do three.js e ja tentou publicar um estado;
    // se tentou, ele fica guardado aqui e e aplicado agora.
    if (window.TeraPlantaPendente) {
      window.TeraPlanta.atualizar(window.TeraPlantaPendente);
      window.TeraPlantaPendente = null;
    }
  }

  espera();
})();
