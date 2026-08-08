/* ==========================================================================
   TeraBoard · TeraSensor — modelo 3D do aparelho, sonda e cabos
   ========================================================================== */

/* ===== TeraSensor 3D — aparelho + sonda + cabos (modelo Gemini) ===== */
(function(){
  var HOST = document.getElementById('deviceStage');
  if (!HOST) return;

  /* espera as bibliotecas: OrbitControls e SVGLoader carregam depois do three,
     e podem chegar atrasados. Sem essa espera, o modelo quebrava no meio e o
     palco ficava vazio (era o bug do "aparelho nao apareceu"). */
  var tentativas = 0;
  function pronto(){
    return typeof THREE !== 'undefined' && THREE.SVGLoader && THREE.OrbitControls;
  }
  function iniciar(){
    if (!pronto()){
      if (tentativas++ < 120){ return setTimeout(iniciar, 80); }  // ate ~10s
      console.error('3D TeraSensor: bibliotecas 3D nao carregaram');
      return;
    }
    window.__HOST3D = HOST;
    try {


        let scene, camera, renderer, controls, sensor, ambientLight, dirLight, sticker, telaMesh, probeGroup, orgGroup, mainBody;
        const hitboxes = [];
        let toastTimeout;

        let maquinaEstado = 'DESLIGADO';
        function setEstado(e){ maquinaEstado = e; if(typeof atualizaGuia==='function') atualizaGuia(e); }
        let bloqueiaClique = false;
        let dispositivoAtivado = false; // so vira true no primeiro clique no aparelho

        let looseCable1, looseCable2;
        let localPt0, localPtEnd;

        // Posições finais definidas para as pontas dos cabos
        const offsetsCabos = {
            sensorX: 0.0000, sensorY: -3.2200, sensorZ: 0.0200,
            sondaX: 0.0000, sondaY: -0.5600, sondaZ: 0.0000
        };

        // ===== card-guia + controle do giro conforme o estado =====
        var GUIA = {
          'DESLIGADO':        {p:'Passo 1 de 4', ic:'ph-power',        t:'Ligue o aparelho',        d:'Toque no botão de <strong>power</strong> (o redondo, embaixo) para iniciar. A sonda desce e a leitura começa.', cta:'Clique no power'},
          'STANDBY':          {p:'Passo 1 de 4', ic:'ph-power',        t:'Ligue novamente',         d:'Toque no <strong>power</strong> para reiniciar o ciclo de leitura.', cta:'Clique no power'},
          'BOOTING':          {p:'Iniciando…',   ic:'ph-spinner-gap',  t:'Ligando o sistema',       d:'A sonda está descendo ao solo. Aguarde um instante.', cta:''},
          'AO_VIVO_1':        {p:'Passo 2 de 4', ic:'ph-floppy-disk',  t:'Salve a 1ª leitura',      d:'O sensor está lendo ao vivo. Toque no <strong>botão verde de cima</strong> para salvar a leitura.', cta:'Botão verde superior'},
          'AO_VIVO_2':        {p:'Passo 2 de 4', ic:'ph-floppy-disk',  t:'Salve a 2ª leitura',      d:'Mova o aparelho para outro ponto e toque de novo no <strong>botão verde de cima</strong>.', cta:'Botão verde superior'},
          'AO_VIVO_3':        {p:'Passo 2 de 4', ic:'ph-floppy-disk',  t:'Salve a 3ª leitura',      d:'Última medição. Toque no <strong>botão verde de cima</strong> para salvar.', cta:'Botão verde superior'},
          'ESPERANDO_SALVOS': {p:'Passo 3 de 4', ic:'ph-list-magnifying-glass', t:'Reveja os dados', d:'As três leituras foram salvas. Use o <strong>botão verde de baixo</strong> para revê-las uma a uma.', cta:'Botão verde inferior'},
          'SALVO_1':          {p:'Passo 4 de 4', ic:'ph-check-circle', t:'Lote 1 de 3',            d:'Mostrando a 1ª leitura salva. Toque no <strong>botão verde de baixo</strong> para a próxima.', cta:'Botão verde inferior'},
          'SALVO_2':          {p:'Passo 4 de 4', ic:'ph-check-circle', t:'Lote 2 de 3',            d:'Mostrando a 2ª leitura. Toque no <strong>botão verde de baixo</strong> para a próxima.', cta:'Botão verde inferior'},
          'SALVO_3':          {p:'Concluído',    ic:'ph-check-circle', t:'Ciclo completo',         d:'Você viu as três leituras. Toque no <strong>power</strong> para encerrar ou recomeçar.', cta:'Clique no power'}
        };
        function atualizaGuia(estado){
          var g = GUIA[estado]; if(!g) return;
          var card=document.getElementById('deviceGuide');
          var S=document.getElementById('dgStep'), T=document.getElementById('dgTitle'),
              D=document.getElementById('dgDesc');
          if(S) S.textContent=g.p;
          if(T) T.innerHTML='<i class="ph-fill '+g.ic+'"></i> '+g.t;
          if(D) D.innerHTML=g.d + (g.cta ? '<span class="dg-cta"><i class="ph-bold ph-arrow-right"></i> '+g.cta+'</span>' : '');
          // "aceso" enquanto o aparelho esta em uso
          var ativo = (estado!=='DESLIGADO' && estado!=='STANDBY');
          if(card) card.classList.toggle('on', ativo);
          // GIRO: desliga quando ligado; religa so no repouso
          if(window.__setAutoRotate) window.__setAutoRotate(!ativo);
        }
        // showMessage e chamado em toda transicao -> aproveitamos para atualizar o guia
        function showMessage(){ atualizaGuia(maquinaEstado); }

        // ===== ativacao: o aparelho so gira (sem acao) ate o 1o clique nele =====
        // ao clicar, o HERO INTEIRO se reorganiza para o modo demonstracao:
        // aparelho grande a esquerda, painel (guia + espelho da tela) grande a
        // direita. so entao os botoes (power / verde) passam a responder.
        var heroGridEl = document.getElementById('heroGrid');
        function ativarInteracao(){
          if (dispositivoAtivado) return;
          dispositivoAtivado = true;
          var hint = document.getElementById('deviceIdleHint');
          var espelho = document.getElementById('screenMirrorImg');
          if (espelho && typeof telasUrls !== 'undefined') espelho.src = telasUrls['TELA LIGANDO'];
          if (hint) hint.classList.add('hide');

          // 1) dispara o FLASHZAO primeiro
          var secao = document.querySelector('.hero-ts');
          if (secao){
            secao.classList.remove('flash');
            void secao.offsetWidth;              // reinicia a animacao
            secao.classList.add('flash');
            setTimeout(function(){ secao.classList.remove('flash'); }, 1150);
          }

          // 2) troca o layout NO PICO do flash (tela lavada esconde o "pulo").
          //    o keyframe estoura em ~14% de .62s (~90ms) e segura ate ~40% (~250ms).
          var trocar = function(){
            if (heroGridEl) heroGridEl.classList.add('demo');
            atualizaGuia(maquinaEstado);
            if (typeof reenquadrar3D === 'function'){
              reenquadrar3D();
              setTimeout(reenquadrar3D, 60);
            }
          };
          var reduz = matchMedia('(prefers-reduced-motion: reduce)').matches;
          setTimeout(trocar, reduz ? 140 : 230);
        }

        // volta ao estado inicial (marketing) e zera a maquina de estados
        function resetarDemo(){
          if (!dispositivoAtivado) return;
          dispositivoAtivado = false;
          bloqueiaClique = false;
          setEstado('DESLIGADO');
          if (typeof atualizarTelaVisual === 'function') atualizarTelaVisual('TELA LIGANDO');
          if (typeof probeGroup !== 'undefined' && probeGroup) probeGroup.position.y = -1.1900;
          var hint = document.getElementById('deviceIdleHint');
          // mesmo flashzao na volta, escondendo a troca de layout
          var secao = document.querySelector('.hero-ts');
          if (secao){
            secao.classList.remove('flash'); void secao.offsetWidth; secao.classList.add('flash');
            setTimeout(function(){ secao.classList.remove('flash'); }, 1150);
          }
          var reduz = matchMedia('(prefers-reduced-motion: reduce)').matches;
          setTimeout(function(){
            if (heroGridEl) heroGridEl.classList.remove('demo');
            if (hint) hint.classList.remove('hide');
            if (typeof reenquadrar3D === 'function'){ reenquadrar3D(); setTimeout(reenquadrar3D, 60); }
          }, reduz ? 140 : 230);
        }

        function createPillShape(width, height) {
            const shape = new THREE.Shape();
            const r = width / 2;
            const h = height / 2 - r;
            shape.moveTo(-r, h);
            shape.arc(r, 0, r, Math.PI, 0, true);
            shape.lineTo(r, -h);
            shape.arc(-r, 0, r, 0, -Math.PI, true);
            shape.lineTo(-r, h);
            return shape;
        }

        function createButterflyShape(width, height) {
            const shape = new THREE.Shape();
            const w = width;
            const h = height;
            const r = w / 2;
            const halfH = h / 2 - r;
            
            shape.moveTo(-r, halfH);
            shape.arc(r, 0, r, Math.PI, 0, true); 
            
            shape.bezierCurveTo( r, halfH * 0.4, r * 0.35, halfH * 0.3, r * 0.35, 0 );
            shape.bezierCurveTo( r * 0.35, -halfH * 0.3, r, -halfH * 0.4, r, -halfH );

            shape.arc(-r, 0, r, 0, -Math.PI, true); 

            shape.bezierCurveTo( -r, -halfH * 0.4, -r * 0.35, -halfH * 0.3, -r * 0.35, -0.15 );
            shape.bezierCurveTo( -r * 0.8, -0.15, -r * 0.8, 0.15, -r * 0.35, 0.15 );
            shape.bezierCurveTo( -r * 0.35, halfH * 0.3, -r, halfH * 0.4, -r, halfH );

            return shape;
        }

        function pressButtonEffect(name){
            var matches = hitboxes.filter(function(m){ return m.name === name; });
            matches.forEach(function(m){
                if (m.userData.origZ === undefined) m.userData.origZ = m.position.z;
                gsap.killTweensOf(m.position);
                gsap.to(m.position, {
                    z: m.userData.origZ - 300,
                    duration: 0.08,
                    ease: 'power2.out',
                    onComplete: function(){
                        gsap.to(m.position, { z: m.userData.origZ, duration: 0.32, ease: 'elastic.out(1,0.5)' });
                    }
                });
                if (m.material && m.material.emissive){
                    gsap.killTweensOf(m.material);
                    m.material.emissive.setHex(0xffffff);
                    m.material.emissiveIntensity = 0.65;
                    gsap.to(m.material, { emissiveIntensity: 0, duration: 0.35, ease: 'power2.out' });
                }
            });
        }

        function init() {
            scene = new THREE.Scene();
            scene.background = null;

            camera = new THREE.PerspectiveCamera(45, HOST.clientWidth / HOST.clientHeight, 0.1, 100);
            camera.position.set(0, 0, 15);

            renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
            renderer.setClearColor(0x000000, 0);
            renderer.setSize(HOST.clientWidth, HOST.clientHeight);
            renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.75)); 
            HOST.appendChild(renderer.domElement);

            controls = new THREE.OrbitControls(camera, renderer.domElement);
            controls.enableDamping = true;
            controls.dampingFactor = 0.05;

            ambientLight = new THREE.AmbientLight(0xffffff, 0.72);
            scene.add(ambientLight);
            
            dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
            dirLight.position.set(5, 5, 8);
            scene.add(dirLight);

            const backLight = new THREE.DirectionalLight(0x1DC78B, 0.5);
            backLight.position.set(-5, 5, -8);
            scene.add(backLight);

            const chassisSvg = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4807.98 8975.03">
             <path d="M2383.93 4.56l40.11 0 6.04 0 0 0.19c570.59,17.92 1142.97,52.17 1720.3,130.59 320.78,43.58 505.41,63.29 607.19,501.87 281.78,3108.55 -815.92,4272.49 -813.21,4419.02l63.94 3441.13c-9.62,232.09 -107.56,351.61 -387.69,382.65 -340.95,37.78 -782.57,103.44 -1190.52,88.24l0 0.01 -46.15 0 0 -0.23c-409.62,16.08 -853.93,-50.06 -1196.57,-88.02 -280.12,-31.03 -378.07,-150.56 -387.69,-382.65l63.94 -3441.13c2.72,-146.53 -1094.99,-1310.47 -813.21,-4419.02 101.78,-438.58 286.41,-458.29 607.2,-501.87 579.36,-78.7 1153.75,-112.91 1726.34,-130.78l-0.01 0z"/>
            </svg>`;
            
            const svgLoader = new THREE.SVGLoader();
            const chassisData = svgLoader.parse(chassisSvg);
            const chassisShape = chassisData.paths[0].toShapes(true)[0];

            const chassisGeo = new THREE.ExtrudeGeometry(chassisShape, {
                depth: 1200, bevelEnabled: true, bevelSegments: 4, steps: 1, bevelSize: 25, bevelThickness: 30
            });
            chassisGeo.center(); 
            chassisGeo.rotateZ(Math.PI);
            
            const scaleFactor = 0.0008; 
            chassisGeo.scale(scaleFactor, scaleFactor, scaleFactor);
            chassisGeo.computeBoundingBox();
            
            const box = chassisGeo.boundingBox;
            const width = box.max.x - box.min.x;
            const height = box.max.y - box.min.y;
            const frontZ = box.max.z;

            const uv = chassisGeo.attributes.uv;
            const pos = chassisGeo.attributes.position;
            for (let i = 0; i < uv.count; i++) {
                uv.setXY(i, (pos.getX(i) - box.min.x) / width, (pos.getY(i) - box.min.y) / height);
            }

            const stickerMat = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.1, transparent: true, alphaTest: 0.05 });
            sticker = new THREE.Mesh(new THREE.PlaneGeometry(width, height), stickerMat);
            sticker.scale.set(0.78, 0.78, 1);
            sticker.position.set(-0.056, -0.132, frontZ + 0.005); 

            const textureLoader = new THREE.TextureLoader();
            textureLoader.crossOrigin = "Anonymous"; 
            
            textureLoader.load('assets/img/produtos/terasensor-capa-verde.webp', function(tex) {
                tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
                stickerMat.map = tex;
                stickerMat.needsUpdate = true;
                const proporcaoOriginal = tex.image.height / tex.image.width;
                sticker.geometry.dispose(); 
                sticker.geometry = new THREE.PlaneGeometry(width, width * proporcaoOriginal);
            });

            // ATUALIZADO: Cor da capa corrigida para preto absoluto acetinado
            const blackMaterial = new THREE.MeshStandardMaterial({ color: 0x080808, roughness: 0.4, metalness: 0.1 }); 
            mainBody = new THREE.Mesh(chassisGeo, blackMaterial);

            const orgDims = { zBack: -0.65, zFront: 0.65, height: 4.2, width: 1.4 };
            orgGroup = new THREE.Group();
            const orgMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2a2d, roughness: 0.6, metalness: 0.1, side: THREE.DoubleSide });

            const backShape = createPillShape(orgDims.width, orgDims.height);
            const backGeo = new THREE.ExtrudeGeometry(backShape, { depth: 0.12, curveSegments: 128, bevelEnabled: true, bevelSegments: 16, bevelSize: 0.04, bevelThickness: 0.04 });
            backGeo.center();
            const backMesh = new THREE.Mesh(backGeo, orgMaterial);
            backMesh.position.z = orgDims.zBack;
            orgGroup.add(backMesh);

            const neckGeo = new THREE.BoxGeometry(0.7, 1.0, (orgDims.zFront - orgDims.zBack), 32, 32, 32);
            const neckMesh = new THREE.Mesh(neckGeo, orgMaterial);
            neckMesh.position.z = (orgDims.zFront + orgDims.zBack) / 2;
            orgGroup.add(neckMesh);

            const frontShape = createButterflyShape(orgDims.width, orgDims.height);
            const frontExtrudeSettings = { depth: 0.12, curveSegments: 128, bevelEnabled: true, bevelSegments: 16, bevelSize: 0.05, bevelThickness: 0.05 };
            const frontGeo = new THREE.ExtrudeGeometry(frontShape, frontExtrudeSettings);
            frontGeo.center();
            
            const posOrg = frontGeo.attributes.position;
            const maxY = orgDims.height / 2;
            for (let i = 0; i < posOrg.count; i++) {
                let y = posOrg.getY(i);
                let z = posOrg.getZ(i);
                let curve = Math.pow(Math.abs(y) / maxY, 2.0); 
                posOrg.setZ(i, z - curve * 0.7);
            }
            frontGeo.computeVertexNormals(); 
            const frontMesh = new THREE.Mesh(frontGeo, orgMaterial);
            frontMesh.position.z = orgDims.zFront;
            orgGroup.add(frontMesh);

            const points = [];
            const turns = 3.0;
            const radiusX = 0.5;
            const radiusY = 1.0;
            const zStart = orgDims.zBack + 0.3;
            const zEnd = orgDims.zFront - 0.3;
            const segments = 150;
            for (let i = 0; i <= segments; i++) {
                const t = i / segments;
                const angle = t * Math.PI * 2 * turns;
                const x = Math.cos(angle) * radiusX;
                const y = Math.sin(angle) * radiusY;
                const z = THREE.MathUtils.lerp(zStart, zEnd, t);
                points.push(new THREE.Vector3(x, y, z));
            }
            const curve = new THREE.CatmullRomCurve3(points);
            // Cor do fio ajustada conforme pedido
            const tubeMat = new THREE.MeshStandardMaterial({ color: 0x282929, roughness: 0.8 });
            const tubeGeo = new THREE.TubeGeometry(curve, 200, 0.08, 16, false);
            orgGroup.add(new THREE.Mesh(tubeGeo, tubeMat));

            localPt0 = points[0].clone();
            localPtEnd = points[points.length - 1].clone();

            looseCable1 = new THREE.Mesh(new THREE.BufferGeometry(), tubeMat);
            looseCable2 = new THREE.Mesh(new THREE.BufferGeometry(), tubeMat);
            scene.add(looseCable1);
            scene.add(looseCable2);

            // CÓDIGO DO ORGANIZADOR DE CABOS APLICADO
            orgGroup.scale.set(0.7000, 0.7000, 0.7000);
            orgGroup.position.set(0.0000, 2.0300, -0.9600);
            orgGroup.rotation.set(-3.1400, 0.0000, 1.5700);

            sensor = new THREE.Group();
            sensor.add(mainBody);
            sensor.add(sticker);
            sensor.add(orgGroup);

            const telasUrls = {
                'TELA LIGANDO': 'assets/img/telas/tela-ligando.webp',
                'DESLIGADO': 'assets/img/telas/tela-desligado.webp',
                'AO VIVO 1': 'assets/img/telas/ao-vivo-1.webp',
                'AO VIVO 2': 'assets/img/telas/ao-vivo-2.webp',
                'AO VIVO 3': 'assets/img/telas/ao-vivo-3.webp',
                'SALVANDO': 'assets/img/telas/salvando.webp',
                'SALVO 1': 'assets/img/telas/salvo-1.webp',
                'SALVO 2': 'assets/img/telas/salvo-2.webp',
                'SALVO 3': 'assets/img/telas/salvo-3.webp'
            };

            const texturasTelas = {};
            // vitrine ociosa mostra a TELA-LIGANDO (antes: DESLIGADO / "Aperte o botão Power")
            let telaAtiva = 'TELA LIGANDO'; 

            const telaMat = new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.05, color: 0xffffff });
            telaMesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width), telaMat);
            telaMesh.scale.set(0.585, 0.585, 1);
            telaMesh.position.set(-0.059, 1.74, frontZ + 0.007);
            sensor.add(telaMesh);

            window.atualizarTelaVisual = function(nome) {
                const tex = texturasTelas[nome];
                if(tex && tex.image) {
                    telaMat.map = tex;
                    telaMat.needsUpdate = true;
                    const proporcao = tex.image.height / tex.image.width;
                    telaMesh.geometry.dispose();
                    telaMesh.geometry = new THREE.PlaneGeometry(width, width * proporcao);
                }
                // espelho 2D (card lateral): mesma imagem, sempre que a tela do aparelho muda
                const espelho = document.getElementById('screenMirrorImg');
                if (espelho && telasUrls[nome]) espelho.src = telasUrls[nome];
            }

            Object.keys(telasUrls).forEach(nome => {
                textureLoader.load(telasUrls[nome], function(tex) {
                    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
                    texturasTelas[nome] = tex;
                    if(nome === telaAtiva) atualizarTelaVisual(nome); 
                });
            });

            const buttonsSvg = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2006.09 5264.55">
             <g>
              <path fill="#FEFEFE" d="M653.37 0l1171.4 0c99.72,0 181.32,81.59 181.32,181.31l0 2267.14c0,99.72 -81.59,181.31 -181.32,181.31l-1171.4 0c-99.72,0 -181.32,-81.59 -181.32,-181.31l0 -2267.14c0,-99.72 81.59,-181.31 181.32,-181.31z"/>
              <path fill="#1EC78C" d="M1456.65 1752.99c166.89,0 302.19,135.3 302.19,302.19 0,166.89 -135.3,302.18 -302.19,302.18 -166.89,0 -302.19,-135.29 -302.19,-302.18 0,-166.89 135.3,-302.19 302.19,-302.19zm0 -1480.61c166.89,0 302.19,135.3 302.19,302.19 0,166.89 -135.3,302.19 -302.19,302.19 -166.89,0 -302.19,-135.3 -302.19,-302.19 0,-166.89 135.3,-302.19 302.19,-302.19zm0 -92.17c108.88,0 207.47,44.15 278.85,115.52 71.37,71.37 115.52,169.96 115.52,278.85 0,108.89 -44.15,207.48 -115.52,278.84 -71.36,71.37 -169.96,115.52 -278.85,115.52 -108.89,0 -207.49,-44.15 -278.85,-115.52 -71.37,-71.36 -115.52,-169.95 -115.52,-278.84 0,-108.89 44.15,-207.48 115.52,-278.85 71.37,-71.37 169.96,-115.52 278.85,-115.52z"/>
             </g>
             <circle fill="#96989A" cx="368.77" cy="4895.78" r="362.63"/>
             <circle fill="#D2D3D5" cx="368.77" cy="4895.78" r="333.78"/>
             <circle fill="#E6E7E8" cx="368.77" cy="4895.78" r="286.54"/>
             <path fill="#606062" d="M368.74 5028.63c-5.58,-0.01 -11.18,-0.41 -16.69,-1.16 -10.47,-1.44 -20.76,-4.22 -30.55,-8.22 -20.41,-8.4 -38.23,-22.12 -51.55,-39.71 -6.75,-8.82 -12.3,-18.57 -16.42,-28.88 -5.84,-14.63 -8.84,-30.29 -8.84,-46.06 0,-27.18 8.94,-53.66 25.39,-75.29 6.75,-8.89 14.72,-16.84 23.6,-23.58 2.97,-2.09 6.5,-3.21 10.12,-3.21 9.68,0 17.53,7.85 17.53,17.53 0,5.25 -2.35,10.23 -6.42,13.56 -6.35,4.8 -12.06,10.5 -16.9,16.83 -4.68,6.16 -8.58,12.95 -11.55,20.11 -2.9,7.04 -4.9,14.45 -5.92,21.99 -0.54,4 -0.82,8.06 -0.82,12.11 0,11.32 2.18,22.56 6.38,33.06 2.95,7.37 6.91,14.33 11.74,20.63 4.83,6.38 10.53,12.09 16.89,16.95 6.16,4.69 12.92,8.58 20.06,11.53 7.07,2.89 14.51,4.9 22.07,5.95 3.91,0.54 7.9,0.82 11.85,0.82 3.62,0 7.23,-0.25 10.82,-0.69 7.71,-0.98 15.28,-2.95 22.48,-5.83 14.85,-6.02 27.87,-15.92 37.63,-28.63 9.35,-12.23 15.34,-26.72 17.37,-41.97 0.54,-3.98 0.82,-8.01 0.82,-12.03 0,-3.58 -0.22,-7.16 -0.65,-10.71 -0.97,-7.69 -2.95,-15.26 -5.84,-22.45 -2.98,-7.42 -6.97,-14.44 -11.82,-20.8 -4.81,-6.33 -10.48,-12.02 -16.81,-16.83 -4.71,-3.28 -7.52,-8.66 -7.52,-14.4 0,-9.68 7.85,-17.53 17.53,-17.53 4.05,0 7.97,1.4 11.1,3.96 8.87,6.73 16.84,14.7 23.57,23.59 6.77,8.87 12.35,18.68 16.5,29.05 4,9.96 6.72,20.46 8.06,31.1 0.6,4.97 0.91,9.99 0.91,14.99 0,50.71 -30.85,96.34 -77.89,115.24 -9.95,3.97 -20.41,6.69 -31.06,8.02 -5.03,0.63 -10.1,0.95 -15.16,0.95l0.01 -0.01zm0.03 -127.46c0,0 0,0 0,0 -9.67,0 -17.53,-7.84 -17.53,-17.52l0 -103.19c0,-9.68 7.85,-17.54 17.53,-17.54 9.68,0 17.54,7.85 17.54,17.54l0 103.19c0,9.68 -7.85,17.54 -17.54,17.54l0 -0.02z"/>
            </svg>`;

            const buttonsData = svgLoader.parse(buttonsSvg);
            const buttonsGroup = new THREE.Group();

            buttonsData.paths.forEach((path, index) => {
                let fillColor = path.userData.style.fill || "#888888";
                fillColor = fillColor.toUpperCase();
                if (fillColor === '#FEFEFE' || fillColor === '#FFFFFF') return; 
                
                const btnMat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setStyle(fillColor), roughness: 0.2, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
                const shapes = path.toShapes(true);
                const zBtn = index * 2;   // um plano por COR (nao por forma/letra)
                shapes.forEach((shape) => {
                    const btnGeo = new THREE.ExtrudeGeometry(shape, { depth: 250, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 10, bevelThickness: 15 });
                    const mesh = new THREE.Mesh(btnGeo, btnMat);
                    // separacao MINIMA por cor (invisivel, so p/ o z-buffer)
                    mesh.position.z += zBtn;
                    
                    if (fillColor === '#1EC78C' || fillColor === '#0B4D36') {
                        mesh.geometry.computeBoundingBox();
                        if (((mesh.geometry.boundingBox.max.y + mesh.geometry.boundingBox.min.y) / 2) < 1000) mesh.name = 'Botão Verde Superior';
                        else mesh.name = 'Botão Verde Inferior';
                        hitboxes.push(mesh);
                    } else if (fillColor === '#96989A' || fillColor === '#D2D3D5' || fillColor === '#E6E7E8' || fillColor === '#606062') {
                        mesh.name = 'Botão Power';
                        hitboxes.push(mesh);
                    }
                    buttonsGroup.add(mesh);
                });
            });

            const btnBbox = new THREE.Box3().setFromObject(buttonsGroup);
            const cx = (btnBbox.max.x + btnBbox.min.x) / 2;
            const cy = (btnBbox.max.y + btnBbox.min.y) / 2;
            buttonsGroup.children.forEach(child => { child.geometry.translate(-cx, -cy, 0); });

            buttonsGroup.scale.set(0.00059, -0.00059, 0.00059);
            buttonsGroup.position.set(-0.32, -1.65, frontZ + 0.01);
            sensor.add(buttonsGroup);

            const probeSvgRaw = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1457.07 2908.03">
             <g>
              <rect fill="#3DB988" x="120.19" y="529.04" width="1212.54" height="1580.92" rx="215.4" ry="219"/>
              <g>
               <polygon fill="#004024" points="204.17,1452.17 317.07,1452.17 317.07,1473.31 272.15,1473.31 272.15,1616.56 249.1,1616.56 249.1,1473.31 204.17,1473.31 "/>
               <path fill="#004024" d="M330.06 1566.54c0.92,4.85 2.57,9.43 4.95,13.74 2.38,4.31 5.34,8.06 8.87,11.27 3.53,3.21 7.49,5.71 11.87,7.51 4.38,1.8 9.1,2.7 14.16,2.7 6.76,0 12.94,-1.68 18.55,-5.05 5.6,-3.37 10.41,-7.87 14.4,-13.51l18.43 10.8c-5.83,8.46 -13.29,15.19 -22.35,20.2 -9.06,5.01 -18.89,7.51 -29.49,7.51 -8.6,0 -16.67,-1.64 -24.19,-4.93 -7.53,-3.29 -14.1,-7.83 -19.7,-13.62 -5.61,-5.79 -10.02,-12.52 -13.25,-20.2 -3.23,-7.67 -4.84,-15.89 -4.84,-24.65 0,-8.77 1.61,-16.99 4.84,-24.66 3.22,-7.67 7.64,-14.4 13.25,-20.2 5.6,-5.79 12.17,-10.33 19.7,-13.62 7.53,-3.28 15.51,-4.93 23.96,-4.93 8.45,0 16.4,1.65 23.85,4.93 7.45,3.29 13.98,7.75 19.58,13.39 5.6,5.64 10.02,12.21 13.25,19.73 3.23,7.52 4.84,15.43 4.84,23.72 0,2.82 -1.03,5.17 -3.11,7.04 -2.07,1.88 -4.64,2.82 -7.72,2.82l-89.86 0zm77.65 -18.09c-1.08,-4.7 -2.77,-9.08 -5.07,-13.15 -2.3,-4.07 -5.07,-7.63 -8.29,-10.68 -3.23,-3.05 -6.91,-5.45 -11.06,-7.17 -4.15,-1.72 -8.53,-2.58 -13.14,-2.58 -4.92,0 -9.56,0.86 -13.94,2.58 -4.38,1.72 -8.29,4.11 -11.75,7.17 -3.45,3.05 -6.37,6.61 -8.75,10.68 -2.38,4.07 -4.11,8.45 -5.18,13.15l77.19 0z"/>
               <path fill="#004024" d="M503.11 1515.35c-5.07,0 -9.76,0.86 -14.06,2.58 -4.3,1.72 -8.03,4.07 -11.18,7.04 -3.15,2.98 -5.65,6.46 -7.49,10.45 -1.84,3.99 -2.77,8.26 -2.77,12.8l0 68.34 -21.89 0 0 -117.42 21.89 0 0 14.09c4.61,-5.48 9.83,-9.82 15.67,-13.03 5.84,-3.21 12.44,-4.81 19.82,-4.81l0 19.96z"/>
               <path fill="#004024" d="M507.95 1558.32c0,-8.77 1.53,-16.99 4.61,-24.66 3.07,-7.67 7.25,-14.4 12.55,-20.2 5.3,-5.79 11.52,-10.33 18.66,-13.62 7.15,-3.28 14.79,-4.93 22.93,-4.93 8.14,0 15.75,1.65 22.81,4.93 7.07,3.29 13.29,7.83 18.66,13.62l0 -14.32 21.89 0 0 117.42 -21.89 0 0 -13.39c-5.38,5.79 -11.6,10.33 -18.66,13.62 -7.07,3.29 -14.67,4.93 -22.81,4.93 -8.14,0 -15.78,-1.64 -22.93,-4.93 -7.14,-3.29 -13.36,-7.83 -18.66,-13.62 -5.3,-5.79 -9.48,-12.52 -12.55,-20.2 -3.08,-7.67 -4.61,-15.89 -4.61,-24.65zm21.89 -0.24c0,5.79 1.04,11.36 3.11,16.68 2.07,5.32 4.88,9.98 8.41,13.97 3.53,3.99 7.72,7.16 12.56,9.51 4.84,2.35 10.02,3.52 15.55,3.52 5.38,0 10.41,-1.18 15.09,-3.52 4.69,-2.35 8.75,-5.52 12.21,-9.51 3.46,-3.99 6.22,-8.65 8.29,-13.97 2.08,-5.32 3.11,-10.88 3.11,-16.68 0,-5.79 -1.03,-11.27 -3.11,-16.44 -2.07,-5.17 -4.84,-9.75 -8.29,-13.74 -3.46,-3.99 -7.53,-7.16 -12.21,-9.51 -4.68,-2.35 -9.71,-3.52 -15.09,-3.52 -5.53,0 -10.71,1.18 -15.55,3.52 -4.84,2.35 -9.03,5.52 -12.56,9.51 -3.53,3.99 -6.34,8.57 -8.41,13.74 -2.07,5.17 -3.11,10.65 -3.11,16.44z"/>
               <path fill="#004024" d="M772.93 1558.32c0,8.77 -1.53,16.99 -4.61,24.65 -3.07,7.68 -7.26,14.41 -12.56,20.2 -5.3,5.79 -11.52,10.33 -18.66,13.62 -7.14,3.29 -14.79,4.93 -22.93,4.93 -8.14,0 -15.75,-1.64 -22.81,-4.93 -7.07,-3.29 -13.29,-7.83 -18.66,-13.62l0 13.39 -21.89 0 0 -164.62 21.89 0 0 61.53c5.38,-5.79 11.6,-10.33 18.66,-13.62 7.07,-3.28 14.67,-4.93 22.81,-4.93 8.14,0 15.78,1.65 22.93,4.93 7.14,3.29 13.36,7.83 18.66,13.62 5.3,5.79 9.49,12.53 12.56,20.2 3.07,7.67 4.61,15.89 4.61,24.66zm-21.89 -0.24c0,-5.79 -1.03,-11.27 -3.11,-16.44 -2.08,-5.17 -4.88,-9.75 -8.41,-13.74 -3.53,-3.99 -7.72,-7.16 -12.56,-9.51 -4.84,-2.35 -10.02,-3.52 -15.55,-3.52 -5.22,0 -10.21,1.18 -14.97,3.52 -4.76,2.35 -8.87,5.52 -12.33,9.51 -3.46,3.99 -6.23,8.57 -8.3,13.74 -2.07,5.17 -3.11,10.65 -3.11,16.44 0,5.79 1.04,11.36 3.11,16.68 2.07,5.32 4.84,9.98 8.3,13.97 3.46,3.99 7.56,7.16 12.33,9.51 4.76,2.35 9.75,3.52 14.97,3.52 5.53,0 10.71,-1.18 15.55,-3.52 4.84,-2.35 -9.03,-5.52 12.56,-9.51 3.54,-3.99 6.34,-8.65 8.41,-13.97 2.07,-5.32 3.11,-10.88 3.11,-16.68z"/>
               <path fill="#004024" d="M782.16 1558.32c0,-8.77 1.65,-16.99 4.95,-24.66 3.3,-7.67 7.83,-14.4 13.59,-20.2 5.76,-5.79 12.48,-10.33 20.16,-13.62 7.68,-3.28 15.9,-4.93 24.65,-4.93 8.76,0 16.97,1.65 24.65,4.93 7.68,3.29 14.4,7.83 20.16,13.62 5.76,5.79 10.29,12.53 13.59,20.2 3.3,7.67 4.95,15.89 4.95,24.66 0,8.77 -1.65,16.99 -4.95,24.65 -3.3,7.68 -7.83,14.41 -13.59,20.2 -5.76,5.79 -12.48,10.33 -20.16,13.62 -7.68,3.29 -15.9,4.93 -24.65,4.93 -8.75,0 -16.97,-1.64 -24.65,-4.93 -7.68,-3.29 -14.4,-7.83 -20.16,-13.62 -5.76,-5.79 -10.29,-12.52 -13.59,-20.2 -3.3,-7.67 -4.95,-15.89 -4.95,-24.65zm21.89 -0.24c0,5.79 1.08,11.36 3.23,16.68 2.15,5.32 5.11,9.98 8.87,13.97 3.77,3.99 8.22,7.16 13.36,9.51 5.15,2.35 10.64,3.52 16.47,3.52 5.68,0 11.02,-1.18 16.01,-3.52 4.99,-2.35 9.33,-5.52 13.02,-9.51 3.69,-3.99 6.6,-8.65 8.76,-13.97 2.15,-5.32 3.22,-10.88 3.22,-16.68 0,-5.79 -1.08,-11.27 -3.22,-16.44 -2.15,-5.17 -5.07,-9.75 -8.76,-13.74 -3.69,-3.99 -8.03,-7.16 -13.02,-9.51 -4.99,-2.35 -10.33,-3.52 -16.01,-3.52 -5.84,0 -11.33,1.18 -16.47,3.52 -5.15,2.35 -9.6,5.52 -13.36,9.51 -3.77,3.99 -6.72,8.57 -8.87,13.74 -2.15,5.17 -3.23,10.65 -3.23,16.44z"/>
               <path fill="#004024" d="M918.11 1558.32c0,-8.77 1.53,-16.99 4.61,-24.66 3.07,-7.67 7.25,-14.4 12.55,-20.2 5.3,-5.79 11.52,-10.33 18.66,-13.62 7.15,-3.28 14.79,-4.93 22.93,-4.93 8.14,0 15.75,1.65 22.81,4.93 7.07,3.29 13.29,7.83 18.66,13.62l0 -14.32 21.89 0 0 117.42 -21.89 0 0 -13.39c-5.38,5.79 -11.6,10.33 -18.66,13.62 -7.07,3.29 -14.67,4.93 -22.81,4.93 -8.14,0 -15.78,-1.64 -22.93,-4.93 -7.14,-3.29 -13.36,-7.83 -18.66,-13.62 -5.3,-5.79 -9.48,-12.52 -12.55,-20.2 -3.08,-7.67 -4.61,-15.89 -4.61,-24.65zm21.89 -0.24c0,5.79 1.04,11.36 3.11,16.68 2.07,5.32 4.88,9.98 8.41,13.97 3.53,3.99 7.72,7.16 12.56,9.51 4.84,2.35 10.02,3.52 15.55,3.52 5.38,0 10.41,-1.18 15.09,-3.52 4.68,-2.35 8.75,-5.52 12.21,-9.51 3.46,-3.99 6.22,-8.65 8.29,-13.97 2.08,-5.32 3.11,-10.88 3.11,-16.68 0,-5.79 -1.03,-11.27 -3.11,-16.44 -2.07,-5.17 -4.84,-9.75 -8.29,-13.74 -3.46,-3.99 -7.53,-7.16 -12.21,-9.51 -4.68,-2.35 -9.71,-3.52 -15.09,-3.52 -5.53,0 -10.71,1.18 -15.55,3.52 -4.84,2.35 -9.03,5.52 -12.56,9.51 -3.53,3.99 -6.34,8.57 -8.41,13.74 -2.07,5.17 -3.11,10.65 -3.11,16.44z"/>
               <path fill="#004024" d="M1118.35 1515.35c-5.07,0 -9.75,0.86 -14.05,2.58 -4.3,1.72 -8.03,4.07 -11.18,7.04 -3.15,2.98 -5.65,6.46 -7.49,10.45 -1.84,3.99 -2.76,8.26 -2.76,12.8l0 68.34 -21.89 0 0 -117.42 21.89 0 0 14.09c4.61,-5.48 9.83,-9.82 15.66,-13.03 5.84,-3.21 12.44,-4.81 19.82,-4.81l0 19.96z"/>
               <path fill="#004024" d="M1126.65 1558.32c0,-8.77 1.53,-16.99 4.61,-24.66 3.07,-7.67 7.25,-14.4 12.55,-20.2 5.3,-5.79 11.52,-10.33 18.66,-13.62 7.15,-3.28 14.79,-4.93 22.93,-4.93 8.14,0 15.75,1.65 22.81,4.93 7.07,3.29 13.29,7.83 18.66,13.62l0 -61.53 21.89 0 0 164.62 -21.89 0 0 -13.39c-5.38,5.79 -11.6,10.33 -18.66,13.62 -7.07,3.29 -14.67,4.93 -22.81,4.93 -8.14,0 -15.78,-1.64 -22.93,-4.93 -7.14,-3.29 -13.36,-7.83 -18.66,-13.62 -5.3,-5.79 -9.48,-12.52 -12.55,-20.2 -3.08,-7.67 -4.61,-15.89 -4.61,-24.65zm21.89 -0.24c0,5.79 1.04,11.36 3.11,16.68 2.07,5.32 4.88,9.98 8.41,13.97 3.53,3.99 7.72,7.16 12.56,9.51 4.84,2.35 10.02,3.52 15.55,3.52 5.38,0 10.41,-1.18 15.09,-3.52 4.69,-2.35 8.75,-5.52 12.21,-9.51 3.46,-3.99 6.22,-8.65 8.29,-13.97 2.08,-5.32 3.11,-10.88 3.11,-16.68 0,-5.79 -1.03,-11.27 -3.11,-16.44 -2.07,-5.17 -4.84,-9.75 -8.29,-13.74 -3.46,-3.99 -7.53,-7.16 -12.21,-9.51 -4.68,-2.35 -9.71,-3.52 -15.09,-3.52 -5.53,0 -10.71,1.18 -15.55,3.52 -4.84,2.35 -9.03,5.52 -12.56,9.51 -3.53,3.99 -6.34,8.57 -8.41,13.74 -2.07,5.17 -3.11,10.65 -3.11,16.44z"/>
               <path fill="#004024" d="M458.29 1664.57c0,-1.64 0.32,-3.02 0.98,-4.16 0.65,-1.13 1.48,-2.04 2.47,-2.72 0.99,-0.68 2.09,-1.18 3.29,-1.47 1.2,-0.31 2.35,-0.46 3.45,-0.46 2.17,0 4.06,0.48 5.68,1.43 1.62,0.95 2.98,2.15 4.08,3.61l-3.47 2.36c-0.74,-0.88 -1.65,-1.65 -2.74,-2.32 -1.09,-0.66 -2.35,-1 -3.81,-1 -0.59,0 -1.21,0.07 -1.84,0.2 -0.64,0.14 -1.23,0.38 -1.76,0.73 -0.53,0.35 -0.98,0.8 -1.34,1.36 -0.35,0.56 -0.53,1.26 -0.53,2.11 0,0.76 0.16,1.41 0.47,1.97 0.31,0.56 0.77,1.07 1.38,1.54 0.61,0.47 1.37,0.91 2.27,1.34 0.9,0.42 1.94,0.86 3.1,1.31 0.8,0.3 1.71,0.66 2.71,1.09 1.01,0.42 1.96,1 2.85,1.74 0.89,0.74 1.64,1.67 2.25,2.77 0.61,1.1 0.91,2.49 0.91,4.15 0,1.72 -0.32,3.17 -0.98,4.33 -0.65,1.17 -1.49,2.11 -2.52,2.81 -1.03,0.71 -2.15,1.23 -3.39,1.55 -1.23,0.31 -2.43,0.47 -3.58,0.47 -1.18,0 -2.28,-0.14 -3.29,-0.43 -1.01,-0.29 -1.95,-0.68 -2.81,-1.18 -0.86,-0.5 -1.66,-1.09 -2.4,-1.77 -0.74,-0.68 -1.42,-1.43 -2.05,-2.24l3.25 -2.36c0.42,0.45 0.88,0.91 1.38,1.38 0.5,0.47 1.07,0.88 1.69,1.25 0.62,0.36 1.29,0.66 2.01,0.91 0.71,0.24 1.47,0.36 2.27,0.36 0.59,0 1.23,-0.08 1.91,-0.23 0.68,-0.15 1.33,-0.42 1.94,-0.79 0.61,-0.38 1.11,-0.88 1.51,-1.5 0.4,-0.62 0.6,-1.4 0.6,-2.34 0,-0.81 -0.17,-1.53 -0.51,-2.13 -0.34,-0.61 -0.81,-1.15 -1.4,-1.63 -0.59,-0.49 -1.31,-0.92 -2.14,-1.3 -0.83,-0.38 -1.74,-0.76 -2.71,-1.16 -0.95,-0.36 -1.96,-0.78 -3.05,-1.25 -1.09,-0.47 -2.08,-1.06 -2.98,-1.77 -0.91,-0.71 -1.66,-1.59 -2.25,-2.65 -0.59,-1.06 -0.89,-2.37 -0.89,-3.95zm46.4 1.63l0 22.24 -4.45 0 0 -29.36c0,-0.79 0.25,-1.44 0.74,-1.97 0.49,-0.53 1.07,-0.8 1.76,-0.8 0.5,0 1,0.17 1.49,0.5 0.49,0.33 0.93,0.94 1.31,1.82l10.86 24.23 10.42 -24.23c0.39,-0.88 0.84,-1.49 1.36,-1.82 0.52,-0.33 1.06,-0.5 1.63,-0.5 0.77,0 1.43,0.27 1.96,0.8 0.53,0.53 0.8,1.18 0.8,1.97l0 29.36 -4.45 0 0 -22.24 -9.48 20.74c-0.59,1.24 -1.32,1.86 -2.18,1.86 -0.95,0 -1.71,-0.62 -2.27,-1.86l-9.48 -20.74zm61.62 -7.67c0.24,-0.58 0.54,-1.09 0.91,-1.55 0.37,-0.45 0.93,-0.68 1.67,-0.68 0.74,0 1.29,0.23 1.65,0.68 0.36,0.46 0.65,0.97 0.89,1.55l12.64 29.91 -4.81 0 -3.03 -7.58 -14.74 0 -3.03 7.58 -4.81 0 12.64 -29.91zm8.33 18.24l-5.74 -14.34 -5.74 14.34 11.49 0zm39.99 -0.86l-5.43 0 0 12.53 -4.45 0 0 -28.41c0,-2.24 1.09,-3.36 3.25,-3.36l9.04 0c1.69,0 3.18,0.29 4.45,0.86 1.28,0.58 2.33,1.32 3.16,2.23 0.83,0.91 1.46,1.94 1.87,3.08 0.42,1.15 0.62,2.3 0.62,3.45 0,2.42 -0.62,4.49 -1.87,6.22 -1.25,1.72 -3.14,2.8 -5.7,3.22l9.17 12.71 -5.12 0 -8.99 -12.53zm2.36 -4.08c0.95,0 1.77,-0.16 2.47,-0.48 0.7,-0.31 1.29,-0.73 1.78,-1.25 0.49,-0.52 0.85,-1.11 1.09,-1.77 0.24,-0.67 0.36,-1.33 0.36,-2 0,-0.69 -0.12,-1.38 -0.36,-2.06 -0.24,-0.68 -0.6,-1.28 -1.09,-1.79 -0.49,-0.51 -1.09,-0.93 -1.78,-1.25 -0.7,-0.31 -1.52,-0.48 -2.47,-0.48l-7.79 0 0 11.08 7.79 0zm32.06 -15.16l21.82 0 0 4.08 -8.68 0 0 27.69 -4.45 0 0 -27.69 -8.68 0 0 -4.08zm72.58 0l0 4.08 -16.07 0 0 9.9 13.58 0 0 4.08 -13.58 0 0 13.71 -4.45 0 0 -28.41c0,-2.24 1.1,-3.36 3.3,-3.36l17.23 0zm27.61 1.87c0.24,-0.58 0.54,-1.09 0.91,-1.55 0.37,-0.45 0.93,-0.68 1.67,-0.68 0.74,0 1.29,0.23 1.65,0.68 0.35,0.46 0.65,0.97 0.89,1.55l12.64 29.91 -4.81 0 -3.02 -7.58 -14.74 0 -3.03 7.58 -4.81 0 12.64 -29.91zm8.33 18.24l-5.75 -14.34 -5.74 14.34 11.49 0zm39.99 -0.86l-5.43 0 0 12.53 -4.45 0 0 -28.41c0,-2.24 1.08,-3.36 3.25,-3.36l9.04 0c1.69,0 3.18,0.29 4.45,0.86 1.28,0.58 2.33,1.32 3.16,2.23 0.83,0.91 1.45,1.94 1.87,3.08 0.41,1.15 0.62,2.3 0.62,3.45 0,2.42 -0.62,4.49 -1.87,6.22 -1.25,1.72 -3.15,2.8 -5.7,3.22l9.17 12.71 -5.12 0 -8.99 -12.53zm2.36 -4.08c0.95,0 1.77,-0.16 2.47,-0.48 0.7,-0.31 1.29,-0.73 1.78,-1.25 0.49,-0.52 0.85,-1.11 1.09,-1.77 0.24,-0.67 0.36,-1.33 0.36,-2 0,-0.69 -0.12,-1.38 -0.36,-2.06 -0.24,-0.68 -0.6,-1.28 -1.09,-1.79 -0.49,-0.51 -1.08,-0.93 -1.78,-1.25 -0.7,-0.31 -1.52,-0.48 -2.47,-0.48l-7.79 0 0 11.08 7.79 0zm37.63 -5.63l0 22.24 -4.45 0 0 -29.36c0,-0.79 0.25,-1.44 0.74,-1.97 0.49,-0.53 1.07,-0.8 1.76,-0.8 0.5,0 1,0.17 1.49,0.5 0.49,0.33 0.93,0.94 1.31,1.82l10.86 24.23 10.42 -24.23c0.39,-0.88 0.84,-1.49 1.36,-1.82 0.52,-0.33 1.06,-0.5 1.62,-0.5 0.77,0 1.43,0.27 1.96,0.8 0.53,0.53 0.8,1.18 0.8,1.97l0 29.36 -4.45 0 0 -22.24 -9.49 20.74c-0.59,1.24 -1.32,1.86 -2.18,1.86 -0.95,0 -1.71,-0.62 -2.27,-1.86l-9.49 -20.74zm55.22 -9.53l0 31.77 -4.45 0 0 -31.77 4.45 0zm22.89 2.41c0,-0.76 0.27,-1.4 0.8,-1.95 0.53,-0.54 1.17,-0.82 1.91,-0.82 0.45,0 0.89,0.12 1.34,0.36 0.45,0.25 0.87,0.67 1.29,1.28l16.43 23 0 -24.28 4.45 0 0 29.36c0,0.75 -0.27,1.4 -0.8,1.95 -0.53,0.55 -1.17,0.82 -1.91,0.82 -0.47,0 -0.93,-0.12 -1.36,-0.36 -0.43,-0.25 -0.85,-0.67 -1.27,-1.28l-16.43 -23 0 24.28 -4.45 0 0 -29.36zm77.48 11.57c0.59,0 1.08,0.16 1.45,0.47 0.37,0.32 0.56,0.8 0.56,1.43 0,2.3 -0.41,4.47 -1.25,6.51 -0.83,2.04 -1.96,3.83 -3.38,5.35 -1.43,1.53 -3.09,2.73 -4.98,3.61 -1.9,0.88 -3.95,1.32 -6.15,1.32 -2.17,0 -4.2,-0.45 -6.12,-1.34 -1.91,-0.89 -3.58,-2.09 -5.01,-3.61 -1.42,-1.52 -2.54,-3.3 -3.36,-5.35 -0.81,-2.06 -1.22,-4.23 -1.22,-6.54 0,-2.3 0.41,-4.46 1.25,-6.49 0.83,-2.03 1.97,-3.81 3.42,-5.33 1.46,-1.53 3.15,-2.73 5.07,-3.61 1.93,-0.88 3.99,-1.32 6.19,-1.32 2.25,0 4.36,0.46 6.32,1.36 1.96,0.91 3.67,2.15 5.12,3.72l-3.25 2.77c-1.03,-1.15 -2.26,-2.07 -3.67,-2.75 -1.41,-0.68 -2.92,-1.02 -4.52,-1.02 -1.57,0 -3.06,0.33 -4.45,1 -1.4,0.67 -2.61,1.58 -3.65,2.73 -1.04,1.15 -1.87,2.49 -2.47,4.02 -0.61,1.53 -0.91,3.17 -0.91,4.92 0,1.76 0.3,3.4 0.89,4.95 0.59,1.54 1.4,2.89 2.43,4.04 1.02,1.15 2.21,2.05 3.56,2.72 1.35,0.67 2.8,1 4.34,1 1.4,0 2.72,-0.27 3.98,-0.8 1.26,-0.53 2.38,-1.26 3.36,-2.2 0.98,-0.94 1.81,-2.05 2.47,-3.33 0.67,-1.29 1.12,-2.67 1.36,-4.15l-10.29 0 0 -4.08 12.92 0z"/>
             </g>
             <g>
              <polygon fill="#3DB988" points="359.38,0 719.97,311.42 344.28,611.64 0.02,308.37 "/>
              <polygon fill="#184C38" points="1457.07,317.91 716.43,926.81 716.94,1258.45 1457.07,637.23 "/>
              <polygon fill="#179068" points="1096.24,0.41 343.78,611.04 -0,308.36 -0,632.08 717,1258.25 716.92,929.62 1456.78,318.55 "/>
             </g>
             <g>
              <path fill="url(#id0)" d="M441.38 2106.85l0 733.98 0 0.01 -0.01 0 -17.67 33.59 -17.68 33.6 -17.68 -33.6 -17.67 -33.59 -0.01 0 0 -0.01 0 -733.98 70.72 0zm-70.72 -0.09c21.62,-16.57 45.06,-17.64 70.72,0l-70.72 0z"/>
              <path fill="url(#id1)" d="M598.26 2106.85l0 733.98 0 0.01 -0.01 0 -17.67 33.59 -17.68 33.6 -17.68 -33.6 -17.67 -33.59 -0.01 0 0 -0.01 0 -733.98 70.72 0zm-70.72 -0.09c21.62,-16.57 45.06,-17.64 70.72,0l-70.72 0z"/>
              <path fill="url(#id2)" d="M755.15 2106.85l0 733.98 0 0.01 -0.01 0 -17.67 33.59 -17.68 33.6 -17.68 -33.6 -17.67 -33.59 -0.01 0 0 -0.01 0 -733.98 70.72 0zm-70.72 -0.09c21.62,-16.57 45.06,-17.64 70.72,0l-70.72 0z"/>
              <path fill="url(#id3)" d="M912.03 2106.85l0 733.98 0 0.01 -0.01 0 -17.67 33.59 -17.68 33.6 -17.68 -33.6 -17.67 -33.59 -0.01 0 0 -0.01 0 -733.98 70.72 0zm-70.72 -0.09c21.62,-16.57 45.06,-17.64 70.72,0l-70.72 0z"/>
              <path fill="url(#id4)" d="M1068.92 2106.85l0 733.98 0 0.01 -0.01 0 -17.67 33.59 -17.68 33.6 -17.68 -33.6 -17.67 -33.59 -0.01 0 0 -0.01 0 -733.98 70.72 0zm-70.72 -0.09c21.62,-16.57 45.06,-17.64 70.72,0l-70.72 0z"/>
             </g>
            </svg>`;

            const probeData = svgLoader.parse(probeSvgRaw);
            probeGroup = new THREE.Group();

            let probeIdx = 0;
            probeData.paths.forEach((path) => {
                let fillColor = path.userData.style.fill;
                const isPin = (!fillColor || fillColor.includes('url') || fillColor.toUpperCase() === '#C1C2C3');
                if (isPin) fillColor = "#C1C2C3";
                fillColor = fillColor.toUpperCase();

                let matOptions = { color: new THREE.Color().setStyle(fillColor), roughness: 0.5, metalness: 0.1 };
                if (isPin) { matOptions.metalness = 0.9; matOptions.roughness = 0.2; }

                matOptions.polygonOffset = true;
                matOptions.polygonOffsetFactor = -1;
                matOptions.polygonOffsetUnits = -1;
                const probeMat = new THREE.MeshStandardMaterial(matOptions);
                const shapes = path.toShapes(true);
                const zCamada = (probeIdx++) * 2;   // um plano por COR (nao por letra)

                shapes.forEach((shape) => {
                    if (isPin) {
                        return;
                    } else {
                        const probeGeo = new THREE.ExtrudeGeometry(shape, {
                            depth: 200, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 10, bevelThickness: 15
                        });
                        var pm = new THREE.Mesh(probeGeo, probeMat);
                        pm.position.z += zCamada;   // mesmo plano p/ todas as letras
                        probeGroup.add(pm);
                    }
                });
            });

            const probeBbox = new THREE.Box3().setFromObject(probeGroup);
            const pCx = (probeBbox.max.x + probeBbox.min.x) / 2;
            const pCy = (probeBbox.max.y + probeBbox.min.y) / 2;
            probeGroup.children.forEach(child => { child.geometry.translate(-pCx, -pCy, 0); });

            // CÓDIGO DA SONDA VERDE APLICADO (Inicia na Posição 1 - Y: -1.1900)
            probeGroup.scale.set(0.0012, -0.0012, 0.0016);
            probeGroup.position.set(0.5500, -1.1900, -1.1900);
            probeGroup.rotation.set(-0.0400, -0.5600, 0.0000);
            
            sensor.position.set(-2.5, 0, 0);
            scene.add(sensor);
            scene.add(probeGroup);

            const raycaster = new THREE.Raycaster();
            const mouse = new THREE.Vector2();

            renderer.domElement.addEventListener('pointerdown', (event) => {
                mouse.x = ((event.clientX-HOST.getBoundingClientRect().left)/HOST.clientWidth)*2-1;
                mouse.y = -((event.clientY-HOST.getBoundingClientRect().top)/HOST.clientHeight)*2+1;

                raycaster.setFromCamera(mouse, camera);

                // antes de ativado: um clique em qualquer parte do aparelho so revela
                // o card-guia + espelho da tela — nao aciona nada da maquina de estados
                if (!dispositivoAtivado) {
                    const hitDispositivo = raycaster.intersectObjects([sensor, probeGroup], true);
                    if (hitDispositivo.length > 0) ativarInteracao();
                    return;
                }

                const intersects = raycaster.intersectObjects(hitboxes);

                if (intersects.length > 0) {
                    if (bloqueiaClique) return;

                    const clicado = intersects[0].object.name;
                    pressButtonEffect(clicado);

                    if (clicado === 'Botão Power') {
                        if (maquinaEstado === 'DESLIGADO' || maquinaEstado === 'STANDBY') {
                            setEstado('BOOTING');
                            bloqueiaClique = true;
                            
                            atualizarTelaVisual('TELA LIGANDO');
                            showMessage("Iniciando sistema e descendo sonda...", 'bg-gray-700');
                            
                            gsap.to(probeGroup.position, {
                                y: -3.6800,
                                duration: 2.5, 
                                ease: "power2.inOut",
                                onComplete: () => {
                                    setTimeout(() => {
                                        setEstado('AO_VIVO_1');
                                        atualizarTelaVisual('AO VIVO 1');
                                        showMessage("Pronto para uso", 'bg-blue-600');
                                        bloqueiaClique = false;
                                    }, 800);
                                }
                            });
                        } else if (maquinaEstado.startsWith('SALVO') || maquinaEstado === 'ESPERANDO_SALVOS') {
                            setEstado('STANDBY');
                            atualizarTelaVisual('TELA LIGANDO');
                            showMessage("Ciclo encerrado. Clique no Power para reiniciar.", 'bg-gray-700');
                        }
                    } 
                    else if (clicado === 'Botão Verde Superior') {
                        if (maquinaEstado === 'AO_VIVO_1') {
                            bloqueiaClique = true;
                            atualizarTelaVisual('SALVANDO');
                            showMessage("Salvando leitura 1...", 'bg-emerald-600');
                            
                            setTimeout(() => {
                                let tl = gsap.timeline({
                                    onComplete: () => {
                                        setTimeout(() => {
                                            setEstado('AO_VIVO_2');
                                            atualizarTelaVisual('AO VIVO 2');
                                            bloqueiaClique = false;
                                        }, 800);
                                    }
                                });
                                tl.to(probeGroup.position, { y: -1.1900, duration: 2, ease: "power2.inOut" })
                                  .to(probeGroup.position, { y: -3.6800, duration: 2, ease: "power2.inOut" });
                            }, 1000);
                        } 
                        else if (maquinaEstado === 'AO_VIVO_2') {
                            bloqueiaClique = true;
                            atualizarTelaVisual('SALVANDO');
                            showMessage("Salvando leitura 2...", 'bg-emerald-600');
                            
                            setTimeout(() => {
                                let tl = gsap.timeline({
                                    onComplete: () => {
                                        setTimeout(() => {
                                            setEstado('AO_VIVO_3');
                                            atualizarTelaVisual('AO VIVO 3');
                                            bloqueiaClique = false;
                                        }, 800);
                                    }
                                });
                                tl.to(probeGroup.position, { y: -1.1900, duration: 2, ease: "power2.inOut" })
                                  .to(probeGroup.position, { y: -3.6800, duration: 2, ease: "power2.inOut" });
                            }, 1000);
                        } 
                        else if (maquinaEstado === 'AO_VIVO_3') {
                            bloqueiaClique = true;
                            atualizarTelaVisual('SALVANDO');
                            showMessage("Salvando leitura 3...", 'bg-emerald-600');
                            
                            setTimeout(() => {
                                gsap.to(probeGroup.position, {
                                    y: -1.1900,
                                    duration: 2, 
                                    ease: "power2.inOut",
                                    onComplete: () => {
                                        setEstado('ESPERANDO_SALVOS');
                                        atualizarTelaVisual('AO VIVO 3'); 
                                        showMessage("Leituras concluídas. Use o botão inferior para rever os dados.", 'bg-indigo-600');
                                        bloqueiaClique = false;
                                    }
                                });
                            }, 1000);
                        }
                    } 
                    else if (clicado === 'Botão Verde Inferior') {
                        if (maquinaEstado === 'ESPERANDO_SALVOS' || maquinaEstado === 'SALVO_3') {
                            setEstado('SALVO_1');
                            atualizarTelaVisual('SALVO 1');
                            showMessage("Dados armazenados - Lote 1", 'bg-indigo-600');
                        } else if (maquinaEstado === 'SALVO_1') {
                            setEstado('SALVO_2');
                            atualizarTelaVisual('SALVO 2');
                            showMessage("Dados armazenados - Lote 2", 'bg-indigo-600');
                        } else if (maquinaEstado === 'SALVO_2') {
                            setEstado('SALVO_3');
                            atualizarTelaVisual('SALVO 3');
                            showMessage("Dados armazenados - Lote 3", 'bg-indigo-600');
                        }
                    }
                }
            });

            window.addEventListener('resize', () => {
                camera.aspect = HOST.clientWidth / HOST.clientHeight;
                camera.updateProjectionMatrix();
                renderer.setSize(HOST.clientWidth, HOST.clientHeight);
            });
        }

        function updateCables() {
            if(!looseCable1 || !looseCable2) return;

            orgGroup.updateMatrixWorld(true);
            sensor.updateMatrixWorld(true);
            probeGroup.updateMatrixWorld(true);

            const globalPt0 = localPt0.clone().applyMatrix4(orgGroup.matrixWorld);
            const globalPtEnd = localPtEnd.clone().applyMatrix4(orgGroup.matrixWorld);

            const targetSensor = new THREE.Vector3(offsetsCabos.sensorX, offsetsCabos.sensorY, offsetsCabos.sensorZ).applyMatrix4(sensor.matrixWorld);

            const probeBox = new THREE.Box3().setFromObject(probeGroup);
            const targetProbe = new THREE.Vector3(
                ((probeBox.max.x + probeBox.min.x) / 2) + offsetsCabos.sondaX, 
                probeBox.max.y + offsetsCabos.sondaY, 
                ((probeBox.max.z + probeBox.min.z) / 2) + offsetsCabos.sondaZ
            );

            const curve1 = new THREE.CatmullRomCurve3([
                globalPt0,
                new THREE.Vector3(globalPt0.x, globalPt0.y - 0.4, globalPt0.z - 0.8), 
                new THREE.Vector3(targetSensor.x, targetSensor.y - 0.5, targetSensor.z - 0.8), 
                targetSensor
            ]);
            looseCable1.geometry.dispose();
            looseCable1.geometry = new THREE.TubeGeometry(curve1, 64, 0.08, 16, false);

            const curve2 = new THREE.CatmullRomCurve3([
                globalPtEnd,
                new THREE.Vector3(globalPtEnd.x + 0.2, globalPtEnd.y - 0.8, globalPtEnd.z),
                new THREE.Vector3(targetProbe.x, targetProbe.y + 0.5, targetProbe.z),
                targetProbe
            ]);
            looseCable2.geometry.dispose();
            looseCable2.geometry = new THREE.TubeGeometry(curve2, 64, 0.08, 16, false);
        }

        function animate() {
            requestAnimationFrame(animate);
            if (controls) controls.update(); 
            
            updateCables();

            if (renderer && scene && camera) renderer.render(scene, camera);
        }

        
    

    // orquestracao no palco (substitui o window.onload do modelo)
    init();

    // mede a cena inteira (aparelho + sonda) UMA vez e guarda os limites,
    // para reenquadrar sempre que o palco muda de tamanho (ex.: modo demo)
    var cenaCenter = null, cenaSize = null;
    if (typeof scene !== 'undefined' && scene){
      var alvo = new THREE.Box3().setFromObject(scene);
      cenaCenter = alvo.getCenter(new THREE.Vector3());
      cenaSize   = alvo.getSize(new THREE.Vector3());
      controls.target.copy(cenaCenter);
      controls.enablePan = false;
      controls.enableZoom = false;
      var reduz = matchMedia('(prefers-reduced-motion: reduce)').matches;
      controls.autoRotate = true;
      controls.autoRotateSpeed = reduz ? 0.4 : 1.4;
      /* o guia liga/desliga o giro conforme o aparelho esta em uso */
      window.__setAutoRotate = function(v){ if(controls) controls.autoRotate = !!v; };
    }

    /* reenquadra levando em conta a PROPORCAO atual do palco: a peca sempre
       cabe inteira (topo e base com folga) seja o palco estreito ou largo.
       f = fracao do palco ocupada pela peca (0.68 -> ~68%, com respiro). */
    function reenquadrar3D(){
      if (!camera) return;
      var L = HOST.clientWidth||340, A = HOST.clientHeight||520;
      camera.aspect = L/A;
      if (renderer) renderer.setSize(L, A);
      if (cenaCenter && cenaSize){
        var f = 0.68;
        var vHalf = Math.tan(camera.fov*Math.PI/360);
        var distV = (cenaSize.y/2) / (f * vHalf);                 // caber na altura
        var distH = (cenaSize.x/2) / (f * vHalf * camera.aspect); // caber na largura
        var dist  = Math.max(distV, distH);                       // o mais restritivo
        camera.position.set(cenaCenter.x, cenaCenter.y, cenaCenter.z + dist);
      }
      camera.updateProjectionMatrix();
    }
    reenquadrar3D();
    addEventListener('resize', reenquadrar3D);
    if (window.ResizeObserver) new ResizeObserver(reenquadrar3D).observe(HOST);

    // wiring dos controles do modo demonstracao
    (function(){
      var hint  = document.getElementById('deviceIdleHint');
      var reset = document.getElementById('demoReset');
      if (hint)  hint.addEventListener('click', function(){ ativarInteracao(); });
      if (reset) reset.addEventListener('click', function(){ resetarDemo(); });
    })();

    animate();   // o loop do proprio modelo (ja atualiza controls e cabos)

    } catch(err){
      console.error('3D TeraSensor:', err);
    }
  }
  if (document.readyState === 'complete') iniciar();
  else window.addEventListener('load', iniciar);
})();
