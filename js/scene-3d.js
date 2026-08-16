/* ==========================================================================
   TeraBoard · Cena 3D de fundo — a marca extrudada que gira com o scroll

   Cada pagina configura a cena pelo proprio HTML, em #canvas-container:
     data-scale       escala da marca (o index usa uma marca maior)
     data-intro-fade  "true" apaga o aviso "role para explorar" ao rolar

   A geometria vem do SVG abaixo, que e a mesma marca de
   assets/logo/teraboard-mark-3d.svg. Ela fica inline de proposito: assim a
   cena nao depende de fetch() e a pagina continua funcionando aberta
   direto do disco (file://), sem servidor.
   ========================================================================== */

window.addEventListener('load', function () {
  var host = document.getElementById('canvas-container');
  if (!host || typeof THREE === 'undefined') { window.__hideLoader && window.__hideLoader(); return; }

  var cfg = host.dataset || {};
  var scaleFactor = parseFloat(cfg.scale) || 0.0000024;
  var introFade = cfg.introFade === 'true';

  // 1. Cena, camera e renderizador transparente (o fundo do body aparece)
  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  var renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  host.appendChild(renderer.domElement);

  // Luzes: dao volume ao material extrudado
  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  var directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
  directionalLight.position.set(1, 1, 2);
  scene.add(directionalLight);

  var svgString = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" shape-rendering="geometricPrecision" ' +
    'text-rendering="geometricPrecision" image-rendering="optimizeQuality" fill-rule="evenodd" ' +
    'clip-rule="evenodd" viewBox="0 0 7287620 1549270">' +
    '<polygon fill="#1EC78C" points="441940,0 886210,383500 423300,753100 0,380010 "/>' +
    '<polygon fill="#0B4D36" points="1793450,391730 881550,1140080 882710,1549270 1793450,784540 "/>' +
    '<polygon fill="#1F8F68" points="1349180,1170 423300,751930 0,380010 0,777550 882710,1548110 882710,1143650 1793450,391730 "/>' +
    '</svg>';

  var loader = new THREE.SVGLoader();
  var svgData = loader.parse(svgString);

  var logoGroup = new THREE.Group();
  var pivotGroup = new THREE.Group();

  var EXTRUDE = { depth: 400000, bevelThickness: 20000, bevelSize: 20000, bevelSegments: 3, bevelEnabled: true };

  svgData.paths.forEach(function (path) {
    var material = new THREE.MeshStandardMaterial({
      color: path.color,
      roughness: 0.62,
      metalness: 0.35,
      side: THREE.DoubleSide
    });
    path.toShapes(true).forEach(function (shape) {
      logoGroup.add(new THREE.Mesh(new THREE.ExtrudeGeometry(shape, EXTRUDE), material));
    });
  });

  // Centralizar a geometria no proprio pivo
  var box = new THREE.Box3().setFromObject(logoGroup);
  logoGroup.position.sub(box.getCenter(new THREE.Vector3()));
  pivotGroup.add(logoGroup);

  pivotGroup.scale.set(scaleFactor, -scaleFactor, scaleFactor);
  scene.add(pivotGroup);
  camera.position.z = 7;

  /* Desenha SOB DEMANDA — nao 60 vezes por segundo.

     A logo so se mexe presa a barra de rolagem (o ScrollTrigger, mais abaixo).
     Com a pagina parada, o quadro seguinte e pixel por pixel igual ao anterior
     — e a versao antiga repintava a tela inteira, em tamanho de janela e com
     antialias, mesmo assim, para sempre.

     Em terahecta.html isso era pior do que desperdicio: aquela pagina embute a
     maquete num iframe, com um SEGUNDO contexto WebGL e um motor 3D de
     verdade. Os dois disputavam a mesma GPU, e um dos dois estava redesenhando
     uma imagem que ninguem tinha pedido para mudar.

     Agora um pedido de quadro so vira desenho quando algo mudou de fato: a
     rotacao (onUpdate do tween) ou o tamanho da janela. */
  var precisaDesenhar = true;
  function pedirQuadro() { precisaDesenhar = true; }

  (function animate() {
    requestAnimationFrame(animate);
    if (!precisaDesenhar) return;
    precisaDesenhar = false;
    renderer.render(scene, camera);
  })();

  // Quanto a logo 3D mede na tela, em px — o loader cresce ate exatamente isso,
  // por isso a troca de uma pela outra nao se percebe.
  // A 3D e um solido extrudado: a face que se ve fica ADIANTE do centro, entao
  // projeta maior. O calculo usa a face frontal, ja com o bisel.
  (function () {
    var PROFUNDIDADE = EXTRUDE.depth + 2 * EXTRUDE.bevelThickness;
    var LARGURA = 1793450 + 2 * EXTRUDE.bevelSize;
    var zFrente = (PROFUNDIDADE * scaleFactor) / 2;
    var distancia = camera.position.z - zFrente;
    var alturaVisivel = 2 * distancia * Math.tan(camera.fov * Math.PI / 360);
    window.__logo3dWidth = (LARGURA * scaleFactor) * (window.innerHeight / alturaVisivel);
  })();

  // A cena ja esta no tamanho final por tras do loader (sem zoom de entrada),
  // para que a logo do loading pouse exatamente em cima dela.
  window.__hideLoader();

  // 2. Rotacao vinculada a barra de rolagem
  if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') return;
  gsap.registerPlugin(ScrollTrigger);

  if (introFade) {
    // Some com o hint "role para explorar" assim que o usuario comeca a rolar
    gsap.to('#introScreen .intro-scroll', {
      opacity: 0,
      y: 14,
      scrollTrigger: { trigger: '#introScreen', start: 'top top', end: 'bottom top', scrub: true }
    });
  }

  gsap.to(pivotGroup.rotation, {
    scrollTrigger: { trigger: 'body', start: 'top top', end: 'bottom bottom', scrub: 1.5 },
    x: Math.PI * 4, // duas voltas completas conforme o usuario le o site
    y: Math.PI * 4,
    /* Quem manda desenhar. O scrub tem inercia: a rotacao continua correndo
       por um tempo depois que a rolagem parou, e e o tween — nao o evento de
       scroll — que sabe quando ela de fato terminou. */
    onUpdate: pedirQuadro
  });

  window.addEventListener('resize', function () {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    pedirQuadro();
  });
});
