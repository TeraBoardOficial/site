/* ==========================================================================
   TeraBoard · TeraSmart — cena 3D da estufa
   ========================================================================== */

(function() {
    // Variáveis Globais de Cena
    let scene, camera, renderer, controls;
    let objects = {};
    let fluidPool = [];
    let dataParticles;
    
    // Estado da simulação
    let isSimulating = false;
    const simState = { rotorSpeed: 0, isFlowing: false, flowTime: 0 };

    // --- RECEITA DE FERTIRRIGAÇÃO ---
    // Cada líquido tem sua própria vazão (L/min) e preço (R$/L).
    // >>> Ajuste esses números para os valores reais da receita/fornecedor <<<
    const duracaoCicloMin = 12; // duração simulada de 1 ciclo de fertirrigação, em minutos
    const LIQUIDOS = {
        agua:  { nome: 'Água',        vazaoLmin: 6.00, precoL: 0.02, capacidadeL: 1000 },
        a:     { nome: 'Nutriente A', vazaoLmin: 0.30, precoL: 5.20, capacidadeL: 20 },
        b:     { nome: 'Nutriente B', vazaoLmin: 0.22, precoL: 6.80, capacidadeL: 20 },
        c:     { nome: 'Nutriente C', vazaoLmin: 0.15, precoL: 9.40, capacidadeL: 20 },
    };

    // Elementos da UI
    let uiBox, uiNum, uiTitle, uiDesc, uiSensor, uiVal, uiEc, btnSim;
    let uiConsumo, cEls = {};
    let lcdCtx, lcdTex;

    // --- FUNÇÕES DE INTERFACE ---
    function initUI() {
        uiBox = document.getElementById('step-display');
        uiNum = document.getElementById('step-number');
        uiTitle = document.getElementById('step-title');
        uiDesc = document.getElementById('step-desc');
        uiSensor = document.getElementById('hw-popup');
        uiVal = document.getElementById('hw-popup-val');
        uiEc = document.getElementById('hw-popup-ec');
        btnSim = document.getElementById('btn-hard-sim');
        uiConsumo = document.getElementById('consumo-popup');
        cEls = {
            agua: { lit: document.getElementById('c-lit-agua'), val: document.getElementById('c-val-agua') },
            a: { lit: document.getElementById('c-lit-a'), val: document.getElementById('c-val-a') },
            b: { lit: document.getElementById('c-lit-b'), val: document.getElementById('c-val-b') },
            c: { lit: document.getElementById('c-lit-c'), val: document.getElementById('c-val-c') },
            totalLit: document.getElementById('c-total-lit'),
            totalVal: document.getElementById('c-total-val'),
        };
        
        setTimeout(() => {
            if (uiBox) {
                uiBox.classList.remove('opacity-0', 'scale-95', '-translate-y-4');
                uiBox.classList.add('opacity-100', 'scale-100', 'translate-y-0');
            }
        }, 500);
    }

    // --- PAINEL DE CONTROLE MANUAL DE POSIÇÃO ---
    // Gera um input X/Y/Z pra cada elemento em objects.controlList + cada
    // ponto do cabo, pra ajustar tudo na mão e depois exportar os valores.

    function fmtR$(v) { return 'R$ ' + v.toFixed(2).replace('.', ','); }
    function fmtL(v) { return v.toFixed(1).replace('.', ',') + ' L'; }

    // Câmera padrão (visão geral) e foco cinematográfico por etapa.
    // Mantém sempre o mesmo ângulo/altura (direção da câmera padrão), só
    // muda o alvo e a distância — dá um efeito de "zoom" consistente.
    const CAM_DEFAULT_POS = { x: -2, y: 12, z: 28 };
    const CAM_DEFAULT_TARGET = { x: 0, y: 0, z: 0 };
    function focusCamera(pos, target, duration = 2.2) {
        if (!camera || !controls) return;
        gsap.to(camera.position, { x: pos.x, y: pos.y, z: pos.z, duration, ease: "power2.inOut" });
        gsap.to(controls.target, { x: target.x, y: target.y, z: target.z, duration, ease: "power2.inOut" });
    }

    // Calcula e anima, em contagem crescente, quanto foi gasto de cada
    // líquido (litros e R$) ao final do ciclo de fertirrigação.
    function mostrarConsumoCiclo() {
        if (!uiConsumo) return;
        let totalLit = 0, totalVal = 0;
        const proxy = {};
        Object.keys(LIQUIDOS).forEach(key => {
            const liq = LIQUIDOS[key];
            const litros = liq.vazaoLmin * duracaoCicloMin;
            const valor = litros * liq.precoL;
            totalLit += litros; totalVal += valor;
            proxy[key + 'L'] = 0; proxy[key + 'V'] = 0;
        });

        gsap.to(proxy, {
            ...Object.keys(LIQUIDOS).reduce((acc, key) => {
                const liq = LIQUIDOS[key];
                acc[key + 'L'] = liq.vazaoLmin * duracaoCicloMin;
                acc[key + 'V'] = liq.vazaoLmin * duracaoCicloMin * liq.precoL;
                return acc;
            }, {}),
            duration: 1.6,
            ease: "power2.out",
            onUpdate: () => {
                Object.keys(LIQUIDOS).forEach(key => {
                    if (cEls[key]) {
                        cEls[key].lit.textContent = fmtL(proxy[key + 'L']);
                        cEls[key].val.textContent = fmtR$(proxy[key + 'V']);
                    }
                });
                const curLit = Object.keys(LIQUIDOS).reduce((s, k) => s + proxy[k + 'L'], 0);
                const curVal = Object.keys(LIQUIDOS).reduce((s, k) => s + proxy[k + 'V'], 0);
                if (cEls.totalLit) cEls.totalLit.textContent = fmtL(curLit);
                if (cEls.totalVal) cEls.totalVal.textContent = fmtR$(curVal);
            }
        });

        uiConsumo.classList.add('vis');
    }

    function showStep(num, title, desc) {
        if(!uiBox) return;
        uiBox.classList.remove('opacity-100', 'scale-100', 'translate-y-0');
        uiBox.classList.add('opacity-0', 'scale-95', '-translate-y-4');
        setTimeout(() => {
            if(uiNum) uiNum.textContent = num;
            if(uiTitle) uiTitle.textContent = title;
            if(uiDesc) uiDesc.textContent = desc;
            uiBox.classList.remove('opacity-0', 'scale-95', '-translate-y-4');
            uiBox.classList.add('opacity-100', 'scale-100', 'translate-y-0');
        }, 400);
    }

    // --- FUNÇÕES DE DISPLAY LCD ---
    function initLCD() {
        const lcdCanvas = document.createElement('canvas');
        lcdCanvas.width = 512; lcdCanvas.height = 256;
        lcdCtx = lcdCanvas.getContext('2d');
        lcdTex = new THREE.CanvasTexture(lcdCanvas);
        updateLCD('TERASMART OS v2', 'STATUS: ATIVO', 'MONITORANDO...');
    }

    function updateLCD(line1, line2, line3) {
        if(!lcdCtx) return;
        lcdCtx.fillStyle = '#06180F';
        lcdCtx.fillRect(0, 0, 512, 256);
        lcdCtx.strokeStyle = 'rgba(12, 42, 29, 0.5)'; lcdCtx.lineWidth = 2;
        for (let i = 0; i < 256; i += 4) {
            lcdCtx.beginPath(); lcdCtx.moveTo(0, i); lcdCtx.lineTo(512, i); lcdCtx.stroke();
        }
        lcdCtx.fillStyle = '#1DC78B';
        lcdCtx.shadowColor = '#1DC78B'; lcdCtx.shadowBlur = 12;
        lcdCtx.font = 'bold 32px "Courier New", Courier, monospace';
        lcdCtx.fillText(line1 || '', 30, 60);
        lcdCtx.fillText(line2 || '', 30, 120);
        lcdCtx.fillText(line3 || '', 30, 180);
        lcdTex.needsUpdate = true;
    }

    // --- INICIALIZAÇÃO 3D ---
    function init3D() {
        const container = document.getElementById('gemeo-canvas-container');
        if (!container) return;
        
        scene = new THREE.Scene();
        
        // Câmera
        const width = container.clientWidth || window.innerWidth;
        const height = container.clientHeight || window.innerHeight;
        camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 200);
        camera.position.set(-2, 12, 28);
        camera.lookAt(0, 0, 0);

        // Renderizador
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(width, height);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        container.appendChild(renderer.domElement);

        // Controles
        controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.maxPolarAngle = Math.PI / 2 - 0.1;
        controls.minDistance = 10;
        controls.maxDistance = 50;

        // Luzes
        const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
        scene.add(ambientLight);
        const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);
        scene.add(hemiLight);
        const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
        dirLight.position.set(15, 25, 10);
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.width = 2048;
        dirLight.shadow.mapSize.height = 2048;
        dirLight.shadow.bias = -0.001;
        scene.add(dirLight);

        // Chão
        const gridHelper = new THREE.GridHelper(60, 60, 0x1F8F67, 0x1F8F67);
        gridHelper.material.opacity = 0.1;
        gridHelper.material.transparent = true;
        gridHelper.position.y = -3;
        scene.add(gridHelper);

        const groundGeo = new THREE.PlaneGeometry(100, 100);
        const groundMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 1, depthWrite: false });
        const ground = new THREE.Mesh(groundGeo, groundMat);
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -3.01;
        ground.receiveShadow = true;
        scene.add(ground);

        // Materiais Básicos
        const matMetal = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.3, metalness: 0.6 });
        const matGlass = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.3 });
        const matValveRed = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.4, metalness: 0.2 });
        const matValveGreen = new THREE.MeshStandardMaterial({ color: 0x1DC78B, roughness: 0.4, metalness: 0.2, emissive: 0x1DC78B, emissiveIntensity: 0.4 });
        // Cano semi-transparente (tipo PVC translúcido) — dá pra ver o líquido passando por dentro
        const matPipe = new THREE.MeshStandardMaterial({ color: 0xcfe8e0, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide });
        
        // Helper Tubulação
        function createPipe(start, end, radius) {
            const path = new THREE.LineCurve3(start, end);
            const mesh = new THREE.Mesh(new THREE.TubeGeometry(path, 8, radius, 12, false), matPipe);
            mesh.renderOrder = 1; // desenha depois das bolinhas, senão o depthWrite:false engole elas
            scene.add(mesh);
        }

        // A. Tanque Principal
        const tankGroup = new THREE.Group();
        tankGroup.position.set(-10, 3, -3);
        const tkShell = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 8, 32), matGlass);
        tkShell.castShadow = true;
        const waterGeo = new THREE.CylinderGeometry(2.4, 2.4, 7.8, 32);
        waterGeo.translate(0, 3.9, 0); 
        const waterMesh = new THREE.Mesh(waterGeo, new THREE.MeshStandardMaterial({
            color: 0x3b82f6, transparent: true, opacity: 0.8, roughness: 0.2
        }));
        waterMesh.position.y = -3.9;
        tankGroup.add(tkShell, waterMesh);
        scene.add(tankGroup);
        objects.waterLevel = waterMesh;
        objects.tankGroup = tankGroup;

        // B. Tanques de Nutrientes e Válvulas
        objects.nutrients = [];
        objects.valves = [];
        objects.nutrientGroups = []; // {label, tankGrp, valveGrp} pro painel de controle manual
        function buildNutrientTank(x, colorHex, label) {
            const grp = new THREE.Group();
            grp.position.set(x, 4, -3);
            const shell = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 4, 32), matGlass);
            const liqGeo = new THREE.CylinderGeometry(1.15, 1.15, 3.8, 32);
            liqGeo.translate(0, 1.9, 0);
            const liqMesh = new THREE.Mesh(liqGeo, new THREE.MeshStandardMaterial({
                color: colorHex, transparent: true, opacity: 0.8, roughness: 0.2, emissive: colorHex, emissiveIntensity: 0.1
            }));
            liqMesh.position.y = -1.9;
            grp.add(shell, liqMesh);
            scene.add(grp);
            objects.nutrients.push(liqMesh);
            
            const valveGrp = new THREE.Group();
            valveGrp.position.set(x, 0.5, -3);
            const vBody = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), matMetal);
            const vWheel = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.15, 8, 16), matValveRed.clone());
            vWheel.rotation.x = Math.PI / 2; vWheel.position.y = 0.5;
            valveGrp.add(vBody, vWheel);
            scene.add(valveGrp);
            
            createPipe(new THREE.Vector3(x, 2, -3), new THREE.Vector3(x, 0.9, -3), 0.3); 
            createPipe(new THREE.Vector3(x, 0.1, -3), new THREE.Vector3(x, -2, -3), 0.3); 
            objects.nutrientGroups.push({ label: label, tankGrp: grp, valveGrp: valveGrp });
            return vWheel;
        }
        
        objects.valves.push(buildNutrientTank(-4, 0xef4444, 'Tanque Nutriente A')); 
        objects.valves.push(buildNutrientTank(-1, 0xeab308, 'Tanque Nutriente B')); 
        objects.valves.push(buildNutrientTank(2, 0x22c55e, 'Tanque Nutriente C'));  

        createPipe(new THREE.Vector3(-10, -1, -3), new THREE.Vector3(-10, -2, -3), 0.55); 
        createPipe(new THREE.Vector3(-10, -2, -3), new THREE.Vector3(8, -2, -3), 0.55); 

        // Caminho de cada líquido, do próprio tanque até o solo — usado pra
        // animar bolinhas coloridas passando pelos canos de verdade. Uso
        // segmentos retos (não curva suave) pra bater exatamente com o cano
        // físico — uma curva suave arredonda as quinas e a bolinha "sai" do
        // cano nos cotovelos.
        function caminhoReto(pontos) {
            const path = new THREE.CurvePath();
            for (let i = 0; i < pontos.length - 1; i++) {
                path.add(new THREE.LineCurve3(pontos[i], pontos[i + 1]));
            }
            return path;
        }
        objects.pipeCurves = {
            agua: caminhoReto([
                new THREE.Vector3(-10, -1, -3),
                new THREE.Vector3(-10, -2, -3),
                new THREE.Vector3(8, -2, -3)
            ]),
            a: caminhoReto([
                new THREE.Vector3(-4, 2, -3),
                new THREE.Vector3(-4, 0.9, -3),
                new THREE.Vector3(-4, 0.1, -3),
                new THREE.Vector3(-4, -2, -3),
                new THREE.Vector3(8, -2, -3)
            ]),
            b: caminhoReto([
                new THREE.Vector3(-1, 2, -3),
                new THREE.Vector3(-1, 0.9, -3),
                new THREE.Vector3(-1, 0.1, -3),
                new THREE.Vector3(-1, -2, -3),
                new THREE.Vector3(8, -2, -3)
            ]),
            c: caminhoReto([
                new THREE.Vector3(2, 2, -3),
                new THREE.Vector3(2, 0.9, -3),
                new THREE.Vector3(2, 0.1, -3),
                new THREE.Vector3(2, -2, -3),
                new THREE.Vector3(8, -2, -3)
            ]),
        };

        // C. Bomba Hidráulica
        const pumpGroup = new THREE.Group();
        pumpGroup.position.set(-7, -2, -3);
        const pBody = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 1.5, 32), matMetal);
        pBody.rotation.x = Math.PI / 2;
        const pGlass = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 1.6, 32), matGlass);
        pGlass.rotation.x = Math.PI / 2;
        const rotor = new THREE.Group();
        const b1 = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 0.4), new THREE.MeshStandardMaterial({ color: 0x334155 }));
        const b2 = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 0.4), new THREE.MeshStandardMaterial({ color: 0x334155 }));
        b2.rotation.y = Math.PI / 2;
        rotor.add(b1, b2); rotor.rotation.x = Math.PI/2; rotor.position.z = 0.8; 
        pumpGroup.add(pBody, pGlass, rotor);
        scene.add(pumpGroup);
        objects.pumpRotor = rotor;
        objects.pumpGroup = pumpGroup;

        // D. Caixa TeraSmart 
        initLCD(); // Inicializa canvas do painel
        
        const teraGrp = new THREE.Group();
        teraGrp.position.set(-15.60, 1.60, -2.80); 
        
        const tsWidth = 4.0; const tsHeight = 6.0; const tsDepth = 1.5;
        // Caixa fechada, sem eletrônica interna — só o invólucro com a arte real na frente
        const tsSideMat = new THREE.MeshStandardMaterial({color: 0xF0F1E3, roughness: 0.5, metalness: 0.1});
        const tsFrontTex = new THREE.TextureLoader().load('assets/img/produtos/terasmart-capa.webp');
        tsFrontTex.colorSpace = THREE.SRGBColorSpace || tsFrontTex.colorSpace;
        const tsFrontMat = new THREE.MeshStandardMaterial({color: 0xffffff, map: tsFrontTex, roughness: 0.45, metalness: 0.05});
        // ordem das faces do BoxGeometry: +x,-x,+y,-y,+z(frente),-z
        const tBox = new THREE.Mesh(new THREE.BoxGeometry(tsWidth, tsHeight, tsDepth),
            [tsSideMat, tsSideMat, tsSideMat, tsSideMat, tsFrontMat, tsSideMat]);
        tBox.castShadow = true; tBox.receiveShadow = true;
        teraGrp.add(tBox);

        // Fundo escuro por trás do texto do LCD, pro contraste ficar bom
        const bezelGeo = new THREE.PlaneGeometry(tsWidth * 0.62, tsHeight * 0.18);
        const bezelMat = new THREE.MeshStandardMaterial({color: 0x06180F});
        const bezel = new THREE.Mesh(bezelGeo, bezelMat);
        bezel.position.set(0, tsHeight * 0.22, tsDepth/2 + 0.005);
        tBox.add(bezel);

        // LCD Canvas Projetado — texto dinâmico (lendo dados / irrigando / fertirrigando)
        const lcdMat = new THREE.MeshBasicMaterial({ map: lcdTex });
        const lcdMesh = new THREE.Mesh(new THREE.PlaneGeometry(tsWidth * 0.58, tsHeight * 0.155), lcdMat);
        lcdMesh.position.set(0, tsHeight * 0.22, tsDepth/2 + 0.01);
        tBox.add(lcdMesh);

        scene.add(teraGrp);
        objects.teraGrp = teraGrp;

        // E. Leito de Cultivo (Solo) e Planta
        const bedGrp = new THREE.Group();
        bedGrp.position.set(8, -1.5, -1);
        
        // Solo — duas texturas geradas por canvas (seca e fértil) que se cruzam
        // (crossfade) conforme o ciclo avança. Gerei por canvas em vez de usar
        // as fotos de banco de imagem porque aquelas vêm com marca d'água e
        // costumam falhar por CORS quando carregadas de outro domínio.
        function gerarTexturaSolo(tipo) {
            const cv = document.createElement('canvas');
            cv.width = 256; cv.height = 256;
            const ctx = cv.getContext('2d');
            if (tipo === 'seca') {
                ctx.fillStyle = '#8a6a45';
                ctx.fillRect(0, 0, 256, 256);
                for (let i = 0; i < 2200; i++) {
                    const x = Math.random() * 256, y = Math.random() * 256;
                    const shade = 130 + Math.random() * 90;
                    ctx.fillStyle = `rgba(${shade+30},${shade},${shade-40},${0.15+Math.random()*0.3})`;
                    ctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
                }
                ctx.strokeStyle = 'rgba(60,40,20,0.5)';
                for (let i = 0; i < 14; i++) {
                    ctx.beginPath();
                    let x = Math.random() * 256, y = Math.random() * 256;
                    ctx.moveTo(x, y);
                    for (let j = 0; j < 5; j++) { x += (Math.random()-0.5)*40; y += (Math.random()-0.5)*40; ctx.lineTo(x, y); }
                    ctx.lineWidth = 0.6 + Math.random();
                    ctx.stroke();
                }
            } else {
                ctx.fillStyle = '#2b1a10';
                ctx.fillRect(0, 0, 256, 256);
                for (let i = 0; i < 3000; i++) {
                    const x = Math.random() * 256, y = Math.random() * 256;
                    const shade = 20 + Math.random() * 60;
                    ctx.fillStyle = `rgba(${shade+30},${shade+15},${shade},${0.2+Math.random()*0.4})`;
                    ctx.fillRect(x, y, 1 + Math.random() * 3, 1 + Math.random() * 3);
                }
                for (let i = 0; i < 160; i++) {
                    ctx.fillStyle = `rgba(${20+Math.random()*20},${15+Math.random()*15},8,0.5)`;
                    ctx.beginPath();
                    ctx.arc(Math.random() * 256, Math.random() * 256, 0.8 + Math.random() * 1.6, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
            const tex = new THREE.CanvasTexture(cv);
            tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
            tex.repeat.set(3, 2);
            return tex;
        }

        const matSoloSeco = new THREE.MeshStandardMaterial({ map: gerarTexturaSolo('seca'), roughness: 0.95 });
        const matSoloFertil = new THREE.MeshStandardMaterial({ map: gerarTexturaSolo('fertil'), roughness: 0.85, transparent: true, opacity: 0 });

        const soilMesh = new THREE.Mesh(new THREE.BoxGeometry(7, 3, 5), matSoloSeco);
        soilMesh.castShadow = true; soilMesh.receiveShadow = true;
        bedGrp.add(soilMesh);

        // Camada fértil por cima (levemente maior, evita z-fighting), some no
        // início (opacity 0) e sobe pra 1 durante a etapa de Absorção.
        const soilFertilMesh = new THREE.Mesh(new THREE.BoxGeometry(7.02, 3.02, 5.02), matSoloFertil);
        soilFertilMesh.receiveShadow = true;
        bedGrp.add(soilFertilMesh);
        objects.soloFertilMat = matSoloFertil;
        
        // Planta — pé de tomate de verdade: caule principal comprido com
        // ramos laterais, folhas compostas (um talo com vários folíolos, como
        // folha de tomateiro de fato) e os tomates em cachos (não soltos).
        const plantGrp = new THREE.Group();
        plantGrp.position.set(1.5, 1.5, 0);

        const stemCurve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0.08, 0.8, 0.03),
            new THREE.Vector3(-0.05, 1.7, -0.03),
            new THREE.Vector3(0.06, 2.5, 0.02),
            new THREE.Vector3(0, 3.3, 0)
        ]);
        const stemMat = new THREE.MeshStandardMaterial({ color: 0x4d7c0f, roughness: 0.7 });
        const stem = new THREE.Mesh(new THREE.TubeGeometry(stemCurve, 24, 0.09, 6, false), stemMat);
        stem.castShadow = true;
        plantGrp.add(stem);

        // Ramos laterais, saindo do caule principal em alturas diferentes
        const ramosDef = [
            [[0, 1.0, 0],    [0.55, 1.3, 0.18],  [1.05, 1.65, 0.30]],
            [[0, 1.6, 0],    [-0.55, 1.9, -0.12], [-1.05, 2.30, -0.22]],
            [[0, 2.2, 0],    [0.50, 2.55, 0.16],  [0.95, 2.95, 0.30]],
            [[0, 2.8, 0],    [-0.45, 3.05, -0.14],[-0.85, 3.40, -0.26]],
        ];
        const ramoMat = new THREE.MeshStandardMaterial({ color: 0x5b8a1a, roughness: 0.7 });
        const ramoPontas = ramosDef.map(pts => {
            const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)));
            const ramo = new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.045, 5, false), ramoMat);
            ramo.castShadow = true;
            plantGrp.add(ramo);
            return curve.getPointAt(1); // ponta do ramo, pra pendurar folha/cacho
        });

        // Folha — blade único, largo e arredondado (sem entalhe: era o entalhe
        // que estava gerando aquelas farpas finas em vez de folha de verdade)
        function criarFolhaGeo() {
            const s = new THREE.Shape();
            s.moveTo(0, 0);
            s.bezierCurveTo(0.30, 0.16, 0.44, 0.58, 0, 1.0);
            s.bezierCurveTo(-0.44, 0.58, -0.30, 0.16, 0, 0);
            return new THREE.ShapeGeometry(s, 10);
        }
        const corMurcha = new THREE.Color(0xC9B458); // amarelada, planta sedenta
        const leafMat = new THREE.MeshStandardMaterial({ color: corMurcha.clone(), roughness: 0.45, side: THREE.DoubleSide });
        objects.leafMat = leafMat;
        const leafGeo = criarFolhaGeo();

        const leafPosicoes = [
            { y: 0.30, ang: 0.3, scl: 0.55, tilt: 0.55 },
            { y: 0.45, ang: 1.9, scl: 0.60, tilt: 0.50 },
            { y: 0.65, ang: 3.6, scl: 0.65, tilt: 0.55 },
            { y: 0.90, ang: 5.2, scl: 0.68, tilt: 0.50 },
            { y: 1.15, ang: 1.1, scl: 0.62, tilt: 0.55 },
            { y: 1.45, ang: 3.0, scl: 0.55, tilt: 0.55 },
            { y: 1.75, ang: 4.8, scl: 0.48, tilt: 0.60 },
            { y: 2.05, ang: 0.6, scl: 0.42, tilt: 0.60 },
        ];
        leafPosicoes.forEach(p => {
            const leaf = new THREE.Mesh(leafGeo, leafMat);
            leaf.position.set(Math.cos(p.ang) * 0.09, p.y, Math.sin(p.ang) * 0.09);
            leaf.rotation.y = p.ang;
            leaf.rotation.x = -Math.PI / 2 + p.tilt;
            leaf.scale.setScalar(p.scl);
            leaf.castShadow = true;
            plantGrp.add(leaf);
        });
        // par de folhas na ponta de cada ramo lateral
        ramoPontas.forEach((pt, i) => {
            [0.35, -0.35].forEach(offset => {
                const leaf = new THREE.Mesh(leafGeo, leafMat);
                leaf.position.copy(pt).add(new THREE.Vector3(offset * 0.3, 0.1, offset * 0.15));
                leaf.rotation.y = i * 1.6 + offset;
                leaf.rotation.x = -Math.PI / 2 + 0.5;
                leaf.scale.setScalar(0.5);
                leaf.castShadow = true;
                plantGrp.add(leaf);
            });
        });

        // Cachos de tomate — pendurados nos ramos, não soltos pelo caule.
        // objects.fruits fica com os 5 tomates individuais (a animação de
        // crescimento na etapa de Absorção continua igual, escala 0 -> 1).
        // MeshPhysicalMaterial com clearcoat dá aquele brilho de tomate maduro.
        const tomatoMat = new THREE.MeshPhysicalMaterial({ color: 0xe4372b, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.15 });
        const calyxMat = new THREE.MeshStandardMaterial({ color: 0x3f6212, roughness: 0.6 });
        objects.fruits = [];

        function criarCacho(qtd) {
            const cachoGrp = new THREE.Group();
            const haste = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.18 * qtd, 5), ramoMat);
            haste.position.y = -0.09 * qtd;
            haste.rotation.x = 0.25;
            cachoGrp.add(haste);
            for (let i = 0; i < qtd; i++) {
                const fruitGrp = new THREE.Group();
                fruitGrp.position.set(0.05 * (i % 2 === 0 ? 1 : -1), -0.18 * (i + 1), 0.04 * i);
                const tomato = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 12), tomatoMat);
                tomato.castShadow = true;
                const calyx = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.08, 6), calyxMat);
                calyx.position.y = 0.15;
                fruitGrp.add(tomato, calyx);
                fruitGrp.scale.set(0, 0, 0); // sem fruto no início
                cachoGrp.add(fruitGrp);
                objects.fruits.push(fruitGrp);
            }
            return cachoGrp;
        }

        const cacho1 = criarCacho(2);
        cacho1.position.copy(ramoPontas[0]).add(new THREE.Vector3(0, -0.15, 0));
        plantGrp.add(cacho1);

        const cacho2 = criarCacho(2);
        cacho2.position.copy(ramoPontas[2]).add(new THREE.Vector3(0, -0.15, 0));
        plantGrp.add(cacho2);

        const cacho3 = criarCacho(1);
        cacho3.position.set(0.15, 1.55, 0.1);
        plantGrp.add(cacho3);

        plantGrp.scale.set(0.5, 0.5, 0.5); // começa murcha/pequena
        bedGrp.add(plantGrp);
        objects.plant = plantGrp;

        // F. TeraSensor (sonda verde real, vetorizada do modelo do TeraSensor)
        // Sem função de clique nem de movimento próprio — só decora o leito de solo.
        const probeGroup = new THREE.Group();
        const svgLoader = new THREE.SVGLoader();

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
            const zCamada = (probeIdx++) * 2;

            shapes.forEach((shape) => {
                if (isPin) {
                    return;
                } else {
                    const probeGeo = new THREE.ExtrudeGeometry(shape, {
                        depth: 200, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 10, bevelThickness: 15
                    });
                    const pm = new THREE.Mesh(probeGeo, probeMat);
                    pm.position.z += zCamada;
                    pm.castShadow = true;
                    probeGroup.add(pm);
                }
            });
        });

        const probeBbox = new THREE.Box3().setFromObject(probeGroup);
        const pCx = (probeBbox.max.x + probeBbox.min.x) / 2;
        const pCy = (probeBbox.max.y + probeBbox.min.y) / 2;
        probeGroup.children.forEach(child => { child.geometry.translate(-pCx, -pCy, 0); });

        // Escala tal como no modelo original do TeraSensor; posição ajustada
        // para a sonda ficar de pé, cravada no leito de terra (bedGrp).
        probeGroup.scale.set(0.0012, -0.0012, 0.0016);
        probeGroup.position.set(-1.5, 2.28, -1); // eixo Y calculado p/ os pinos afundarem no solo
        probeGroup.rotation.set(-0.04, -0.56, 0);
        bedGrp.add(probeGroup);
        objects.probeGroup = probeGroup;

        scene.add(bedGrp);
        objects.bedGrp = bedGrp;

        // Registro central de tudo que aparece no painel de controle manual
        objects.controlList = [
            { label: 'Tanque de Água', obj: objects.tankGroup },
            ...objects.nutrientGroups.flatMap(g => [
                { label: g.label + ' (corpo)', obj: g.tankGrp },
                { label: g.label + ' (válvula)', obj: g.valveGrp },
            ]),
            { label: 'Bomba', obj: objects.pumpGroup },
            { label: 'Caixa TeraSmart', obj: objects.teraGrp },
            { label: 'Leito de Solo (+ planta)', obj: objects.bedGrp },
            { label: 'Sonda TeraSensor', obj: objects.probeGroup },
        ];

        // Cabo — arqueia por cima de cada tanque até a bomba.
        // Os pontos ficam expostos em objects.cablePoints pra dar pra arrastar
        // no painel de controle manual (cada ajuste chama rebuildCable()).
        objects.cablePoints = [
            new THREE.Vector3(7.10, 0.70, -1.60),
            new THREE.Vector3(4.50, 3.90, -2.80),
            new THREE.Vector3(2.80, 1.00, -3.50),
            new THREE.Vector3(0.50, 0.20, -3.30),
            new THREE.Vector3(-1.00, 0.50, -3.50),
            new THREE.Vector3(-2.50, 0.10, -3.00),
            new THREE.Vector3(-4.00, 0.40, -3.60),
            new THREE.Vector3(-6.80, -1.80, -2.90),
            new THREE.Vector3(-11.10, -1.80, -5.40),
            new THREE.Vector3(-15.10, -1.90, -2.60),
            new THREE.Vector3(-15.60, 4.30, -2.30),
        ];
        const cableMat = new THREE.MeshStandardMaterial({color: 0x1e293b, roughness: 0.8});
        objects.cableCurve = new THREE.CatmullRomCurve3(objects.cablePoints);
        const cableMesh = new THREE.Mesh(new THREE.TubeGeometry(objects.cableCurve, 80, 0.06, 8, false), cableMat);
        scene.add(cableMesh);
        objects.cableMesh = cableMesh;
        window.rebuildCable = function() {
            const novaGeo = new THREE.TubeGeometry(objects.cableCurve, 80, 0.06, 8, false);
            objects.cableMesh.geometry.dispose();
            objects.cableMesh.geometry = novaGeo;
        };

        // G. Sistema de Partículas 
        dataParticles = new THREE.Group();
        scene.add(dataParticles);

        const fluidParticles = new THREE.Group();
        scene.add(fluidParticles);
        for(let i=0; i<40; i++) {
            const m = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 8), new THREE.MeshBasicMaterial({color: 0xffffff}));
            m.visible = false;
            fluidParticles.add(m);
            fluidPool.push(m);
        }

        // Listener de Resize
        window.addEventListener('resize', () => {
            const w = container.clientWidth || window.innerWidth;
            const h = container.clientHeight || window.innerHeight;
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h);
        });

        // Inicia Loop
        animate();
    }

    function spawnDataPulse(start, end, colorHex, duration) {
        const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(0.15, 8, 8),
            new THREE.MeshBasicMaterial({ color: colorHex })
        );
        mesh.position.copy(start);
        dataParticles.add(mesh);
        
        gsap.to(mesh.position, {
            x: end.x, y: end.y, z: end.z,
            duration: duration,
            ease: "power1.inOut",
            onComplete: () => { dataParticles.remove(mesh); }
        });
    }

    // Igual ao spawnDataPulse, mas anda por cima do cabo de verdade
    // (objects.cableCurve) em vez de ir em linha reta do início ao fim.
    function spawnDataPulseOnCable(colorHex, duration) {
        if (!objects.cableCurve) return;
        const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(0.15, 8, 8),
            new THREE.MeshBasicMaterial({ color: colorHex })
        );
        mesh.position.copy(objects.cableCurve.getPointAt(0));
        dataParticles.add(mesh);

        const proxy = { t: 0 };
        gsap.to(proxy, {
            t: 1,
            duration: duration,
            ease: "power1.inOut",
            onUpdate: () => { mesh.position.copy(objects.cableCurve.getPointAt(proxy.t)); },
            onComplete: () => { dataParticles.remove(mesh); }
        });
    }

    // --- LOOP DE RENDERIZAÇÃO ---
    const clock = new THREE.Clock();

    function animate() {
        requestAnimationFrame(animate);
        const delta = clock.getDelta();
        const time = clock.getElapsedTime();

        if (controls) controls.update();

        if (objects.pumpRotor && simState.rotorSpeed > 0) {
            objects.pumpRotor.rotation.z += simState.rotorSpeed;
        }

        if (simState.isFlowing && objects.pipeCurves) {
            simState.flowTime += delta * 0.35;

            const streams = [
                { curve: objects.pipeCurves.agua, cor: 0x3b82f6 },
                { curve: objects.pipeCurves.a,    cor: 0xef4444 },
                { curve: objects.pipeCurves.b,    cor: 0xeab308 },
                { curve: objects.pipeCurves.c,    cor: 0x22c55e },
            ];
            const porFluxo = 8; // bolinhas por líquido, igualmente espaçadas na curva
            let idx = 0;
            streams.forEach(({ curve, cor }) => {
                for (let i = 0; i < porFluxo; i++) {
                    const p = fluidPool[idx++];
                    p.visible = true;
                    p.material.color.setHex(cor);
                    const t = (simState.flowTime + i / porFluxo) % 1;
                    p.position.copy(curve.getPointAt(t));
                }
            });
            for (; idx < fluidPool.length; idx++) fluidPool[idx].visible = false;
        } else {
            fluidPool.forEach(p => p.visible = false);
        }

        if (objects.plant && objects.plant.scale.x > 0.5) {
            objects.plant.position.y = 1.5 + Math.sin(time * 2) * 0.03;
        }

        if (renderer && scene && camera) {
            renderer.render(scene, camera);
        }
    }

    // --- LÓGICA DE ANIMAÇÃO (MALHA FECHADA) ---
    const SIM_SPEED = 3; // 1 = velocidade original; 3 = 3x mais lento (tudo multiplicado por isso)

    function startHardwareSim() {
        if (isSimulating) return;
        isSimulating = true;
        
        btnSim.innerHTML = '<i class="ph-fill ph-spinner" style="font-size:1.2rem; animation: spin 1s linear infinite;"></i> Processando...';
        btnSim.style.background = '#F5B841'; 
        btnSim.style.color = 'var(--forest-2)';
        
        uiSensor.className = 'sensor-popup plate bad';
        uiVal.textContent = '21%'; uiEc.textContent = '0.4mS';
        if (uiConsumo) uiConsumo.classList.remove('vis');
        
        // Reseta o solo pra textura seca e a planta pro estado murcho/sem fruto
        objects.soloFertilMat.opacity = 0;
        
        gsap.to(objects.plant.scale, {x: 0.5, y: 0.5, z: 0.5, duration: 1 * SIM_SPEED});
        gsap.to(objects.plant.rotation, {z: 0.15, duration: 1 * SIM_SPEED});
        const _corMurcha = new THREE.Color(0xC9B458);
        gsap.to(objects.leafMat.color, {r: _corMurcha.r, g: _corMurcha.g, b: _corMurcha.b, duration: 1 * SIM_SPEED});
        objects.fruits.forEach(f => gsap.to(f.scale, {x: 0, y: 0, z: 0, duration: 0.6 * SIM_SPEED}));
        
        objects.waterLevel.scale.y = 1;
        objects.nutrients.forEach(n => n.scale.y = 1);
        simState.rotorSpeed = 0;
        simState.isFlowing = false;
        focusCamera(CAM_DEFAULT_POS, CAM_DEFAULT_TARGET, 1 * SIM_SPEED);

        const tl = gsap.timeline();

        // 1. Coleta
        tl.call(() => {
            showStep(1, "Coleta com TeraSensor", "A sonda capta o solo: a umidade caiu para 21% e a condutividade elétrica está defasada.");
            updateLCD('> LENDO DADOS', '  UMIDADE: 21%', '  EC: 0.4mS');
            focusCamera({ x: 6.21, y: 5.22, z: 9.50 }, { x: 7.0, y: 0.5, z: -1.5 }, 2.0 * SIM_SPEED);
            
            // As bolinhas seguem o cabo de verdade (objects.cableCurve), não uma
            // linha reta — do início do cabo (perto da sonda) até o fim (caixa).
            let count = 0;
            const interval = setInterval(() => {
                if(count > 3) clearInterval(interval);
                spawnDataPulseOnCable(0xF5B841, 1.4 * SIM_SPEED);
                count++;
            }, 300 * SIM_SPEED);
        })
        .to({}, {duration: 2.5 * SIM_SPEED})

        // 2. Análise (TeraSmart)
        .call(() => {
            showStep(2, "Análise Preditiva", "O TeraSmart recebe os dados e calcula a dosagem perfeita de água e nutrientes necessária.");
            uiSensor.className = 'sensor-popup plate processing';
            updateLCD('> ANALISANDO', '  DEFICIT DETECTADO', '  CALCULANDO DOSE...');
            focusCamera({ x: -16.45, y: 6.91, z: 9.12 }, { x: -15.6, y: 1.8, z: -2.8 }, 2.2 * SIM_SPEED);
        })
        .to({}, {duration: 2.5 * SIM_SPEED})

        // 3. Execução
        .call(() => {
            showStep(3, "Execução Autônoma", "Sem intervenção manual, a central comanda a abertura das válvulas e liga o sistema de bombeamento.");
            updateLCD('> INICIANDO', '  ACIONANDO BOMBA', '  ABRINDO VALVULAS');
            focusCamera({ x: -4.55, y: 5.79, z: 11.67 }, { x: -3.5, y: -0.5, z: -3.0 }, 1.3 * SIM_SPEED);
            const pPos = new THREE.Vector3(-15.60, 1.60, -2.80);
            
            spawnDataPulse(pPos, new THREE.Vector3(-7, -2, -3), 0x3b82f6, 1 * SIM_SPEED);
            objects.valves.forEach((v, idx) => {
                const targetX = [-4, -1, 2][idx];
                spawnDataPulse(pPos, new THREE.Vector3(targetX, 0.5, -3), 0x1DC78B, 1.2 * SIM_SPEED);
            });
        })
        .to({}, {duration: 1.5 * SIM_SPEED})
        .call(() => {
            objects.valves.forEach(v => {
                // Ao abrir, cor muda para verde e roda
                v.material.color.setHex(0x1DC78B);
                v.material.emissive.setHex(0x1DC78B);
                v.material.emissiveIntensity = 0.4;
                gsap.to(v.rotation, {y: Math.PI / 2, duration: 0.5 * SIM_SPEED});
            });
            gsap.to(simState, {rotorSpeed: 0.3, duration: 1 * SIM_SPEED});
        })

        // 4. Aplicação (Fertirrigação)
        .call(() => {
            showStep(4, "Aplicação", "Água e os nutrientes A, B e C fluem perfeitamente dosados na linha principal.");
            updateLCD('SETOR 01:', 'FERTIRRIGANDO...', 'SETOR 02: IRRIGANDO');
            focusCamera({ x: -5.31, y: 9.86, z: 15.34 }, { x: -4.0, y: 2.0, z: -3.0 }, 2.4 * SIM_SPEED);
            simState.isFlowing = true;
            
            // Cada tanque baixa de nível proporcional ao que ele de fato gasta no
            // ciclo (litros consumidos / capacidade do tanque) — não é mais um
            // valor fixo igual pra todos.
            const quedaNivel = (liq) => {
                const consumidoL = liq.vazaoLmin * duracaoCicloMin;
                const fracao = consumidoL / liq.capacidadeL;
                return 1 - Math.min(fracao, 0.6); // nunca deixa o tanque esvaziar visualmente
            };

            gsap.to(objects.waterLevel.scale, {y: quedaNivel(LIQUIDOS.agua), duration: 4 * SIM_SPEED, ease: "none"});
            const ordemNutrientes = ['a', 'b', 'c']; // segue a ordem de criação dos tanques: vermelho, amarelo, verde
            objects.nutrients.forEach((n, idx) => {
                gsap.to(n.scale, {y: quedaNivel(LIQUIDOS[ordemNutrientes[idx]]), duration: 4 * SIM_SPEED, ease: "none"});
            });
        })
        .to({}, {duration: 3.5 * SIM_SPEED})

        // 5. Correção (Planta reage)
        .call(() => {
            showStep(5, "Absorção", "A planta responde positivamente. O solo é saturado até a condição de alvo estipulada pela receita.");
            updateLCD('> ACOMPANHANDO', '  UMIDADE SUBINDO', '  AJUSTANDO EC...');
            const focoCamDur = 2.2 * SIM_SPEED;
            focusCamera({ x: 7.45, y: 7.49, z: 13.67 }, { x: 8.5, y: 1.2, z: -1.0 }, focoCamDur);
            
            // Solo, planta e frutos só começam a crescer depois que a câmera
            // termina de chegar no leito (delay = focoCamDur) — assim dá pra
            // ver o crescimento acontecendo, em vez de já chegar tudo grande.
            gsap.to(objects.soloFertilMat, { opacity: 1, duration: 3 * SIM_SPEED, delay: focoCamDur });

            gsap.to(objects.plant.scale, {x: 2, y: 2, z: 2, duration: 3 * SIM_SPEED, delay: focoCamDur, ease: "back.out(1.5)"});
            gsap.to(objects.plant.rotation, {z: 0, duration: 3 * SIM_SPEED, delay: focoCamDur});
            const _corSaudavel = new THREE.Color(0x2f9e44);
            gsap.to(objects.leafMat.color, {r: _corSaudavel.r, g: _corSaudavel.g, b: _corSaudavel.b, duration: 3 * SIM_SPEED, delay: focoCamDur});

            // Frutos só nascem depois que a planta termina de crescer
            // (delay = tempo até a câmera chegar + tempo do crescimento da planta)
            const plantaCresceuEm = focoCamDur + 3 * SIM_SPEED;
            objects.fruits.forEach((f, i) => {
                gsap.to(f.scale, {
                    x: 1, y: 1, z: 1,
                    duration: 1 * SIM_SPEED,
                    delay: plantaCresceuEm + i * 0.25 * SIM_SPEED,
                    ease: "back.out(2)"
                });
            });

            let proxy = { u: 21, e: 0.4 };
            gsap.to(proxy, {
                u: 68, e: 1.3, duration: 3 * SIM_SPEED, ease: "none",
                onUpdate: () => {
                    if(uiVal) uiVal.textContent = Math.floor(proxy.u) + '%';
                    if(uiEc) uiEc.textContent = proxy.e.toFixed(1) + 'mS';
                }
            });
        })
        .to({}, {duration: 8 * SIM_SPEED})

        // 6. Conclusão
        .call(() => {
            showStep(6, "Malha Fechada", "A meta foi atingida. O TeraSmart desliga o sistema, contabiliza o gasto de cada líquido e retoma o monitoramento contínuo.");
            updateLCD('TERASMART OS v2', 'STATUS: ATIVO', 'MONITORANDO...');
            focusCamera(CAM_DEFAULT_POS, CAM_DEFAULT_TARGET, 2.5 * SIM_SPEED);
            
            simState.isFlowing = false;
            gsap.to(simState, {rotorSpeed: 0, duration: 1 * SIM_SPEED});
            
            objects.valves.forEach(v => {
                v.material.color.setHex(0xef4444);
                v.material.emissiveIntensity = 0;
                gsap.to(v.rotation, {y: 0, duration: 0.5 * SIM_SPEED});
            });
            
            uiSensor.className = 'sensor-popup plate good';
            mostrarConsumoCiclo();
            
            btnSim.innerHTML = '<i class="ph-bold ph-check" style="font-size: 1.2rem;"></i> Ciclo Concluído';
            btnSim.style.background = 'var(--signal)';
            btnSim.style.color = 'var(--forest-2)';
        })
        .to({}, {duration: 4 * SIM_SPEED})
        
        // Reset 
        .call(() => {
            setTimeout(() => {
                btnSim.innerHTML = '<i class="ph-bold ph-play" style="font-size: 1.2rem;"></i> Iniciar Ciclo de Fertirrigação';
                isSimulating = false;
            }, 600);
        });
    }


    // Inicialização segura ao DOM estar pronto
    if (document.readyState === 'complete') {
        init3D(); initUI();
    } else {
        window.addEventListener('DOMContentLoaded', () => { init3D(); initUI(); });
    }

    // Expõe pro atributo onclick="startHardwareSim()" do botão funcionar
    // (a função fica isolada aqui dentro do IIFE, então precisa desse link manual)
    window.startHardwareSim = startHardwareSim;


})();
