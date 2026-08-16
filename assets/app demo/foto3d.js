/* =========================================================================
   Card 09 — o aparelho vira e fotografa o morango
   -------------------------------------------------------------------------
   Encenação em three.js, carregada SOB DEMANDA: o modelo do morango tem 6 MB
   e não pode pesar na abertura da vitrine.

   Duas decisões de enquadramento sustentam a cena:

   1. A câmera parte da distância em que o aparelho sai EXATAMENTE do tamanho
      da moldura em SVG — é o que faz a troca entre as duas passar
      despercebida. Durante a encenação ela recua, abrindo margem para o giro
      e para o morango. No fim volta, e a moldura assume de novo.

   2. O flash é luz de verdade: uma fonte pontual que estoura por um quarto de
      segundo e bate no morango. Um círculo aceso na carcaça não passa de um
      adesivo brilhante.
   ========================================================================= */

import * as THREE from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

/* Medidas do aparelho, em milímetros reais — as mesmas de `device.svg`. */
const BODY_W = 71.9;
const BODY_H = 150.0;
const BODY_D = 8.75;
const FRONT_Z = BODY_D / 2;

/* Raio dos cantos vistos de frente e arredondamento das quinas laterais. */
const CANTO = 11.5;
const BISEL = 0.85;

/* A rampa verde é a mesma de `device.svg`, na mesma ordem de claro a escuro. */
const VERDE_CLARO = 0x4DE5AD;
const VERDE = 0x1DC78B;
const VERDE_ESCURO = 0x13865F;
const VERDE_FUNDO = 0x0B563F;

const FOV = 22;
/** Quanto a câmera recua no meio da cena, para nada sair cortado. */
const RECUO_CAMERA = 0.62;

/*
 * Resolvido contra o PRÓPRIO módulo, e não contra a página. Assim a pasta
 * continua funcionando quando for colada em outro projeto, em qualquer nível
 * de diretório — um caminho relativo à página quebraria na primeira mudança
 * de lugar.
 */
const MODELO = new URL("assets/morango.obj", import.meta.url).href;

/* Roteiro, em segundos. Mexer aqui muda o ritmo da cena inteira. */
const T = {
	vira:   [0.15, 1.35],   // frente → costas
	entra:  [1.05, 2.10],   // o morango sobe na frente da lente
	clique: 2.50,           // obturador
	guarda: [2.80, 3.50],   // a foto encolhe para dentro do aparelho
	volta:  [3.40, 4.50],   // costas → frente
	fim:    4.70,
};

const suave = (t) => t * t * (3 - 2 * t);
const trecho = (t, [a, b]) => Math.min(1, Math.max(0, (t - a) / (b - a)));

// ---------------------------------------------------------------------------
// Texturas geradas
// ---------------------------------------------------------------------------

/**
 * Textura do que aparece na tela de frente.
 *
 * O aparelho só fica de frente nos dois instantes em que a cena troca com a
 * moldura em SVG, e já girando. Não precisa ser a página de verdade —
 * precisa não destoar no quadro em que as duas se cruzam.
 */
function telaAproximada() {
	const c = document.createElement("canvas");
	c.width = 402; c.height = 874;
	const g = c.getContext("2d");

	g.fillStyle = "#FFFFFF"; g.fillRect(0, 0, 402, 874);
	g.fillStyle = "#0B4D36"; g.fillRect(0, 0, 402, 210);

	g.fillStyle = "rgba(240,241,227,0.9)"; g.fillRect(24, 120, 210, 26);
	g.fillStyle = "rgba(240,241,227,0.5)"; g.fillRect(24, 158, 130, 12);

	g.fillStyle = "#F0F1E3"; arredondado(g, 20, 170, 362, 120, 16); g.fill();

	g.fillStyle = "#E8ECEB";
	for (let i = 0; i < 6; i++) { arredondado(g, 24, 330 + i * 84, 354, 56, 12); g.fill(); }

	const tex = new THREE.CanvasTexture(c);
	tex.colorSpace = THREE.SRGBColorSpace;
	return tex;
}

function arredondado(g, x, y, w, h, r) {
	g.beginPath();
	g.moveTo(x + r, y);
	g.arcTo(x + w, y, x + w, y + h, r);
	g.arcTo(x + w, y + h, x, y + h, r);
	g.arcTo(x, y + h, x, y, r);
	g.arcTo(x, y, x + w, y, r);
	g.closePath();
}

/** Halo do flash: claro no miolo, some nas bordas. */
function halo() {
	const c = document.createElement("canvas");
	c.width = c.height = 128;
	const g = c.getContext("2d");
	const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
	grad.addColorStop(0.0, "rgba(255,255,255,1)");
	grad.addColorStop(0.22, "rgba(255,248,224,0.85)");
	grad.addColorStop(0.55, "rgba(255,232,170,0.25)");
	grad.addColorStop(1.0, "rgba(255,225,150,0)");
	g.fillStyle = grad;
	g.fillRect(0, 0, 128, 128);

	const tex = new THREE.CanvasTexture(c);
	tex.colorSpace = THREE.SRGBColorSpace;
	return tex;
}

// ---------------------------------------------------------------------------
// O aparelho
// ---------------------------------------------------------------------------

/**
 * Perfil do aparelho visto de frente: retângulo de cantos arredondados.
 *
 * Tudo que tem a silhueta do aparelho sai daqui — carcaça, vidro da frente,
 * chapa das costas e platô das câmeras.
 */
function perfil(largura, altura, raio) {
	const x = largura / 2;
	const y = altura / 2;
	const r = Math.min(raio, x, y);
	const s = new THREE.Shape();

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
 * Sólido com esse perfil, extrudado e centrado na origem.
 *
 * É por extrusão, e não por `RoundedBoxGeometry`, porque o arredondamento que
 * o aparelho precisa é ANISOTRÓPICO: 11,5 mm de canto visto de frente e menos
 * de 1 mm de quina lateral. `RoundedBoxGeometry` só aceita um raio para os
 * três eixos, e exige que ele caiba na menor dimensão — num corpo de 8,75 mm
 * de espesso, o teto é 4,37 mm. Pedir 9,5 mm ali não dá erro: a esfera dos
 * cantos simplesmente estoura para fora da caixa, e o aparelho vira um bloco
 * quadrado com as arestas espetadas para fora. Era esse o defeito.
 */
function solido(largura, altura, raio, profundidade, bisel = 0) {
	const forma = perfil(largura - 2 * bisel, altura - 2 * bisel, raio - bisel);
	const nucleo = profundidade - 2 * bisel;

	const geo = new THREE.ExtrudeGeometry(forma, {
		depth: nucleo,
		bevelEnabled: bisel > 0,
		bevelThickness: bisel,
		bevelSize: bisel,
		bevelSegments: 4,
		curveSegments: 28,
	});
	geo.translate(0, 0, -nucleo / 2);
	return geo;
}

/**
 * A marca da TeraBoard em relevo, no lugar da maçã.
 *
 * São os três polígonos de `teraboard-mark.svg`, transcritos em vez de
 * carregados: o SVGLoader traria mais um módulo pela rede só para ler doze
 * pares de coordenadas. Todos usam o mesmo metal — a marca é monocromática —
 * e o que separa uma face da outra é a altura do relevo, não a cor.
 */
const MARCA = [
	[[168251, 2], [337388, 146003], [161154, 286712], [0, 144673]],
	[[682780, 149136], [335613, 434034], [336055, 589816], [682780, 298678]],
	[[513643, 446], [161154, 286267], [0, 144673], [0, 296016],
	 [336055, 589375], [336055, 435393], [682780, 149136]],
];

function marca(material, larguraFinal) {
	const g = new THREE.Group();
	const k = larguraFinal / 682780;

	MARCA.forEach((pontos, i) => {
		const forma = new THREE.Shape();
		pontos.forEach(([x, y], j) => {
			// x espelhado: a marca é vista pelas COSTAS, e sem o espelho ela
			// sairia invertida para quem olha.
			const px = -(x - 341390) * k;
			const py = (294908 - y) * k;
			if (j === 0) forma.moveTo(px, py); else forma.lineTo(px, py);
		});
		forma.closePath();

		const alto = 0.16 + i * 0.05;
		const geo = new THREE.ExtrudeGeometry(forma, { depth: alto, bevelEnabled: false });
		geo.translate(0, 0, -alto);   // cresce para fora das costas, não para dentro
		g.add(new THREE.Mesh(geo, material));
	});

	return g;
}

function montarAparelho() {
	const g = new THREE.Group();

	const metal = new THREE.MeshStandardMaterial({
		color: VERDE, metalness: 0.95, roughness: 0.28,
	});

	// --- Carcaça ---
	g.add(new THREE.Mesh(solido(BODY_W, BODY_H, CANTO, BODY_D, BISEL), metal));

	// --- Frente: vidro preto e a tela ---
	const vidroFrente = new THREE.Mesh(
		solido(BODY_W - 1.6, BODY_H - 1.6, CANTO - 0.8, 0.5),
		new THREE.MeshStandardMaterial({ color: 0x0A0C0F, metalness: 0.4, roughness: 0.1 }),
	);
	vidroFrente.position.z = FRONT_Z - 0.1;
	g.add(vidroFrente);

	const tela = new THREE.Mesh(
		new THREE.PlaneGeometry(65.5, 142.4),
		new THREE.MeshBasicMaterial({ map: telaAproximada() }),
	);
	tela.position.z = FRONT_Z + 0.22;
	g.add(tela);

	// --- Costas: vidro e o painel claro do meio ---
	const costas = new THREE.Mesh(
		solido(BODY_W - 1.6, BODY_H - 1.6, CANTO - 0.8, 0.5),
		new THREE.MeshStandardMaterial({ color: VERDE_CLARO, metalness: 0.5, roughness: 0.34 }),
	);
	costas.position.z = -FRONT_Z + 0.1;
	g.add(costas);

	const painel = new THREE.Mesh(
		solido(BODY_W - 13, 72, 10, 0.35),
		new THREE.MeshStandardMaterial({ color: VERDE_CLARO, metalness: 0.35, roughness: 0.52 }),
	);
	painel.position.set(0, -19, -FRONT_Z - 0.2);
	g.add(painel);

	const logo = marca(
		new THREE.MeshStandardMaterial({ color: VERDE, metalness: 1.0, roughness: 0.16 }),
		23,
	);
	logo.position.set(0, -19, -FRONT_Z - 0.36);
	g.add(logo);

	// --- Platô das câmeras ---
	// Atravessa quase toda a largura e encosta nas duas bordas, como no 17 Pro:
	// as três objetivas ficam à esquerda e o flash sozinho à direita.
	const PLATO_Y = BODY_H / 2 - 21;
	const plato = new THREE.Mesh(
		solido(BODY_W - 4.5, 31, 9.5, 2.7, 0.6),
		new THREE.MeshStandardMaterial({ color: VERDE_ESCURO, metalness: 0.92, roughness: 0.26 }),
	);
	plato.position.set(0, PLATO_Y, -FRONT_Z - 1.15);
	g.add(plato);
	const PLATO_Z = -FRONT_Z - 2.5;   // face externa do platô

	const vidroLente = new THREE.MeshStandardMaterial({
		color: 0x090D11, metalness: 0.95, roughness: 0.06,
	});
	const aroMetal = new THREE.MeshStandardMaterial({
		color: VERDE_FUNDO, metalness: 0.97, roughness: 0.22,
	});

	// Triângulo à esquerda: duas empilhadas na borda e a terceira recuada.
	[[-22.5, 7.4], [-22.5, -7.4], [-9.5, 0]].forEach(([lx, ly]) => {
		const aro = new THREE.Mesh(new THREE.CylinderGeometry(6.3, 6.3, 2.2, 48), aroMetal);
		aro.rotation.x = Math.PI / 2;
		aro.position.set(lx, PLATO_Y + ly, PLATO_Z - 1.1);
		g.add(aro);

		const vidro = new THREE.Mesh(new THREE.CylinderGeometry(4.7, 4.7, 2.4, 48), vidroLente);
		vidro.rotation.x = Math.PI / 2;
		vidro.position.set(lx, PLATO_Y + ly, PLATO_Z - 1.3);
		g.add(vidro);
	});

	// Sensor LiDAR e o furo do microfone, do lado do flash.
	const lidar = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 1.0, 32), vidroLente);
	lidar.rotation.x = Math.PI / 2;
	lidar.position.set(15.5, PLATO_Y - 7.4, PLATO_Z - 0.4);
	g.add(lidar);

	const microfone = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.8, 20), vidroLente);
	microfone.rotation.x = Math.PI / 2;
	microfone.position.set(23, PLATO_Y - 0.5, PLATO_Z - 0.3);
	g.add(microfone);

	// --- Botões laterais ---
	// Só aparecem no giro, que é justamente quando o aparelho mostra o perfil.
	const botao = new THREE.MeshStandardMaterial({
		color: VERDE_ESCURO, metalness: 0.94, roughness: 0.3,
	});
	const nasLaterais = [
		[-1, 40, 9], [-1, 25, 19], [-1, 3, 19],   // ação, volume + e volume −
		[1, 30, 26], [1, -2, 12],                 // energia e controle da câmera
	];
	nasLaterais.forEach(([lado, by, bh]) => {
		const b = new THREE.Mesh(new RoundedBoxGeometry(1.7, bh, 4.4, 3, 0.75), botao);
		b.position.set(lado * (BODY_W / 2 - 0.25), by, 0);
		g.add(b);
	});

	// --- Flash: lâmpada, halo e a luz de verdade ---
	const posFlash = new THREE.Vector3(15.5, PLATO_Y + 7.4, PLATO_Z - 0.2);

	const aroFlash = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.1, 0.9, 32), aroMetal);
	aroFlash.rotation.x = Math.PI / 2;
	aroFlash.position.set(posFlash.x, posFlash.y, PLATO_Z - 0.35);
	g.add(aroFlash);

	const lampada = new THREE.Mesh(
		new THREE.CircleGeometry(2.5, 32),
		new THREE.MeshBasicMaterial({ color: 0x3A3222 }),
	);
	lampada.position.copy(posFlash).setZ(PLATO_Z - 0.85);
	lampada.rotation.y = Math.PI;
	g.add(lampada);

	const brilho = new THREE.Sprite(new THREE.SpriteMaterial({
		map: halo(),
		blending: THREE.AdditiveBlending,
		depthWrite: false,
		transparent: true,
		opacity: 0,
	}));
	brilho.position.copy(posFlash).setZ(posFlash.z - 1);
	brilho.scale.setScalar(30);
	g.add(brilho);

	/*
	 * `decay = 0` de propósito. O mundo aqui está em milímetros, então a queda
	 * física por distância exigiria intensidades na casa dos milhares e
	 * qualquer ajuste viraria adivinhação. Sem queda, a intensidade é um
	 * multiplicador direto — previsível de calibrar.
	 */
	const luzFlash = new THREE.PointLight(0xFFF4DC, 0, 0, 0);
	luzFlash.position.copy(posFlash).setZ(posFlash.z - 6);
	g.add(luzFlash);

	return { grupo: g, lampada, brilho, luzFlash };
}

// ---------------------------------------------------------------------------
// O morango
// ---------------------------------------------------------------------------

/**
 * O arquivo vem sem textura e com uma malha só, então a cor é resolvida na
 * geometria: o perfil do modelo mostra o corpo até z ≈ 2,7 e o cálice acima
 * disso. É essa fronteira que separa o vermelho do verde.
 */
function pintar(geometria) {
	const pos = geometria.attributes.position;
	const cores = new Float32Array(pos.count * 3);

	const vermelhoBaixo = new THREE.Color(0x8E1119);
	const vermelhoAlto = new THREE.Color(0xE03A2F);
	const verdeFolha = new THREE.Color(0x3E8B3A);
	const verdeCabo = new THREE.Color(0x5C7A32);
	const c = new THREE.Color();

	for (let i = 0; i < pos.count; i++) {
		// O modelo é Z-para-cima; a geometria ainda não foi rotacionada.
		const z = pos.getZ(i);

		if (z > 3.2) {
			c.copy(verdeCabo);
		} else if (z > 2.6) {
			// Faixa de mistura: o cálice não termina num plano.
			c.copy(vermelhoAlto).lerp(verdeFolha, Math.min(1, (z - 2.6) / 0.2));
		} else {
			// Mais claro no ombro, mais fechado na ponta.
			c.copy(vermelhoBaixo).lerp(vermelhoAlto, Math.min(1, z / 2.6));
		}

		cores[i * 3] = c.r;
		cores[i * 3 + 1] = c.g;
		cores[i * 3 + 2] = c.b;
	}

	geometria.setAttribute("color", new THREE.BufferAttribute(cores, 3));
}

function carregarMorango() {
	return new Promise((resolve, reject) => {
		new OBJLoader().load(MODELO, (obj) => {
			let malha = null;
			obj.traverse((filho) => { if (filho.isMesh && !malha) malha = filho; });
			if (!malha) return reject(new Error("OBJ sem malha"));

			const geo = malha.geometry;
			pintar(geo);
			geo.computeVertexNormals();

			const morango = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
				vertexColors: true,
				roughness: 0.38,
				metalness: 0.0,
			}));

			// Z-para-cima do arquivo → Y-para-cima do three.js, centrado na
			// origem e dimensionado em milímetros do aparelho.
			morango.rotation.x = -Math.PI / 2;
			geo.computeBoundingBox();
			const bb = geo.boundingBox;
			const centro = bb.getCenter(new THREE.Vector3());
			const k = 40 / (bb.max.z - bb.min.z);

			morango.scale.setScalar(k);
			morango.position.set(-centro.x * k, centro.z * k, centro.y * k);

			const suporte = new THREE.Group();
			suporte.add(morango);
			resolve(suporte);
		}, undefined, reject);
	});
}

// ---------------------------------------------------------------------------
// Cena
// ---------------------------------------------------------------------------

function luzes(cena) {
	cena.add(new THREE.HemisphereLight(0xdfe9e4, 0x0c1310, 0.7));

	const principal = new THREE.DirectionalLight(0xffffff, 2.0);
	principal.position.set(-90, 160, 220);
	cena.add(principal);

	const preenche = new THREE.DirectionalLight(0xbcd7cc, 0.7);
	preenche.position.set(180, -40, 150);
	cena.add(preenche);

	const recorte = new THREE.DirectionalLight(0xffd2a8, 1.3);
	recorte.position.set(160, 110, -170);
	cena.add(recorte);
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * Roda a encenação dentro de `host`, que precisa ter as mesmas medidas da
 * moldura em SVG.
 *
 * @param {HTMLElement} host
 * @param {object} passos { aoVirar, aoClicar, aoTerminar }
 */
export async function encenar(host, passos = {}) {
	const largura = host.clientWidth;
	const altura = host.clientHeight;

	const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
	renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
	renderer.setSize(largura, altura);
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.1;
	host.appendChild(renderer.domElement);

	const cena = new THREE.Scene();
	luzes(cena);

	// Sem um ambiente para refletir, metal vira plástico chapado: a carcaça
	// de titânio precisa ter o que espelhar.
	const pmrem = new THREE.PMREMGenerator(renderer);
	const ambiente = pmrem.fromScene(new RoomEnvironment(), 0.04);
	cena.environment = ambiente.texture;
	pmrem.dispose();

	// Distância em que o aparelho sai do tamanho da moldura em SVG.
	const dBase = (BODY_H / 2) / Math.tan((FOV * Math.PI) / 360);
	const camera = new THREE.PerspectiveCamera(FOV, largura / altura, 1, 3000);
	camera.position.z = dBase;

	const { grupo: aparelho, lampada, brilho, luzFlash } = montarAparelho();
	cena.add(aparelho);

	const morango = await carregarMorango();
	morango.visible = false;
	cena.add(morango);

	let clicou = false;
	let virou = false;
	let vivo = true;
	const inicio = performance.now();

	// Reaproveitados a cada quadro para não criar lixo no laço de render.
	const caixa = new THREE.Box3();
	const alvo = new THREE.Vector3();

	return new Promise((resolve) => {
		function quadro() {
			if (!vivo) return;
			const t = (performance.now() - inicio) / 1000;

			// --- O aparelho vira e abre espaço ---
			const giro = suave(trecho(t, T.vira));
			const desfaz = suave(trecho(t, T.volta));
			const recuo = giro - desfaz;

			aparelho.rotation.y = Math.PI * recuo;
			aparelho.rotation.z = 0.05 * recuo;
			aparelho.scale.setScalar(1 - 0.3 * recuo);
			aparelho.position.x = -16 * recuo;

			// A câmera recua junto: é isto que impede o corte nas bordas.
			camera.position.z = dBase * (1 + RECUO_CAMERA * recuo);

			if (!virou && giro > 0.55) { virou = true; passos.aoVirar?.(); }

			// --- O morango entra em quadro ---
			const entrada = suave(trecho(t, T.entra));
			const guarda = suave(trecho(t, T.guarda));

			morango.visible = entrada > 0 && guarda < 1;
			morango.scale.setScalar(entrada * (1 - 0.94 * guarda));
			morango.position.set(
				26 - 24 * guarda,
				-16 + 24 * entrada + 28 * guarda,
				34 - 30 * guarda,
			);
			morango.rotation.y = t * 0.85;
			morango.rotation.z = 0.1;

			/*
			 * Onde a mira tem de estar.
			 *
			 * A moldura do foco é um elemento da PÁGINA, sobreposto ao palco —
			 * ela não sabe nada de three.js. Antes o CSS a deixava parada em
			 * 73%/46%, um palpite: bastava a câmera recuar ou o morango entrar
			 * por outro lado para ela apontar para o vazio. Aqui o próprio
			 * morango é projetado na tela a cada quadro e diz onde está.
			 *
			 * O raio sai do mesmo jeito: um ponto na borda da fruta, projetado
			 * junto, e a distância entre os dois em pixels. Assim a moldura
			 * cresce quando ela se aproxima da lente.
			 */
			if (morango.visible) {
				/*
				 * O alvo é a caixa da fruta, não `morango.position`. A malha
				 * está deslocada dentro do grupo — a origem do grupo cai uns
				 * 40 mm abaixo do que se vê — e mirar na origem colocava a
				 * moldura sistematicamente abaixo do morango.
				 */
				caixa.setFromObject(morango);
				caixa.getCenter(alvo);
				const raio = 0.5 * Math.max(caixa.max.x - caixa.min.x, caixa.max.y - caixa.min.y);

				const centro = alvo.clone().project(camera);
				const borda = alvo.clone().setX(alvo.x + raio).project(camera);

				passos.aoMirar?.(
					(centro.x * 0.5 + 0.5) * 100,
					(-centro.y * 0.5 + 0.5) * 100,
					Math.max(34, Math.abs(borda.x - centro.x) * largura * 2.4),
				);
			}

			// --- Obturador ---
			if (!clicou && t >= T.clique) {
				clicou = true;
				passos.aoClicar?.();
			}

			// Estouro curto e assimétrico: sobe quase instantâneo e cai mais
			// devagar, que é como uma lâmpada de flash se comporta.
			const dt = t - T.clique;
			const pulso = dt < 0 ? 0 : Math.exp(-Math.pow(Math.max(0, dt) / 0.16, 1.6));

			luzFlash.intensity = pulso * 7;
			brilho.material.opacity = Math.min(1, pulso * 1.4);
			brilho.scale.setScalar(26 + pulso * 26);
			lampada.material.color.setRGB(0.22 + pulso * 0.78, 0.2 + pulso * 0.78, 0.14 + pulso * 0.7);

			renderer.render(cena, camera);

			if (t < T.fim) {
				requestAnimationFrame(quadro);
			} else {
				passos.aoTerminar?.();
				resolve({
					encerrar: () => {
						vivo = false;
						encerrar(renderer, cena, ambiente, host);
					},
				});
			}
		}

		quadro();
	});
}

function encerrar(renderer, cena, ambiente, host) {
	cena.traverse((o) => {
		o.geometry?.dispose();
		if (o.material) {
			const lista = Array.isArray(o.material) ? o.material : [o.material];
			lista.forEach((m) => { m.map?.dispose(); m.dispose(); });
		}
	});
	ambiente?.texture?.dispose();
	renderer.dispose();
	renderer.forceContextLoss();
	if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
}
