/*
 * TeraHecta — Gêmeo Digital 3D
 *
 * Módulo único: monta a cena, o terreno, as quatro áreas, as sondas, o HUD e o
 * modo filme com narração. Importa o three.js pelo importmap declarado no
 * index.html (vendor/three), então não depende de rede externa.
 *
 * Onde mexer primeiro:
 *   ASSETS          — os seis modelos .glb carregados no início
 *   TERASMART_URL   — link do produto no cartão de informação
 *   FALAS           — texto e minutagem das 63 falas da narração
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

// ===================================================================================
// TERAHECTA — GÊMEO DIGITAL
//
// Quatro áreas de 1 hectare (100 m × 100 m = 10.000 m² cada), uma estação autônoma
// por hectare, 6 sensores por estação a 30 cm de profundidade. As estações entregam
// na Caixa Principal, que fica na COTA ALTA junto da casa — fora da área onde a água
// se acumula.
//
// Este arquivo é a MAQUETE: geometria, câmera e narração. O funcionamento interno do
// produto — protocolos, eletrônica, firmware — não é descrito aqui nem na tela.
//
// Unidade da cena: 1 unidade = 1 metro. Todo modelo importado é escalado até bater
// com essa régua, e nada aqui é posicionado "no olho": as fileiras, os corredores,
// o trajeto do fazendeiro e as faixas de terra revolvida saem todos das MESMAS
// constantes geométricas, logo abaixo.
// ===================================================================================

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = THREE.MathUtils.clamp;

const IS_MOBILE = window.innerWidth <= 820
  || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

const Q = IS_MOBILE
  ? { rowStep:2, spacing:4.0, plantShadows:false, shadowMap:1024,
      pixelRatio:1.5, rainDrops:6000, terrainSeg:120, nearR:10, midR:26, farR:62 }
  : { rowStep:1, spacing:2.8, plantShadows:true, shadowMap:2048,
      pixelRatio:2, rainDrops:15000, terrainSeg:190, nearR:13, midR:32, farR:70 };

// ===================================================================================
// TOPOGRAFIA
//
// O terreno não é uma rampa com ondulação: é uma encosta com FORMA. Sobre a queda
// geral norte→sul entram feições do tamanho da propriedade e, dentro de cada
// hectare, um mesmo conjunto de quatro acidentes — esporão, grota, domo e bacia —
// GIRADO de 90° em 90° de um hectare para o outro.
//
// O giro é o que faz os quatro hectares serem diferentes sem serem arbitrários, e
// o motivo é hidrológico, não decorativo: o relevo local gira, mas a queda da
// encosta não. O esporão que na área A desce a encosta, na B a atravessa — e
// água que desce é canal, água que atravessa é barragem. Mesmo inventário de
// formas, comportamentos opostos. É por isso que o estudo de um hectare não
// serve para o vizinho, e é por isso que as seis posições de sensor saem
// diferentes em cada hectare.
// ===================================================================================
const SLOPE = 0.12;          // 12% de queda geral — encosta de café de montanha
const HA = 50;               // meio-lado de 1 hectare: 100 m × 100 m
const ROAD_HALF = 7;         // meia-largura do carreador em cruz
const WORLD = 148;           // o terreno vai muito além do plantio

// Patamar da sede: a Fazenda Boa traz o próprio gramado cercado, e um terreno
// em declive faria essa base enterrar de um lado e flutuar do outro. O terreno
// é achatado sob ela e volta ao relevo natural numa faixa de transição.
const SEDE = { x: 20, z: -122, raio: 17, borda: 13 };

// As quatro áreas, em 2×2, separadas pelo carreador em cruz. `rot` é o quarto
// de volta que o motivo do relevo leva naquele hectare — declarado aqui porque o
// próprio terreno depende dele.
const BLOCKS = [
  { id:'A', name:'ÁREA A', cx:-57, cz:-57, rot:0 },
  { id:'B', name:'ÁREA B', cx: 57, cz:-57, rot:1 },
  { id:'C', name:'ÁREA C', cx:-57, cz: 57, rot:2 },
  { id:'D', name:'ÁREA D', cx: 57, cz: 57, rot:3 },
];
const FOCUS = 'A';           // o hectare onde a história acontece
const PLANT_EDGE = 106;      // limite externo do plantio (|x| e |z|)

const suave = t => t * t * (3 - 2 * t);

/** 1 no miolo, 0 da borda para fora, com transição suave. */
function janela(t, dentro, fora) {
  const a = Math.abs(t);
  if (a <= dentro) return 1;
  if (a >= fora) return 0;
  return 1 - suave((a - dentro) / (fora - dentro));
}

/** Gaussiana alongada: lombada (A>0) ou canal (A<0) ao longo de um eixo. */
function lombada(x, z, cx, cz, graus, A, sigT, sigL) {
  const a = graus * Math.PI / 180;
  const ex = Math.cos(a), ez = Math.sin(a);
  const dx = x - cx, dz = z - cz;
  const t = dx * -ez + dz * ex;      // através do eixo
  const l = dx *  ex + dz * ez;      // ao longo do eixo
  return A * Math.exp(-(t*t)/(sigT*sigT) - (l*l)/(sigL*sigL));
}
/** Calota: domo (A>0) ou bacia (A<0). */
function calota(x, z, cx, cz, A, sig) {
  const dx = x - cx, dz = z - cz;
  return A * Math.exp(-(dx*dx + dz*dz)/(sig*sig));
}

// ------------------------------------------------------------- ESCALA DA FAZENDA
// Feições que não se repetem: é o que impede a propriedade de parecer quatro
// ladrilhos carimbados lado a lado.
function relevoGeral(x, z) {
  return -z * SLOPE
       + Math.sin(x * 0.020) * 1.7
       + Math.cos(z * 0.017) * 2.1
       + Math.sin((x + z) * 0.011) * 1.5
       + lombada(x, z, -78, -30,  22,  4.0, 42, 105)   // esporão a oeste
       + lombada(x, z,  34,  55, 104, -4.4, 30, 100);  // talvegue principal, a leste
}

// --------------------------------------------------------- MOTIVO DO HECTARE
// Quatro acidentes, um em cada quadrante, em coordenadas locais do hectare. A
// janela zera o motivo antes da divisa: o carreador em cruz fica na rampa lisa,
// que é onde carreador de verdade fica, e nenhum hectare emenda com degrau no
// vizinho.
function motivoHectare(u, v) {
  const h = lombada(u, v,  21, -16, -20,  8.0, 15, 34)    // esporão
          + lombada(u, v, -20,  14, 155, -7.5, 10, 31)    // grota
          + calota (u, v, -22, -27,  5.5, 17)             // domo
          + calota (u, v,  23,  25, -6.5, 12);            // bacia fechada
  return h * janela(u, 32, 49) * janela(v, 32, 49);
}

/** Quarto(s) de volta no plano, para o motivo cair diferente em cada hectare. */
function giro(u, v, r) {
  switch (r & 3) {
    case 0:  return [ u,  v];
    case 1:  return [ v, -u];
    case 2:  return [-u, -v];
    default: return [-v,  u];
  }
}

function relevoNatural(x, z) {
  let h = relevoGeral(x, z);
  for (const b of BLOCKS) {
    const u = x - b.cx, v = z - b.cz;
    if (Math.abs(u) > HA || Math.abs(v) > HA) continue;
    const [ur, vr] = giro(u, v, b.rot);
    h += motivoHectare(ur, vr);
    break;                       // as áreas não se sobrepõem
  }
  return h;
}

const SEDE_Y = relevoNatural(SEDE.x, SEDE.z);

function elevationAt(x, z) {
  const y = relevoNatural(x, z);
  const d = Math.hypot(x - SEDE.x, z - SEDE.z);
  if (d > SEDE.raio + SEDE.borda) return y;
  // suavização de Hermite entre o patamar e o relevo natural
  const t = Math.max(0, Math.min(1, (d - SEDE.raio) / SEDE.borda));
  return SEDE_Y + (y - SEDE_Y) * suave(t);
}

/** Gradiente do terreno por diferença central — usado no estudo e no escoamento. */
function gradienteEm(x, z, e = .75) {
  return [ (elevationAt(x + e, z) - elevationAt(x - e, z)) / (2*e),
           (elevationAt(x, z + e) - elevationAt(x, z - e)) / (2*e) ];
}

const ROW_SPACING = 3.6;         // espaçamento nominal entre fileiras
// Intervalo VERTICAL entre fileiras: é o que define a curva de nível de cada uma.
// Numa encosta de 12% ele dá exatamente os 3,6 m nominais; onde o terreno é mais
// íngreme as fileiras se aproximam, onde é mais manso se afastam — que é como
// plantio em nível se comporta no campo.
const ROW_DE = ROW_SPACING * SLOPE;

/** Está dentro de algum hectare plantado? (fora do carreador em cruz e da borda) */
function inPlanting(x, z) {
  return Math.abs(x) > ROAD_HALF && Math.abs(z) > ROAD_HALF
      && Math.abs(x) < PLANT_EDGE && Math.abs(z) < PLANT_EDGE;
}

// ===================================================================================
// CURVAS DE NÍVEL
//
// Com esporão e grota no hectare, a fileira deixa de ser "z em função de x": ela
// contorna o esporão, entra na grota e volta. Não existe fórmula — existe o
// conjunto de nível da cota, e ele se traça.
//
// Marching squares numa grade fina, com os segmentos depois emendados em
// polilinhas ordenadas. A ordem importa: é ela que permite plantar ao longo da
// fileira com espaçamento constante e transformar um corredor em caminho.
// ===================================================================================

/**
 * Amostra a cota numa grade. Separado do traçado de propósito: são ~60 curvas de
 * nível por hectare, e reamostrar o terreno para cada uma custaria três milhões de
 * avaliações — a grade é a mesma para todas.
 */
function amostrarGrade(f, x0, z0, x1, z1, passo) {
  const nx = Math.max(2, Math.round((x1 - x0) / passo));
  const nz = Math.max(2, Math.round((z1 - z0) / passo));
  const px = (x1 - x0) / nx, pz = (z1 - z0) / nz;
  const H = new Float32Array((nx + 1) * (nz + 1));
  for (let j = 0; j <= nz; j++)
    for (let i = 0; i <= nx; i++)
      H[j * (nx + 1) + i] = f(x0 + i * px, z0 + j * pz);
  return { nx, nz, px, pz, x0, z0, H };
}

function tracarNivel(grade, iso) {
  const { nx, nz, px, pz, x0, z0, H } = grade;
  const segs = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const h0 = H[j*(nx+1)+i] - iso,       h1 = H[j*(nx+1)+i+1] - iso;
      const h2 = H[(j+1)*(nx+1)+i+1] - iso, h3 = H[(j+1)*(nx+1)+i] - iso;
      let c = (h0 > 0 ? 1 : 0) | (h1 > 0 ? 2 : 0) | (h2 > 0 ? 4 : 0) | (h3 > 0 ? 8 : 0);
      if (c === 0 || c === 15) continue;
      const xa = x0 + i * px, xb = xa + px, za = z0 + j * pz, zb = za + pz;
      const mix = (a, b, ha, hb) => a + (b - a) * (ha / (ha - hb));
      const B = () => [mix(xa, xb, h0, h1), za];          // aresta de baixo
      const R = () => [xb, mix(za, zb, h1, h2)];          // direita
      const T = () => [mix(xb, xa, h2, h3), zb];          // topo
      const L = () => [xa, mix(zb, za, h3, h0)];          // esquerda
      // Sela: os dois cantos altos podem estar ligados por dentro ou por fora.
      // A média dos quatro cantos decide, e é o que evita o "xis" no meio da
      // curva quando a fileira passa exatamente na garganta entre dois morros.
      if (c === 5 || c === 10) {
        const m = (h0 + h1 + h2 + h3) / 4;
        if ((c === 5 && m <= 0) || (c === 10 && m > 0)) c += 100;
      }
      switch (c) {
        case 1: case 14: segs.push([L(), B()]); break;
        case 2: case 13: segs.push([B(), R()]); break;
        case 3: case 12: segs.push([L(), R()]); break;
        case 4: case 11: segs.push([R(), T()]); break;
        case 6: case 9:  segs.push([B(), T()]); break;
        case 7: case 8:  segs.push([L(), T()]); break;
        case 5:   segs.push([L(), B()]); segs.push([R(), T()]); break;
        case 10:  segs.push([B(), R()]); segs.push([T(), L()]); break;
        case 105: segs.push([L(), T()]); segs.push([B(), R()]); break;
        case 110: segs.push([L(), B()]); segs.push([R(), T()]); break;
      }
    }
  }
  if (!segs.length) return [];

  // ---- emenda: ponta com ponta, por chave arredondada
  const chave = p => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
  const mapa = new Map();
  segs.forEach((s, i) => {
    for (const p of s) {
      const k = chave(p);
      if (!mapa.has(k)) mapa.set(k, []);
      mapa.get(k).push(i);
    }
  });
  const usado = new Uint8Array(segs.length);
  const vizinho = (k, de) => (mapa.get(k) || []).find(i => i !== de && !usado[i]);
  const linhas = [];
  const puxar = (i0, aberto) => {
    usado[i0] = 1;
    const linha = [segs[i0][0], segs[i0][1]];
    for (const frente of [true, false]) {
      let atual = i0;
      for (;;) {
        const ponta = frente ? linha[linha.length - 1] : linha[0];
        const j = vizinho(chave(ponta), atual);
        if (j === undefined) break;
        usado[j] = 1;
        const [a, b] = segs[j];
        const proximo = chave(a) === chave(ponta) ? b : a;
        if (frente) linha.push(proximo); else linha.unshift(proximo);
        atual = j;
      }
    }
    linhas.push(linha);
  };
  // primeiro as curvas ABERTAS (que morrem na borda da janela), depois os anéis
  segs.forEach((s, i) => {
    if (usado[i]) return;
    if (s.some(p => (mapa.get(chave(p)) || []).length === 1)) puxar(i, true);
  });
  segs.forEach((s, i) => { if (!usado[i]) puxar(i, false); });
  return linhas.filter(l => l.length > 2);
}

/**
 * Caminha por uma polilinha entregando pontos igualmente espaçados em
 * COMPRIMENTO DE ARCO, junto com a direção da linha ali — é essa direção que
 * alinha a copa do cafeeiro com a fileira em vez de deixá-la atravessada.
 */
function passearNaLinha(linha, espaco, aoPonto) {
  let sobra = espaco * .5;
  for (let i = 1; i < linha.length; i++) {
    const [ax, az] = linha[i-1], [bx, bz] = linha[i];
    const d = Math.hypot(bx - ax, bz - az);
    if (d < 1e-6) continue;
    const dx = (bx - ax)/d, dz = (bz - az)/d;
    let t = sobra;
    while (t <= d) {
      aoPonto(ax + dx * t, az + dz * t, dx, dz);
      t += espaco;
    }
    sobra = t - d;
  }
}

// ---------------------------------------------------------------- FILEIRAS
// Cada hectare devolve suas fileiras e seus corredores como curvas de nível: as
// fileiras nas cotas múltiplas do intervalo vertical, os corredores exatamente
// no meio do caminho entre duas fileiras.
// ------------------------------------------------------------------------------
// O INTERVALO VERTICAL ENTRE FILEIRAS É ADAPTATIVO.
//
// Curva de nível a intervalo de cota fixo tem um defeito conhecido: onde o
// terreno amansa, duas curvas vizinhas se afastam sem limite — e a primeira
// versão disto deixou clareiras enormes justamente nos patamares, que na vida
// real são a melhor parte do hectare para plantar.
//
// A correção é a mesma do campo: o que se mantém constante é a distância NO
// CHÃO entre fileiras, não a diferença de altura. A cada curva traçada, mede-se
// a declividade média ao longo dela e daí sai o degrau até a próxima.
// ------------------------------------------------------------------------------
const ALVO_H = ROW_SPACING * Q.rowStep;      // distância de chão pretendida
const curvasPorArea = {};
BLOCKS.forEach(b => {
  const grade = amostrarGrade(elevationAt, b.cx - HA, b.cz - HA, b.cx + HA, b.cz + HA, 1.1);
  let lo = Infinity, hi = -Infinity;
  for (const y of grade.H) { if (y < lo) lo = y; if (y > hi) hi = y; }

  // O degrau é FINO E FIXO, e quem decide o espaçamento real é o desbaste na
  // hora de plantar.
  //
  // Tentei antes deduzir o degrau da declividade da curva anterior — pela média
  // e pelo quintil de baixo. Os dois abrem clareira, e pelo mesmo motivo: a
  // curva que serve de referência pode estar num canto do hectare e o trecho
  // manso no canto oposto, a dez metros de cota de distância. Nenhum número
  // tirado de UMA curva sabe do resto do hectare.
  //
  // Com o degrau fino, toda parte do hectare é atravessada por muitas curvas, e
  // o desbaste — que mede distância no CHÃO — escolhe quais viram fileira. O
  // resultado é espaçamento constante em metros de terreno, no barranco e no
  // patamar, que é como o cafezal é plantado de verdade.
  const PASSO_Y = ROW_DE * .2;
  const fileiras = [];
  let niv = 0;
  for (let y = Math.ceil(lo / PASSO_Y) * PASSO_Y; y <= hi; y += PASSO_Y, niv++)
    for (const pts of tracarNivel(grade, y)) fileiras.push({ niv, pts });
  curvasPorArea[b.id] = { fileiras, lo, hi };
});


// ===================================================================================
// ESTUDO TOPOGRÁFICO — de onde saem as seis posições de cada hectare
//
// Um sensor não fala por si: fala pela ZONA que ele representa. Por isso as
// posições não são escolhidas "espalhadas": cada hectare é lido antes, dividido
// nas zonas que se comportam de forma parecida, e cada sensor vai para o ponto
// mais típico de uma dessas zonas.
//
// O que define uma zona não é a altura. Duas áreas na mesma cota se comportam de
// forma oposta se uma for côncava — a água converge, encharca — e a outra
// convexa — a água diverge, seca primeiro. A leitura usa três coisas:
//
//   posição na encosta  ·  curvatura (convergente/divergente)  ·  declividade
//
// mais o acúmulo de escoamento, calculado na PROPRIEDADE inteira: a água que
// encharca o pé de um hectare pode ter caído no hectare de cima.
// ===================================================================================
const ZONAS = {
  bacia:   { nome:'Bacia de acúmulo', comporta:'baixa', risco:2.3,
             sobre:'côncava e fechada — a água entra e não sai sozinha' },
  grota:   { nome:'Grota de escoamento', comporta:'baixa', risco:1.9,
             sobre:'por onde a água do hectare desce, e leva sal e adubo junto' },
  sope:    { nome:'Sopé', comporta:'baixa', risco:1.6,
             sobre:'recebe o que desce de toda a encosta acima' },
  esporao: { nome:'Esporão', comporta:'alta', risco:1.8,
             sobre:'convexo e inclinado — a água se abre para os dois lados e some' },
  crista:  { nome:'Topo convexo', comporta:'alta', risco:1.7,
             sobre:'a parte mais alta, que drena primeiro e seca primeiro' },
  patamar: { nome:'Patamar', comporta:'media', risco:1.3,
             sobre:'trecho de pouca queda no meio da encosta — a água se demora' },
  encosta: { nome:'Meia-encosta', comporta:'media', risco:1.0,
             sobre:'a face regular da encosta, que é a maior parte do hectare' },
};
const zoneColors = { alta:0x3ffa8b, media:0xe8b64f, baixa:0xd97757 };

// ------------------------------------------------- ACÚMULO DE ESCOAMENTO (D8)
// Cada célula despeja na vizinha mais baixa; percorrendo da cota mais alta para a
// mais baixa, cada uma já recebeu tudo o que vinha de cima quando é processada.
const FLUXO = (() => {
  const passo = 2, lim = 128;
  const n = Math.round(lim * 2 / passo) + 1;
  const cel = i => -lim + i * passo;
  const Y = new Float32Array(n * n);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++)
      Y[j*n + i] = elevationAt(cel(i), cel(j));

  const ordem = Array.from({ length: n*n }, (_, i) => i)
    .sort((a, b) => Y[b] - Y[a]);
  const acum = new Float32Array(n * n).fill(1);
  for (const k of ordem) {
    const i = k % n, j = (k / n) | 0;
    let melhor = -1, maisFundo = Y[k];
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        const y = Y[jj*n + ii];
        if (y < maisFundo) { maisFundo = y; melhor = jj*n + ii; }
      }
    }
    if (melhor >= 0) acum[melhor] += acum[k];
  }
  return { n, passo, lim, acum, celula: passo * passo,
    em(x, z) {
      const i = Math.round((x + lim) / passo), j = Math.round((z + lim) / passo);
      if (i < 0 || j < 0 || i >= n || j >= n) return 1;
      return acum[j*n + i];
    } };
})();

// ------------------------------------------- DEPRESSÕES: ONDE A ÁGUA NÃO SAI
// O escoamento acumulado diz por onde a água PASSA. Isto diz onde ela FICA.
//
// Priority flood: da borda para dentro, sempre pela célula de menor cota, cada
// uma é levantada até o nível da soleira mais baixa por onde a água conseguiria
// escapar. Onde esse nível fica acima do terreno existe depressão fechada — a
// mesma pergunta que o topógrafo faz na planta: "de onde essa água não sai
// sozinha?".
//
// Uma conta só, dois usos: a classe "bacia" do estudo de cada hectare e a mancha
// de água que aparece na chuva saem daqui. Eram dois cálculos diferentes, e por
// isso discordavam — dava sensor classificado como "patamar" plantado dentro de
// uma poça de um metro.
const DEPRESSAO = (() => {
  const n = 200, passo = WORLD * 2 / n;
  const pos = i => -WORLD + (i + .5) * passo;
  const Y = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) Y[j*n + i] = elevationAt(pos(i), pos(j));

  const nivel = new Float32Array(n * n);
  const visto = new Uint8Array(n * n);
  const hV = new Float32Array(n * n), hK = new Int32Array(n * n);
  let hLen = 0;
  const troca = (a, c) => {
    const v = hV[a], k = hK[a]; hV[a] = hV[c]; hK[a] = hK[c]; hV[c] = v; hK[c] = k;
  };
  const empilhar = (v, k) => {
    let i = hLen++; hV[i] = v; hK[i] = k;
    while (i > 0) { const p = (i - 1) >> 1; if (hV[p] <= hV[i]) break; troca(p, i); i = p; }
  };
  const desempilhar = () => {
    const k = hK[0], v = hV[0];
    if (--hLen > 0) {
      hV[0] = hV[hLen]; hK[0] = hK[hLen];
      for (let i = 0;;) {
        const e = 2*i + 1, d = e + 1;
        let m = i;
        if (e < hLen && hV[e] < hV[m]) m = e;
        if (d < hLen && hV[d] < hV[m]) m = d;
        if (m === i) break;
        troca(m, i); i = m;
      }
    }
    return [v, k];
  };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    if (i > 0 && j > 0 && i < n-1 && j < n-1) continue;    // só a moldura: por ela a água sai
    const k = j*n + i; nivel[k] = Y[k]; visto[k] = 1; empilhar(Y[k], k);
  }
  const VIZ = [[1,0],[-1,0],[0,1],[0,-1]];
  while (hLen > 0) {
    const [v, k] = desempilhar();
    const i = k % n, j = (k / n) | 0;
    for (const [di, dj] of VIZ) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
      const kk = jj*n + ii;
      if (visto[kk]) continue;
      visto[kk] = 1;
      nivel[kk] = Math.max(Y[kk], v);
      empilhar(nivel[kk], kk);
    }
  }

  // Profundidade da depressão em cada ponto, e a LÂMINA que uma chuva forte
  // deixa: 1,1 m medidos a partir do fundo de cada mancha fechada. Encher a bacia
  // até a borda seria represa, não chuva.
  const LAMINA = 1.1;
  const prof = new Float32Array(n * n);
  for (let k = 0; k < n*n; k++) prof[k] = Math.max(0, nivel[k] - Y[k]);
  const lamina = new Float32Array(n * n);
  const fila = new Int32Array(n * n);
  const marcado = new Uint8Array(n * n);
  for (let k0 = 0; k0 < n*n; k0++) {
    if (marcado[k0] || prof[k0] <= .03) continue;
    let ini = 0, fim = 0, fundo = 0;
    fila[fim++] = k0; marcado[k0] = 1;
    while (ini < fim) {
      const k = fila[ini++];
      if (prof[k] > fundo) fundo = prof[k];
      const i = k % n, j = (k / n) | 0;
      for (const [di, dj] of VIZ) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        const kk = jj*n + ii;
        if (marcado[kk] || prof[kk] <= .03) continue;
        marcado[kk] = 1; fila[fim++] = kk;
      }
    }
    for (let q = 0; q < fim; q++) {
      const k = fila[q];
      lamina[k] = Math.max(0, Math.min(1, (prof[k] - (fundo - LAMINA)) / LAMINA));
    }
  }

  const indice = (x, z) => {
    const i = Math.round((x + WORLD) / passo - .5), j = Math.round((z + WORLD) / passo - .5);
    if (i < 0 || j < 0 || i >= n || j >= n) return -1;
    return j*n + i;
  };
  return { n, passo, prof, lamina,
    // profundidade da depressão fechada naquele ponto, em metros
    em: (x, z) => { const k = indice(x, z); return k < 0 ? 0 : prof[k]; },
    // 0 a 1: quanto da lâmina de chuva forte cobre aquele ponto
    laminaEm: (x, z) => { const k = indice(x, z); return k < 0 ? 0 : lamina[k]; } };
})();

// --------------------------------------------------- LEITURA DE CADA HECTARE
const GP = 2;                       // grade do estudo, em metros
const estudoPorArea = {};

BLOCKS.forEach(b => {
  const n = Math.round(HA * 2 / GP) + 1;
  const px = i => b.cx - HA + i * GP, pz = j => b.cz - HA + j * GP;
  const Y = new Float32Array(n*n), decl = new Float32Array(n*n);
  const curv = new Float32Array(n*n), umid = new Float32Array(n*n);
  const prof = new Float32Array(n*n);      // profundidade da depressão fechada

  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) Y[j*n+i] = elevationAt(px(i), pz(j));
  let lo = Infinity, hi = -Infinity;
  for (const y of Y) { if (y < lo) lo = y; if (y > hi) hi = y; }

  // ---- o ponto mais alto do hectare: é onde a estação vai
  //
  // A antena trabalha melhor de cima, e "de cima" agora quer dizer alguma coisa:
  // com esporão e domo no hectare, o centro geométrico pode estar oito metros
  // abaixo da crista. A margem de 8 m mantém a estação dentro da lavoura, e não
  // encostada na divisa.
  let alto = [b.cx, b.cz], altoY = -Infinity;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = px(i), z = pz(j);
      if (!inPlanting(x, z)) continue;
      if (Math.abs(x - b.cx) > HA - 8 || Math.abs(z - b.cz) > HA - 8) continue;
      if (Y[j*n+i] > altoY) { altoY = Y[j*n+i]; alto = [x, z]; }
    }
  }

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j*n + i;
      const x = px(i), z = pz(j);
      const [gx, gz] = gradienteEm(x, z, GP/2);
      decl[k] = Math.hypot(gx, gz);
      // Laplaciano: negativo onde a superfície é côncava (a água converge),
      // positivo onde é convexa (a água se abre).
      curv[k] = (elevationAt(x+GP, z) + elevationAt(x-GP, z)
               + elevationAt(x, z+GP) + elevationAt(x, z-GP) - 4*Y[k]) / (GP*GP);
      // Índice de umidade: quanta água passa por aqui contra a rapidez com que
      // ela escorre. É o mesmo raciocínio do índice topográfico de umidade.
      umid[k] = Math.log(FLUXO.em(x, z) * FLUXO.celula / Math.max(.02, decl[k]));
      prof[k] = DEPRESSAO.em(x, z);
    }
  }

  const mediana = arr => { const a = [...arr].sort((p,q)=>p-q); return a[a.length>>1]; };
  const quantil = (arr, p) => {
    const a = [...arr].sort((x,y) => x-y);
    return a[Math.min(a.length - 1, Math.floor(a.length * p))];
  };

  // Só onde há café: a faixa da divisa não é plantada, e sonda ali estaria lendo
  // terra de beira de carreador, não a lavoura.
  const uteis = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = px(i), z = pz(j);
      if (!inPlanting(x, z)) continue;
      // 9 m de recuo da divisa, e não 4: sonda encostada na estrema lê a borda do
      // talhão — bordadura, compactação de manobra, água que vem do vizinho.
      if (Math.abs(x - b.cx) > HA - 9 || Math.abs(z - b.cz) > HA - 9) continue;
      uteis.push(j*n + i);
    }
  }
  const declMed = mediana(uteis.map(k => decl[k]));
  const umidMed = mediana(uteis.map(k => umid[k]));

  // ===========================================================================
  // AS SEIS ZONAS DO HECTARE
  //
  // Um agrônomo não espalha seis sondas pelas manchas maiores do mapa. Ele
  // estratifica a lavoura pelas duas coisas que mandam na água do solo: ONDE na
  // encosta, e se ali a água CONVERGE ou se abre. Três terços por dois
  // comportamentos dão seis compartimentos — e uma sonda em cada.
  //
  // O critério anterior era área × risco. Ele produzia hectare com três esporões
  // e NENHUMA sonda no terço alto (o filme dizia "numa das zonas altas" com a
  // câmera plantada no pé do hectare), sonda de "patamar" dentro de uma poça de
  // um metro, e sonda respondendo por 0,7% da área ao lado de outra respondendo
  // por 46%. Seis sondas têm de repartir o hectare, não catar detalhe.
  // ===========================================================================
  const cotaAlta  = quantil(uteis.map(k => Y[k]), 2/3);
  const cotaBaixa = quantil(uteis.map(k => Y[k]), 1/3);
  const tercoDe = k => Y[k] >= cotaAlta ? 0 : Y[k] >= cotaBaixa ? 1 : 2;

  // Convergência: a curvatura (negativa = côncava, a água junta) somada ao
  // excesso de água que chega. As duas dizem a mesma coisa por caminhos
  // diferentes, e sozinha cada uma erra — a curvatura não sabe quanta água vem de
  // cima, e o acúmulo não distingue "passa por aqui" de "fica aqui". Depressão
  // fechada não precisa de índice: ali a água fica, ponto.
  const escalaC = Math.max(.01, mediana(uteis.map(k => Math.abs(curv[k]))) * 2);
  const escalaU = Math.max(.30, mediana(uteis.map(k => Math.abs(umid[k] - umidMed))) * 2);
  const convergencia = k => -curv[k]/escalaC + (umid[k] - umidMed)/escalaU + (prof[k] > .05 ? 3 : 0);

  // O corte entre convergente e divergente é a mediana DENTRO de cada terço. Um
  // corte único para o hectare devolveria o terço baixo inteiro convergente e o
  // alto inteiro divergente: isso é a encosta, não a variação dentro dela.
  const corte = [0,1,2].map(t => {
    const doTerco = uteis.filter(k => tercoDe(k) === t).map(convergencia);
    return doTerco.length ? mediana(doTerco) : 0;
  });
  const baldeDe = k => tercoDe(k)*2 + (convergencia(k) >= corte[tercoDe(k)] ? 0 : 1);

  // O nome sai do compartimento REFINADO pelo terreno do ponto: o compartimento
  // diz de que parte da encosta se trata e para onde a água vai ali; o terreno do
  // ponto diz qual das feições daquela família é. Nomear só pela curvatura do
  // ponto não funciona — a sonda fica no lugar típico do compartimento, onde a
  // curvatura é média, e caía tudo em "meia-encosta".
  const nomeDaZona = (k, t, converge) => {
    const x = px(k % n), z = pz((k / n) | 0);
    // Bacia é onde a água FICA — não a borda de uma depressão rasa. Aceitar
    // "prof > 0" chamava de bacia de acúmulo um ponto que a lâmina nem alcança.
    if (DEPRESSAO.laminaEm(x, z) > .10) return 'bacia';
    if (converge) {
      if (umid[k] > umidMed + .8 && decl[k] > declMed * .7) return 'grota';
      if (t === 2) return 'sope';
      return decl[k] < declMed * .6 ? 'patamar' : 'grota';
    }
    if (decl[k] > declMed * 1.15) return 'esporao';
    if (t === 0) return 'crista';
    return decl[k] < declMed * .6 ? 'patamar' : 'encosta';
  };

  // ---- a sonda de cada compartimento: o PONTO DE ATENÇÃO dele
  //
  // Não o ponto médio. Quem instala seis sondas num hectare não as põe na média
  // de cada pedaço: põe onde aquele pedaço dá problema. No compartimento que
  // converge, isso é o fundo — onde a água chega e fica. No que dispersa, é o
  // ombro convexo, que perde água primeiro. A sonda no meio termo não avisa nada
  // antes de a lavoura inteira já estar avisando.
  const VIZ8 = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  const spanY = Math.max(.5, hi - lo);
  const escolhidas = [], jaPostos = [];
  // Os que convergem escolhem primeiro: são os que têm ponto obrigatório — o
  // fundo da depressão, quando existe uma. Quem dispersa se acomoda no que sobra,
  // porque "o ombro que seca" tem muitos lugares igualmente bons no hectare.
  for (const bl of [4, 0, 2, 5, 1, 3]) {
    const celulas = uteis.filter(k => baldeDe(k) === bl);
    if (!celulas.length) continue;
    const converge = bl % 2 === 0;
    // Onde converge, água parada manda: havendo lâmina no compartimento, é nela
    // que a sonda vai — é o ponto que o agrônomo aponta primeiro no talhão.
    const carater = k => {
      const c = converge ? convergencia(k) : -convergencia(k);
      return converge ? c + 5 * DEPRESSAO.laminaEm(px(k % n), pz((k / n) | 0)) : c;
    };
    const cMed = mediana(celulas.map(carater));
    const cEsc = Math.max(.4, mediana(celulas.map(k => Math.abs(carater(k) - cMed))) * 3);

    const avaliar = k => {
      const i = k % n, j = (k / n) | 0, x = px(i), z = pz(j);
      // Caráter limitado: passado certo ponto, "mais extremo" não quer dizer mais
      // representativo, e o extremo do compartimento costuma estar espremido numa
      // quina do talhão. Sem o teto, quatro sondas de um hectare foram parar na
      // mesma faixa de 8 m rente à divisa norte.
      let nota = clamp((carater(k) - cMed) / cEsc, -1.5, 1.5);
      // no miolo do compartimento, não na fronteira com o vizinho: sonda em divisa
      // de zona lê a média de duas coisas e não fala por nenhuma
      let iguais = 0;
      for (const [di, dj] of VIZ8) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        if (baldeDe(jj*n + ii) === bl) iguais++;
      }
      nota += iguais * .16;
      // recuo suave da divisa, por cima do recorte duro: entre dois pontos de
      // atenção parecidos, o de dentro do talhão é o que se instala
      const daDivisa = Math.min(HA - Math.abs(x - b.cx), HA - Math.abs(z - b.cz));
      if (daDivisa < 20) nota -= (20 - daDivisa) * .09;
      // A estação ocupa o alto do hectare: clareira aberta no plantio, painel,
      // mastro e o acesso pisado em volta. Sonda a 17 m dela lia terra de pátio —
      // e, no filme, o plano de perto do sensor levava o mastro inteiro no quadro.
      if (Math.hypot(x - alto[0], z - alto[1]) < 22) nota -= 4;
      return nota;
    };

    // Espaçamento mínimo de verdade, e não penalidade: seis sondas amontoadas num
    // canto do hectare são seis leituras da mesma coisa. Só afrouxa se o
    // compartimento inteiro estiver dentro do raio das já postas.
    let melhor = null, melhorNota = -Infinity;
    for (const sep of [24, 19, 14, 0]) {
      for (const k of celulas) {
        const x = px(k % n), z = pz((k / n) | 0);
        if (jaPostos.some(([ox, oz]) => Math.hypot(x - ox, z - oz) < sep)) continue;
        const nota = avaliar(k);
        if (nota > melhorNota) { melhorNota = nota; melhor = k; }
      }
      if (melhor !== null) break;
    }
    if (melhor === null) continue;

    const centro = [px(melhor % n), pz((melhor / n) | 0)];
    jaPostos.push(centro);
    escolhidas.push({
      classe: nomeDaZona(melhor, tercoDe(melhor), converge),
      celulas, areaHa: celulas.length * GP*GP / 10000,
      centro, rel: (Y[melhor] - lo) / spanY,
      terco: ['alto','médio','baixo'][tercoDe(melhor)],
      converge,
      poca: DEPRESSAO.laminaEm(centro[0], centro[1]),
      prof: prof[melhor],
    });
  }

  estudoPorArea[b.id] = { escolhidas, lo, hi, alto, altoY };
});

// A estação de cada hectare, no alto dele. Tudo o que a envolve — a clareira do
// plantio, os cabos que chegam nela, o enlace que sai, os planos do filme — sai
// daqui, e não mais do centro geométrico do hectare.
const ESTACAO = {};
BLOCKS.forEach(b => {
  const [x, z] = estudoPorArea[b.id].alto;
  ESTACAO[b.id] = { x, z, y: elevationAt(x, z) };
});

// --------------------------------------------------- OS SENSORES, ENFIM
// Cada zona escolhida recebe um sensor no seu ponto mais típico. Ele não é
// empurrado para o corredor mais próximo: o plantio é que abre 3,6 m em volta
// dele, o que dá acesso ao técnico sem tirar o sensor do lugar que ele veio
// representar. Empurrar para o corredor mudaria a leitura de zona por comodidade
// de caminho — e a leitura é o motivo de o sensor existir.
const sensors = [];
BLOCKS.forEach(b => {
  estudoPorArea[b.id].escolhidas
    .slice()
    .sort((p, q) => q.rel - p.rel)          // numera de cima para baixo do hectare
    .forEach((m, i) => {
      const p = m.centro;
      const z = ZONAS[m.classe];
      sensors.push({
        id: `${b.id}${i + 1}`, block: b.id, blockRef: b,
        zona: m.classe, zonaNome: z.nome, zonaSobre: z.sobre,
        areaHa: m.areaHa, zone: z.comporta,
        terco: m.terco, converge: m.converge, poca: m.poca,
        posicao: `terço ${m.terco}`,
        x: p[0], z: p[1], y: elevationAt(p[0], p[1]),
      });
    });
});
const sensorById = Object.fromEntries(sensors.map(s => [s.id, s]));

// Os dois eventos da narrativa: a zona da área A que seca primeiro e a que
// encharca. Saem do estudo, não de um número escrito à mão — se o relevo mudar,
// a história continua acontecendo no lugar certo.
//
// E saem do COMPARTIMENTO, não do risco da classe. Pelo risco, o esporão do terço
// baixo ganhava da crista e virava "a zona que seca primeiro": a narração dizia
// "numa das zonas altas da área A" com a câmera plantada no pé do hectare, num
// ponto que na chuva aparecia molhado. Agora é literal — a que seca é a do terço
// ALTO que dispersa água, a que encharca é a do terço BAIXO que a recebe.
// A bacia de um hectare DE BAIXO. É dela que o capítulo 2 fala ao dizer que no
// ponto mais baixo a água empoça: mostrar só a área de acúmulo do sopé escondia
// que o mesmo acontece dentro do talhão, a metros de pé de café — que é o que o
// produtor pisa, e o que a Fase 3 vai drenar.
const BACIA_BAIXA = sensors
  .filter(s => s.blockRef.cz > 0 && s.poca > .1)
  .sort((p, q) => q.poca - p.poca || p.y - q.y)[0]
  || sensors.filter(s => s.blockRef.cz > 0).sort((p, q) => p.y - q.y)[0];

const doFoco = sensors.filter(s => s.block === FOCUS);
const DRY_ID = (doFoco.find(s => s.terco === 'alto' && !s.converge)
              || doFoco.find(s => !s.converge) || doFoco[0]).id;
const WET_ID = (doFoco.find(s => s.terco === 'baixo' && s.converge)
              || doFoco.find(s => s.converge) || doFoco[doFoco.length - 1]).id;

console.log('[TeraHecta] estudo topográfico:\n' + BLOCKS.map(b => {
  const e = estudoPorArea[b.id];
  return `  ${b.name} · desnível ${(e.hi - e.lo).toFixed(1)} m · `
       + sensors.filter(s => s.block === b.id)
           .map(s => `${s.id}=${s.zonaNome}/${s.terco} (${(s.areaHa*100).toFixed(0)}%)`).join(' · ');
}).join('\n'));

// ------------------------------------------------------------------ CONSTRUÇÕES
// Tudo na COTA ALTA (norte, z negativo): casa, Caixa Principal e meteorológica
// ficam acima da linha de acúmulo de água.
const HOUSE   = { x:  20, z:-122 };   // sede — ver SEDE/SEDE_Y
const MAINBOX = { x:   6, z:-121 };
const METEO   = { x: -13, z:-124 };
[HOUSE, MAINBOX, METEO].forEach(p => { p.y = elevationAt(p.x, p.z); });

// Área de acúmulo: o sopé de tudo, ao sul. É o objeto do estudo de drenagem.
const POND = { x: 0, z: 118, rx: 126, rz: 44 };

// ---------------------------------------------------------------------------------
// TRAJETOS DO FAZENDEIRO
//
// O trajeto É o corredor. Antes ele era remontado a partir das constantes do
// plantio; agora que o corredor é uma curva de nível traçada, não há o que
// remontar — o caminho é a própria polilinha por onde não existe planta, e o
// produtor chega ao sensor pelo mesmo lugar por onde chegaria no campo.
// ---------------------------------------------------------------------------------
function buildWalk(points) {
  return new THREE.CatmullRomCurve3(
    points.map(([x, z]) => V3(x, elevationAt(x, z), z)), false, 'catmullrom', 0.22);
}

const blockA = BLOCKS.find(b => b.id === FOCUS);

/**
 * O trecho de corredor que termina ao lado do sensor, vindo do lado do carreador.
 *
 * `livre` diz se um ponto está longe o bastante de qualquer cafeeiro. Ele só
 * existe depois do plantio, e é por isso que os trajetos são montados lá dentro:
 * corredor de verdade é onde não tem planta, e quem sabe onde tem planta é o
 * plantio, não a curva de nível.
 */
function aproximacaoDoSensor(s, livre, corredoresPorArea, comprimento = 34) {
  // Corredor não é "a curva mais perto do sensor": é a curva que passa ENTRE
  // duas fileiras plantadas. Como o desbaste escolhe quais curvas viram fileira,
  // a curva vizinha pode estar colada numa delas — e foi assim que o trajeto
  // saiu com três metros e a câmera do plano colou no rosto do produtor.
  //
  // Então todas as curvas perto do sensor são testadas, e vence a que oferece o
  // TRECHO LIVRE MAIS LONGO terminando ao lado dele.
  const trecho = (l, idx, passo) => {
    const pts = [];
    let somado = 0;
    for (let i = idx; i >= 0 && i < l.length; i += passo) {
      if (!livre(l[i][0], l[i][1])) break;
      if (pts.length) {
        const a = pts[pts.length - 1];
        somado += Math.hypot(l[i][0] - a[0], l[i][1] - a[1]);
      }
      pts.push(l[i]);
      if (somado > comprimento) break;
    }
    return { pts, somado };
  };

  let melhor = null;
  for (const l of corredoresPorArea[s.block] || []) {
    let idx = -1, dist = 100;                      // só carreadores a menos de 10 m
    for (let i = 0; i < l.length; i++) {
      const d = (l[i][0] - s.x)**2 + (l[i][1] - s.z)**2;
      if (d < dist) { dist = d; idx = i; }
    }
    if (idx < 0 || !livre(l[idx][0], l[idx][1])) continue;
    for (const passo of [1, -1]) {
      const t = trecho(l, idx, passo);
      // Desempate pelo comprimento livre; a distância ao sensor entra como
      // desconto leve, para não pegar um corredor bom mas longe.
      const nota = t.somado - Math.sqrt(dist) * 1.5;
      if (!melhor || nota > melhor.nota) melhor = { ...t, nota };
    }
  }
  if (!melhor || melhor.pts.length < 3) return [[s.x - 3.2, s.z], [s.x - 1.8, s.z]];

  const pts = melhor.pts;
  // Ele para AO LADO do sensor, não em cima dele.
  while (pts.length > 2 && Math.hypot(pts[0][0] - s.x, pts[0][1] - s.z) < 1.6) pts.shift();
  return pts.filter((_, i) => i % 3 === 0 || i === pts.length - 1).reverse();
}

const dry = sensorById[DRY_ID], wet = sensorById[WET_ID];
// Montados dentro de init(), assim que o cafezal existe — ver "TRAJETOS".
let walkDry = null, walkWet = null;

/**
 * Ponto do corredor a `recuo` metros antes do sensor, `altura` acima do chão e
 * `lado` metros para o lado da linha. Substitui o antigo dryAlley/wetAlley, que
 * andavam em X — num corredor que contorna esporão, andar em X sai da curva.
 */
function pontoCorredor(curva, recuo, altura, lado = 0) {
  const u = clamp(1 - recuo / Math.max(1, curva.getLength()), 0, 1);
  const p = curva.getPointAt(u);
  const t = curva.getTangentAt(u); t.y = 0;
  if (t.lengthSq() < 1e-6) t.set(1, 0, 0); else t.normalize();
  const x = p.x - t.z * lado, z = p.z + t.x * lado;
  return V3(x, elevationAt(x, z) + altura, z);
}

// ===================================================================================
// SOM — os efeitos são sintetizados na hora (Web Audio); a NARRAÇÃO vem de assets/audio/.
//
// Duas saídas separadas penduradas no mesmo master (que é quem o botão 🔊 muta):
//
//   sfx   — chuva, regador, bipes. Abaixa enquanto o filme roda: a chuva é ruído
//           de banda larga e, no nível de ambiente, cobre justamente a faixa da voz.
//   narr  — a locução. Entra com ganho porque as gravações vieram baixas
//           (pico global 0,39 · RMS −26,8 dBFS, conferido nos 63 arquivos); no
//           ganho abaixo o pico fica em 0,79 depois do master, sem estourar.
// ===================================================================================
const SFX = (() => {
  let ctx = null, master = null, sfx = null, narr = null, muted = false, noise = null;
  function ensure() {
    if (ctx) return ctx;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = muted ? 0 : .85;
    master.connect(ctx.destination);
    sfx = ctx.createGain(); sfx.gain.value = 1; sfx.connect(master);
    narr = ctx.createGain(); narr.gain.value = 2.4; narr.connect(master);
    const len = ctx.sampleRate * 2;
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }
  const resume = () => { ensure(); if (ctx.state === 'suspended') ctx.resume(); };
  function toggleMute() {
    ensure(); muted = !muted;
    master.gain.setTargetAtTime(muted ? 0 : .85, ctx.currentTime, .05);
    return muted;
  }
  function tones(list, type = 'sine', vol = .3) {
    if (!ctx) return;
    const now = ctx.currentTime;
    list.forEach(([f, at, dur]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.value = f;
      const t = now + at;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + .015);
      g.gain.exponentialRampToValueAtTime(.001, t + dur);
      o.connect(g).connect(sfx); o.start(t); o.stop(t + dur + .02);
    });
  }
  const notification = () => tones([[880, 0, .32], [1318.5, .14, .34]]);
  const beep = () => tones([[1650, 0, .1]], 'square', .1);
  const chime = () => tones([[659, 0, .3], [988, .1, .36], [1319, .2, .5]], 'sine', .22);
  function loopNoise(cut, vol, ramp) {
    if (!ctx) return null;
    const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cut;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(vol, ctx.currentTime + ramp);
    s.connect(f).connect(g).connect(sfx); s.start();
    return { s, g };
  }
  function stopLoop(n, tau) {
    if (!ctx || !n) return;
    n.g.gain.setTargetAtTime(0, ctx.currentTime, tau);
    setTimeout(() => { try { n.s.stop(); } catch (e) {} }, tau * 3000);
  }
  let rainN = null, waterN = null;
  return {
    resume, toggleMute, notification, beep, chime,
    rainStart: () => { if (!rainN) rainN = loopNoise(1800, .18, 1.2); },
    rainStop:  () => { stopLoop(rainN, 1.0); rainN = null; },
    waterStart:() => { if (!waterN) waterN = loopNoise(2600, .13, .35); },
    waterStop: () => { stopLoop(waterN, .25); waterN = null; },
    // Para a narração: o contexto e a saída onde ela toca.
    ctx: () => ensure(),
    narrBus: () => { ensure(); return narr; },
    duck: on => { ensure(); sfx.gain.setTargetAtTime(on ? .45 : 1, ctx.currentTime, .25); },
  };
})();

document.getElementById('btn-sound').addEventListener('click', e => {
  SFX.resume();
  const m = SFX.toggleMute();
  e.currentTarget.innerText = m ? '🔇 SOM' : '🔊 SOM';
  e.currentTarget.classList.toggle('muted', m);
});

// ===================================================================================
// NARRAÇÃO — os 63 trechos gravados em assets/audio/, e o relógio do filme
//
// A locução veio cortada frase a frase, com a marcação de onde cada uma cai na
// gravação inteira (docs/rotulos-audio.txt). Conferido arquivo por arquivo: a
// duração de cada trecho bate com a marcação até o milissegundo (era assim nos
// .wav originais e continuou assim nos .flac, que são sem perdas e batem bit a
// bit com eles — ver a nota em `nome`, adiante). Então a tabela
// abaixo não é uma estimativa — é o tempo real da voz, e é ele que passa a
// cronometrar o filme. Antes as durações dos planos eram escolhidas na mão a
// partir da contagem de palavras; agora quem manda é a gravação, e cada corte de
// câmera cai na respiração ENTRE duas frases, nunca por cima de uma palavra.
//
// A legenda também sai daqui, e não do plano: um plano cobre três ou quatro
// frases, e uma legenda só para o plano inteiro entregaria de saída o que ainda
// vai ser dito. Quem tem texto abre um cartão novo; quem não tem continua o
// cartão anterior — é o caso das frases que o estúdio quebrou em dois ou três
// arquivos e que, na tela, são uma oração só.
// ===================================================================================
const NARRACAO = (() => {
  // Silêncio antes da primeira palavra: o plano de abertura precisa de um
  // instante da propriedade na tela antes de alguém começar a falar dela.
  const ABERTURA = 1.2;
  // E depois da última palavra a câmera ainda corre um pouco: terminar o filme
  // na sílaba final é corte seco no meio do movimento.
  const RESPIRO = 2.6;

  // [ início, fim, legenda ] — segundos na gravação original. Sem legenda = a
  // frase continua o cartão aberto pela anterior.
  const FALAS = [
    [  0.38,   1.41, 'Este é o <b>TeraHecta</b>.'],
    [  1.96,   6.73, 'Quatro áreas de café, de um hectare cada — cem por cem metros de lavoura em cada uma.'],
    [  7.19,  10.32, 'Em cada área, uma estação e <b>seis sensores</b> no solo.'],
    [ 10.76,  14.84, 'São vinte e quatro pontos de leitura em quatro hectares. Comece pelo terreno:'],
    [ 15.42,  19.40, 'A chuva não fica onde cai: ela desce. Aqui a cor mostra a altura — claro em cima, azul lá embaixo.'],
    [ 19.82,  21.87],
    [ 22.49,  24.43, 'Por isso um hectare não tem <b>um solo só</b>.'],
    [ 24.90,  26.19, 'O alto seca depressa. O sopé recebe tudo o que desce.'],
    [ 26.68,  28.83],
    [ 29.35,  32.37, 'E cada dobra do terreno reage do seu jeito.'],
    [ 32.91,  35.16, 'No ponto mais baixo, a água empoça.'],
    [ 35.71,  37.47, 'Enxergar isso já é possível hoje.'],
    [ 37.96,  41.27, 'Drenar é a <b>Fase 3</b>, ainda em desenvolvimento.'],
    [ 41.79,  43.85, 'Por isso cada hectare é estudado antes.'],
    [ 44.45,  47.49, 'O relevo divide a lavoura em <b>zonas</b> parecidas entre si, e cada sensor vai para uma delas.'],
    [ 48.03,  49.81],
    [ 50.30,  54.86, 'Cada sensor fica no ponto mais típico da sua zona e <b>responde por ela inteira</b>:'],
    [ 55.46,  59.14, 'o que ele mede vale para tudo que se comporta como aquele ponto.'],
    [ 59.70,  62.69, 'O que os seis medem chega até a <b>estação de transmissão</b> da área.'],
    [ 63.28,  64.31, 'Nenhuma caderneta, nenhuma visita ao campo para anotar número: é o solo que dá notícia.'],
    [ 64.88,  68.61],
    [ 69.14,  70.99, 'E a estação não depende de nada ali.'],
    [ 71.54,  76.14, 'Ela <b>gera a própria energia</b> e trabalha todo dia, chova ou faça sol.'],
    [ 76.60,  80.83, 'A estação fica no ponto mais alto da área, e a antena bem acima do cafezal.'],
    [ 81.37,  83.73, 'É daqui que as leituras começam a viagem.'],
    [ 84.20,  87.54, 'Cada ponto que corre nessas linhas é uma <b>leitura em trânsito</b>.'],
    [ 88.00,  91.86, 'Cada área tem o seu próprio caminho até a Caixa Principal — se uma parar, as outras três seguem entregando.'],
    [ 92.38,  94.16],
    [ 94.62,  96.94, 'Tudo se encontra aqui, na <b>Caixa Principal</b>, ao lado da casa e na parte alta do terreno — longe de onde a água se junta.'],
    [ 97.43, 101.88],
    [102.42, 105.24, 'A estação meteorológica acompanha o céu: chuva, vento, temperatura, umidade do ar.'],
    [105.85, 108.32],
    [108.87, 109.68, 'E <b>antecipa</b>.'],
    [110.13, 113.77, 'Molhar um solo que vai encharcar em seis horas é perder duas vezes.'],
    [114.33, 117.57, 'Chove. E cada zona reage de um jeito diferente.'],
    [118.13, 121.81, 'É isso que os <b>vinte e quatro sensores</b> registram, cada um pela sua zona.'],
    [122.39, 123.08, 'Dias depois, numa das zonas altas da área A: a umidade caiu para <b>vinte e quatro por cento</b>.'],
    [123.65, 127.58],
    [128.22, 130.19, 'A lavoura daquele trecho está em estresse.'],
    [130.61, 132.85, 'O aviso chega no celular já apontando <b>onde</b>.'],
    [133.40, 137.59, 'Sem isso, o produtor só veria o problema quando a folha já estivesse murcha.'],
    [138.21, 140.40, 'O sistema não diz que o hectare está seco.'],
    [140.81, 144.19, 'Diz <b>qual parte</b> dele está — e a correção vai só naquela zona.'],
    [144.70, 147.81, 'Acionar sozinho é a <b>Fase 2</b>, em desenvolvimento.'],
    [148.28, 149.55, 'Zona de volta ao normal.'],
    [150.09, 153.99, '<b>Uma parte tratada</b> — e não o hectare inteiro tratado igual, no escuro.'],
    [154.53, 156.19, 'Na parte baixa do mesmo hectare, o problema é o oposto:'],
    [156.74, 158.25],
    [158.71, 159.73, '<b>solo encharcado</b>, com o sal que desceu da encosta parado ali.'],
    [160.37, 162.46],
    [163.01, 164.79, 'Aqui, molhar seria o erro.'],
    [165.41, 166.79, 'O dado pede o oposto.'],
    [167.22, 168.74, 'Duas zonas do mesmo hectare, dois problemas opostos — sem sensor, as duas receberiam o mesmo tratamento.'],
    [169.23, 171.69],
    [172.24, 174.44],
    [174.95, 176.34, '<b>Vinte e quatro sensores. Quatro estações. Uma Caixa Principal.</b>'],
    [176.81, 177.91],
    [178.42, 179.59],
    [180.04, 183.52, 'A propriedade inteira acompanhada ponto a ponto, o ano todo.'],
    [184.02, 185.99, 'A <b>Fase 1</b> é enxergar o solo.'],
    [186.46, 188.31, 'É ela que sustenta o que vem depois:'],
    [188.78, 191.33, 'irrigação e fertirrigação na <b>Fase 2</b>, drenagem na <b>Fase 3</b>.'],
    [191.88, 193.50],
  ];

  const N = FALAS.length;
  // ►► Para trocar o formato do áudio, é esta linha e só ela.
  //
  // WAV estéreo → FLAC mono: 27,0 MB viraram 5,9 MB. A narração era a maior
  // parte do peso desta pasta, e baixava inteira, em seis conexões paralelas,
  // disputando banda com os .glb da cena.
  //
  // FLAC, e NÃO um codec com perdas — isto aqui já foi AAC e voltou atrás.
  // A locução vem cortada em 63 pedaços, e o AAC borrava justamente as bordas:
  // a janela MDCT espalha energia para trás e para frente no tempo, então cada
  // trecho ganhava um "sopro" ao entrar e ao sair do silêncio. Medido: o pico
  // dos primeiros e dos últimos 50 ms subia uns 40% em todos os arquivos. Uma
  // vez é inaudível; 63 emendas seguidas, não — dava para ouvir cada costura.
  //
  // O engano da primeira tentativa foi conferir a coisa errada. Duração e
  // alinhamento estavam perfeitos (offset zero, mesma contagem de amostras) e
  // isso não diz nada sobre timbre. A conferência que vale, e que o FLAC passa,
  // é comparar a FORMA DE ONDA: os 63 foram decodificados e batem bit a bit
  // com o original. Sendo sem perdas, soa igual por construção, e a sincronia
  // que a tabela FALAS cronometra continua exata.
  //
  // Mono porque a locução é uma voz só, gravada igual nos dois canais — é o
  // mesmo (L+R)/2 que paraMono() fazia adiante, agora feito uma vez só, na
  // conversão. Com arquivo mono, paraMono() sai na primeira linha.
  //
  // Os .wav originais não foram apagados: estão em
  // "Site Nao Subir/_originais-nao-publicar/audio-wav-original".
  const nome = i => 'assets/audio/som-' + String(i + 1).padStart(2, '0') + '.flac';
  const inicio = i => FALAS[i][0] + ABERTURA;          // instante no filme
  const fim    = i => (i < 0 ? 0 : FALAS[i][1] + ABERTURA);
  const total  = fim(N - 1) + RESPIRO;

  let bytes = null, bufs = null, baixando = null, fontes = [], t0 = 0, tocando = false, prontos = 0;

  // Só os bytes: baixar não precisa de AudioContext e portanto não precisa
  // esperar o visitante clicar em nada. Seis por vez para não abrir 63 conexões.
  async function baixar() {
    const arr = new Array(N);
    let prox = 0;
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (prox < N) {
        const i = prox++;
        const r = await fetch(nome(i));
        if (!r.ok) throw new Error(nome(i) + ' — HTTP ' + r.status);
        arr[i] = await r.arrayBuffer();
        prontos++;
      }
    }));
    return arr;
  }

  // A locução é uma voz só, gravada igual nos dois canais: guardar os dois é
  // segurar 54 MB de RAM em vez de 27 pelo mesmo som.
  function paraMono(ctx, b) {
    if (b.numberOfChannels < 2) return b;
    const m = ctx.createBuffer(1, b.length, b.sampleRate);
    const d = m.getChannelData(0), e = b.getChannelData(0), f = b.getChannelData(1);
    for (let i = 0; i < b.length; i++) d[i] = (e[i] + f[i]) * .5;
    return m;
  }

  // Forma com callback: a que existe em todo navegador, inclusive nos Safari
  // antigos que ainda não devolvem promessa de decodeAudioData.
  const decodificar = (ctx, b) => new Promise((ok, erro) => ctx.decodeAudioData(b, ok, erro));

  function preparar() {
    if (!baixando) baixando = baixar()
      .then(a => { bytes = a; return true; })
      .catch(e => { console.warn('narração indisponível:', e.message); return false; });
    return baixando;
  }

  // Decodificar precisa do AudioContext, que só existe depois de um gesto do
  // visitante — por isso é aqui, e não no download, que a preparação termina.
  async function pronta() {
    if (bufs) return true;
    if (!(await preparar()) || !bytes) return false;
    try {
      const ctx = SFX.ctx();
      const b = await Promise.all(bytes.map(x => decodificar(ctx, x)));
      bufs = b.map(x => paraMono(ctx, x));
      bytes = null;                       // decodificado, os bytes crus não servem mais
      const desvio = Math.max(...bufs.map((x, i) => Math.abs(x.duration - (FALAS[i][1] - FALAS[i][0]))));
      if (desvio > .05) console.warn('narração: arquivo fora da marcação por', desvio.toFixed(2), 's');
      return true;
    } catch (e) { console.warn('narração: falha ao decodificar —', e.message); bufs = null; return false; }
  }

  /**
   * Agenda as 63 falas de uma vez, no relógio do próprio áudio.
   *
   * Disparar cada frase quando o quadro chega na hora dela erra por até um
   * quadro e o erro é diferente toda vez. Aqui cada fonte já nasce com o
   * instante exato em que deve soar, e o filme passa a ler a hora DESSE relógio
   * (`relogio()`): imagem e voz não têm como escorregar uma da outra.
   *
   * `desde` = segundo do filme onde começar (0 = do início; usado no seek).
   */
  function tocar(desde = 0) {
    parar();
    if (!bufs) return false;
    const ctx = SFX.ctx(), bus = SFX.narrBus();
    const base = ctx.currentTime + .05;
    FALAS.forEach((f, i) => {
      const quando = inicio(i) - desde;              // daqui a quantos segundos
      if (quando + bufs[i].duration <= 0) return;    // frase já passou
      const s = ctx.createBufferSource();
      s.buffer = bufs[i]; s.connect(bus);
      if (quando >= 0) s.start(base + quando);
      else s.start(base, -quando);                   // seek no meio de uma frase
      fontes.push(s);
    });
    t0 = base - desde; tocando = true;
    return true;
  }

  function parar() {
    fontes.forEach(s => { try { s.stop(); } catch (e) {} });
    fontes = []; tocando = false;
  }

  return {
    preparar, pronta, tocar, parar,
    // Hora do filme segundo o áudio — null quando não há narração tocando.
    relogio: () => tocando ? SFX.ctx().currentTime - t0 : null,
    carregada: () => !!bufs,
    progresso: () => prontos / N,
    n: N, total, inicio, fim,
    fimDaFala: fim(N - 1),
    legendas: FALAS.map(f => f[2] || null),
  };
})();

// ===================================================================================
// FAIXAS AGRONÔMICAS (café adulto, leitura a 20–30 cm)
// ===================================================================================
const THRESHOLDS = {
  moisture:{ okMin:40, okMax:75, warnMin:32, warnMax:85,
    lowMsg:'Seco demais — a planta já está sofrendo',
    highMsg:'Encharcado — a raiz fica sem ar' },
  temp:{ okMin:18, okMax:28, warnMin:15, warnMax:31,
    lowMsg:'Solo frio — a raiz trabalha devagar',
    highMsg:'Solo quente demais — a raiz sofre' },
  ec:{ okMin:150, okMax:400, warnMin:100, warnMax:550,
    lowMsg:'Solo fraco — a chuva levou o alimento embora',
    highMsg:'Sal acumulado — sobra de adubo no solo' },
  ph:{ okMin:5.2, okMax:6.0, warnMin:4.9, warnMax:6.4,
    lowMsg:'Ácido demais — o alumínio começa a atacar a raiz',
    highMsg:'pH alto demais — a planta não absorve o adubo' },
  sal:{ okMin:0, okMax:1.0, warnMin:-1, warnMax:1.8,
    lowMsg:'', highMsg:'Sal alto — a planta sente seca mesmo com água' },
  tds:{ okMin:0, okMax:300, warnMin:-1, warnMax:480,
    lowMsg:'', highMsg:'Muita coisa dissolvida — anda junto com o sal' },
};
function evalParam(key, v) {
  const t = THRESHOLDS[key];
  if (v < t.warnMin) return { level:'danger', msg:t.lowMsg };
  if (v < t.okMin)   return { level:'warn',   msg:t.lowMsg };
  if (v > t.warnMax) return { level:'danger', msg:t.highMsg };
  if (v > t.okMax)   return { level:'warn',   msg:t.highMsg };
  return { level:'ok', msg:'' };
}

// Histerese: o alerta só cai depois de HOLD_MS dentro da faixa. Sem isso um valor
// oscilando em cima do limite acende e apaga o card a cada ciclo.
const HOLD_MS = 4000;
const alertHold = new Map();
const PARAMS = [['moisture','UMI'],['temp','TEMP'],['ec','EC'],['ph','pH'],['sal','SAL'],['tds','TDS']];

function computeAlerts(s, now) {
  const out = [];
  PARAMS.forEach(([key, label]) => {
    const k = s.id + '|' + key;
    const raw = evalParam(key, s[key]);
    let held = alertHold.get(k);
    if (raw.level !== 'ok' && raw.msg) {
      held = { level:raw.level, msg:raw.msg, label, t:now };
      alertHold.set(k, held);
    } else if (held && now - held.t >= HOLD_MS) {
      alertHold.delete(k); held = null;
    }
    if (held) out.push({ level:held.level, label:held.label, msg:held.msg });
  });
  return out;
}

// ===================================================================================
// CARREGAMENTO
// ===================================================================================
const ASSETS = {
  coffee:  'assets/models/cafeeiro.glb',
  farmer:  'assets/models/fazendeiro.glb',
  solar:   'assets/models/painel-solar.glb',
  antenna: 'assets/models/antena.glb',
  can:     'assets/models/regador.glb',
  fazenda: 'assets/models/fazenda.glb',
};
const loadingEl = document.getElementById('loading');
const loadingFill = document.getElementById('loading-fill');
const loadingMsg = document.getElementById('loading-msg');
const loadingErr = document.getElementById('loading-err');

function showLoadError(err) {
  loadingMsg.innerText = 'Não foi possível carregar os modelos';
  loadingFill.style.background = '#ff5c5c';
  loadingErr.style.display = 'block';
  loadingErr.innerHTML = location.protocol === 'file:'
    ? 'Esta página lê arquivos <b>.glb</b> por rede, e o navegador bloqueia isso quando '
    + 'a página é aberta direto do disco (<b>file://</b>). Rode um servidor local dentro '
    + 'desta pasta e abra pelo endereço que ele mostrar:'
    + '<br><code>npm start</code><br><code>python -m http.server 8000</code>'
    : 'Detalhe técnico: ' + (err && err.message ? err.message : err);
  console.error(err);
}

const loader = new GLTFLoader();
let loadedCount = 0;
const totalAssets = Object.keys(ASSETS).length;
const loadAsset = url => new Promise((res, rej) => loader.load(url,
  g => { loadedCount++; loadingFill.style.width = (loadedCount / totalAssets * 100) + '%'; res(g); },
  undefined,
  e => rej(new Error('falha ao carregar ' + url + ' — ' + (e?.message || e)))));

/* Espera o navegador PINTAR antes de devolver o controle. Um rAF só garante
   "antes do próximo quadro"; o segundo garante que aquele quadro saiu mesmo.
   Sem isso, a mensagem trocada logo abaixo nunca chegaria à tela — `init()`
   trava a thread em seguida e o navegador desenharia direto o texto velho. */
const proximoQuadro = () =>
  new Promise(ok => requestAnimationFrame(() => requestAnimationFrame(ok)));

Promise.all(Object.values(ASSETS).map(loadAsset))
  .then(async results => {
    const models = {};
    Object.keys(ASSETS).forEach((k, i) => { models[k] = results[i]; });

    /* A TELA DE CARREGAMENTO FICA DE PÉ ATÉ A CENA EXISTIR DE VERDADE.
       Antes ela saía aqui, ANTES de `init(models)` — e init é quem constrói o
       terreno, as milhares de plantas, as malhas instanciadas e as texturas,
       tudo de uma vez e travando a thread. O visitante via a barra chegar a
       100%, a tela sumir, e então a página congelava com a lavoura já à mostra.
       O engasgo não tinha desaparecido: ele tinha sido movido para depois da
       cortina subir, que é o pior lugar possível.

       Agora a ordem é: barra a 100% → aviso de que está montando → init roda
       atrás da cortina → shaders compilados → primeiro quadro desenhado → só
       então a cortina sobe. O carregamento fica um pouco mais longo, e é
       exatamente essa a troca: o tempo sai de onde incomoda e vai para onde a
       pessoa já estava esperando. */
    loadingMsg.innerText = 'Montando a lavoura…';
    await proximoQuadro();

    try { init(models); }
    catch (err) { showLoadError(err); return; }

    loadingEl.style.opacity = '0';
    setTimeout(() => { loadingEl.style.display = 'none'; }, 500);

    /* A NARRAÇÃO ESPERA A INTENÇÃO — não baixa sozinha.

       Antes, no computador, os 5,9 MB inteiros começavam a descer 400 ms depois
       da cena aparecer, houvesse ou não interesse no filme. Para quem só veio
       girar a lavoura — que é a maioria — era o maior download da página inteira
       gasto em nada, e ainda por cima logo depois do carregamento, disputando
       banda com o que aparecia na tela.

       O gatilho agora é o ponteiro chegando no botão do filme: quem vai clicar
       leva alguns décimos de segundo entre passar o mouse e apertar, e nesse
       intervalo o download já começou — na prática, continua pronto na hora.
       Quem nunca chega perto do botão não paga nada. `preparar()` é idempotente
       (guarda a promessa em `baixando`), então repetir o evento não repete o
       download.

       No toque não há passagem de ponteiro, e ali o caminho continua o de
       antes: baixa no clique, com o botão avisando que está preparando. */
    const botaoFilme = document.getElementById('btn-story');
    if (botaoFilme && !IS_MOBILE && !navigator.connection?.saveData) {
      const adiantar = () => NARRACAO.preparar();
      botaoFilme.addEventListener('pointerenter', adiantar, { once: true });
      botaoFilme.addEventListener('focus', adiantar, { once: true });
    }
  })
  .catch(showLoadError);

// ===================================================================================
// PREPARO DO CAFEEIRO
//
// O modelo vem num vaso e como UMA malha só, sem grupos. Duas coisas acontecem aqui:
//
//  1. REMOVER O VASO. Ele é uma ilha de geometria isolada — nenhum triângulo dele
//     compartilha vértice com a planta. Achando as componentes conexas, o vaso é
//     simplesmente a que contém o vértice mais baixo. Recorte exato, sem precisar
//     chutar um plano de corte em Y (que deixaria a borda do vaso para trás, porque
//     ela sobe até 2.18 enquanto o caule já começa em 2.00).
//
//  2. GERAR OS NÍVEIS DE DETALHE. A planta é feita de ilhas independentes: caules,
//     ~37 folhas de 72 triângulos e ~89 frutos de 24. Dá para montar LODs jogando
//     ilhas inteiras fora — a silhueta continua correta, ao contrário do que
//     aconteceria decimando cada folha.
// ===================================================================================
function prepareCoffee(mesh) {
  const geom = mesh.geometry;
  const pos = geom.attributes.position;
  const index = geom.index.array;

  const weld = new Map();
  const parent = new Int32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    if (!weld.has(key)) weld.set(key, i);
    parent[i] = weld.get(key);
  }
  const find = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  for (let i = 0; i < index.length; i += 3) { union(index[i], index[i+1]); union(index[i+1], index[i+2]); }

  const comps = new Map();
  for (let t = 0; t < index.length; t += 3) {
    const r = find(index[t]);
    let c = comps.get(r);
    if (!c) { c = { tris:[], minY:Infinity, maxY:-Infinity, cx:0, cz:0, n:0 }; comps.set(r, c); }
    c.tris.push(t);
    for (let j = 0; j < 3; j++) {
      const vi = index[t + j], y = pos.getY(vi);
      c.minY = Math.min(c.minY, y); c.maxY = Math.max(c.maxY, y);
      c.cx += pos.getX(vi); c.cz += pos.getZ(vi); c.n++;
    }
  }

  const all = [...comps.values()].sort((a, b) => a.minY - b.minY);
  const pot = all[0];                       // a ilha mais baixa é o vaso
  const plant = all.slice(1);
  const stems  = plant.filter(c => c.maxY - c.minY > 2.5);
  const fruits = plant.filter(c => c.maxY - c.minY <= 2.5 && c.tris.length <= 30);
  const leaves = plant.filter(c => c.maxY - c.minY <= 2.5 && c.tris.length > 30);

  const baseY = Math.min(...stems.map(c => c.minY));
  let sx = 0, sz = 0, sn = 0;
  stems.forEach(c => { sx += c.cx; sz += c.cz; sn += c.n; });
  const offX = sn ? sx / sn : 0, offZ = sn ? sz / sn : 0;

  const base = new THREE.BufferGeometry();
  const p = pos.array.slice();
  for (let i = 0; i < p.length; i += 3) { p[i] -= offX; p[i+1] -= baseY; p[i+2] -= offZ; }
  base.setAttribute('position', new THREE.BufferAttribute(p, 3));
  base.setAttribute('normal', geom.attributes.normal.clone());
  if (geom.attributes.uv) base.setAttribute('uv', geom.attributes.uv.clone());

  const idxOf = groups => {
    const out = [];
    groups.forEach(c => c.tris.forEach(t => out.push(index[t], index[t+1], index[t+2])));
    return new THREE.BufferAttribute(new Uint16Array(out), 1);
  };
  const every = (a, n) => a.filter((_, i) => i % n === 0);
  // Um índice por LOD, todos sobre o MESMO buffer de vértices: quatro malhas pelo
  // preço de um vertex buffer na GPU.
  const makeLod = groups => {
    const g = base.clone(); g.setIndex(idxOf(groups)); g.computeBoundingSphere(); return g;
  };
  // TODO pé de café é o MESMO pé: copa inteira e frutos em todos os níveis.
  //
  // Ralar folha por distância era o que deixava a maior parte da lavoura com
  // cara de vara seca — a silhueta do cafeeiro É a folhagem, e sem ela sobra
  // galho. E o pé sem fruto ao lado do pé com fruto entregava a troca na hora.
  // O que varia agora é só a quantidade de frutos nos níveis distantes, onde
  // ninguém conta grão: a copa, que é o que se enxerga, é sempre a mesma.
  const lods = [
    makeLod([...stems, ...leaves, ...fruits]),            // LOD0 — inteiro
    makeLod([...stems, ...leaves, ...every(fruits, 2)]),  // LOD1 — metade dos frutos
    makeLod([...stems, ...leaves, ...every(fruits, 3)]),  // LOD2
    makeLod([...stems, ...leaves, ...every(fruits, 4)]),  // LOD3
  ];

  const material = mesh.material.clone();
  material.side = THREE.DoubleSide;    // as folhas são cards de face única
  material.metalness = 0; material.roughness = .85;
  if (material.map) material.map.anisotropy = 4;

  base.computeBoundingBox();
  const bb = base.boundingBox;
  return { lods, material, stats:{
    height: bb.max.y, depth: Math.max(bb.max.z - bb.min.z, .01),
    removedTris: pot.tris.length, tri: lods.map(g => g.index.count / 3) } };
}

// ===================================================================================
// CENA
// ===================================================================================
function init(models) {
  const scene = new THREE.Scene();
  // A névoa não tem alcance fixo: ela recua conforme a câmera sobe (ver o bloco
  // "névoa adaptativa" no loop). Parada em 170–460 m, ela dava profundidade nos
  // planos rentes ao chão mas engolia a propriedade inteira no zoom out.
  scene.fog = new THREE.Fog(0xcfe6f7, 170, 460);

  const camera = new THREE.PerspectiveCamera(IS_MOBILE ? 56 : 44,
    window.innerWidth / window.innerHeight, .1, 1200);

  const renderer = new THREE.WebGLRenderer({ antialias: !IS_MOBILE, alpha:true,
    powerPreference:'high-performance' });
  renderer.setClearColor(0x000000, 0);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, Q.pixelRatio));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.getElementById('canvas-wrap').appendChild(renderer.domElement);

  // ---------------------------------------------------------------- REFLEXO
  // Céu procedural em equirretangular -> PMREM. É o que dá o que refletir: com
  // rugosidade baixa e nada no ambiente, o vidro fica só preto.
  const skyEnv = (() => {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 256;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0.00, '#1b3f7a');   // zênite
    grd.addColorStop(0.42, '#6aa6dd');
    grd.addColorStop(0.50, '#cfe6f7');   // horizonte
    grd.addColorStop(0.58, '#7e8f5e');
    grd.addColorStop(1.00, '#46512f');   // solo
    g.fillStyle = grd; g.fillRect(0, 0, 64, 256);
    // borrão claro do sol, na direção da luz principal
    const sun = g.createRadialGradient(46, 66, 2, 46, 66, 34);
    sun.addColorStop(0, 'rgba(255,250,235,1)');
    sun.addColorStop(1, 'rgba(255,250,235,0)');
    g.fillStyle = sun; g.fillRect(0, 0, 64, 256);

    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromEquirectangular(tex).texture;
    pmrem.dispose(); tex.dispose();
    return env;
  })();

  /** Transforma o material num vidro de placa fotovoltaica. */
  function makeGlassy(root, { rough = .07, metal = .25, intensity = 1.5 } = {}) {
    root.traverse(o => {
      if (!o.isMesh) return;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
        if (!m) return;
        m.roughness = rough;
        m.metalness = metal;
        m.envMap = skyEnv;
        m.envMapIntensity = intensity;
        m.needsUpdate = true;
      });
    });
  }

  // ---------------------------------------------------------------- PEÇAS CLICÁVEIS
  // Cada equipamento se apresenta quando o visitante clica nele. A peça é
  // marcada aqui, no lugar onde é construída; o texto da ficha fica na tabela
  // FICHAS, lá embaixo, junto do resto do que é palavra e não geometria.
  const clicaveis = [];
  const registrar = (obj, tipo, extra = null) => {
    obj.userData.ficha = { tipo, extra };
    clicaveis.push(obj);
    return obj;
  };

  scene.add(new THREE.HemisphereLight(0xdcefff, 0x4a5b3a, 1.15));
  scene.add(new THREE.AmbientLight(0xbcd6e8, .55));
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
  sun.position.set(90, 130, -70);
  sun.castShadow = true;
  sun.shadow.mapSize.set(Q.shadowMap, Q.shadowMap);
  sun.shadow.camera.left = -150; sun.shadow.camera.right = 150;
  sun.shadow.camera.top = 150; sun.shadow.camera.bottom = -150;
  sun.shadow.camera.far = 480;
  sun.shadow.bias = -.0006; sun.shadow.normalBias = .035;
  scene.add(sun);

  // ============================================================== TERRENO
  const uTopo = { value: 0 };          // 0 = solo real · 1 = mapa hipsométrico
  const uRain = { value: 0 }, uDry = { value: 0 }, uPuddle = { value: 0 };
  // (x, z, raio) de uma depressão que continua com água depois de o resto secar.
  // Raio 0 = nenhuma. É o capítulo 9: o hectare já secou e a bacia não.
  const uPocaFoco = { value: new THREE.Vector3(0, 0, 0) };

  // ------------------------------------------------------------------------
  // ONDE A ÁGUA SE JUNTA DENTRO DO HECTARE
  //
  // Chuva forte não deixa água só no sopé da propriedade. Cada hectare tem a sua
  // bacia fechada e a sua grota (é o motivo do relevo, declarado lá em cima), e é
  // ali que a água para — em manchas de poucos metros, não numa lâmina de
  // duzentos. Mostrar só o acúmulo lá embaixo contava metade da história: a fala
  // do capítulo 7 é "cada zona reage de um jeito diferente", e a mancha dentro do
  // hectare é a imagem que faltava para a frase.
  //
  // Duas águas, porque são dois fenômenos — e as duas vêm do mesmo cálculo que
  // decidiu onde as sondas foram postas, não de uma segunda conta feita só para a
  // imagem. Quando eram duas contas, elas discordavam: dava sonda de "patamar"
  // plantada dentro de uma poça de um metro.
  //
  //   PARADA (canal R) — a lâmina de DEPRESSAO, o enchimento de depressões
  //     calculado lá em cima. A mesma coisa que define a classe "bacia" do estudo.
  //   CORRENDO (canal G) — o índice topográfico de umidade, escoamento acumulado
  //     sobre a declividade. O mesmo índice que separa convergente de divergente
  //     na hora de estratificar o hectare.
  //
  // Que é a diferença que as zonas do estudo já nomeiam: a bacia, "côncava e
  // fechada — a água entra e não sai sozinha"; a grota, "por onde a água do
  // hectare desce".
  // ------------------------------------------------------------------------
  const uAcumulo = { value: null };
  {
    const N = DEPRESSAO.n, passo = DEPRESSAO.passo;
    const px = i => -WORLD + (i + .5) * passo;

    // ---- a que corre: mesmo índice de umidade do estudo, calibrado pelos
    // percentis DA LAVOURA. Pelo mundo inteiro, a bacia do sopé satura a escala
    // sozinha e os quatro hectares saem secos na tela.
    const umid = new Float32Array(N * N);
    const daLavoura = [];
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = px(i), z = px(j);
        const [gx, gz] = gradienteEm(x, z, passo);
        const v = Math.log(FLUXO.em(x, z) * FLUXO.celula
                           / Math.max(.02, Math.hypot(gx, gz)));
        umid[j*N + i] = v;
        if (inPlanting(x, z)) daLavoura.push(v);
      }
    }
    daLavoura.sort((a, b) => a - b);
    const pct = p => daLavoura[Math.floor((daLavoura.length - 1) * p)];
    const lo = pct(.88), hi = pct(.995);      // só os fios de escoamento, não meia lavoura

    const dados = new Uint8Array(N * N * 4);
    for (let k = 0; k < N * N; k++) {
      dados[k*4]     = Math.round(255 * DEPRESSAO.lamina[k]);
      dados[k*4 + 1] = Math.round(255 * clamp((umid[k] - lo) / (hi - lo), 0, 1));
      dados[k*4 + 3] = 255;
    }
    const tex = new THREE.DataTexture(dados, N, N, THREE.RGBAFormat);
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    uAcumulo.value = tex;
  }

  const terrainGeo = new THREE.PlaneGeometry(WORLD * 2, WORLD * 2, Q.terrainSeg, Q.terrainSeg);
  terrainGeo.rotateX(-Math.PI / 2);
  const tp = terrainGeo.attributes.position;
  for (let i = 0; i < tp.count; i++) tp.setY(i, elevationAt(tp.getX(i), tp.getZ(i)));
  terrainGeo.computeVertexNormals();

  const terrainMat = new THREE.MeshStandardMaterial({ color:0xffffff, roughness:.95, metalness:0 });

  // ------------------------------------------------------------------------
  // A FAIXA DE TERRA REVOLVIDA É DESENHADA A PARTIR DAS FILEIRAS DE VERDADE.
  //
  // Antes o shader repetia a equação do terreno para adivinhar onde passava cada
  // fileira — duas cópias da mesma verdade, e uma delas agora nem existe: com
  // esporão e grota, fileira não é fórmula, é curva traçada. E o intervalo entre
  // elas é adaptativo, então nem um "resto da divisão da cota" serviria.
  //
  // Então a faixa vira MAPA: as mesmas polilinhas que plantam o café são
  // desenhadas grossas num canvas visto de cima, e o terreno lê esse mapa. É
  // impossível a terra preparada sair de sincronia com o que foi plantado, em
  // qualquer relevo — inclusive no celular, onde metade das fileiras não existe.
  // ------------------------------------------------------------------------
  // O mapa é desenhado só depois do plantio, a partir dos pés que realmente
  // ficaram de pé — ver `pintarTerraRevolvida`, logo abaixo dos cafeeiros. Aqui
  // fica só o lugar dele: o material é montado antes, mas o shader só lê o
  // uniforme no primeiro quadro, que é bem depois.
  const uTilled = { value: null };

  terrainMat.onBeforeCompile = shader => {
    shader.uniforms.uTopo = uTopo; shader.uniforms.uRain = uRain;
    shader.uniforms.uDry = uDry; shader.uniforms.uPuddle = uPuddle;
    shader.uniforms.uTilled = uTilled; shader.uniforms.uAcumulo = uAcumulo;
    shader.uniforms.uPocaFoco = uPocaFoco;
    shader.vertexShader = 'varying vec3 vWPos;\n' + shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      '#include <worldpos_vertex>\n vWPos = (modelMatrix * vec4(transformed,1.0)).xyz;');
    shader.fragmentShader = `
      uniform float uTopo; uniform float uRain; uniform float uDry; uniform float uPuddle;
      uniform sampler2D uTilled; uniform sampler2D uAcumulo; uniform vec3 uPocaFoco;
      varying vec3 vWPos;
      float hash(vec2 c){ return fract(sin(dot(c, vec2(12.9898,78.233))) * 43758.5453); }
      // mesma máscara do patamar da sede usada no JS
      float sedeMask(vec2 p){
        float d = distance(p, vec2(${SEDE.x.toFixed(1)}, ${SEDE.z.toFixed(1)}));
        return 1.0 - smoothstep(${SEDE.raio.toFixed(1)}, ${(SEDE.raio + SEDE.borda).toFixed(1)}, d);
      }

      // Rampa hipsométrica: a convenção cartográfica de verdade — azul nas cotas de
      // acúmulo, verde no meio, ocre e claro nas cotas altas. Contínua, não três
      // faixas chapadas, porque a água não respeita fronteira desenhada a régua.
      vec3 hypso(float t){
        vec3 c;
        if (t < 0.25)      c = mix(vec3(0.03,0.20,0.46), vec3(0.05,0.45,0.58), t/0.25);
        else if (t < 0.45) c = mix(vec3(0.05,0.45,0.58), vec3(0.13,0.55,0.20), (t-0.25)/0.20);
        else if (t < 0.65) c = mix(vec3(0.13,0.55,0.20), vec3(0.78,0.70,0.10), (t-0.45)/0.20);
        else if (t < 0.85) c = mix(vec3(0.78,0.70,0.10), vec3(0.80,0.36,0.08), (t-0.65)/0.20);
        else               c = mix(vec3(0.80,0.36,0.08), vec3(0.95,0.90,0.86), (t-0.85)/0.15);
        return c;
      }
      ` + shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>

      float inField = step(${ROAD_HALF.toFixed(1)}, abs(vWPos.x))
                    * step(${ROAD_HALF.toFixed(1)}, abs(vWPos.z))
                    * step(abs(vWPos.x), ${PLANT_EDGE.toFixed(1)})
                    * step(abs(vWPos.z), ${PLANT_EDGE.toFixed(1)});
      float road = (1.0 - step(${ROAD_HALF.toFixed(1)}, abs(vWPos.x)))
                 + (1.0 - step(${ROAD_HALF.toFixed(1)}, abs(vWPos.z)));
      road = clamp(road, 0.0, 1.0)
           * step(abs(vWPos.x), ${(PLANT_EDGE + 6.0).toFixed(1)})
           * step(abs(vWPos.z), ${(PLANT_EDGE + 6.0).toFixed(1)});

      // ---------- solo real ----------
      vec3 soil = vec3(0.40, 0.33, 0.20);
      soil = mix(vec3(0.33, 0.44, 0.18), soil, inField);          // fora: pasto
      vec2 uvT = (vWPos.xz + ${WORLD.toFixed(1)}) / ${(WORLD * 2).toFixed(1)};
      float tilled = texture2D(uTilled, uvT).r * inField;
      soil = mix(soil, vec3(0.235, 0.150, 0.088), tilled * 0.82);
      soil = mix(soil, vec3(0.44, 0.37, 0.28), road * 0.80);
      soil -= hash(floor(vWPos.xz * 11.0)) * 0.035;

      // ---------- mapa topográfico ----------
      float t = clamp((vWPos.y + 20.0) / 40.0, 0.0, 1.0);
      vec3 topo = hypso(t);
      float modY = mod(vWPos.y, 2.0);
      float iso = smoothstep(0.07, 0.0, modY) + smoothstep(1.93, 2.0, modY);
      float modI = mod(vWPos.y, 10.0);
      float isoIndex = smoothstep(0.16, 0.0, modI) + smoothstep(9.84, 10.0, modI);
      topo = mix(topo, vec3(0.06,0.10,0.09), iso * 0.30);
      topo = mix(topo, vec3(0.03,0.06,0.05), isoIndex * 0.55);

      // no patamar da sede o solo vira grama aparada, sem faixa de plantio
      float sede = sedeMask(vWPos.xz);
      soil = mix(soil, vec3(0.31, 0.42, 0.20), sede);

      diffuseColor.rgb = mix(soil, topo, uTopo);

      // curvas de nível discretas também no modo solo, mais fracas
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9,0.78,0.62), iso * 0.16 * (1.0 - uTopo));

      // ---------- água ----------
      float normZ = clamp((vWPos.z + 120.0) / 240.0, 0.0, 1.0);
      float wet = clamp(uRain - uDry * (1.5 - normZ * 1.2), 0.0, 1.0);
      diffuseColor.rgb *= (1.0 - wet * 0.34);

      // Três águas, e não a mesma:
      //
      //   lâmina — a bacia do sopé, que enche e escorre junto com o resto do
      //            terreno, por isso acompanha o encharcamento geral (wet).
      //   poça   — a depressão fechada DE CADA HECTARE. Essa não some quando a
      //            superfície seca: é justamente isso que a cena precisa mostrar —
      //            o alto já secou e o fundo ainda está com água. Por isso depende
      //            só de uPuddle.
      //   fio    — a água correndo pela grota. Fraca e de propósito: é passagem,
      //            não acúmulo, e competindo com a poça esconderia a diferença
      //            entre as duas — que é o assunto do plano.
      float valley = smoothstep(-8.0, -15.0, vWPos.y);
      float lamina = clamp(uPuddle * valley * (wet + 0.5), 0.0, 1.0);
      float naLavoura = step(abs(vWPos.x), ${(PLANT_EDGE + 4.0).toFixed(1)})
                      * step(abs(vWPos.z), ${(PLANT_EDGE + 4.0).toFixed(1)});
      // A depressão aparece na chuva E no mapa de altitude. Onde a água não sai
      // sozinha é propriedade do TERRENO, não do tempo: quem está lendo a
      // topografia para decidir onde drenar precisa ver isso sem esperar chover.
      //
      // E aparece sozinha, numa bacia só, quando o filme diz que aquela bacia
      // continua encharcada com o resto do hectare já seco. Sem isso o capítulo 9
      // era chão seco com uma legenda falando de encharcamento.
      float foco = uPocaFoco.z > 0.0
        ? 1.0 - smoothstep(uPocaFoco.z * 0.55, uPocaFoco.z, distance(vWPos.xz, uPocaFoco.xy))
        : 0.0;
      diffuseColor.rgb *= (1.0 - foco * 0.13);
      float mostraPoca = max(max(uPuddle, uTopo * 0.9), foco);
      vec2 ac = texture2D(uAcumulo, uvT).rg;
      float poca = clamp(mostraPoca * smoothstep(0.06, 0.55, ac.r) * naLavoura, 0.0, 1.0);
      float fio  = clamp(mostraPoca * smoothstep(0.30, 0.95, ac.g) * naLavoura * 0.30, 0.0, 1.0);
      float agua = max(lamina, max(poca, fio));
      // A poça tem que saltar por cima do verde e do ocre do mapa de altitude; a
      // lâmina do sopé fica no azul mais fundo, que é onde ela já estava.
      vec3 corAgua = mix(vec3(0.16,0.34,0.52), vec3(0.20,0.55,0.82), poca * (1.0 - valley));
      diffuseColor.rgb = mix(diffuseColor.rgb, corAgua, agua * 0.82);
      `);
  };

  const terrain = new THREE.Mesh(terrainGeo, terrainMat);
  terrain.receiveShadow = true;
  scene.add(terrain);

  // saia lateral, para o terreno ter espessura de bloco geológico
  {
    const depthY = -70, steps = 70, v = [];
    const edge = (ax, az, bx, bz) => {
      for (let i = 0; i < steps; i++) {
        const f = i / steps, g = (i + 1) / steps;
        const x1 = ax + (bx-ax)*f, z1 = az + (bz-az)*f;
        const x2 = ax + (bx-ax)*g, z2 = az + (bz-az)*g;
        const y1 = elevationAt(x1, z1), y2 = elevationAt(x2, z2);
        v.push(x1,depthY,z1, x2,depthY,z2, x1,y1,z1,  x2,depthY,z2, x2,y2,z2, x1,y1,z1);
      }
    };
    edge(-WORLD,WORLD, WORLD,WORLD); edge(WORLD,WORLD, WORLD,-WORLD);
    edge(WORLD,-WORLD, -WORLD,-WORLD); edge(-WORLD,-WORLD, -WORLD,WORLD);
    v.push(-WORLD,depthY,WORLD, WORLD,depthY,-WORLD, -WORLD,depthY,-WORLD,
           -WORLD,depthY,WORLD, WORLD,depthY,WORLD,  WORLD,depthY,-WORLD);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    const m = new THREE.MeshStandardMaterial({ roughness:.98, metalness:0, side:THREE.DoubleSide });
    m.onBeforeCompile = sh => {
      sh.vertexShader = 'varying float vY;\n' + sh.vertexShader.replace(
        '#include <worldpos_vertex>', '#include <worldpos_vertex>\n vY=(modelMatrix*vec4(transformed,1.0)).y;');
      sh.fragmentShader = 'varying float vY;\n' + sh.fragmentShader.replace(
        '#include <color_fragment>', `
        #include <color_fragment>
        vec3 a=vec3(0.30,0.19,0.11), b=vec3(0.42,0.24,0.14), c=vec3(0.36,0.29,0.24), d=vec3(0.28,0.28,0.30);
        vec3 g = mix(a,b,smoothstep(-2.0,-14.0,vY));
        g = mix(g,c,smoothstep(-26.0,-40.0,vY));
        g = mix(g,d,smoothstep(-48.0,-60.0,vY));
        g *= (0.94 + 0.06*(sin(vY*5.0)*0.5+0.5));
        diffuseColor = vec4(g, opacity);`);
    };
    scene.add(new THREE.Mesh(g, m));
  }

  // ============================================== SPRITES
  const mapLabels = [];   // anotações de mapa: somem quando a lente desce ao chão

  function makeLabel(text, color, sizeMul = 1, bg = null) {
    const cvs = document.createElement('canvas');
    cvs.width = 512; cvs.height = 128;
    const c = cvs.getContext('2d');
    if (bg) {
      c.fillStyle = bg; c.beginPath();
      if (c.roundRect) c.roundRect(4,4,504,120,60); else c.rect(4,4,504,120);
      c.fill(); c.strokeStyle = color; c.lineWidth = 5; c.stroke();
    }
    // A fonte se ajusta ao texto em vez do contrário: com corpo fixo de 46 px,
    // qualquer rótulo acima de ~17 caracteres estourava os 512 px do canvas e
    // aparecia decepado nas duas pontas ("ULO — DRENAGEM EM ES").
    let fontSize = 46;
    const maxW = bg ? 430 : 470;
    do {
      c.font = `600 ${fontSize}px "IBM Plex Mono", monospace`;
      if (c.measureText(text).width <= maxW) break;
      fontSize -= 2;
    } while (fontSize > 16);
    c.fillStyle = color; c.textAlign = 'center'; c.textBaseline = 'middle';
    if (!bg) { c.shadowColor = 'rgba(0,0,0,.85)'; c.shadowBlur = 6; }
    c.fillText(text, 256, 66);
    const tex = new THREE.CanvasTexture(cvs); tex.colorSpace = THREE.SRGBColorSpace;
    // depthTest LIGADO: sem ele o rótulo desenha por cima das plantas que estão à
    // sua frente e vira letreiro flutuando no meio da lavoura.
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map:tex, transparent:true, depthTest:true, depthWrite:false }));
    s.scale.set(10 * sizeMul, 2.5 * sizeMul, 1);
    s.renderOrder = 20;
    return s;
  }
  function makeIcon(glyph, color, size) {
    const cvs = document.createElement('canvas'); cvs.width = cvs.height = 128;
    const c = cvs.getContext('2d');
    c.font = '700 88px sans-serif'; c.fillStyle = color;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.shadowColor = 'rgba(0,0,0,.9)'; c.shadowBlur = 10;
    c.fillText(glyph, 64, 70);
    const tex = new THREE.CanvasTexture(cvs); tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map:tex, transparent:true, depthTest:true, depthWrite:false }));
    s.scale.set(size, size, 1); s.renderOrder = 21; s.visible = false;
    return s;
  }

  // FBX2glTF carimba metalness 0.4 em modelos sem mapa metálico nenhum — o resultado
  // é personagem acinzentado e casa com aspecto de plástico molhado.
  function normalize(root, rough = .85) {
    root.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
        if (!m) return; m.metalness = 0; m.roughness = rough;
        if (m.map) m.map.anisotropy = 4;
      });
    });
  }
  /* -------------------------------------------------------------------------
     VESTIR A SEDE — as duas superfícies que ficaram sem mapa no fazenda.glb

     O modelo veio quase todo texturizado: tora, telha, pedra, vidro, folhagem,
     cerca, e até a madeira dos canteiros. Duas superfícies chegaram com cor
     branca e mapa nenhum, e é por isso que apareciam estouradas na maquete:

       · a terra dos quatro canteiros (bed-carrot-soil, bed-tomato-soil,
         bed-strawberry-a-soil, bed-strawberry-b-soil);
       · a face frontal do gabinete TeraSmart — as outras cinco faces da caixa
         são creme (222,224,196) e só essa é branca pura, que é como um
         modelador deixa reservado o lugar da arte.

     A correção não inventa material nenhum. A terra sai da PRÓPRIA cena: a
     bancada da estufa (potting-soil) manteve a textura de terra no export e
     usa a mesma convenção de UV (0..1) dos canteiros, então é ela que se
     copia. A terra de dentro da estufa e a de fora passam a ser a mesma
     terra — que é o certo, e não custa um byte a mais de download.

     A arte do gabinete é o mesmo arquivo que a página do TeraSmart põe na
     frente do aparelho (terasmart-capa.webp), copiado para dentro desta pasta
     para a maquete continuar inteira em qualquer endereço onde for publicada.
     ------------------------------------------------------------------------- */
  const ARTE_TERASMART = 'assets/img/terasmart-capa.webp';

  function vestirSede(raiz) {
    let terra = null, gabinete = null;
    const canteiros = [];

    raiz.traverse(o => {
      const nome = o.name || '';
      // Comparo por trecho e não por igualdade: o GLTFLoader higieniza os
      // nomes e a barra de "gh-benching/merged/potting-soil" não sobrevive
      // igual em toda versão do three.
      if (nome.indexOf('TeraSmartCabinet') >= 0) gabinete = o;
      if (!o.isMesh) return;
      // Guarda o MATERIAL inteiro, e não só o mapa: desde que as texturas
      // saíram do fazenda.glb, a terra é uma cor chapada e não há mapa nenhum
      // para copiar. A intenção — a terra de dentro da estufa ser a mesma de
      // fora — continua valendo; o que mudou é por onde ela passa.
      if (nome.indexOf('potting-soil') >= 0 && o.material) terra = o.material;
      if (/bed-.*-soil/.test(nome)) canteiros.push(o);
    });

    if (terra && canteiros.length) {
      canteiros.forEach(m => {
        // Material próprio para cada canteiro. Hoje os quatro ficam iguais,
        // mas se um dia um canteiro tiver de aparecer mais seco que os outros,
        // o material compartilhado mudaria os quatro de uma vez.
        m.material = m.material.clone();
        // Copia o que houver: mapa, se um dia voltar a existir; cor, que é o
        // caso desde que o modelo passou a ser de cores chapadas.
        if (terra.map) m.material.map = terra.map;
        if (terra.color) m.material.color.copy(terra.color);
        m.material.roughness = .95;   // terra não brilha
        m.material.metalness = 0;
        m.material.needsUpdate = true;
      });
    }

    if (gabinete) {
      // Limitar a busca ao gabinete não é detalhe: o skid ao lado tem tanques
      // brancos e sem mapa que pegariam a arte do produto na barriga.
      let frente = null;
      gabinete.traverse(o => {
        if (!o.isMesh || frente) return;
        const m = o.material;
        if (!m || m.map || !m.color) return;                       // a plaquinha já tem textura própria
        if (m.color.r > .98 && m.color.g > .98 && m.color.b > .98) frente = o;
      });
      if (frente) {
        new THREE.TextureLoader().load(ARTE_TERASMART, tex => {
          /* CORRIGIDO: era `false` e a arte aparecia de cabeça para baixo na
             maquete.

             O raciocínio antigo está escrito aqui embaixo porque ele é o certo
             NO GERAL — UV de glTF conta o V de cima para baixo, ao contrário do
             padrão do three, e por isso o GLTFLoader marca flipY=false nas
             texturas que ele mesmo carrega. Só que esta aqui não vem do
             GLTFLoader: vem de um TextureLoader avulso, e o TextureLoader já
             entrega a imagem virada. Marcar flipY=false virava a segunda vez.

             Se agora ela sair espelhada na horizontal, o conserto é
             tex.wrapS = THREE.RepeatWrapping com tex.repeat.x = -1. */
          tex.flipY = true;
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = 4;
          frente.material = frente.material.clone();
          frente.material.map = tex;
          frente.material.roughness = .45;
          frente.material.metalness = .05;
          frente.material.needsUpdate = true;
        });
      }
    }
  }

  function fitModel(gltf, targetHeight) {
    const obj = gltf.scene;
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const s = targetHeight / size.y;
    const holder = new THREE.Group();
    obj.scale.setScalar(s);
    obj.position.set(-(box.min.x + box.max.x)/2*s, -box.min.y*s, -(box.min.z + box.max.z)/2*s);
    holder.add(obj);
    return holder;
  }

  // ============================================================ CAFEEIROS
  const coffeeStats = { total:0, byLod:[0,0,0,0], tris:0, draws:0 };
  const plantXZ = [];   // posições finais, guardadas para auditoria geométrica
  const corredoresPorArea = {};   // carreadores internos, por hectare
  let canopyDepth = .9;
  {
    let src = null;
    models.coffee.scene.traverse(o => { if (o.isMesh && !src) src = o; });
    const { lods, material, stats } = prepareCoffee(src);
    const PLANT_H = 2.2;                       // cafeeiro adulto conduzido
    const scale = PLANT_H / stats.height;
    canopyDepth = stats.depth * scale;

    // Onde a câmera do filme realmente desce ao chão. Usar os 24 sensores aqui seria
    // inútil: eles cobrem as quatro áreas, "perto de um sensor" viraria "em qualquer
    // lugar" e o campo inteiro cairia no nível mais caro.
    // Só onde a câmera do filme realmente para. A área A é a única que recebe
    // close; B, C e D só aparecem em plano aberto e caem no nível barato pela
    // distância, sem precisar de regra especial.
    const hero = [
      V3(dry.x, 0, dry.z), V3(wet.x, 0, wet.z),
      V3(sensorById['A5'].x, 0, sensorById['A5'].z),
      V3(ESTACAO[FOCUS].x, 0, ESTACAO[FOCUS].z),
    ];

    const dummy = new THREE.Object3D();
    const col = new THREE.Color();

    // ---------------------------------------------------------------------
    // O café é plantado AO LONGO DA CURVA DE NÍVEL, não numa grade.
    //
    // Cada fileira é uma polilinha de cota constante: os pés são distribuídos
    // por comprimento de arco sobre ela, então a fileira contorna o esporão e
    // entra na grota como contorna e entra no campo de verdade.
    //
    // Onde a encosta é mais íngreme, duas curvas vizinhas se aproximam no plano
    // e as fileiras se apertam. A malha de ocupação corta o excesso: sem ela, o
    // flanco do esporão viraria um matagal de pés colados uns nos outros.
    // ---------------------------------------------------------------------
    // ---------------------------------------------------------------------
    // O DESBASTE DECIDE POR TRECHO, NÃO POR PÉ.
    //
    // Testar cada pé isolado contra a fileira anterior parece a mesma coisa e
    // não é: como a declividade muda ao longo da curva, um pedaço da curva fica
    // a 3,5 m da fileira de cima e o pedaço seguinte a 2,5 m. Pé a pé, isso
    // pica a lavoura em tocos de três plantas — o hectare vira mato espalhado, e
    // não cafezal.
    //
    // Aqui cada curva é percorrida inteira, os pontos aprovados viram TRECHOS
    // contínuos, e só entram os trechos com pé suficiente para valer uma
    // fileira. As pontas curtas que sobram nas gargantas são descartadas, que é
    // o que o plantador faz quando a curva fecha e não cabe mais linha.
    // ---------------------------------------------------------------------
    const ENTRE = ALVO_H * .80;     // distância entre fileiras, medida no chão
    const MIN_CORRIDA = 4;          // menos que isso não é fileira, é sobra
    const fileirasPlantadas = [];
    BLOCKS.forEach(b => {
      const E = ESTACAO[b.id];
      const spots = [];
      const malha = new Map();

      // ------------------------------------------------------------------
      // CARREADORES INTERNOS: fileiras que não se planta.
      //
      // Sem eles não existe corredor contínuo. O desbaste escolhe as fileiras
      // uma a uma, e o vão que sobra entre duas nunca é o mesmo vão duas curvas
      // adiante — o resultado é um labirinto sem caminho que atravesse o hectare.
      //
      // Quais fileiras viram carreador só se decide DEPOIS do desbaste, na
      // segunda passada: a curva mais próxima de um sensor quase nunca é uma das
      // que sobraram, e reservar uma curva descartada não abre caminho nenhum.
      // ------------------------------------------------------------------
      const corridas = [];               // primeira passada: o que ficou de pé
      const corredores = [];
      const cabe = (x, z) => {
        const ci = Math.floor(x/ENTRE), cj = Math.floor(z/ENTRE);
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            for (const [ox, oz] of malha.get(`${ci+di},${cj+dj}`) || [])
              if ((ox-x)**2 + (oz-z)**2 < ENTRE*ENTRE) return false;
          }
        }
        return true;
      };

      curvasPorArea[b.id].fileiras.forEach(({ niv, pts }) => {
        let corrida = [];
        const fechar = () => {
          if (corrida.length >= MIN_CORRIDA) {
            corrida.forEach(sp => {
              const k = `${Math.floor(sp.x/ENTRE)},${Math.floor(sp.z/ENTRE)}`;
              if (!malha.has(k)) malha.set(k, []);
              malha.get(k).push([sp.x, sp.z]);
            });
            corridas.push({ niv, pts: corrida });
          }
          corrida = [];
        };
        passearNaLinha(pts, Q.spacing, (x, z, dx, dz) => {
          const px = x + (Math.random() - .5) * .25;
          const pz = z + (Math.random() - .5) * .25;
          if (!inPlanting(px, pz)
              || Math.abs(px - b.cx) > HA - 3 || Math.abs(pz - b.cz) > HA - 3) {
            fechar(); return;
          }
          for (const s of sensors) {
            if (s.block !== b.id) continue;
            if ((px - s.x)**2 + (pz - s.z)**2 < 13) { fechar(); return; }
          }
          // Clareira de 10 m no entorno da estação. Não é folga de câmera: um
          // painel solar sombreado por cafeeiro de 2,2 m não carrega a bateria,
          // e a manutenção precisa de espaço para trabalhar em volta do gabinete.
          if ((px - E.x)**2 + (pz - E.z)**2 < 100) { fechar(); return; }
          if (!cabe(px, pz)) { fechar(); return; }
          corrida.push({ x:px, z:pz, dir: Math.atan2(-dz, dx) });
        });
        fechar();
      });

      // ---- segunda passada: quais fileiras viram carreador
      //
      // A que passa mais perto de cada sensor, para o técnico chegar nele
      // andando, mais uma a cada oito para o hectare ter travessia. As
      // reservadas continuam ocupando lugar no desbaste (já ocuparam, acima),
      // senão a fileira seguinte teria avançado por cima do carreador.
      const carreador = new Set();
      const niveis = [...new Set(corridas.map(c => c.niv))].sort((p, q) => p - q);
      niveis.forEach((nv, i) => { if (i % 8 === 4) carreador.add(nv); });
      sensors.filter(s => s.block === b.id).forEach(s => {
        let melhor = null, dist = Infinity;
        corridas.forEach(c => {
          for (const sp of c.pts) {
            const d = (sp.x - s.x)**2 + (sp.z - s.z)**2;
            if (d < dist) { dist = d; melhor = c.niv; }
          }
        });
        if (melhor !== null) carreador.add(melhor);
      });
      corridas.forEach(c => {
        if (carreador.has(c.niv)) corredores.push(c.pts.map(sp => [sp.x, sp.z]));
        else { spots.push(...c.pts); fileirasPlantadas.push(c.pts); }
      });

      // ---- terceira passada: o que a curva de nível não alcança
      //
      // Onde o terreno é quase plano, duas curvas vizinhas ficam a dez metros
      // uma da outra por mais fino que seja o degrau — no limite, chão sem
      // declive não tem curva de nível nenhuma. É um patamar pelado no meio do
      // hectare, e nenhum cafeicultor deixa o melhor pedaço sem plantar.
      //
      // O buraco é preenchido por varredura, com o MESMO desbaste: só entra pé
      // onde não havia nada. E ele entra alinhado com a direção da curva local
      // (perpendicular ao caimento), então o renque continua fazendo sentido.
      for (let x = b.cx - HA + 3; x <= b.cx + HA - 3; x += ENTRE * .72) {
        for (let z = b.cz - HA + 3; z <= b.cz + HA - 3; z += ENTRE * .72) {
          const px = x + (Math.random() - .5) * .8, pz = z + (Math.random() - .5) * .8;
          if (!inPlanting(px, pz)) continue;
          if ((px - E.x)**2 + (pz - E.z)**2 < 100) continue;
          if (sensors.some(s => s.block === b.id && (px-s.x)**2 + (pz-s.z)**2 < 13)) continue;
          if (!cabe(px, pz)) continue;
          const k = `${Math.floor(px/ENTRE)},${Math.floor(pz/ENTRE)}`;
          if (!malha.has(k)) malha.set(k, []);
          malha.get(k).push([px, pz]);
          const [gx, gz] = gradienteEm(px, pz, 1.2);
          const g = Math.hypot(gx, gz) || 1;
          const sp = { x:px, z:pz, dir: Math.atan2(gx/g, -gz/g) };
          spots.push(sp);
          // um traço curto de terra mexida, na direção da curva
          fileirasPlantadas.push([
            { x: px + gz/g * 1.1, z: pz - gx/g * 1.1 },
            { x: px - gz/g * 1.1, z: pz + gx/g * 1.1 },
          ]);
        }
      }

      // Reparte em níveis de detalhe. Áreas que não são o foco caem direto no LOD
      // mais barato: a câmera nunca chega perto deles.
      const buckets = [[],[],[],[]];
      spots.forEach(sp => {
        let d = Infinity;
        for (const h of hero) {
          const ddx = sp.x - h.x, ddz = sp.z - h.z;
          d = Math.min(d, Math.sqrt(ddx*ddx + ddz*ddz));
        }
        buckets[d < Q.nearR ? 0 : d < Q.midR ? 1 : d < Q.farR ? 2 : 3].push(sp);
      });

      // No celular tudo desce um nível: o hectare em foco sozinho custava mais que a
      // soma dos outros três, porque é o único que recebe LOD0/LOD1. Um degrau de
      // LOD a mais é invisível numa tela de 6 polegadas e corta ~35% da geometria.
      const TIER = IS_MOBILE ? 1 : 0;
      buckets.forEach((bucket, li) => {
        if (!bucket.length) return;
        const lod = Math.min(lods.length - 1, li + TIER);
        const m = new THREE.InstancedMesh(lods[lod], material, bucket.length);
        // Só o nível mais detalhado projeta sombra: é o que fica perto da câmera. Os
        // outros dobrariam o custo de geometria por frame sem diferença visível.
        m.castShadow = Q.plantShadows && li === 0;
        m.receiveShadow = true;
        const tint = new Float32Array(bucket.length * 3);
        bucket.forEach((sp, i) => {
          const s = scale * (.86 + Math.random() * .3);
          dummy.position.set(sp.x, elevationAt(sp.x, sp.z) - .05, sp.z);
          // Quase alinhado à fileira: a copa é larga em X e fina em Z, então os pés
          // se tocam e formam renque contínuo, com uns graus de bagunça para não
          // virar fila de clones.
          // Alinhado À FILEIRA, que agora curva: a copa é larga num eixo e fina
          // no outro, e é o eixo largo que tem de acompanhar a linha para os pés
          // se tocarem em renque contínuo. Uns graus de bagunça para não virar
          // fila de clones.
          dummy.rotation.set(0, sp.dir + (Math.random() < .5 ? 0 : Math.PI)
                                       + (Math.random()-.5)*.30, 0);
          dummy.scale.set(s, s * (.94 + Math.random()*.16), s);
          dummy.updateMatrix();
          m.setMatrixAt(i, dummy.matrix);
          col.setHSL(.26 + (Math.random()-.5)*.035, .42, .40 + (Math.random()-.5)*.14);
          tint[i*3] = col.r; tint[i*3+1] = col.g; tint[i*3+2] = col.b;
        });
        m.instanceColor = new THREE.InstancedBufferAttribute(tint, 3);
        m.instanceMatrix.needsUpdate = true;
        // Uma malha por hectare por nível: assim o frustum descarta hectare inteiro
        // que saiu de quadro, em vez de mandar a lavoura toda para a GPU sempre.
        m.computeBoundingSphere();
        scene.add(m);
        registrar(m, 'cafe', b);
        coffeeStats.byLod[lod] += bucket.length;
        coffeeStats.tris += bucket.length * stats.tri[lod];
        coffeeStats.draws++;
      });
      coffeeStats.total += spots.length;
      spots.forEach(sp => plantXZ.push(sp.x, sp.z));
      corredoresPorArea[b.id] = corredores;
    });

    // ---- terra revolvida: um traço debaixo de cada fileira que ficou de pé
    {
      const N = IS_MOBILE ? 1024 : 2048;
      const c = document.createElement('canvas'); c.width = c.height = N;
      const g = c.getContext('2d');
      g.fillStyle = '#000'; g.fillRect(0, 0, N, N);
      const esc = N / (WORLD * 2);
      g.strokeStyle = '#fff';
      g.lineWidth = Math.max(1.6, 1.5 * esc);      // ~1,5 m de terra mexida
      g.lineJoin = g.lineCap = 'round';
      fileirasPlantadas.forEach(linha => {
        g.beginPath();
        linha.forEach((sp, i) => {
          const px = (sp.x + WORLD) * esc, pz = (sp.z + WORLD) * esc;
          if (i) g.lineTo(px, pz); else g.moveTo(px, pz);
        });
        g.stroke();
      });
      const t = new THREE.CanvasTexture(c);
      t.flipY = false;                             // v cresce com z, como no mundo
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.colorSpace = THREE.NoColorSpace;
      uTilled.value = t;
    }

    // ---- TRAJETOS: agora que o cafezal existe, dá para saber onde se anda
    {
      const CEL_L = 2.0, ocupado = new Map();
      for (let i = 0; i < plantXZ.length; i += 2) {
        const k = `${Math.floor(plantXZ[i]/CEL_L)},${Math.floor(plantXZ[i+1]/CEL_L)}`;
        if (!ocupado.has(k)) ocupado.set(k, []);
        ocupado.get(k).push([plantXZ[i], plantXZ[i+1]]);
      }
      // 1,45 m: meia-copa (0,44) mais o ombro de quem passa, com folga.
      const livre = (x, z) => {
        const ci = Math.floor(x/CEL_L), cj = Math.floor(z/CEL_L);
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++)
            for (const [ox, oz] of ocupado.get(`${ci+di},${cj+dj}`) || [])
              if ((ox-x)**2 + (oz-z)**2 < 1.45*1.45) return false;
        return true;
      };
      walkDry = buildWalk(aproximacaoDoSensor(dry, livre, corredoresPorArea));
      walkWet = buildWalk(aproximacaoDoSensor(wet, livre, corredoresPorArea));
    }

    console.log(`[TeraHecta] cafeeiro: vaso removido (${stats.removedTris} tri) · `
      + `LODs ${stats.tri.map(t => t+'tri').join('/')} · ${coffeeStats.total} plantas `
      + `(${coffeeStats.byLod.join('/')}) ≈ ${(coffeeStats.tris/1000).toFixed(0)}k tri em `
      + `${coffeeStats.draws} draw calls · copa ${canopyDepth.toFixed(2)}m, `
      + `corredor livre ${(ROW_SPACING - canopyDepth).toFixed(2)}m`);
  }


// ===================================================================================
// SONDA DO SENSOR
//
// Vem do SondaSensor.html: um SVG da própria sonda TeraBoard, extrudado. Duas
// coisas foram feitas para caber em dezenas de cópias na cena:
//
//  1. Os caminhos pequenos (as letras "TeraBoard" gravadas na peça) são
//     descartados. A 30 cm de altura e vistos do outro lado do hectare eles são
//     ilegíveis, e sozinhos respondem pela maior parte dos triângulos.
//  2. Os caminhos que sobram são mesclados por cor e viram UMA InstancedMesh por
//     cor — as 24 sondas em 3 chamadas de desenho em vez de 24 grupos soltos.
//
// A cor do corpo é por instância, então cada sonda acende conforme o estado do
// seu sensor: verde tudo certo, âmbar atenção, vermelho crítico.
// ===================================================================================
const SONDA_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1457.07 2908.03">
 <g>
  <rect fill="#3DB988" x="120.19" y="529.04" width="1212.54" height="1580.92" rx="215.4" ry="219"/>
  <g>
   <polygon fill="#3DB988" points="359.38,0 719.97,311.42 344.28,611.64 0.02,308.37"/>
   <polygon fill="#184C38" points="1457.07,317.91 716.43,926.81 716.94,1258.45 1457.07,637.23"/>
   <polygon fill="#179068" points="1096.24,0.41 343.78,611.04 -0,308.36 -0,632.08 717,1258.25 716.92,929.62 1456.78,318.55"/>
  </g>
 </g>
</svg>`;

/**
 * Constrói as geometrias da sonda, agrupadas por cor e já assentadas com a base
 * em y=0 e altura `alturaAlvo`.
 */
function construirSonda(alturaAlvo) {
  const dados = new SVGLoader().parse(SONDA_SVG);
  const porCor = new Map();

  // Ordem de camada: a placa é o primeiro caminho e fica atrás; o logo vem
  // depois e é empurrado para a frente. Sem esse escalonamento os dois ocupam a
  // mesma faixa de profundidade e o logo aparece atravessado na placa.
  dados.paths.forEach((caminho, camada) => {
    const fill = caminho.userData?.style?.fill;
    if (!fill || fill === 'none' || fill.includes('url')) return;   // pula os espetos
    const cor = fill.toUpperCase();
    const profundidade = camada === 0 ? 190 : 90;
    caminho.toShapes(true).forEach(forma => {
      const g = new THREE.ExtrudeGeometry(forma, {
        depth: profundidade, bevelEnabled: true, bevelSegments: 1, steps: 1,
        bevelSize: 10, bevelThickness: 12,
      });
      if (camada > 0) g.translate(0, 0, 190);   // logo em relevo, sobre a placa
      if (!porCor.has(cor)) porCor.set(cor, []);
      porCor.get(cor).push(g);
    });
  });

  // mescla por cor
  const partes = [];
  for (const [cor, gs] of porCor) {
    const g = gs.length === 1 ? gs[0] : BufferGeometryUtils.mergeGeometries(gs, false);
    partes.push({ cor, geom: g });
  }

  // O SVG cresce para baixo; espelhar Y põe a peça de pé. Depois tudo é
  // centrado em XZ e escalado para a altura pedida.
  const caixa = new THREE.Box3();
  partes.forEach(({ geom }) => {
    geom.scale(1, -1, 1);
    geom.computeBoundingBox();
    caixa.union(geom.boundingBox);
  });
  const tam = caixa.getSize(new THREE.Vector3());
  const k = alturaAlvo / tam.y;
  const cx = (caixa.min.x + caixa.max.x) / 2;
  const cz = (caixa.min.z + caixa.max.z) / 2;
  partes.forEach(({ geom }) => {
    geom.translate(-cx, -caixa.min.y, -cz);
    geom.scale(k, k, k);
    geom.computeVertexNormals();
    geom.computeBoundingSphere();
  });
  return partes;
}

  // ============================================================ SENSORES
  // 24 sensores. Hastes e cabeças vão INSTANCIADAS (2 draw calls no total) — vinte e
  // quatro grupos soltos custariam ~150 chamadas de desenho só nisto.
  //
  // A sonda NÃO emite luz. A tentativa anterior era um halo aditivo — a mesma
  // silhueta um pouco maior, somada por cima — e o que aparecia na tela não era
  // brilho: era um fantasma deslocado em volta da peça, pior ainda quando a cor
  // virava vermelho de alerta. O estado agora está na cor da própria peça, que é
  // sólida e lê a qualquer distância, e a sonda cresceu para caber essa leitura.
  const SONDA_H = .62;          // cabeça da sonda, em metros
  const SONDA_Y = .80;          // altura da base da cabeça sobre o solo
  const sensorVisual = {};
  const sensorIndex = Object.fromEntries(sensors.map((s, i) => [s.id, i]));
  const corSonda = new THREE.Color();
  {
    const rodGeo = new THREE.CylinderGeometry(.05, .05, 1.2, 8);
    rodGeo.translate(0, .24, 0);
    const rodMat = new THREE.MeshStandardMaterial({ color:0x3a3f38, metalness:.5, roughness:.45 });
    const rods = new THREE.InstancedMesh(rodGeo, rodMat, sensors.length);
    rods.castShadow = true;

    // ---- a sonda, no lugar da esfera ----
    const partesSonda = construirSonda(SONDA_H);
    const d = new THREE.Object3D();
    sensorVisual.sondas = [];

    // ------------------------------------------------------------------
    // A sonda inteira veste o estado.
    //
    // Antes só o corpo mudava de cor e as duas cores do logo ficavam verdes: a
    // sonda em alerta virava um corpo vermelho com uma marca verde plantada em
    // cima, que de longe lia como "meio vermelho". Agora TODAS as partes
    // recebem a cor do estado — as do logo em tons mais escuros da MESMA cor,
    // que é o que mantém a marca visível sem quebrar a leitura de "esta sonda
    // está em alerta".
    //
    // O tom entra por instância, então o material de cada parte é branco: o
    // three multiplica material × instância, e uma cor no material sobreviveria
    // como tinta por baixo de todas as sondas.
    // ------------------------------------------------------------------
    const TOM = { '#3DB988':1.0, '#179068':.62, '#184C38':.34 };
    sensorVisual.tons = [];

    partesSonda.forEach(({ cor, geom }) => {
      // Emissivo ZERO: o emissivo é constante do material e as sondas dividem
      // um material só — qualquer emissivo aqui seria somado por igual em todas e
      // lavaria justamente a cor que carrega o estado.
      const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff, roughness: .48, metalness: .06,
      });
      const inst = new THREE.InstancedMesh(geom, mat, sensors.length);
      inst.castShadow = true;
      sensors.forEach((s, i) => {
        d.position.set(s.x, s.y + SONDA_Y, s.z);
        d.rotation.set(0, Math.PI, 0);
        d.updateMatrix();
        inst.setMatrixAt(i, d.matrix);
      });

      const k = TOM[cor] ?? 1;
      const tint = new Float32Array(sensors.length * 3);
      const c = new THREE.Color(0x2fbe7e);
      for (let i = 0; i < sensors.length; i++) {
        tint[i*3] = c.r * k; tint[i*3+1] = c.g * k; tint[i*3+2] = c.b * k;
      }
      inst.instanceColor = new THREE.InstancedBufferAttribute(tint, 3);
      sensorVisual.tons.push({ attr: inst.instanceColor, k });

      inst.computeBoundingSphere();
      scene.add(inst);
      sensorVisual.sondas.push(inst);
    });

    sensors.forEach((s, i) => {
      d.position.set(s.x, s.y, s.z); d.updateMatrix();
      rods.setMatrixAt(i, d.matrix);
    });
    rods.computeBoundingSphere();
    scene.add(rods);

    // Alvo de clique: a sonda tem 60 cm e a haste é um risco: acertar isso com o
    // dedo, num celular, a dez metros de distância, seria sorte. Uma caixa
    // invisível em volta de cada sensor dá ao clique a folga que o olho já tem.
    // Opacidade zero em vez de visible=false para não depender de o raycaster
    // ignorar (ou não) objeto escondido, e sem escrita de profundidade para não
    // atrapalhar o que é desenhado depois.
    {
      const alvo = new THREE.InstancedMesh(
        new THREE.BoxGeometry(.9, 1.9, .9),
        new THREE.MeshBasicMaterial({ transparent:true, opacity:0, depthWrite:false }),
        sensors.length);
      sensors.forEach((s, i) => {
        d.position.set(s.x, s.y + .95, s.z); d.updateMatrix();
        alvo.setMatrixAt(i, d.matrix);
      });
      alvo.computeBoundingSphere();
      scene.add(alvo);
      registrar(alvo, 'sensor');
    }

    // ------------------------------------------------------------------
    // A sonda é uma peça CHAPADA: de perfil ela some, e de costas o que a
    // câmera vê é o verso liso. Ela gira em torno da haste para ficar sempre de
    // frente para a lente — não é a peça que muda, é a mesma peça sempre
    // apresentada pela face que se lê.
    //
    // Só o giro é reescrito, e num único Object3D reaproveitado: 24 matrizes por
    // quadro custam menos que uma planta a mais na cena.
    // ------------------------------------------------------------------
    const encara = new THREE.Object3D();
    let ultimaLente = null;
    sensorVisual.encararCamera = (cam) => {
      // Enquanto a lente não anda, a matriz da sonda do quadro anterior continua
      // valendo. A chave é a POSIÇÃO da câmera, arredondada a 20 cm: o ângulo em
      // volta da origem não serve — num travelling rente ao corredor ele mal se
      // move enquanto o rumo de cada sonda gira meia volta.
      const p = cam.position;
      const chave = `${p.x*5|0},${p.y*5|0},${p.z*5|0}`;
      if (chave === ultimaLente) return;
      ultimaLente = chave;
      sensors.forEach((s, i) => {
        encara.position.set(s.x, s.y + SONDA_Y, s.z);
        // A face da sonda sai em +Z local (o logo é extrudado por cima da placa,
        // nessa direção), então o rumo da câmera é o próprio ângulo do giro.
        encara.rotation.set(0, Math.atan2(cam.position.x - s.x, cam.position.z - s.z), 0);
        encara.updateMatrix();
        sensorVisual.sondas.forEach(inst => inst.setMatrixAt(i, encara.matrix));
      });
      sensorVisual.sondas.forEach(inst => { inst.instanceMatrix.needsUpdate = true; });
    };

    // Rótulo e ícone de alerta só nos sensores do hectare em foco, e um ícone único
    // por hectare vizinho. Quarenta sprites de cada seriam 80 draw calls de HUD 3D.
    sensorVisual.warn = {};
    sensors.filter(s => s.block === FOCUS).forEach(s => {
      const lbl = makeLabel(s.id, '#f2ecd9', .3);
      lbl.position.set(s.x, s.y + 1.75, s.z);
      scene.add(lbl); mapLabels.push(lbl);
      const w = makeIcon('⚠', '#ff5c5c', .9);
      w.position.set(s.x, s.y + 3.25, s.z);
      scene.add(w);
      sensorVisual.warn[s.id] = w;
    });
  }

  // ---- ligação sensor → estação: TODAS as linhas numa geometria só
  {
    const pts = [];
    sensors.forEach(s => {
      const b = s.blockRef;
      const a = V3(s.x, s.y + .15, s.z);
      const E = ESTACAO[s.block];
      const e = V3(E.x, E.y + .2, E.z);
      const mid = a.clone().lerp(e, .5); mid.y = Math.max(a.y, e.y) + .6;
      const curve = new THREE.QuadraticBezierCurve3(a, mid, e).getPoints(14);
      for (let i = 0; i < curve.length - 1; i++) pts.push(curve[i], curve[i+1]);
    });
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const l = new THREE.LineSegments(g, new THREE.LineDashedMaterial({
      color:0x3ffa8b, dashSize:.7, gapSize:.5, transparent:true, opacity:.55 }));
    l.computeLineDistances();
    scene.add(l);
  }

  // ================================================== GABINETE PADRÃO TERAHECTA
  //
  // A caixa do TeraHecta é sempre a MESMA peça: corpo claro sobre pernas, arte
  // impressa na face e prensa-cabo na base. Muda o tamanho e o que está escrito.
  // A da sede tem visor; a do hectare não — no meio da lavoura ninguém vai ler
  // tela, quem lê é o app.
  //
  // A arte é desenhada em coordenadas RELATIVAS à tela, e não em pixels soltos:
  // a mesma rotina serve gabinetes de proporções diferentes sem o texto sair
  // esticado ou fora da caixa.
  function makeCabinet({ W, H, D, LEG, titulo, subtitulo, linhas, visor = false }) {
    const grupo = new THREE.Group();
    const cvs = document.createElement('canvas');
    cvs.width = 384; cvs.height = Math.round(384 * H / W);
    const c = cvs.getContext('2d');
    const CW = cvs.width, CH = cvs.height;

    const grd = c.createLinearGradient(0, 0, 0, CH);
    grd.addColorStop(0, '#f4f1e2'); grd.addColorStop(1, '#e2ddc8');
    c.fillStyle = grd; c.fillRect(0, 0, CW, CH);

    c.fillStyle = '#0b1a12'; c.fillRect(0, 0, CW, CH * .235);
    c.textAlign = 'center';
    c.fillStyle = '#3ffa8b'; c.font = `700 ${Math.round(CH*.09)}px "IBM Plex Mono", monospace`;
    c.fillText(titulo, CW/2, CH * .121);
    c.fillStyle = '#f2ecd9'; c.font = `500 ${Math.round(CH*.039)}px "IBM Plex Mono", monospace`;
    c.fillText(subtitulo, CW/2, CH * .188);

    c.strokeStyle = '#0b1a12'; c.lineWidth = 3;
    c.strokeRect(CW*.068, CH*.57, CW*.864, CH*.371);
    c.fillStyle = '#0b1a12'; c.font = `600 ${Math.round(CH*.037)}px "IBM Plex Mono", monospace`;
    c.textAlign = 'left';
    linhas.forEach((t, i) => c.fillText(t, CW*.11, CH*.637 + i * CH*.066));

    const art = new THREE.CanvasTexture(cvs); art.colorSpace = THREE.SRGBColorSpace;
    const lado = new THREE.MeshStandardMaterial({ color:0xe8e4d2, roughness:.6, metalness:0 });
    const frente = new THREE.MeshStandardMaterial({ map:art, roughness:.5, metalness:0 });
    const corpo = new THREE.Mesh(new THREE.BoxGeometry(W, H, D),
      [lado, lado, lado, lado, frente, lado]);
    corpo.position.y = LEG + H/2; corpo.castShadow = true; corpo.receiveShadow = true;
    grupo.add(corpo);

    for (const sx of [-1, 1]) {
      const perna = new THREE.Mesh(new THREE.BoxGeometry(.1, LEG, .1),
        new THREE.MeshStandardMaterial({ color:0x5b6470, roughness:.55, metalness:.35 }));
      perna.position.set(sx * W * .38, LEG/2, 0); perna.castShadow = true; grupo.add(perna);
    }
    const prensa = new THREE.Mesh(new THREE.CylinderGeometry(.06,.06,.14,10),
      new THREE.MeshStandardMaterial({ color:0x1e293b, roughness:.7 }));
    prensa.position.set(0, LEG + .05, -D/2); grupo.add(prensa);

    let desenharVisor = null;
    if (visor) {
      const lc = document.createElement('canvas'); lc.width = 512; lc.height = 200;
      const lx = lc.getContext('2d');
      const lt = new THREE.CanvasTexture(lc); lt.colorSpace = THREE.SRGBColorSpace;
      desenharVisor = (a, b2, c3) => {
        lx.fillStyle = '#04140c'; lx.fillRect(0,0,512,200);
        lx.fillStyle = '#1DC78B'; lx.shadowColor = '#1DC78B'; lx.shadowBlur = 12;
        lx.font = 'bold 34px "IBM Plex Mono", monospace'; lx.textAlign = 'left';
        lx.fillText(a,26,56); lx.fillText(b2,26,116); lx.fillText(c3,26,176);
        lx.shadowBlur = 0; lt.needsUpdate = true;
      };
      const moldura = new THREE.Mesh(new THREE.PlaneGeometry(W*.66, H*.2),
        new THREE.MeshStandardMaterial({ color:0x06180F, roughness:.85 }));
      moldura.position.set(0, LEG + H*.72, D/2 + .004); grupo.add(moldura);
      const tela = new THREE.Mesh(new THREE.PlaneGeometry(W*.62, H*.175),
        new THREE.MeshBasicMaterial({ map:lt }));
      tela.position.set(0, LEG + H*.72, D/2 + .009); grupo.add(tela);
    }
    return { grupo, desenharVisor, alturaTotal: LEG + H };
  }

  // ============================================================ ESTAÇÕES
  const stationTops = {};
  const blockWarnIcons = [];
  BLOCKS.forEach(b => {
    const E = ESTACAO[b.id];
    const g = new THREE.Group();
    g.position.set(E.x, E.y, E.z);

    const EW = .95, EH = 1.25, ED = .40, ELEG = .62;
    const { grupo: gabinete } = makeCabinet({
      W:EW, H:EH, D:ED, LEG:ELEG,
      titulo:'TERAHECTA', subtitulo:'ESTAÇÃO DE TRANSMISSÃO',
      linhas:[b.name, '6 PONTOS DE LEITURA', '1 ha MONITORADO'],
    });
    g.add(gabinete);

    // O painel solar é POSICIONADO PELA PRÓPRIA MEDIDA, não por um valor
    // escrito no olho: ele é largo, e o número antigo o deixava encavalado no
    // gabinete — as duas peças se atravessavam em qualquer ângulo de câmera.
    // Aqui ele encosta o próprio limite na folga pedida e nada mais.
    const solar = fitModel({ scene: models.solar.scene.clone(true) }, 1.7);
    normalize(solar, .55);
    makeGlassy(solar);
    solar.rotation.y = Math.PI * .12;
    solar.updateMatrixWorld(true);
    const cxs = new THREE.Box3().setFromObject(solar);
    solar.position.set(-(EW/2 + (cxs.max.x - cxs.min.x)/2 + .5), 0, -.25);
    g.add(solar);

    // Mastro alto de propósito: o dossel molhado do cafezal atrapalha o alcance,
    // e a antena trabalha bem acima dele.
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(.055, .075, 6.4, 8),
      new THREE.MeshStandardMaterial({ color:0x9aa2a8, metalness:.6, roughness:.35 }));
    mast.position.set(1.15, 3.2, .2); mast.castShadow = true; g.add(mast);

    const ant = fitModel({ scene: models.antenna.scene.clone(true) }, 2.0);
    normalize(ant, .5);
    ant.position.set(1.15, 6.2, .2); g.add(ant);
    registrar(gabinete, 'estacao', b);
    registrar(solar, 'solar', b);
    registrar(ant, 'antena', b);
    registrar(mast, 'antena', b);

    const lbl = makeLabel(b.name + ' · 1 ha', b.id === FOCUS ? '#3ffa8b' : '#8ab4f8',
      1.15, 'rgba(11,26,18,.85)');
    lbl.position.y = 9.0; g.add(lbl); mapLabels.push(lbl);

    // Marca de hectare: é anotação de mapa, então entra na mesma regra de
    // desaparecimento por altitude. Sem isso, um plano rente ao chão que passe
    // perto de uma estação leva um triângulo vermelho de tela inteira.
    const warn = makeIcon('⚠', '#ff5c5c', 1.2);
    warn.position.y = 7.4; g.add(warn);
    sensorVisual.warn['BLOCK_' + b.id] = warn;
    blockWarnIcons.push(warn);

    scene.add(g);
    stationTops[b.id] = V3(E.x + 1.15, E.y + 7.6, E.z + .2);
  });

  // ===================================================== SEDE — "FAZENDA BOA"
  // A propriedade do projeto anterior entra inteira: casa de tora, estufa,
  // canteiros, barris e o gabinete na parede. Ela não é explicada em lugar
  // nenhum da narração — fica ali como parte da paisagem, e quem conhece
  // reconhece.
  const obstaculosSede = [];
  {
    const sede = models.fazenda.scene;
    sede.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(sede);
    const c = bb.getCenter(new THREE.Vector3());
    // centra em XZ e apoia a base no patamar
    sede.position.set(-c.x, -bb.min.y, -c.z);

    const raiz = new THREE.Group();
    raiz.add(sede);
    raiz.position.set(SEDE.x, SEDE_Y, SEDE.z);
    raiz.rotation.y = Math.PI * .18;
    raiz.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true;
    });
    vestirSede(raiz);
    scene.add(raiz);
    raiz.updateMatrixWorld(true);
    // A sede inteira responde ao clique; qual ficha aparece depende de ONDE se
    // clicou — o gabinete TeraSmart que veio no modelo tem a sua.
    registrar(raiz, 'sede');

    const lbl = makeLabel('SEDE', '#f2ecd9', .9, 'rgba(11,26,18,.8)');
    lbl.position.set(SEDE.x, SEDE_Y + 9.5, SEDE.z);
    scene.add(lbl); mapLabels.push(lbl);

    // ------------------------------------------------------------------
    // Obstáculos da sede, MEDIDOS da própria malha.
    //
    // O passeio do produtor tem que respeitar casa, estufa, canteiros, barris e
    // cerca. Escrever esses limites à mão significaria copiar valores que só
    // existem dentro do .glb — e que mudam se a fazenda for reexportada. Aqui
    // cada peça acima de 40 cm vira um retângulo no plano, e o caminho é traçado
    // depois no que sobrou. Abaixo de 40 cm fica o gramado e as pedras do
    // caminho, que são justamente por onde ele PODE andar.
    // ------------------------------------------------------------------
    raiz.traverse(o => {
      if (!o.isMesh) return;
      const cx = new THREE.Box3().setFromObject(o);
      if (cx.max.y - SEDE_Y < .4) return;           // rente ao chão: não atrapalha
      // Malha instanciada (a cerca, as flores do canteiro) devolve UMA caixa que
      // cobre todas as cópias — ou seja, o terreno inteiro. Tratar isso como um
      // obstáculo maciço fecha o terreiro e o passeio colapsa no raio mínimo,
      // que foi exatamente o que aconteceu na primeira tentativa.
      if (cx.max.x - cx.min.x > 9 || cx.max.z - cx.min.z > 9) return;
      obstaculosSede.push({
        x0: cx.min.x, x1: cx.max.x, z0: cx.min.z, z1: cx.max.z,
      });
    });
  }

  // ==================================================== CAIXA PRINCIPAL
  // O mesmo gabinete das estações, um tamanho acima e com visor: é aqui que os
  // quatro áreas se juntam antes de subir.
  const mainBox = new THREE.Group();
  let lcdDraw = null;
  {
    const { grupo, desenharVisor } = makeCabinet({
      W:1.15, H:1.7, D:.45, LEG:.68,
      titulo:'TERAHECTA', subtitulo:'CAIXA PRINCIPAL',
      linhas:['CENTRAL DA PROPRIEDADE','4 ESTAÇÕES · 4 ha','24 PONTOS DE LEITURA',
              'ENVIO PARA A NUVEM','INSTALAÇÃO EXTERNA'],
      visor:true,
    });
    mainBox.add(grupo);
    lcdDraw = desenharVisor;
    lcdDraw('TERAHECTA', '4 ESTAÇÕES ONLINE', 'SINCRONIZADO');
    const lbl = makeLabel('CAIXA PRINCIPAL', '#e8b64f', .95, 'rgba(11,26,18,.88)');
    lbl.position.y = 3.3; mainBox.add(lbl); mapLabels.push(lbl);
  }
  mainBox.position.set(MAINBOX.x, MAINBOX.y, MAINBOX.z);
  mainBox.rotation.y = Math.PI * .15;
  scene.add(mainBox);
  registrar(mainBox, 'caixa');
  const mainBoxTop = V3(MAINBOX.x, MAINBOX.y + 2.6, MAINBOX.z);

  // =================================================== ESTAÇÃO METEOROLÓGICA
  // Anemômetro de conchas, biruta, pluviômetro e abrigo termométrico ventilado.
  // Ela é o que permite ao sistema ANTECIPAR: prever a chuva antes dela cair muda a
  // leitura de um alerta de solo (não adianta regar se vem 40 mm em seis horas).
  const meteo = new THREE.Group();
  let cupsGroup = null, vaneGroup = null;
  {
    const metal = new THREE.MeshStandardMaterial({ color:0xd8dde2, roughness:.4, metalness:.35 });
    const dark  = new THREE.MeshStandardMaterial({ color:0x2f3a44, roughness:.6, metalness:.2 });

    const mast = new THREE.Mesh(new THREE.CylinderGeometry(.07,.09,4.6,10), metal);
    mast.position.y = 2.3; mast.castShadow = true; meteo.add(mast);

    // tripé
    for (let i = 0; i < 3; i++) {
      const a = i * Math.PI * 2 / 3;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(.035,.035,1.5,6), metal);
      leg.position.set(Math.cos(a)*.42, .62, Math.sin(a)*.42);
      leg.rotation.z = -Math.cos(a)*.5; leg.rotation.x = Math.sin(a)*.5;
      leg.castShadow = true; meteo.add(leg);
    }

    cupsGroup = new THREE.Group();
    cupsGroup.position.y = 4.75;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(.05,.05,.12,8), dark);
    cupsGroup.add(hub);
    for (let i = 0; i < 3; i++) {
      const a = i * Math.PI * 2 / 3;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(.30,.018,.018), metal);
      arm.position.set(Math.cos(a)*.15, 0, Math.sin(a)*.15);
      arm.rotation.y = -a; cupsGroup.add(arm);
      const cup = new THREE.Mesh(new THREE.SphereGeometry(.075, 10, 8, 0, Math.PI*2, 0, Math.PI/2),
        new THREE.MeshStandardMaterial({ color:0xe8e4d2, roughness:.5, side:THREE.DoubleSide }));
      cup.position.set(Math.cos(a)*.3, 0, Math.sin(a)*.3);
      cup.rotation.set(Math.PI/2, 0, -a);
      cupsGroup.add(cup);
    }
    meteo.add(cupsGroup);

    vaneGroup = new THREE.Group();
    vaneGroup.position.y = 4.35;
    const tail = new THREE.Mesh(new THREE.BoxGeometry(.02,.20,.30), metal);
    tail.position.z = -.26; vaneGroup.add(tail);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(.055,.20,8), metal);
    nose.rotation.x = Math.PI/2; nose.position.z = .26; vaneGroup.add(nose);
    const rod = new THREE.Mesh(new THREE.BoxGeometry(.018,.018,.5), metal);
    vaneGroup.add(rod);
    meteo.add(vaneGroup);

    // abrigo termométrico (pratos empilhados)
    for (let i = 0; i < 5; i++) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(.15 - i*.008, .17 - i*.008, .035, 14),
        new THREE.MeshStandardMaterial({ color:0xf2f0e6, roughness:.55 }));
      p.position.set(.42, 2.5 + i*.075, 0); meteo.add(p);
    }
    // pluviômetro
    const gauge = new THREE.Mesh(new THREE.CylinderGeometry(.13,.10,.42,12), dark);
    gauge.position.set(-.44, 2.2, 0); gauge.castShadow = true; meteo.add(gauge);
    const funnel = new THREE.Mesh(new THREE.ConeGeometry(.155,.16,12, 1, true),
      new THREE.MeshStandardMaterial({ color:0xbcc4cc, roughness:.35, metalness:.4, side:THREE.DoubleSide }));
    funnel.position.set(-.44, 2.47, 0); meteo.add(funnel);
    // painel solar da estação
    const sp = new THREE.Mesh(new THREE.BoxGeometry(.6,.03,.4),
      new THREE.MeshStandardMaterial({ color:0x0d1c36, metalness:.3, roughness:.06,
        envMap:skyEnv, envMapIntensity:1.6 }));
    sp.position.set(0, 3.5, .3); sp.rotation.x = -Math.PI/5;
    sp.castShadow = true; meteo.add(sp);

    const lbl = makeLabel('ESTAÇÃO METEOROLÓGICA', '#9fd8ff', 1.15, 'rgba(11,26,18,.85)');
    lbl.position.y = 6.1; meteo.add(lbl); mapLabels.push(lbl);
  }
  meteo.position.set(METEO.x, METEO.y, METEO.z);
  scene.add(meteo);
  registrar(meteo, 'meteo');

  // ============================================ MALHA DE RÁDIO E ENLACES
  // ------------------------------------------------------------------------
  // PACOTES DE DADOS
  //
  // Linha tracejada sozinha não conta que existe COMUNICAÇÃO: ela só desenha um
  // fio. O que mostra a malha funcionando é ver o dado andando por ela — do
  // sensor para a estação, de estação para estação, e de todas para a Caixa
  // Principal. Cada enlace ganha um punhado de pontos que correm pela curva.
  // ------------------------------------------------------------------------
  const packetCurves = [];
  const packetGeo = new THREE.SphereGeometry(1.15, 10, 8);

  function makeLink(a, b, color, lift, dash, opacity, packets = 0) {
    const mid = a.clone().lerp(b, .5); mid.y = Math.max(a.y, b.y) + lift;
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    const l = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(curve.getPoints(40)),
      new THREE.LineDashedMaterial({ color, dashSize:dash, gapSize:dash*.7, transparent:true, opacity }));
    l.computeLineDistances(); scene.add(l);

    if (packets > 0) {
      // Sem blending aditivo: ele saturava o pacote para branco puro e apagava a
      // cor do enlace — que é o código de cor que a narração do filme cita
      // ("os pontos azuis", "os pacotes âmbar").
      const mat = new THREE.MeshBasicMaterial({ color, transparent:true, opacity:1,
        depthWrite:false, toneMapped:false });
      const inst = new THREE.InstancedMesh(packetGeo, mat, packets);
      inst.frustumCulled = false;
      scene.add(inst);
      packetCurves.push({ curve, inst, count:packets, speed:.16 + Math.random()*.05 });
    }
    return l;
  }
  // ------------------------------------------------------------------------
  // Cada estação fala DIRETO com a Caixa Principal.
  //
  // Não existe malha entre estações: saltar de vizinha em vizinha seria complicar
  // o que o alcance já resolve — e cada salto a mais é uma estação a mais que, se
  // cair, derruba o caminho.
  // ------------------------------------------------------------------------
  const uplinks = BLOCKS.map(b => makeLink(stationTops[b.id], mainBoxTop, 0xe8b64f, 46, 1.8, .8, 6));
  // meteorológica → Caixa Principal
  const meteoLink = makeLink(V3(METEO.x, METEO.y + 4.9, METEO.z), mainBoxTop, 0x9fd8ff, 5, 1.2, .8, 2);

  // ====================================== ÁREA DE ACÚMULO / DRENAGEM EM ESTUDO
  const pond = new THREE.Group();
  let pondSurface = null;
  {
    // Lâmina d'água que engorda durante a chuva, no ponto mais baixo de tudo.
    const seg = 72;
    const g = new THREE.PlaneGeometry(POND.rx*2, POND.rz*2, seg, Math.floor(seg/3));
    g.rotateX(-Math.PI/2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const wx = POND.x + p.getX(i), wz = POND.z + p.getZ(i);
      p.setY(i, elevationAt(wx, wz) + .12);
    }
    g.computeVertexNormals();
    const m = new THREE.MeshStandardMaterial({
      color:0x2b6ea8, roughness:.12, metalness:.15, transparent:true, opacity:0,
      depthWrite:false });
    pondSurface = new THREE.Mesh(g, m);
    pondSurface.position.set(POND.x, 0, POND.z);
    pond.add(pondSurface);
    registrar(pondSurface, 'agua');

    // contorno tracejado da área em estudo
    const pts = [];
    for (let i = 0; i <= 96; i++) {
      const a = i / 96 * Math.PI * 2;
      const x = POND.x + Math.cos(a) * POND.rx, z = POND.z + Math.sin(a) * POND.rz;
      pts.push(V3(x, elevationAt(x, z) + .5, z));
    }
    const outline = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineDashedMaterial({ color:0x5aa9e6, dashSize:2.5, gapSize:1.8, transparent:true, opacity:.9 }));
    outline.computeLineDistances(); pond.add(outline);

    const lbl = makeLabel('ACÚMULO — DRENAGEM EM ESTUDO', '#5aa9e6', 1.9, 'rgba(11,26,18,.86)');
    lbl.position.set(POND.x, elevationAt(POND.x, POND.z) + 12, POND.z);
    pond.add(lbl); mapLabels.push(lbl);
  }
  scene.add(pond);

  // ===================================================================================
  // DRENO EM ESTUDO
  //
  // Ilustrativo de propósito: uma calha saindo da bacia e descendo até fora do
  // hectare, com a água correndo dentro. Não é projeto de drenagem — é a forma de
  // mostrar em imagem o que a narração diz que está sendo estudado, em vez de
  // deixar a frase solta sobre uma poça parada.
  // ===================================================================================
  const dreno = new THREE.Group();
  dreno.visible = false;
  let drenoAgua = null, drenoMat = null;
  {
    const pontos = [];
    // Passos curtos: com poucos pontos a curva suavizada corta o relevo e a
    // calha sai boiando no ar em vez de acompanhar o chão.
    const N = 26;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      // sai da bacia pelo leste e desce acompanhando o caimento do terreno
      const x = POND.x + 34 + t * 74 + Math.sin(t * Math.PI) * 10;
      const z = POND.z - 4 + t * 26;
      // afundada mais que o raio do tubo, para virar vala e não tubulação
      pontos.push(V3(x, elevationAt(x, z) - 1.05, z));
    }
    const curva = new THREE.CatmullRomCurve3(pontos);

    // calha: um tubo meio enterrado vira uma vala aberta
    const calha = new THREE.Mesh(
      new THREE.TubeGeometry(curva, 90, 1.35, 10, false),
      new THREE.MeshStandardMaterial({ color:0x4a3a26, roughness:.95, metalness:0,
        side:THREE.DoubleSide }));
    calha.receiveShadow = true;
    dreno.add(calha);

    // água correndo: listras rolando ao longo do tubo
    const cvs = document.createElement('canvas');
    cvs.width = 64; cvs.height = 8;
    const cx2 = cvs.getContext('2d');
    cx2.fillStyle = '#2f7fe6'; cx2.fillRect(0, 0, 64, 8);
    for (let i = 0; i < 4; i++) {
      const g = cx2.createLinearGradient(i*16, 0, i*16+16, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(.5, 'rgba(200,232,255,.9)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      cx2.fillStyle = g; cx2.fillRect(i*16, 0, 16, 8);
    }
    const tex = new THREE.CanvasTexture(cvs);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(14, 1);
    drenoMat = new THREE.MeshStandardMaterial({
      color:0xffffff, map:tex, roughness:.15, metalness:0,
      transparent:true, opacity:.92, side:THREE.DoubleSide,
      emissive:0x1d4ed8, emissiveIntensity:.2 });
    drenoAgua = new THREE.Mesh(new THREE.TubeGeometry(curva, 90, .95, 10, false), drenoMat);
    dreno.add(drenoAgua);

    const lbl = makeLabel('DRENO EM ESTUDO · ILUSTRATIVO', '#7fd0ff', 1.5, 'rgba(11,26,18,.86)');
    const meio = curva.getPointAt(.5);
    lbl.position.set(meio.x, meio.y + 8, meio.z);
    dreno.add(lbl); mapLabels.push(lbl);
  }
  scene.add(dreno);

  // ===================================== SETAS DE ESCOAMENTO (modo topografia)
  // Mostram para onde a água vai: é o argumento inteiro de por que os sensores
  // seguem a topografia em vez de uma grade uniforme.
  const flowArrows = new THREE.Group();
  flowArrows.visible = false;
  {
    const shape = new THREE.Shape();
    shape.moveTo(0, 1.6); shape.lineTo(-.8, -.2); shape.lineTo(-.28, -.2);
    shape.lineTo(-.28, -1.6); shape.lineTo(.28, -1.6); shape.lineTo(.28, -.2);
    shape.lineTo(.8, -.2); shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI/2);
    const mat = new THREE.MeshBasicMaterial({ color:0x7fd0ff, transparent:true, opacity:.85,
      side:THREE.DoubleSide, depthWrite:false });
    const spots = [];
    for (let x = -126; x <= 126; x += 21)
      for (let z = -120; z <= 120; z += 21) spots.push([x, z]);
    const inst = new THREE.InstancedMesh(geo, mat, spots.length);
    const d = new THREE.Object3D();
    spots.forEach(([x, z], i) => {
      // gradiente numérico do terreno: a seta aponta para a descida real
      const e = .8;
      const gx = (elevationAt(x + e, z) - elevationAt(x - e, z)) / (2*e);
      const gz = (elevationAt(x, z + e) - elevationAt(x, z - e)) / (2*e);
      d.position.set(x, elevationAt(x, z) + .45, z);
      d.rotation.set(0, Math.atan2(-gx, -gz), 0);
      const steep = clamp(Math.hypot(gx, gz) / .2, .45, 1.6);
      d.scale.setScalar(1.7 * steep);
      d.updateMatrix(); inst.setMatrixAt(i, d.matrix);
    });
    inst.computeBoundingSphere();
    flowArrows.add(inst);
  }
  scene.add(flowArrows);

  // ================================================================ CHUVA
  const rainCount = Q.rainDrops;
  const rainGeo = new THREE.BufferGeometry();
  const rainArr = new Float32Array(rainCount * 3);
  for (let i = 0; i < rainCount; i++) {
    rainArr[i*3]   = (Math.random() - .5) * 300;
    rainArr[i*3+1] = Math.random() * 110;
    rainArr[i*3+2] = (Math.random() - .5) * 300;
  }
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainArr, 3));
  const rainMat = new THREE.PointsMaterial({ color:0x9ec8ff, size:.3, transparent:true,
    opacity:0, depthWrite:false });
  const rainSys = new THREE.Points(rainGeo, rainMat);
  rainSys.frustumCulled = false;
  scene.add(rainSys);

  let rainPhase = 0, rainTimer = 0, rainSpeed = 1;
  const rainStatus = document.getElementById('rain-status');
  function startRain() {
    if (rainPhase !== 0) return;
    rainPhase = 1; rainTimer = 0;
    rainStatus.innerText = '🌧️  CHUVA — 38 mm\nA água desce pela encosta e se acumula no sopé.';
    rainStatus.style.opacity = '1';
    SFX.rainStart();
  }
  document.getElementById('btn-rain').addEventListener('click', () => { SFX.resume(); startRain(); });

  // Corta a chuva junto com o plano. O capítulo seguinte é "dias depois": a água
  // da chuva anterior não pode atravessar o corte, e como É um corte seco — a
  // câmera muda de lugar no mesmo quadro — a troca do chão não aparece.
  function pararChuva() {
    rainPhase = 0; rainTimer = 0;
    uRain.value = 0; uDry.value = 0; uPuddle.value = 0;
    rainMat.opacity = 0;
    rainStatus.style.opacity = '0';
    SFX.rainStop();
  }

  // ===================================================================================
  // FAZENDEIRO
  //
  // Os nomes dos ossos vêm SEM o ponto: o GLTFLoader sanitiza "Wrist.R" para "WristR".
  // Procurar pelo nome original não acha nada e o objeto preso à mão simplesmente
  // nunca aparece — por isso a busca aqui é por padrão, não por string exata.
  //
  // As poses foram medidas, não supostas: no clipe Wave a mão ESQUERDA sobe até a
  // altura da cabeça (1,60 m) — pose de quem olha o celular; no clipe Interact a mão
  // DIREITA se estende à frente a 1,30 m — pose de quem despeja um regador.
  // ===================================================================================

  // ===================================================================================
  // PALETA DO PERSONAGEM
  //
  // O modelo vem com jardineira azul-escura e camisa marrom. A identidade do projeto
  // é verde, então as peças são repintadas para bater com a referência de arte.
  //
  // O material "Brown" cobre CAMISA e LUVAS ao mesmo tempo, e na referência elas têm
  // cores diferentes. As duas são ilhas de geometria independentes dentro da mesma
  // malha, então a separação sai por componentes conexas — o mesmo recurso usado
  // para arrancar o vaso do cafeeiro — e cada ilha recebe seu material.
  // ===================================================================================
  const PALETA = {
    macacao:  0x2c8442,   // jardineira e calça
    camisa:   0x6b4226,
    luva:     0x4fb3a8,
    bota:     0xd8c49c,
    solado:   0xb49a72,
    chapeu:   0x8b5e3c,   // chapéu e punhos da manga
    fita:     0x5a3a20,   // faixa do chapéu (era vermelha)
    pele:     0xe3b98d,
  };

  /** Separa as ilhas de geometria de uma malha e devolve os índices agrupados. */
  function ilhasDe(geom) {
    const pos = geom.attributes.position;
    const idx = geom.index.array;
    const soldado = new Map();
    const pai = new Int32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const k = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
      if (!soldado.has(k)) soldado.set(k, i);
      pai[i] = soldado.get(k);
    }
    const acha = a => { while (pai[a] !== a) { pai[a] = pai[pai[a]]; a = pai[a]; } return a; };
    const une = (a, b) => { a = acha(a); b = acha(b); if (a !== b) pai[a] = b; };
    for (let i = 0; i < idx.length; i += 3) { une(idx[i], idx[i+1]); une(idx[i+1], idx[i+2]); }
    const grupos = new Map();
    for (let t = 0; t < idx.length; t += 3) {
      const r = acha(idx[t]);
      if (!grupos.has(r)) grupos.set(r, []);
      grupos.get(r).push(idx[t], idx[t+1], idx[t+2]);
    }
    return [...grupos.values()];
  }

  function pintarFazendeiro(root) {
    const novo = (hex, rough = .82) =>
      new THREE.MeshStandardMaterial({ color:hex, roughness:rough, metalness:0 });

    root.traverse(o => {
      if (!o.isMesh) return;
      const nome = o.material && o.material.name;

      if (nome === 'LightBlue') o.material = novo(PALETA.macacao);
      else if (nome === 'Beige') o.material = novo(PALETA.chapeu);
      else if (nome === 'Red') o.material = novo(PALETA.fita);
      else if (nome === 'Brown2') o.material = novo(PALETA.solado, .9);
      else if (nome === 'Skin') o.material = novo(PALETA.pele, .62);
      else if (nome === 'Brown') {
        if (/Feet/i.test(o.name)) { o.material = novo(PALETA.bota, .78); return; }

        // Camisa + luvas na mesma malha: reordena os triângulos por ilha e cria
        // dois grupos, um material para cada.
        //
        // A classificação é por POSIÇÃO, não por tamanho. Tentar "a maior ilha é
        // o torso" não funciona: a camisa vem picada em várias ilhas (tronco,
        // mangas, gola) e uma manga acaba sendo maior que o resto — foi assim
        // que a camisa inteira saiu com a cor da luva. Na pose de bind os braços
        // estão abertos, então o que separa mão de tronco é o afastamento
        // lateral, medido como fração da meia-largura da própria malha.
        const ilhas = ilhasDe(o.geometry);
        if (ilhas.length < 2) { o.material = novo(PALETA.camisa); return; }
        const pos = o.geometry.attributes.position;
        let maxAbsX = 0;
        for (let i = 0; i < pos.count; i++) maxAbsX = Math.max(maxAbsX, Math.abs(pos.getX(i)));
        const limite = maxAbsX * 0.55;
        const camisa = [], luvas = [];
        ilhas.forEach(ilha => {
          let soma = 0;
          for (const vi of ilha) soma += Math.abs(pos.getX(vi));
          (soma / ilha.length > limite ? luvas : camisa).push(...ilha);
        });
        if (!luvas.length) { o.material = novo(PALETA.camisa); return; }
        const ordenado = new Uint16Array(camisa.length + luvas.length);
        ordenado.set(camisa, 0);
        ordenado.set(luvas, camisa.length);
        o.geometry = o.geometry.clone();
        o.geometry.setIndex(new THREE.BufferAttribute(ordenado, 1));
        o.geometry.clearGroups();
        o.geometry.addGroup(0, camisa.length, 0);
        o.geometry.addGroup(camisa.length, luvas.length, 1);
        o.material = [novo(PALETA.camisa), novo(PALETA.luva, .7)];
      }
    });
  }

  const farmerRoot = new THREE.Group();
  const farmer = models.farmer.scene;
  let mixer = null, currentAction = null;
  const clips = {};
  let phone = null, wateringCan = null, waterDrops = null;
  let wristL = null, wristR = null;

  {
    const box = new THREE.Box3().setFromObject(farmer);
    const fs = 1.78 / (box.max.y - box.min.y);
    farmer.scale.setScalar(fs);
    farmer.position.y = -box.min.y * fs;
    normalize(farmer, .78);
    pintarFazendeiro(farmer);
    farmerRoot.add(farmer);
    farmerRoot.visible = false;
    scene.add(farmerRoot);

    mixer = new THREE.AnimationMixer(farmer);
    models.farmer.animations.forEach(c => { clips[c.name] = c; });

    farmer.traverse(o => {
      if (/^Wrist[._]?L$/.test(o.name)) wristL = o;
      if (/^Wrist[._]?R$/.test(o.name)) wristR = o;
    });
    farmer.updateMatrixWorld(true);

    // O osso NÃO está na escala da cena: o FBX2glTF deixa uma escala de ~97,6
    // carimbada no armature, então um objeto de 7 cm sairia com 7 m. Em vez de
    // chutar o fator, mede-se a escala mundial do osso e divide-se por ela — vale
    // para qualquer rig, venha de que exportador vier.
    // O fator depende das matrizes de mundo estarem atualizadas. Se getWorldScale
    // for chamado antes disso, ele devolve 1 em vez de ~97,6 — e o objeto entra
    // na cena 97 vezes maior, o que aparece como uma placa preta gigante plantada
    // no hectare. A escala do armature deste rig é conhecida e alta, então um
    // valor perto de 1 é sinal de matriz velha, não de rig diferente: força a
    // atualização e mede de novo antes de aceitar.
    const boneK = bone => {
      const v = new THREE.Vector3();
      bone.getWorldScale(v);
      if (v.x < 10) {
        scene.updateMatrixWorld(true);
        bone.updateWorldMatrix(true, false);
        bone.getWorldScale(v);
      }
      if (v.x < 1e-6) {
        console.warn('[TeraHecta] escala do osso inválida; objeto de mão desativado');
        return 0;
      }
      return 1 / v.x;
    };

    if (wristL) {
      const k = boneK(wristL);
      phone = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(.075,.145,.012),
        new THREE.MeshStandardMaterial({ color:0x14181f, roughness:.3, metalness:.4 }));

      // Tela do app: marca TeraBoard e o alerta que acabou de chegar. Desenhada
      // em canvas porque não existe arquivo de logo no projeto — trocar por uma
      // imagem real é substituir este bloco por um TextureLoader.
      const pc = document.createElement('canvas');
      pc.width = 264; pc.height = 504;
      const px = pc.getContext('2d');
      px.fillStyle = '#0b1a12'; px.fillRect(0, 0, 264, 504);

      // barra de status
      px.fillStyle = '#7d9689'; px.font = '500 15px "IBM Plex Mono", monospace';
      px.textAlign = 'left';  px.fillText('09:42', 16, 26);
      px.textAlign = 'right'; px.fillText('4G  ▮▮▮', 248, 26);

      // marca
      px.textAlign = 'center';
      // Ícone: a logo real, extraída do LOGO.ico (o frame de 64x64). Enquanto ela
      // não chega, fica o quadrado da marca — o desenho não espera o arquivo.
      px.fillStyle = '#3ffa8b';
      px.beginPath();
      px.roundRect ? px.roundRect(96, 52, 72, 72, 16) : px.rect(96, 52, 72, 72);
      px.fill();
      const logo = new Image();
      logo.onload = () => {
        px.clearRect(96, 52, 72, 72);
        px.drawImage(logo, 96, 52, 72, 72);
        ptex.needsUpdate = true;
      };
      logo.src = 'assets/img/logo-teraboard.png';
      px.fillStyle = '#f2ecd9';
      px.font = '700 30px "Space Grotesk", sans-serif';
      px.fillText('TeraBoard', 132, 160);
      px.fillStyle = '#7d9689';
      px.font = '500 15px "IBM Plex Mono", monospace';
      px.fillText('MONITORAMENTO DE SOLO', 132, 184);

      // cartão de alerta
      px.fillStyle = '#2a0f0f';
      px.beginPath();
      px.roundRect ? px.roundRect(18, 216, 228, 174, 14) : px.rect(18, 216, 228, 174);
      px.fill();
      px.fillStyle = '#ff5c5c'; px.fillRect(18, 216, 6, 174);
      px.font = '700 34px sans-serif'; px.textAlign = 'left';
      px.fillText('⚠', 40, 262);
      px.fillStyle = '#ffe1e1';
      px.font = '600 19px "IBM Plex Mono", monospace';
      // O sensor do alerta sai do ESTUDO, não de um número escrito aqui: com o
      // relevo mudando as zonas, a tela do celular mostrava A2 enquanto o painel
      // e o visor da caixa acusavam outro sensor.
      px.fillText('ALERTA · ' + DRY_ID, 82, 258);
      px.fillStyle = '#ffb4b4';
      px.font = '500 15px "IBM Plex Mono", monospace';
      px.fillText((sensorById[DRY_ID].blockRef.name + ' · '
                 + sensorById[DRY_ID].zonaNome).toUpperCase(), 82, 282);
      px.fillStyle = '#ffe1e1';
      px.font = '700 46px "IBM Plex Mono", monospace';
      px.fillText('24%', 40, 342);
      px.fillStyle = '#ffb4b4';
      px.font = '500 16px "IBM Plex Mono", monospace';
      px.fillText('UMIDADE — ESTRESSE', 40, 370);

      // rodapé
      px.fillStyle = '#1b3a28';
      px.beginPath();
      px.roundRect ? px.roundRect(18, 408, 228, 46, 12) : px.rect(18, 408, 228, 46);
      px.fill();
      px.fillStyle = '#3ffa8b';
      px.font = '600 16px "IBM Plex Mono", monospace'; px.textAlign = 'center';
      px.fillText('VER NO MAPA', 132, 438);

      const ptex = new THREE.CanvasTexture(pc);
      ptex.colorSpace = THREE.SRGBColorSpace;
      ptex.anisotropy = 4;
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(.066,.126),
        new THREE.MeshBasicMaterial({ map:ptex, toneMapped:false }));
      scr.position.z = .0075;
      // Sub-grupo só para o CONTEÚDO. A orientação vinda da bancada (inclinação
      // 180° + rolagem 30°) compõe uma rotação de 210° no plano da tela: o
      // aparelho fica no lugar certo na mão, mas o texto sai deitado. Isso é
      // invisível na bancada, onde o visor é um retângulo liso. Girar aqui
      // endireita a leitura sem mexer nos ângulos ajustados.
      const inner = new THREE.Group();
      inner.add(body, scr);
      inner.rotation.z = THREE.MathUtils.degToRad(150);   // medido, não deduzido
      phone.add(inner);
      phone.userData.inner = inner;

      // Valores medidos na bancada (Personagem.html).
      phone.scale.setScalar(k * 1.61);
      phone.position.set(.007*k, .162*k, -.028*k);
      // Guardados para o plano em que o aparelho é apresentado à lente: lá ele
      // sai da posição de repouso e precisa saber voltar.
      phone.userData.base = phone.position.clone();
      phone.visible = false;
      wristL.add(phone);   // a rotação é resolvida por frame, em orientProp()
    }

    if (wristR) {
      const k = boneK(wristR);
      // ------------------------------------------------------------------
      // REGADOR — modelo de Isa Lousberg (poly.pizza), no lugar do que era
      // montado com primitivas. O bico aponta para +X local e termina no crivo;
      // a ponta e a direção do jato saem MEDIDAS da malha, logo abaixo, em vez
      // de escritas à mão — assim continuam certas se o modelo for trocado.
      // ------------------------------------------------------------------
      wateringCan = new THREE.Group();
      const canModel = models.can.scene;
      canModel.updateMatrixWorld(true);

      const canBox = new THREE.Box3().setFromObject(canModel);
      const CAN_H = 0.26;                                   // regador de mão
      const canScale = CAN_H / canBox.getSize(new THREE.Vector3()).y;
      canModel.scale.multiplyScalar(canScale);
      canModel.updateMatrixWorld(true);

      // centra o corpo na origem do grupo e apoia a base em y = 0
      const canBox2 = new THREE.Box3().setFromObject(canModel);
      const canCentro = canBox2.getCenter(new THREE.Vector3());
      canModel.position.set(-canCentro.x, -canBox2.min.y, -canCentro.z);
      normalize(canModel, .72);
      wateringCan.add(canModel);
      wateringCan.updateMatrixWorld(true);

      // Ponta do crivo: o vértice de maior X. É o mesmo ponto que o marcador de
      // inspeção acusou, e vale para qualquer pose porque é local ao objeto.
      {
        const ponta = new THREE.Vector3(-1e9, 0, 0);
        const v = new THREE.Vector3();
        canModel.traverse(m => {
          if (!m.isMesh) return;
          const pa = m.geometry.attributes.position;
          for (let i = 0; i < pa.count; i++) {
            v.fromBufferAttribute(pa, i).applyMatrix4(m.matrixWorld);
            if (v.x > ponta.x) ponta.copy(v);
          }
        });
        const tip = new THREE.Object3D();
        wateringCan.worldToLocal(ponta);
        tip.position.copy(ponta);
        wateringCan.add(tip);
        wateringCan.userData.tip = tip;
        wateringCan.userData.spout = new THREE.Vector3(1, 0, 0);   // eixo do bico
      }

      // Posição vinda da bancada; a altura desceu um pouco porque o modelo novo
      // tem o corpo mais baixo e largo que o de primitivas.
      wateringCan.scale.setScalar(k * 1.10);
      wateringCan.position.set(.127*k, .150*k, -.179*k);
      wateringCan.visible = false;
      wristR.add(wateringCan);   // idem: orientado no mundo, não por Euler local

      // jato: gotas recicladas que nascem na ponta do bico
      waterDrops = { group:new THREE.Group(), items:[] };
      const dg = new THREE.SphereGeometry(.035, 6, 6);
      for (let i = 0; i < 14; i++) {
        const m = new THREE.Mesh(dg, new THREE.MeshBasicMaterial({
          color:0x9fd8ff, transparent:true, opacity:.85, depthWrite:false }));
        m.visible = false;
        waterDrops.group.add(m);
        waterDrops.items.push({ mesh:m, phase:i/14 });
      }
      scene.add(waterDrops.group);
    }

    // balão de notificação: o pacote não tem clipe de "olhar o celular", então o
    // balão conta o acontecimento sem depender de uma pose que não existe
    const nc = document.createElement('canvas'); nc.width = 256; nc.height = 160;
    const nx = nc.getContext('2d');
    nx.fillStyle = '#0b1a12'; nx.strokeStyle = '#3ffa8b'; nx.lineWidth = 5;
    nx.beginPath();
    if (nx.roundRect) nx.roundRect(6,6,244,108,20); else nx.rect(6,6,244,108);
    nx.fill(); nx.stroke();
    nx.beginPath(); nx.moveTo(112,112); nx.lineTo(128,150); nx.lineTo(150,112); nx.closePath();
    nx.fillStyle = '#0b1a12'; nx.fill(); nx.strokeStyle = '#3ffa8b'; nx.stroke();
    nx.fillStyle = '#ff5c5c'; nx.font = '700 42px sans-serif';
    nx.textAlign = 'center'; nx.textBaseline = 'middle';
    nx.fillText('⚠', 50, 58);
    nx.fillStyle = '#f2ecd9'; nx.font = '600 25px "IBM Plex Mono", monospace';
    nx.fillText('ALERTA', 152, 42);
    nx.fillStyle = '#a9c2b3'; nx.font = '500 20px "IBM Plex Mono", monospace';
    nx.fillText('NO CELULAR', 152, 78);
    const nt = new THREE.CanvasTexture(nc); nt.colorSpace = THREE.SRGBColorSpace;
    var notify = new THREE.Sprite(new THREE.SpriteMaterial({
      map:nt, transparent:true, depthTest:true, depthWrite:false }));
    notify.scale.set(1.15,.72,1); notify.position.y = 2.45;
    notify.visible = false; notify.renderOrder = 22;
    farmerRoot.add(notify);
  }

  /**
   * `hold` congela o clipe numa fração dele (0..1) em vez de deixar rodando.
   *
   * Serve para o gesto de regar: `Interact` é um movimento de alcançar em loop,
   * e repetido sem parar dá a impressão de que ele fica pegando e soltando o
   * regador. Parado no ponto de extensão máxima, a pose é a de quem está
   * despejando — e a água continua correndo, porque o jato é animado à parte.
   */
  // ---------------------------------------------------------------------------
  // PASSEIO NA SEDE
  //
  // Para cada direção em volta do centro do terreiro, procura o maior raio que
  // ainda cabe entre os obstáculos, com folga de ombro. Os raios viram um anel
  // suavizado — um caminho fechado que contorna o que existe, em vez de uma
  // volta desenhada no olho que atravessa a estufa quando a fazenda mudar.
  // ---------------------------------------------------------------------------
  const passeioSede = (() => {
    const FOLGA = .48;   // meio ombro do personagem; o gramado da sede é estreito
    // A cerca tem ~17,3 m de lado. Sem este confinamento a varredura enxerga o
    // pasto livre do lado de fora, o centroide é puxado para lá e o passeio
    // acaba dando a volta POR FORA da propriedade — que é o oposto do pedido.
    const DENTRO = 7.4;
    const livre = (x, z) => {
      if (Math.abs(x - SEDE.x) > DENTRO || Math.abs(z - SEDE.z) > DENTRO) return false;
      for (const o of obstaculosSede) {
        if (x > o.x0 - FOLGA && x < o.x1 + FOLGA &&
            z > o.z0 - FOLGA && z < o.z1 + FOLGA) return false;
      }
      return true;
    };
    // 72 amostras, não 28: a corda entre dois ângulos vizinhos a 6 m de raio cai
    // para ~0,5 m, curta o bastante para o caminho não "pular" por cima de um
    // obstáculo estreito entre uma amostra e a seguinte.
    // ---------------------------------------------------------------------
    // O caminho é BUSCADO numa grade, não encaixado numa forma.
    //
    // Tentei anel radial e retângulo pelo perímetro; os dois colapsaram, porque
    // o gramado livre da sede não é disco nem moldura — é um punhado de faixas
    // entre casa, estufa, canteiros e barris. Qualquer figura paramétrica ou não
    // cabe ou atravessa alguma coisa.
    //
    // Aqui a sede vira uma grade de 25 cm, marcada livre/ocupada. Uma busca em
    // largura a partir do ponto mais central acha a célula livre mais DISTANTE
    // dele, e o caminho de volta é o trajeto — que por construção só pisa em
    // célula livre. Ele percorre esse trajeto de ida e volta.
    // ---------------------------------------------------------------------
    const PASSO = .25;
    const N = Math.round(DENTRO * 2 / PASSO);
    const cel = (i, j) => [SEDE.x - DENTRO + i * PASSO, SEDE.z - DENTRO + j * PASSO];
    const ok = new Uint8Array(N * N);
    let qtdLivre = 0;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const [x, z] = cel(i, j);
        if (livre(x, z)) { ok[j * N + i] = 1; qtdLivre++; }
      }
    }

    // semente: a célula livre mais próxima do centro do terreno
    let si = -1, sj = -1, melhorD = Infinity;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      if (!ok[j * N + i]) continue;
      const [x, z] = cel(i, j);
      const d = (x - SEDE.x) ** 2 + (z - SEDE.z) ** 2;
      if (d < melhorD) { melhorD = d; si = i; sj = j; }
    }

    const pts = [];
    if (si >= 0) {
      const anterior = new Int32Array(N * N).fill(-1);
      const visto = new Uint8Array(N * N);
      const fila = [sj * N + si];
      visto[sj * N + si] = 1;
      let ultimo = sj * N + si;
      for (let head = 0; head < fila.length; head++) {
        const cur = fila[head];
        ultimo = cur;                       // o último a sair é o mais distante
        const ci = cur % N, cj = (cur / N) | 0;
        for (const [di, dj] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const ni = ci + di, nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
          const k = nj * N + ni;
          if (visto[k] || !ok[k]) continue;
          visto[k] = 1; anterior[k] = cur; fila.push(k);
        }
      }
      // reconstrói o trajeto do mais distante até a semente
      const rota = [];
      for (let k = ultimo; k !== -1; k = anterior[k]) {
        const [x, z] = cel(k % N, (k / N) | 0);
        rota.push([x, z]);
      }
      // rala os pontos, para a curva ficar suave em vez de escada de grade
      for (let i = 0; i < rota.length; i += 3) {
        const [x, z] = rota[i];
        pts.push(V3(x, elevationAt(x, z), z));
      }
      // ida e volta: fecha o ciclo pelo mesmo trajeto
      for (let i = pts.length - 2; i > 0; i--) pts.push(pts[i].clone());
    }
    if (pts.length < 4) {
      // rede de segurança: um quadrado pequeno no centro, para nunca quebrar
      for (const [dx, dz] of [[-2,-2],[2,-2],[2,2],[-2,2]]) {
        pts.push(V3(SEDE.x + dx, elevationAt(SEDE.x + dx, SEDE.z + dz), SEDE.z + dz));
      }
    }
    const curva = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', .18);

    console.log(`[TeraHecta] passeio da sede: ${obstaculosSede.length} obstáculos · `
      + `${qtdLivre} células livres de ${N*N} · ${pts.length} pontos · `
      + `percurso de ${curva.getLength().toFixed(1)} m`);
    return curva;
  })();

  function playClip(name, { fade = .3, timeScale = 1, hold = null } = {}) {
    const clip = clips[name];
    if (!clip || !mixer) return;
    const a = mixer.clipAction(clip);
    a.reset(); a.setLoop(THREE.LoopRepeat, Infinity);
    a.timeScale = timeScale; a.enabled = true;

    if (hold !== null) {
      // Sem crossfade: a mistura com a ação anterior sobrescreveria a pose
      // congelada durante o tempo da transição.
      if (currentAction && currentAction !== a) currentAction.stop();
      a.play();
      a.time = clamp(hold, 0, 1) * clip.duration;
      mixer.update(0);          // aplica a pose ao esqueleto neste quadro
      a.paused = true;
    } else {
      a.paused = false;
      if (currentAction && currentAction !== a) currentAction.crossFadeTo(a.play(), fade, false);
      else a.play();
    }
    currentAction = a;
  }

  function placeOn(curve, u, faceTarget = null) {
    const p = curve.getPointAt(clamp(u, 0, 1));
    farmerRoot.position.set(p.x, elevationAt(p.x, p.z), p.z);
    if (faceTarget) {
      farmerRoot.rotation.y = Math.atan2(faceTarget.x - p.x, faceTarget.z - p.z);
    } else {
      const a = curve.getPointAt(clamp(u + .004, 0, 1));
      const d = a.clone().sub(p); d.y = 0;
      if (d.lengthSq() > 1e-6) farmerRoot.rotation.y = Math.atan2(d.x, d.z);
    }
    return p;
  }

  // ===================================================================================
  // CÂMERA — órbita livre para o usuário, e câmera com posição/alvo próprios para o
  // filme. Um sistema que só orbita um alvo não consegue fazer travelling lateral nem
  // plano fixo: dá sempre a mesma "câmera colada nas costas".
  // ===================================================================================
  let theta = Math.PI*.68, phi = IS_MOBILE ? Math.PI*.27 : Math.PI*.34;
  let radius = IS_MOBILE ? 330 : 275;
  const target = V3(0, 2, -6);
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
  let storyActive = false, autoRotate = true;

  function orbitVectors(p, l) {
    p.set(target.x + radius*Math.sin(phi)*Math.sin(theta),
          target.y + radius*Math.cos(phi),
          target.z + radius*Math.sin(phi)*Math.cos(theta));
    l.copy(target);
  }
  const applyCam = () => { camera.position.copy(camPos); camera.lookAt(camLook); };
  const updateOrbit = () => { orbitVectors(camPos, camLook); applyCam(); };
  updateOrbit();

  const dom = renderer.domElement;
  let down = false, lx = 0, ly = 0;
  dom.addEventListener('pointerdown', e => {
    if (storyActive) return;
    down = true; autoRotate = false; lx = e.clientX; ly = e.clientY;
    dom.setPointerCapture(e.pointerId);
  });
  window.addEventListener('pointerup', () => { down = false; });
  window.addEventListener('pointermove', e => {
    if (!down || storyActive) return;
    theta -= (e.clientX - lx) * .005;
    phi = clamp(phi - (e.clientY - ly) * .005, .08, Math.PI/2 - .02);
    lx = e.clientX; ly = e.clientY;
    updateOrbit();
  });
  dom.addEventListener('wheel', e => {
    e.preventDefault();
    if (storyActive) return;
    radius = clamp(radius + e.deltaY * .16, 26, 560);
    updateOrbit();
  }, { passive:false });
  let pinch = 0;
  dom.addEventListener('touchstart', e => {
    if (e.touches.length === 2)
      pinch = Math.hypot(e.touches[0].clientX - e.touches[1].clientX,
                         e.touches[0].clientY - e.touches[1].clientY);
  }, { passive:true });
  dom.addEventListener('touchmove', e => {
    if (e.touches.length === 2 && !storyActive) {
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX,
                           e.touches[0].clientY - e.touches[1].clientY);
      radius = clamp(radius * (pinch / d), 26, 560); pinch = d; updateOrbit();
    }
  }, { passive:true });

  // ===================================================================================
  // PERCORRER O CAMPO
  //
  // Girar e aproximar mostram a propriedade de fora, como quem roda uma maquete na
  // mão. Faltava ANDAR nela: descer entre duas fileiras, seguir o corredor, chegar
  // na estação do hectare vizinho. É o que estas duas entradas fazem — teclado no
  // computador, manche na tela do celular.
  //
  // Quem anda é o ALVO da órbita, não a câmera: a lente continua obedecendo ao
  // arrasto e ao zoom, e o passo funciona igual num sobrevoo alto ou rente ao chão.
  // A altura do alvo acompanha o relevo, então descer a encosta é descer mesmo.
  // ===================================================================================
  const anda = { f:0, s:0 };
  const teclas = new Set();
  const TECLA = {
    ArrowUp:'f+', KeyW:'f+', ArrowDown:'f-', KeyS:'f-',
    ArrowLeft:'s-', KeyA:'s-', ArrowRight:'s+', KeyD:'s+',
  };
  const lerTeclado = () => {
    let f = 0, s = 0;
    teclas.forEach(k => {
      const a = TECLA[k]; if (!a) return;
      if (a === 'f+') f += 1; else if (a === 'f-') f -= 1;
      else if (a === 's+') s += 1; else if (a === 's-') s -= 1;
    });
    anda.f = clamp(f, -1, 1); anda.s = clamp(s, -1, 1);
  };
  window.addEventListener('keydown', e => {
    if (!TECLA[e.code]) return;
    e.preventDefault();          // seta rola a página por padrão; aqui ela anda
    teclas.add(e.code); lerTeclado();
  });
  window.addEventListener('keyup', e => { teclas.delete(e.code); lerTeclado(); });
  window.addEventListener('blur', () => { teclas.clear(); anda.f = anda.s = 0; });

  // ---- manche de toque: mesma saída do teclado, vinda do polegar
  {
    const pad = document.getElementById('nav-pad');
    const knob = document.getElementById('nav-knob');
    if (IS_MOBILE || matchMedia('(hover:none)').matches) document.body.classList.add('touchnav');
    let padId = null;
    const RAIO = 46;
    const solta = () => {
      padId = null; anda.f = anda.s = 0;
      pad.classList.remove('act'); knob.style.transform = '';
    };
    pad.addEventListener('pointerdown', e => {
      padId = e.pointerId; pad.setPointerCapture(e.pointerId);
      pad.classList.add('act'); e.stopPropagation();
    });
    pad.addEventListener('pointermove', e => {
      if (padId !== e.pointerId) return;
      const r = pad.getBoundingClientRect();
      let dx = e.clientX - (r.left + r.width/2), dy = e.clientY - (r.top + r.height/2);
      const d = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, d / RAIO) / d;
      dx *= k * RAIO; dy *= k * RAIO;
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      anda.s = clamp(dx / RAIO, -1, 1);
      anda.f = clamp(-dy / RAIO, -1, 1);
      e.stopPropagation();
    });
    pad.addEventListener('pointerup', solta);
    pad.addEventListener('pointercancel', solta);
  }

  const LIMITE = WORLD - 6;
  function andarNoCampo(dt) {
    if (storyActive || (!anda.f && !anda.s)) return false;
    // Frente = para onde a lente aponta, achatado no chão. Assim "para cima"
    // é sempre "para lá", qualquer que seja o ângulo em que a cena foi girada.
    const fx = target.x - camPos.x, fz = target.z - camPos.z;
    const fl = Math.hypot(fx, fz) || 1;
    const dirX = fx / fl, dirZ = fz / fl;
    // Uma velocidade só, de quem atravessa a lavoura com pressa. A escala de
    // "andar" foi testada e é lenta demais para 4 hectares: o visitante desiste
    // antes de chegar ao hectare vizinho.
    //
    // Num sobrevoo alto o passo cresce junto com a altura — a mesma tecla que
    // atravessa um corredor de 3 m atravessaria a propriedade em meia hora.
    const escala = clamp(radius / 60, 1, 6);
    const v = 17 * escala * dt;
    target.x = clamp(target.x + (dirX * anda.f - dirZ * anda.s) * v, -LIMITE, LIMITE);
    target.z = clamp(target.z + (dirZ * anda.f + dirX * anda.s) * v, -LIMITE, LIMITE);
    target.y = elevationAt(target.x, target.z) + 2;
    autoRotate = false;
    updateOrbit();
    return true;
  }

  // ===================================================================================
  // FICHA DO OBJETO — o visitante clica, a peça se apresenta
  //
  // Regra da casa: cada ficha diz O QUE a peça faz e por que ela está ali. Nada
  // de como ela faz — nem protocolo, nem eletrônica, nem programa. Isso é do
  // produto, não da maquete.
  //
  // A ficha se fecha sozinha: quem está passeando pela lavoura não quer voltar
  // para fechar cartão nenhum.
  // ===================================================================================
  /* A página do TeraSmart está no ar. O caminho sobe uma pasta porque a maquete
     mora em /terahecta/, e o <a id="info-link"> já nasce com target="_blank" —
     o que também resolve o fato de a maquete rodar dentro de um iframe: sem
     isso o site inteiro abriria dentro da moldura da maquete. */
  const TERASMART_URL = '../terasmart.html';

  const FICHAS = {
    estacao: { tipo:'Equipamento de campo', nome:'Estação de Transmissão',
      texto:'Fica no <b>ponto mais alto da área</b> e recolhe, sozinha e o dia inteiro, o que os '
          + '6 sensores dela estão medindo. Cada sensor responde por uma zona, e juntos eles '
          + 'cobrem o hectare inteiro.' },
    solar: { tipo:'Energia da estação', nome:'Painel solar',
      texto:'Mantém a estação trabalhando o ano inteiro, sem depender de energia elétrica '
          + 'no meio da lavoura.' },
    antena: { tipo:'Saída dos dados', nome:'Antena da estação',
      texto:'Trabalha bem acima do cafezal, que é de onde o sinal sai limpo. É por ela que as '
          + 'leituras saem do campo e chegam à Caixa Principal, mesmo a quilômetros de '
          + 'distância e sem sinal de celular na lavoura.' },
    caixa: { tipo:'Central da propriedade', nome:'Caixa Principal',
      texto:'Onde as quatro áreas se encontram. Reúne o que as quatro estações mandam e '
          + 'entrega no aplicativo, pronto para ler.' },
    meteo: { tipo:'Clima da propriedade', nome:'Estação Meteorológica',
      texto:'Acompanha chuva, vento, temperatura e umidade do ar — e <b>antecipa</b>. É o que '
          + 'evita mandar molhar um solo que vai encharcar sozinho em seis horas.' },
    sede: { tipo:'A propriedade', nome:'Sede da fazenda',
      texto:'Casa, estufa e canteiros. É daqui que o produtor acompanha os quatro hectares '
          + 'pelo celular, sem percorrer a lavoura para descobrir onde está o problema.' },
    terasmart: { tipo:'Outra solução TeraBoard', nome:'TeraSmart',
      texto:'O irmão mais velho do TeraHecta, instalado nesta mesma fazenda: automação para '
          + 'quem cultiva em área concentrada. <b>Quer conhecer?</b> A página dele abre '
          + 'numa aba nova.',
      botao:'Ver a página do TeraSmart →' },
    cafe: { tipo:'A lavoura', nome:'Cafeeiro',
      texto:'Café adulto conduzido em <b>curvas de nível</b>: as fileiras acompanham a altura '
          + 'do terreno em vez de seguir a linha reta. É o desenho que segura a água na '
          + 'encosta em vez de deixá-la descer levando a terra junto.' },
    agua: { tipo:'Onde a água se junta', nome:'Área de acúmulo',
      texto:'O ponto mais baixo da propriedade: o que chove nas quatro áreas termina aqui. '
          + 'Hoje o sistema <b>mostra</b> o problema. A <b>drenagem</b> é a Fase 3 do TeraHecta '
          + 'e ainda está em desenvolvimento.' },
  };

  const cardEl = document.getElementById('info-card');
  const cardKind = document.getElementById('info-kind');
  const cardName = document.getElementById('info-name');
  const cardDesc = document.getElementById('info-desc');
  const cardRead = document.getElementById('info-read');
  const cardLink = document.getElementById('info-link');
  let cardTimer = null, cardSensor = null;

  function fecharFicha() {
    cardEl.classList.remove('on');
    cardSensor = null;
    if (cardTimer) { clearTimeout(cardTimer); cardTimer = null; }
  }
  document.getElementById('info-close').addEventListener('click', fecharFicha);

  /** Preenche a grade de leituras com o estado atual do sensor. */
  function pintarLeituras(s) {
    const campos = [['moisture','UMIDADE', v => v.toFixed(1) + '%'],
                    ['temp','TEMP', v => v.toFixed(1) + '°C'],
                    ['ec','EC', v => v.toFixed(0) + ' µS'],
                    ['ph','pH', v => v.toFixed(2)],
                    ['sal','SALIN.', v => v.toFixed(2) + ' ppt'],
                    ['tds','TDS', v => v.toFixed(0) + ' ppm']];
    cardRead.innerHTML = campos.map(([k, rot, fmt]) => {
      const nivel = evalParam(k, s[k]).level;
      return `<div class="rd ${nivel === 'ok' ? '' : nivel}"><i>${rot}</i><b>${fmt(s[k])}</b></div>`;
    }).join('');
  }

  function abrirFicha(tipo, extra) {
    if (cardTimer) clearTimeout(cardTimer);
    cardSensor = null;
    cardLink.style.display = 'none';
    cardRead.innerHTML = '';
    let segundos = 9;

    if (tipo === 'sensor') {
      const s = extra;
      cardSensor = s;
      cardKind.textContent = `Sensor de solo · ${s.zonaNome} · ${s.posicao}`;
      cardName.textContent = `${s.id} · ${s.blockRef.name}`;
      // A posição na encosta faz parte da identidade da zona: dois hectares podem
      // ter grota no terço alto e grota no terço médio, e não é a mesma coisa —
      // uma começa a juntar água, a outra já a está levando embora.
      cardDesc.innerHTML = `Fala pela <b>${s.zonaNome.toLowerCase()}</b> do <b>${s.posicao}</b> `
                         + `deste hectare (${s.zonaSobre}), que ocupa `
                         + `<b>${(s.areaHa*100).toFixed(0)}%</b> da área. `
                         + 'O que ela mostra agora:';
      pintarLeituras(s);
      segundos = 16;
    } else {
      const f = FICHAS[tipo];
      if (!f) return;
      cardKind.textContent = extra && extra.name ? f.tipo + ' · ' + extra.name : f.tipo;
      cardName.textContent = f.nome;
      cardDesc.innerHTML = f.texto;
      if (f.botao) {
        cardLink.textContent = f.botao;
        cardLink.style.display = 'inline-block';
        if (TERASMART_URL) { cardLink.href = TERASMART_URL; cardLink.style.pointerEvents = ''; }
        else { cardLink.removeAttribute('href'); cardLink.style.pointerEvents = 'none'; }
        segundos = 13;
      }
    }
    cardEl.classList.add('on');
    cardTimer = setTimeout(fecharFicha, segundos * 1000);
  }

  // ---- quem foi clicado
  const raycaster = new THREE.Raycaster();
  const ponteiro = new THREE.Vector2();

  /** Sobe pela árvore até achar a peça registrada. */
  function fichaDe(obj) {
    for (let o = obj; o; o = o.parent) if (o.userData.ficha) return o.userData.ficha;
    return null;
  }
  /**
   * O modelo da sede traz o gabinete TeraSmart dentro; ele fala por si.
   *
   * A subida pela árvore para no nó "FarmScene…": esse é o RAIZ do modelo da
   * fazenda e o nome dele também casa com o padrão — sem essa parada, a casa, a
   * estufa e até a cerca respondiam como se fossem o equipamento.
   */
  function ehTeraSmart(obj) {
    for (let o = obj; o; o = o.parent) {
      const nome = o.name || '';
      if (/^farmscene/i.test(nome)) break;
      if (/tera(smart|sensor)/i.test(nome)) return true;
    }
    return false;
  }

  function clicarCena(cx, cy) {
    if (storyActive) return;
    const r = dom.getBoundingClientRect();
    ponteiro.set((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ponteiro, camera);
    const hits = raycaster.intersectObjects(clicaveis, true);
    if (!hits.length) { fecharFicha(); return; }
    const h = hits[0];
    const f = fichaDe(h.object);
    if (!f) { fecharFicha(); return; }
    if (f.tipo === 'sensor') abrirFicha('sensor', sensors[h.instanceId]);
    else if (f.tipo === 'sede') abrirFicha(ehTeraSmart(h.object) ? 'terasmart' : 'sede');
    else abrirFicha(f.tipo, f.extra);
  }

  // Clique é toque curto e parado. Sem isso, soltar o arrasto que girou a cena
  // abriria a ficha do que estivesse debaixo do dedo no fim do movimento.
  let cliqueX = 0, cliqueY = 0, cliqueT = 0;
  dom.addEventListener('pointerdown', e => { cliqueX = e.clientX; cliqueY = e.clientY; cliqueT = performance.now(); });
  dom.addEventListener('pointerup', e => {
    if (performance.now() - cliqueT > 450) return;
    if (Math.hypot(e.clientX - cliqueX, e.clientY - cliqueY) > 6) return;
    clicarCena(e.clientX, e.clientY);
  });
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    drawProfile();
  });

  // ===================================================================================
  // SIMULAÇÃO DOS SENSORES
  // ===================================================================================
  const zoneBase = {
    alta:  { moisture:[44,52], temp:[24.5,26.8], ec:[178,232], ph:[5.42,5.86], sal:[.25,.52], tds:[110,160] },
    media: { moisture:[50,60], temp:[23.0,25.2], ec:[212,296], ph:[5.30,5.74], sal:[.42,.70], tds:[142,200] },
    baixa: { moisture:[58,70], temp:[21.5,23.8], ec:[255,372], ph:[5.30,5.64], sal:[.55,.85], tds:[172,262] },
  };
  const rnd = r => r[0] + Math.random() * (r[1] - r[0]);
  sensors.forEach(s => { const b = zoneBase[s.zone]; PARAMS.forEach(([k]) => { s[k] = rnd(b[k]); }); });

  // ---- tabela por hectare
  let activeBlock = FOCUS;
  const tabsEl = document.getElementById('area-tabs');
  const tbody = document.getElementById('sensor-table-body');
  let cells = {};

  function buildTable() {
    tbody.innerHTML = '';
    cells = {};
    sensors.filter(s => s.block === activeBlock).forEach(s => {
      const tr = document.createElement('tr');
      tr.className = 'tr-' + s.zone;
      tr.innerHTML = `<td>${s.id}</td>` + ['umi','temp','ec','ph','sal','tds']
        .map(k => `<td id="td-${k}-${s.id}"></td>`).join('');
      tbody.appendChild(tr);
    });
    sensors.filter(s => s.block === activeBlock).forEach(s => {
      cells[s.id] = {
        umi:  document.getElementById(`td-umi-${s.id}`),
        temp: document.getElementById(`td-temp-${s.id}`),
        ec:   document.getElementById(`td-ec-${s.id}`),
        ph:   document.getElementById(`td-ph-${s.id}`),
        sal:  document.getElementById(`td-sal-${s.id}`),
        tds:  document.getElementById(`td-tds-${s.id}`),
      };
    });
  }
  BLOCKS.forEach(b => {
    const t = document.createElement('div');
    t.className = 'tab' + (b.id === activeBlock ? ' on' : '');
    t.textContent = b.id;
    t.title = b.name;
    t.addEventListener('click', () => {
      activeBlock = b.id;
      [...tabsEl.children].forEach(c => c.classList.toggle('on', c.textContent === b.id));
      buildTable();
    });
    tabsEl.appendChild(t);
  });
  buildTable();

  function forceDry(id) {
    const s = sensorById[id]; if (!s) return;
    s.moisture = 24; s.ec = 118; s.temp = 30.5;
  }
  function forceWet(id) {
    const s = sensorById[id]; if (!s) return;
    s.moisture = 91; s.sal = 2.45; s.ec = 690; s.tds = 565;
  }
  function healSensor(id) {
    const s = sensorById[id]; if (!s) return;
    const b = zoneBase[s.zone];
    PARAMS.forEach(([k]) => { s[k] = (b[k][0] + b[k][1]) / 2; alertHold.delete(id + '|' + k); });
  }
  function clampPhysical(s) {
    s.moisture = clamp(s.moisture, 5, 98); s.temp = clamp(s.temp, 10, 38);
    s.ec = clamp(s.ec, 40, 900); s.ph = clamp(s.ph, 3.8, 8.0);
    s.sal = clamp(s.sal, .05, 3.5); s.tds = clamp(s.tds, 30, 700);
  }

  // ===================================================================================
  // ESTAÇÃO METEOROLÓGICA — dados e previsão
  // ===================================================================================
  const weather = { temp:26.4, hum:58, wind:7.2, windDir:.6, rainAcc:0, forecast:'Céu limpo · sem chuva prevista' };
  const mtTemp = document.getElementById('mt-temp'), mtHum = document.getElementById('mt-hum');
  const mtWind = document.getElementById('mt-wind'), mtRain = document.getElementById('mt-rain');
  const mtFc = document.getElementById('meteo-fc');
  function renderWeather() {
    mtTemp.textContent = weather.temp.toFixed(1) + ' °C';
    mtHum.textContent  = weather.hum.toFixed(0) + ' %';
    mtWind.textContent = weather.wind.toFixed(1) + ' km/h';
    mtRain.textContent = weather.rainAcc.toFixed(1) + ' mm';
    mtFc.innerHTML = 'Previsão: ' + weather.forecast;
  }
  renderWeather();

  // ===================================================================================
  // MODO TOPOGRAFIA — rampa hipsométrica na cena + perfil em corte no HUD
  //
  // Três cores chapadas dizem pouco: a água não respeita fronteira desenhada a régua.
  // O que se usa em cartografia de verdade é rampa contínua de cota mais curvas de
  // nível, e é isso aqui — com o corte transversal ao lado, que é onde a inclinação
  // aparece como inclinação em vez de como mancha vista de cima.
  // ===================================================================================
  let topoOn = false, topoBlend = 0;
  let drenoForcado = false;
  const profileHud = document.getElementById('profile-hud');
  const profCvs = document.getElementById('profile-cvs');
  const pctx = profCvs.getContext('2d');

  function hypsoCss(t) {
    const stops = [[0,[8,51,117]],[.25,[13,115,148]],[.45,[33,140,51]],
                   [.65,[199,179,26]],[.85,[204,92,20]],[1,[242,230,219]]];
    for (let i = 0; i < stops.length - 1; i++) {
      const [a, ca] = stops[i], [b, cb] = stops[i+1];
      if (t <= b) {
        const f = (t - a) / (b - a);
        return `rgb(${ca.map((v,j)=>Math.round(v+(cb[j]-v)*f)).join(',')})`;
      }
    }
    return 'rgb(242,230,219)';
  }

  function drawProfile() {
    const W = profCvs.width, H = profCvs.height;
    pctx.clearRect(0, 0, W, H);
    const padL = 62, padR = 18, padT = 26, padB = 40;
    const gw = W - padL - padR, gh = H - padT - padB;

    // amostra o terreno no eixo das áreas A/C (x fixo), de norte a sul
    const X = blockA.cx;
    const z0 = -140, z1 = 140, N = 300;
    const ys = [];
    for (let i = 0; i <= N; i++) ys.push(elevationAt(X, z0 + (z1 - z0) * i / N));
    const yMin = Math.min(...ys) - 2, yMax = Math.max(...ys) + 4;
    const sx = i => padL + gw * i / N;
    const sy = y => padT + gh * (1 - (y - yMin) / (yMax - yMin));

    // grade de cotas
    pctx.font = '500 15px "IBM Plex Mono", monospace';
    pctx.textAlign = 'right'; pctx.textBaseline = 'middle';
    const step = 5;
    for (let y = Math.ceil(yMin/step)*step; y <= yMax; y += step) {
      pctx.strokeStyle = 'rgba(255,255,255,.10)'; pctx.lineWidth = 1;
      pctx.beginPath(); pctx.moveTo(padL, sy(y)); pctx.lineTo(W - padR, sy(y)); pctx.stroke();
      pctx.fillStyle = 'rgba(201,220,207,.75)';
      pctx.fillText(y.toFixed(0) + ' m', padL - 8, sy(y));
    }

    // corpo do terreno, pintado com a MESMA rampa hipsométrica da cena
    for (let i = 0; i < N; i++) {
      const t0 = clamp((ys[i] + 20) / 40, 0, 1);
      pctx.fillStyle = hypsoCss(t0);
      pctx.beginPath();
      pctx.moveTo(sx(i), sy(ys[i])); pctx.lineTo(sx(i+1), sy(ys[i+1]));
      pctx.lineTo(sx(i+1), padT + gh); pctx.lineTo(sx(i), padT + gh);
      pctx.closePath(); pctx.fill();
    }
    pctx.strokeStyle = 'rgba(255,255,255,.75)'; pctx.lineWidth = 2;
    pctx.beginPath();
    ys.forEach((y, i) => i ? pctx.lineTo(sx(i), sy(y)) : pctx.moveTo(sx(i), sy(y)));
    pctx.stroke();

    // faixas das áreas
    pctx.font = '600 15px "IBM Plex Mono", monospace';
    pctx.textAlign = 'center'; pctx.textBaseline = 'top';
    [[blockA, 'ÁREA A'], [BLOCKS.find(b => b.id === 'C'), 'ÁREA C']].forEach(([b, nm]) => {
      const i0 = (b.cz - HA - z0) / (z1 - z0) * N, i1 = (b.cz + HA - z0) / (z1 - z0) * N;
      pctx.fillStyle = 'rgba(63,250,139,.10)';
      pctx.fillRect(sx(i0), padT, sx(i1) - sx(i0), gh);
      pctx.strokeStyle = 'rgba(63,250,139,.45)'; pctx.lineWidth = 1.5;
      pctx.strokeRect(sx(i0), padT, sx(i1) - sx(i0), gh);
      pctx.fillStyle = 'rgba(63,250,139,.95)';
      pctx.fillText(nm + ' · 1 ha', (sx(i0) + sx(i1)) / 2, padT + 4);
    });

    // sensores do corte, na cota real
    sensors.filter(s => Math.abs(s.x - X) < 34).forEach(s => {
      const i = (s.z - z0) / (z1 - z0) * N;
      if (i < 0 || i > N) return;
      const y = elevationAt(X, z0 + (z1 - z0) * i / N);
      const col = '#' + zoneColors[s.zone].toString(16).padStart(6, '0');
      pctx.strokeStyle = col; pctx.lineWidth = 2;
      pctx.beginPath(); pctx.moveTo(sx(i), sy(y)); pctx.lineTo(sx(i), sy(y) - 22); pctx.stroke();
      pctx.fillStyle = col;
      pctx.beginPath(); pctx.arc(sx(i), sy(y) - 26, 5, 0, Math.PI*2); pctx.fill();
    });

    // área de acúmulo
    {
      const i0 = (POND.z - POND.rz - z0) / (z1 - z0) * N;
      const i1 = (POND.z + POND.rz - z0) / (z1 - z0) * N;
      pctx.fillStyle = 'rgba(90,169,230,.34)';
      pctx.fillRect(sx(i0), padT, sx(i1) - sx(i0), gh);
      pctx.fillStyle = '#9fd8ff'; pctx.font = '600 14px "IBM Plex Mono", monospace';
      pctx.textAlign = 'center'; pctx.textBaseline = 'bottom';
      pctx.fillText('ACÚMULO', (sx(i0) + sx(i1)) / 2, padT + gh - 8);
    }

    // seta do sentido do escoamento
    pctx.strokeStyle = '#7fd0ff'; pctx.fillStyle = '#7fd0ff'; pctx.lineWidth = 2.5;
    const ay = padT + 16;
    pctx.beginPath(); pctx.moveTo(padL + 30, ay); pctx.lineTo(padL + gw*.42, ay); pctx.stroke();
    pctx.beginPath();
    pctx.moveTo(padL + gw*.42 + 14, ay); pctx.lineTo(padL + gw*.42, ay - 6);
    pctx.lineTo(padL + gw*.42, ay + 6); pctx.closePath(); pctx.fill();
    pctx.font = '500 14px "IBM Plex Mono", monospace'; pctx.textAlign = 'left';
    pctx.textBaseline = 'middle';
    pctx.fillText('sentido do escoamento da água', padL + gw*.42 + 22, ay);

    // eixos
    pctx.fillStyle = 'rgba(201,220,207,.8)'; pctx.font = '500 14px "IBM Plex Mono", monospace';
    pctx.textAlign = 'left'; pctx.textBaseline = 'top';
    pctx.fillText('NORTE — cota alta (casa, Caixa Principal)', padL, padT + gh + 10);
    pctx.textAlign = 'right';
    pctx.fillText('SUL — sopé', W - padR, padT + gh + 10);
  }
  drawProfile();

  function setTopo(on) {
    topoOn = on;
    document.body.classList.toggle('topo', on);
    document.getElementById('btn-topo').classList.toggle('on', on);
    profileHud.classList.toggle('on', on);
    flowArrows.visible = on;
  }
  document.getElementById('btn-topo').addEventListener('click', () => setTopo(!topoOn));

  // ===================================================================================
  // MODO FILME
  //
  // Feito para quem nunca ouviu falar de EC nem de condutividade: cada capítulo responde UMA
  // pergunta, na ordem em que um leigo a faria. Cada plano declara COMO a câmera se
  // comporta, não só para onde vai:
  //   orbit  — interpola theta/phi/raio/alvo (planos abertos, visão do sistema)
  //   dolly  — posição e alvo explícitos, A → B (aproximações e travellings)
  //
  // Não existe mais plano de caminhada: o assunto do filme é como o TeraHecta
  // funciona, não como alguém atravessa a lavoura. O produtor aparece só onde ele
  // É a informação — dando escala ao equipamento e mostrando a ação corretiva.
  //
  // QUANDO cada plano entra não se escolhe mais aqui: cada um declara em que
  // frase da narração (`fala`, o número do arquivo em assets/audio/) ele começa, e a
  // duração é o que sobra até o plano seguinte. Foi o que acertou a montagem com
  // a gravação — o roteiro estimava 4:08 de locução e a voz levou 3:14,7.
  // ===================================================================================
  let stageIndex = -1, storyFrom = null;
  const captionEl = document.getElementById('story-caption');
  const chapterEl = document.getElementById('story-chapter');
  const storyBtn = document.getElementById('btn-story');
  const progressEl = document.getElementById('story-progress');

  const ease = t => (t < .5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2);
  function angleDelta(a, b) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI*2;
    while (d < -Math.PI) d += Math.PI*2;
    return d;
  }

  const dryP = walkDry.getPointAt(1);

  /**
   * Ponto de câmera medido A PARTIR DO CHÃO daquele lugar, não da cota do sensor.
   *
   * Num terreno de rampa dava na mesma. Com esporão e grota não dá: uma câmera a
   * "4,4 m acima do sensor", sete metros encosta acima, pode estar a meio metro
   * do chão — e a auditoria pegou exatamente isso, com a lente a 75 cm de um pé
   * de café.
   */
  const acimaDoChao = (x, z, h) => V3(x, elevationAt(x, z) + h, z);
  const EA = ESTACAO[FOCUS];          // a estação do hectare da história
  const BFOCO = BLOCKS.find(b => b.id === FOCUS);   // e o hectare inteiro, para os planos de cima

  // Alvo e posição de câmera calculados na hora do plano, a partir de onde o
  // celular REALMENTE está no mundo depois da pose congelada. Mirar num ponto
  // fixo estimado deixava o aparelho pequeno e fora do centro — e qualquer
  // ajuste de pose na bancada desalinharia o enquadramento de novo.
  const phoneLook = new THREE.Vector3();
  const phoneCamFar = new THREE.Vector3();
  const phoneCamNear = new THREE.Vector3();
  const wetP = walkWet.getPointAt(1);
  // Câmera medida ao longo do CORREDOR, em metros antes do sensor. Andar em X,
  // como era antes, sai da curva assim que o corredor contorna um esporão.
  const dryAlley = (recuo, h, lado = 0) => pontoCorredor(walkDry, recuo, h, lado);
  const wetAlley = (recuo, h, lado = 0) => pontoCorredor(walkWet, recuo, h, lado);

  let producerState = 'idle';
  // Ligado só no plano em que a tela é o assunto: fora dele o aparelho volta a
  // ser segurado como se segura um celular, virado para o próprio dono.
  let phoneAim = false;
  function setState(s) {
    producerState = s;
    if (s !== 'notify') phoneAim = false;
    if (s === 'water') SFX.waterStart(); else SFX.waterStop();
    if (phone) phone.visible = (s === 'notify');
    if (wateringCan) wateringCan.visible = (s === 'water');
    // O balão sobre a cabeça só entra se a câmera estiver longe demais para ler
    // a tela. De perto os dois juntos dizem a mesma coisa duas vezes.
    notify.visible = false;
  }

  const stages = [
    // ================================================== CAP. 1 — A PROPRIEDADE
    { chapter:'1 · A propriedade', type:'orbit', fala:1,
      end:{ theta:Math.PI*.74, phi:Math.PI*.30, radius:300, target:V3(0,2,-6) },
      onStart:() => { setTopo(false); } },

    { chapter:'1 · A propriedade', type:'orbit', fala:3,
      end:{ theta:Math.PI*1.16, phi:Math.PI*.21, radius:215, target:V3(0,0,-10) } },

    // ============================================ CAP. 2 — POR QUE A TOPOGRAFIA
    // Entra no meio da fala 4, em "Comece pelo terreno": é a deixa da virada para
    // o mapa de altitude, e esperar a frase acabar deixaria a ordem no vazio.
    { chapter:'2 · Por que a topografia manda', type:'orbit', fala:4, apos:2.8, panels:['profile'],
      end:{ theta:Math.PI*1.5, phi:Math.PI*.16, radius:250, target:V3(0,0,6) },
      onStart:() => { setTopo(true); } },

    { chapter:'2 · Por que a topografia manda', type:'orbit', fala:7, panels:['profile'],
      end:{ theta:Math.PI*1.86, phi:Math.PI*.30, radius:210, target:V3(-20,0,30) } },

    // "No ponto mais baixo, a água empoça" — e o ponto mais baixo que interessa ao
    // produtor não é só o sopé da propriedade: é a depressão DENTRO do talhão, a
    // metros de pé de café. O plano abre na bacia de um hectare de baixo, com a
    // área de acúmulo do sopé já no quadro, e desce acompanhando a água até ela —
    // onde entra o dreno da Fase 3. As duas escalas do mesmo problema, num
    // movimento só, na ordem em que a narração as cita.
    { chapter:'2 · Por que a topografia manda', type:'dolly', fala:11, panels:['profile'],
      from:{ pos:V3(BACIA_BAIXA.x - 46, BACIA_BAIXA.y + 54, BACIA_BAIXA.z + 78),
             look:V3(BACIA_BAIXA.x + 14, BACIA_BAIXA.y - 4, BACIA_BAIXA.z + 30) },
      to:{ pos:V3(POND.x - 30, elevationAt(POND.x, POND.z) + 30, POND.z + 54),
           look:V3(POND.x, elevationAt(POND.x, POND.z), POND.z) },
      onStart:() => { drenoForcado = true; dreno.visible = true; },
      onEnd:() => { drenoForcado = false; } },

    // ================================================== CAP. 3 — OS SENSORES
    { chapter:'3 · Onde ficam os sensores', type:'orbit', fala:14,
      end:{ theta:Math.PI*.62, phi:Math.PI*.26, radius:150, target:V3(EA.x,0,EA.z) },
      onStart:() => { setTopo(false); } },

    { chapter:'3 · Onde ficam os sensores', type:'dolly', fala:17, panels:['data'],
      from:{ pos:V3(sensorById['A5'].x - 9, sensorById['A5'].y + 5.5, sensorById['A5'].z + 7),
             look:V3(sensorById['A5'].x, sensorById['A5'].y + 1, sensorById['A5'].z) },
      to:{ pos:V3(sensorById['A5'].x - 1.9, sensorById['A5'].y + 1.35, sensorById['A5'].z + 1.6),
           look:V3(sensorById['A5'].x, sensorById['A5'].y + 1.05, sensorById['A5'].z) } },

    // ============================================ CAP. 4 — DO SOLO À ESTAÇÃO
    { chapter:'4 · Do solo até a estação', type:'dolly', fala:19,
      from:{ pos:acimaDoChao(EA.x + 17, EA.z + 19, 12.0), look:V3(EA.x, EA.y + 3.2, EA.z) },
      to:{ pos:acimaDoChao(EA.x + 8.6, EA.z + 10.0, 4.6), look:V3(EA.x, EA.y + 3.9, EA.z) } },

    { chapter:'4 · Do solo até a estação', type:'dolly', fala:22,
      from:{ pos:acimaDoChao(EA.x + 8.6, EA.z + 10.0, 4.6), look:V3(EA.x, EA.y + 3.9, EA.z) },
      to:{ pos:acimaDoChao(EA.x + 3.0, EA.z + 6.8, 2.6), look:V3(EA.x - 1.4, EA.y + 1.2, EA.z - .3) } },

    // ==================================== CAP. 5 — A MALHA ENTRE AS ESTAÇÕES
    { chapter:'5 · Como o dado sai do campo', type:'dolly', fala:24,
      from:{ pos:acimaDoChao(EA.x + 3.0, EA.z + 6.8, 2.6), look:V3(EA.x + 1.15, EA.y + 6.8, EA.z + .2) },
      to:{ pos:V3(EA.x + 34, EA.y + 30, EA.z + 38), look:V3(EA.x + 18, EA.y + 13, EA.z + 9) } },

    // Dois planos viraram um. Eram quatro no capítulo, todos em plano aberto e
    // dizendo coisas próximas — é o trecho do filme em que a atenção cai, e o
    // assunto (o dado saindo do campo) é o menos visível de todos.
    { chapter:'5 · Como o dado sai do campo', type:'orbit', fala:26,
      end:{ theta:Math.PI*.80, phi:Math.PI*.36, radius:270, target:V3(0,30,-62) } },

    { chapter:'5 · Como o dado sai do campo', type:'dolly', fala:29,
      from:{ pos:V3(MAINBOX.x + 26, MAINBOX.y + 20, MAINBOX.z + 30), look:mainBoxTop.clone() },
      to:{ pos:V3(MAINBOX.x + 7.5, MAINBOX.y + 3.4, MAINBOX.z + 9),
           look:V3(MAINBOX.x, MAINBOX.y + 1.9, MAINBOX.z) } },

    // ============================================ CAP. 6 — A METEOROLÓGICA
    { chapter:'6 · A estação meteorológica', type:'dolly', fala:31, panels:['meteo'],
      from:{ pos:V3(METEO.x - 12, METEO.y + 9, METEO.z + 13), look:V3(METEO.x, METEO.y + 3.4, METEO.z) },
      to:{ pos:V3(METEO.x - 3.6, METEO.y + 4.6, METEO.z + 4.6), look:V3(METEO.x, METEO.y + 4.0, METEO.z) },
      onStart:() => {
        weather.forecast = '<b>Chuva forte em ~6 h</b> · 35–45 mm previstos';
        renderWeather(); SFX.beep();
      } },

    // ============================================ CAP. 7 — EM OPERAÇÃO
    //
    // Com as cores da topografia ligadas, e não no solo real. A fala é "cada zona
    // reage de um jeito diferente" — e no solo real essa frase não tem imagem:
    // chove igual em cima de tudo e o chão inteiro escurece igual. No mapa de
    // altitude, com as poças enchendo onde o terreno as junta, a frase É a imagem.
    //
    // O plano entra largo, nos quatro hectares, e desce para a área A: de longe as
    // manchas de um hectare são pontinhos; é de perto que se lê que a água parou
    // na bacia fechada e na grota, e não na lavoura toda. Terminar sobre a área A
    // ainda entrega a câmera onde o capítulo 8 começa.
    // Quase a prumo, e não rasante: poça se lê de cima. Na oblíqua o próprio
    // cafezal tapa o chão entre as fileiras, que é justamente onde a água fica.
    { chapter:'7 · O sistema em operação', type:'orbit', fala:35, panels:['data'],
      begin:{ theta:Math.PI*.30, phi:Math.PI*.19, radius:330, target:V3(0, 2, -6) },
      end:{ theta:Math.PI*.30, phi:Math.PI*.21, radius:175, target:V3(BFOCO.cx, 2, BFOCO.cz) },
      // Mesmo azimute nos dois: o plano é uma descida, não um giro. Começa nos
      // quatro hectares — cada um junta água no seu canto, e são quatro cantos
      // diferentes — e desce na área A, que é onde dá para ler que a água parou na
      // depressão e não na lavoura inteira. Termina onde o capítulo 8 começa.
      //
      // Chuva a 2,2× e não a 4×: no ritmo antigo o ciclo inteiro cabia no meio do
      // plano e zerava tudo antes do corte, com a poça sumindo na cara de quem
      // está olhando. Assim ela enche por volta dos 3,4 s e fica até o corte.
      onStart:() => { setTopo(true); rainSpeed = 2.2; startRain(); },
      onEnd:() => { setTopo(false); rainSpeed = 1; pararChuva(); } },

    // ================================= CAP. 8 e 9 — DOIS ALERTAS OPOSTOS
    { chapter:'8 · Alerta na parte que seca', type:'dolly', fala:37, panels:['alert'],
      from:{ pos:acimaDoChao(dry.x - 20, dry.z + 20, 22), look:V3(dry.x, dry.y + 1, dry.z) },
      to:{ pos:acimaDoChao(dry.x - 8, dry.z + 8, 5.2), look:V3(dry.x, dry.y + 1.1, dry.z) },
      onStart:() => {
        forceDry(DRY_ID);
        weather.forecast = 'Sem chuva nos próximos 5 dias · déficit hídrico';
        renderWeather(); SFX.notification();
        if (lcdDraw) lcdDraw('> ALERTA', '  ' + DRY_ID + ' UMIDADE 24%', '  ENVIADO AO APP');
      } },

    { chapter:'8 · Alerta na parte que seca', type:'dolly', fala:40,
      from:{ pos:phoneCamFar, look:phoneLook },
      to:{ pos:phoneCamNear, look:phoneLook },
      onStart:() => {
        farmerRoot.visible = true;
        // ------------------------------------------------------------------
        // Aqui o assunto é a TELA, então duas coisas têm que ser verdade ao
        // mesmo tempo: a câmera de frente para o produtor, e o aparelho virado
        // para a câmera.
        //
        // A montagem anterior fazia o contrário do pretendido. O celular é
        // orientado com a tela voltada para o rosto de quem segura, e a câmera
        // era deduzida DESSE eixo — ou seja, ia parar atrás do produtor, com o
        // corpo dele entre a lente e o aparelho. O que aparecia no plano eram
        // as pernas dele e um celular de canto.
        //
        // Agora a ordem é outra: ele se vira para o corredor, a câmera se planta
        // à frente dele, e é o APARELHO que passa a mirar a lente (ver phoneAim
        // no loop). A tela fica legível de qualquer rumo em que ele esteja.
        // ------------------------------------------------------------------
        placeOn(walkDry, 1, dryAlley(9, 0, -.35));
        playClip('Wave', { hold: .51 });   // pose de quem levanta o aparelho e lê
        setState('notify');

        // A pose já está aplicada ao esqueleto (playClip com hold chama
        // mixer.update(0)), então a posição do aparelho já é a definitiva.
        farmerRoot.updateMatrixWorld(true);
        phone.getWorldPosition(phoneLook);

        // Frente do produtor, no plano do chão: é para lá que ele olha depois do
        // placeOn, e é onde a lente cabe sem o corpo dele na frente.
        const frente = V3(Math.sin(farmerRoot.rotation.y), 0, Math.cos(farmerRoot.rotation.y));
        phoneCamFar.copy(phoneLook).addScaledVector(frente, 4.2).add(V3(0, .30, 0));
        phoneCamNear.copy(phoneLook).addScaledVector(frente, 1.15).add(V3(0, .02, 0));
        phoneAim = true;
      },
      onEnd:() => { phoneAim = false; } },

    { chapter:'8 · Alerta na parte que seca', type:'dolly', fala:42,
      // Câmera ao longo do corredor, não de frente para ele: virado para a lente,
      // o braço estendido fica escorçado e o gesto de regar some. De perfil, lê.
      // Deslocada para o lado OPOSTO do corredor ao do sensor: passando rente a
      // ele, a cabeça do sensor (0,3 m) ocupava um terço da altura do quadro.
      from:{ pos:dryAlley(8.0, 2.5, -.95), look:dryP.clone().setY(dryP.y + 1.15) },
      to:{ pos:dryAlley(4.2, 1.55, -.9),  look:dryP.clone().setY(dryP.y + .95) },
      onStart:() => {
        farmerRoot.visible = true;
        // Virado para a FILEIRA, não para o sensor: quem rega, rega a planta. De
        // quebra, isso o põe de perfil para a câmera que corre pelo corredor, e
        // o braço estendido aparece inteiro em vez de apontado para a lente.
        placeOn(walkDry, 1, dryAlley(0, 0, 2.0));
        // Extensão máxima do braço direito (medida: punho a 1,32 m de altura,
        // 0,46 m à frente) — a pose de quem está despejando.
        playClip('Interact', { hold: .5 });
        setState('water');
      } },

    { chapter:'8 · Alerta na parte que seca', type:'dolly', fala:45, panels:['alert'],
      from:{ pos:dryAlley(4.2, 1.9, .8), look:dryP.clone().setY(dryP.y + 1.0) },
      to:{ pos:dryAlley(9.5, 3.6, -.7), look:dryP.clone().setY(dryP.y + 1.0) },
      onStart:() => { healSensor(DRY_ID); SFX.chime(); setState('idle'); playClip('Idle'); } },

    { chapter:'9 · Alerta na parte que encharca', type:'dolly', fala:47, panels:['alert'],
      from:{ pos:acimaDoChao(wet.x - 22, wet.z + 22, 24), look:V3(wet.x, wet.y + 1, wet.z) },
      to:{ pos:acimaDoChao(wet.x - 8.5, wet.z + 8.5, 5.4), look:V3(wet.x, wet.y + 1.1, wet.z) },
      onStart:() => {
        forceWet(WET_ID);
        // A bacia continua com água — é o que a fala diz, e é o que o terreno faz:
        // a depressão fechada é a última coisa do hectare a secar.
        uPocaFoco.value.set(wet.x, wet.z, 34);
        farmerRoot.visible = false;
        if (lcdDraw) lcdDraw('> ALERTA', '  ' + WET_ID + ' SALINIDADE', '  2.45 ppt');
      } },

    { chapter:'9 · Alerta na parte que encharca', type:'dolly', fala:51, panels:['alert'],
      from:{ pos:wetAlley(6.5, 2.6, .8), look:wetP.clone().setY(wetP.y + 1.1) },
      to:{ pos:wetAlley(10.5, 4.2, -.8), look:wetP.clone().setY(wetP.y + 1.0) },
      onStart:() => {
        farmerRoot.visible = true;
        placeOn(walkWet, 1, V3(wet.x, 0, wet.z));
        playClip('Interact', { timeScale:.7 });
        setState('inspect');
      },
      onEnd:() => { uPocaFoco.value.set(0, 0, 0); } },

    // ============================================ CAP. 10 — FECHO
    { chapter:'10 · O sistema completo', type:'orbit', fala:56,
      end:{ theta:Math.PI*.42, phi:Math.PI*.20, radius:300, target:V3(0,4,-20) },
      onStart:() => {
        farmerRoot.visible = false; setState('idle');
        healSensor(WET_ID);
        weather.forecast = 'Céu limpo · sem chuva prevista';
        renderWeather();
        if (lcdDraw) lcdDraw('TERAHECTA','4 ESTAÇÕES ONLINE','SINCRONIZADO');
      } },

    // O último não tem onEnd para encerrar: quem encerra é o relógio, quando a
    // narração acaba e o respiro final termina.
    { chapter:'10 · O sistema completo', type:'orbit', fala:60,
      end:{ theta:Math.PI*.76, phi:Math.PI*.28, radius:330, target:V3(0,2,-6) } },
  ];

  if (IS_MOBILE) {
    stages.forEach(st => {
      if (st.type === 'orbit') { st.end.radius *= 1.34; if (st.begin) st.begin.radius *= 1.34; }
      if (st.type === 'dolly') {
        const back = (p, l) => p.add(p.clone().sub(l).multiplyScalar(.20));
        back(st.from.pos, st.from.look); back(st.to.pos, st.to.look);
      }
    });
  }

  // -------------------------------------------------------------------------
  // A MONTAGEM SAI DA GRAVAÇÃO
  //
  // `t` — segundo do filme em que o plano entra. Por padrão o corte cai no
  // silêncio ANTES da frase que o plano ilustra: a locução tem de 0,42 s a 0,64 s
  // de respiro entre frases, e 0,22 s antes da primeira sílaba está sempre dentro
  // desse respiro (a metade da folga, quando a folga for menor, garante o resto).
  // `apos` põe o corte DENTRO da frase, para o plano que ilustra a segunda metade dela.
  //
  // `dur` — o que sobra até o próximo plano. Continua em milissegundos porque é
  // por ele que a auditoria externa mede o filme.
  // -------------------------------------------------------------------------
  stages.forEach((st, i) => {
    const f = st.fala - 1;
    const folga = NARRACAO.inicio(f) - NARRACAO.fim(f - 1);
    st.t = i === 0 ? 0                       // o primeiro plano abre o filme, antes de qualquer voz
         : st.apos != null ? NARRACAO.inicio(f) + st.apos
         : NARRACAO.inicio(f) - Math.min(.22, folga * .5);
  });
  stages.forEach((st, i) => {
    st.dur = Math.round(((i + 1 < stages.length ? stages[i + 1].t : NARRACAO.total) - st.t) * 1000);
  });

  // ---------------------------------------------------------------------------
  // PAINÉIS DURANTE O FILME
  //
  // Nenhum na tela por padrão: eles são ferramenta de quem explora, e durante a
  // narração tapavam justamente o plano que a câmera montou. Cada estágio declara
  // em `panels` quais fazem parte do que está sendo contado NAQUELE momento — a
  // tabela de leituras quando o assunto é o sensor, a meteorológica quando o
  // assunto é a previsão, os alertas quando um dispara. Fora disso, tela limpa.
  // ---------------------------------------------------------------------------
  const PAINEIS = {
    alert:  document.getElementById('alert-hud'),
    data:   document.getElementById('data-hud'),
    meteo:  document.getElementById('meteo-hud'),
    legend: document.getElementById('legend-hud'),
    // O perfil entra na mesma regra. Fora do filme ele acompanha o modo
    // topografia, e está certo — é a legenda daquele modo. Dentro do filme,
    // "topografia ligada" e "o perfil é o assunto" deixaram de ser a mesma coisa
    // no capítulo 7: lá as cores servem para as poças aparecerem, e um corte
    // norte→sul da propriedade inteira só disputa espaço com elas.
    profile: profileHud,
  };
  function mostrarPaineis(lista) {
    Object.entries(PAINEIS).forEach(([k, el]) => {
      const on = !!lista && lista.includes(k);
      el.classList.toggle('cine', on);
      // recolhido não adianta: o cartão precisa mostrar o conteúdo
      if (el.tagName === 'DETAILS') el.open = on;
    });
  }

  function beginStage(i) {
    stageIndex = i;
    const st = stages[i];
    storyFrom = { theta, phi, radius, target:target.clone(), pos:camPos.clone(), look:camLook.clone() };
    // Plano de órbita que declara DE ONDE parte, em vez de herdar a órbita que
    // sobrou do plano anterior. Depois de um travelling, theta/phi/raio ficam
    // parados no último plano orbital — o enquadramento de abertura passa a
    // depender de um plano que está três capítulos atrás, e muda sozinho quando
    // aquele muda.
    if (st.begin) Object.assign(storyFrom, st.begin, { target:st.begin.target.clone() });
    if (st.chapter) { chapterEl.innerText = st.chapter; chapterEl.style.opacity = '1'; }
    mostrarPaineis(st.panels);
    if (st.onStart) st.onStart();
  }

  // ---------------------------------------------------------------------------
  // RELÓGIO DO FILME
  //
  // Com narração tocando, quem marca a hora é o relógio do ÁUDIO. É ele que
  // decide quando cada palavra sai da caixa de som; amarrar a câmera nele é o
  // que impede imagem e voz de escorregarem uma da outra ao longo de três
  // minutos — e faz a montagem se reencontrar sozinha se o navegador engasgar ou
  // se a aba for para segundo plano, porque a posição é lida do tempo absoluto,
  // não somada quadro a quadro.
  //
  // O relógio da página é a rede de segurança: vale quando não há narração e
  // vale se o AudioContext travar (uma aba sem saída de som pode não avançar
  // relógio nenhum — sem isso o filme congelaria de vez).
  // ---------------------------------------------------------------------------
  let filmePerf0 = 0, ultimoAudio = -1, audioParado = 0;
  function relogioDoFilme() {
    const a = NARRACAO.relogio();
    if (a != null) {
      if (a > ultimoAudio) { ultimoAudio = a; audioParado = 0; return Math.max(0, a); }
      if (++audioParado < 90) return Math.max(0, ultimoAudio);   // ~1,5 s de tolerância
      NARRACAO.parar();
      filmePerf0 = performance.now() - Math.max(0, ultimoAudio) * 1000;
    }
    return (performance.now() - filmePerf0) / 1000;
  }

  // ---------------------------------------------------------------------------
  // LEGENDA
  //
  // Uma por trecho de voz, não por plano: o plano dura três ou quatro frases, e
  // a legenda do plano inteiro entregaria de saída o que ainda vai ser dito.
  // Trecho sem texto próprio continua o cartão aberto pelo anterior — são as
  // frases que o estúdio quebrou em dois arquivos e que na tela são uma só.
  // ---------------------------------------------------------------------------
  let falaAtual = -1;
  function atualizarLegenda(t) {
    while (falaAtual + 1 < NARRACAO.n && t >= NARRACAO.inicio(falaAtual + 1)) {
      falaAtual++;
      const txt = NARRACAO.legendas[falaAtual];
      if (txt) { captionEl.innerHTML = txt; captionEl.style.opacity = '1'; }
    }
    // Depois da última palavra a legenda sai, e o fecho fica só imagem.
    if (t > NARRACAO.fimDaFala + .4) captionEl.style.opacity = '0';
  }

  function endStory() {
    // O plano em que o filme parou pode ter deixado coisa ligada (o dreno forçado,
    // a chuva acelerada, o celular mirando a lente). Parar no meio tem de desfazer
    // o que aquele plano fez, senão a cena livre herda o estado do filme.
    const st = stages[stageIndex];
    if (st && st.onEnd) st.onEnd();
    NARRACAO.parar();
    SFX.duck(false);
    uPocaFoco.value.set(0, 0, 0);
    storyActive = false; stageIndex = -1;
    captionEl.style.opacity = '0'; chapterEl.style.opacity = '0';
    progressEl.style.opacity = '0';
    mostrarPaineis(null);      // fora do filme quem manda no painel é o visitante
    autoRotate = true;
    setState('idle');
    rainSpeed = 1;
    storyBtn.innerText = '▶ Modo filme';
    storyBtn.classList.remove('playing');
    document.body.classList.remove('playing');
  }

  function updateStory() {
    if (!storyActive || stageIndex < 0) return;
    const agora = relogioDoFilme();
    atualizarLegenda(agora);

    // Enquanto houver plano vencido, avança. É um `while` e não um `if` porque a
    // posição vem do tempo absoluto: se a aba ficou em segundo plano e voltou
    // três planos depois, todos eles ainda precisam rodar o seu onStart/onEnd na
    // ordem — é o que liga a chuva, dispara o alerta, cura o sensor.
    while (stageIndex + 1 < stages.length && agora >= stages[stageIndex + 1].t) {
      const ant = stages[stageIndex];
      if (ant.onEnd) ant.onEnd();
      beginStage(stageIndex + 1);
    }

    const st = stages[stageIndex];
    const t = Math.max(0, Math.min(1, (agora - st.t) / (st.dur / 1000)));
    const e = ease(t);

    if (st.type === 'orbit') {
      theta = storyFrom.theta + angleDelta(storyFrom.theta, st.end.theta) * e;
      phi = storyFrom.phi + (st.end.phi - storyFrom.phi) * e;
      radius = storyFrom.radius + (st.end.radius - storyFrom.radius) * e;
      target.copy(storyFrom.target).lerp(st.end.target, e);
      orbitVectors(camPos, camLook);

    } else if (st.type === 'dolly') {
      // no começo do plano vem de onde a câmera estava, para o corte não dar solavanco
      const b = Math.min(1, t * 6);
      camPos.copy(storyFrom.pos).lerp(st.from.pos, b).lerp(st.to.pos, e);
      camLook.copy(storyFrom.look).lerp(st.from.look, b).lerp(st.to.look, e);

    }
    applyCam();

    progressEl.style.width = Math.min(100, agora / NARRACAO.total * 100) + '%';
    if (agora >= NARRACAO.total) endStory();
  }

  // Põe o filme para rodar a partir de `desde` (segundos). Tudo o que marca a
  // hora — voz, legenda, plano, barra de progresso — é zerado no mesmo ponto.
  function rodarFilme(desde) {
    fecharFicha();
    storyActive = true; autoRotate = false;
    progressEl.style.opacity = '1'; progressEl.style.width = '0%';
    storyBtn.innerText = '⏹ Parar';
    storyBtn.classList.add('playing');
    document.body.classList.add('playing');
    falaAtual = -1; ultimoAudio = -1; audioParado = 0;
    filmePerf0 = performance.now() - desde * 1000;
    NARRACAO.tocar(desde);
    SFX.duck(true);
    if (desde === 0) {
      theta = Math.PI*.34; phi = IS_MOBILE ? Math.PI*.15 : Math.PI*.18;
      radius = IS_MOBILE ? 470 : 400; target.set(0, 2, -6);
      orbitVectors(camPos, camLook); applyCam();
    }
    let i = 0;
    while (i + 1 < stages.length && desde >= stages[i + 1].t) i++;
    stageIndex = -1;
    beginStage(i);
  }

  storyBtn.addEventListener('click', async () => {
    SFX.resume();
    if (storyActive) { endStory(); return; }
    // A narração é o relógio do filme: são 27 MB, e numa primeira visita podem
    // não ter chegado ainda. O botão espera por ela em vez de rodar mudo — mas
    // se o download falhou de vez, o filme roda assim mesmo, no relógio da página.
    if (!NARRACAO.carregada()) {
      const rotulo = storyBtn.innerText;
      storyBtn.disabled = true;
      const conta = setInterval(() => {
        storyBtn.innerText = '⏳ ' + Math.round(NARRACAO.progresso() * 100) + '%';
      }, 250);
      await NARRACAO.pronta();
      clearInterval(conta);
      storyBtn.disabled = false;
      storyBtn.innerText = rotulo;
      if (storyActive) return;        // o visitante desistiu e clicou de novo no meio da espera
    }
    rodarFilme(0);
  });

  // ===================================================================================
  // PAINEL DE ALERTAS — atualização diferencial (recriar os cards fazia tudo piscar)
  // ===================================================================================
  const alertListEl = document.getElementById('alert-list');
  const alertSummaryEl = document.getElementById('alert-summary');
  const alertNodes = new Map();
  let moreNode = null;

  function renderAlerts(top, total) {
    const seen = new Set();
    top.forEach(a => {
      const key = a.id + '|' + a.label;
      seen.add(key);
      const text = `<b>${a.id}</b> · ${a.label} — ${a.msg}`;
      const cls = 'alert-card' + (a.level === 'warn' ? ' warn' : '');
      let n = alertNodes.get(key);
      if (!n) {
        n = document.createElement('div');
        n.className = cls; n.innerHTML = text;
        alertListEl.appendChild(n); alertNodes.set(key, n);
      } else {
        if (n.className !== cls) n.className = cls;
        if (n.innerHTML !== text) n.innerHTML = text;
      }
    });
    for (const [k, n] of alertNodes.entries())
      if (!seen.has(k)) { n.remove(); alertNodes.delete(k); }
    const extra = total - top.length;
    if (extra > 0) {
      const text = `+ ${extra} outro(s) alerta(s)`;
      if (!moreNode) {
        moreNode = document.createElement('div');
        moreNode.className = 'alert-card warn'; moreNode.innerText = text;
        alertListEl.appendChild(moreNode);
      } else if (moreNode.innerText !== text) moreNode.innerText = text;
    } else if (moreNode) { moreNode.remove(); moreNode = null; }
  }

  // ===================================================================================
  // LOOP
  // ===================================================================================
  const clock = new THREE.Clock();
  let lastData = 0, lcdT = 0, lcdI = 0;
  let passeioU = 0;
  const LCD = [
    ['TERAHECTA','4 ESTAÇÕES ONLINE','SINCRONIZADO'],
    ['> RECEBENDO','  4 EST · 24 SENSORES','  SINAL ESTAVEL'],
    ['> AGREGANDO','  4 ha MONITORADOS','  ENVIO OK'],
  ];

  /* ------------------------------------------------------------------------
     PAUSA QUANDO A MAQUETE SAI DE VISTA

     Esta cena quase sempre roda dentro de um iframe, no meio de terahecta.html.
     Rolada para fora da tela ela continuava desenhando a 60 quadros por
     segundo — a lavoura inteira, com sombras — enquanto o visitante lia o
     texto abaixo. O requestAnimationFrame só desacelera sozinho quando a ABA
     inteira fica oculta; iframe fora do campo de visão, para ele, é conteúdo
     visível.

     Quem avisa é a página de fora, por postMessage (ver js/pages/terahecta.js).
     Um IntersectionObserver aqui dentro não serviria: o observador enxerga o
     viewport DO IFRAME, e dentro dele o canvas está sempre à mostra.

     Sem aviso nenhum — maquete aberta direto em /terahecta/, ou página antiga
     em cache — o valor inicial `true` mantém o comportamento de antes. E o
     filme nunca é interrompido: quem o iniciou pediu para vê-lo, e a narração
     continuaria correndo no relógio do áudio de qualquer forma. */
  let cenaVisivel = true;
  let estavaPausada = false;

  window.addEventListener('message', e => {
    if (e.origin !== location.origin) return;
    if (!e.data || e.data.tb !== 'maquete-visivel') return;
    cenaVisivel = !!e.data.visivel;
  });

  function animate() {
    requestAnimationFrame(animate);

    if (!cenaVisivel && !storyActive) { estavaPausada = true; return; }

    /* Primeiro quadro depois da pausa: o relógio ficou parado junto com a
       cena, e `getDelta()` devolveria agora todo o tempo em que ninguém
       estava olhando. Ele é consumido e descartado, e `elapsedTime` volta ao
       valor de antes — senão o vento e a água, que são função do tempo,
       dariam um salto visível no reencontro. */
    if (estavaPausada) {
      estavaPausada = false;
      const guardado = clock.elapsedTime;
      clock.getDelta();
      clock.elapsedTime = guardado;
      return;
    }

    const dt = Math.min(clock.getDelta(), .05);
    const time = clock.elapsedTime;

    try { updateStory(); }
    catch (err) { console.error('modo filme falhou:', err); endStory(); }

    const andou = andarNoCampo(dt);
    if (!storyActive && autoRotate && !andou) { theta += .00045; updateOrbit(); }

    // transição suave entre solo real e mapa hipsométrico
    topoBlend += ((topoOn ? 1 : 0) - topoBlend) * Math.min(1, dt * 3.2);
    uTopo.value = topoBlend;
    flowArrows.visible = topoBlend > .02;
    // O dreno acompanha a topografia; o plano da drenagem no filme liga à parte.
    if (!drenoForcado) dreno.visible = topoBlend > .02;
    flowArrows.children[0].material.opacity = .85 * topoBlend;

    // Fora do modo filme ele fica circulando na própria sede — a cena livre
    // deixa de ser um cenário vazio e ganha alguém morando nela.
    if (!storyActive) {
      if (!farmerRoot.visible) {
        farmerRoot.visible = true;
        setState('idle');
        playClip('Walk');
      }
      passeioU = (passeioU + dt * .0075) % 1;
      const pp = passeioSede.getPointAt(passeioU);
      const pa = passeioSede.getPointAt((passeioU + .012) % 1);
      farmerRoot.position.set(pp.x, elevationAt(pp.x, pp.z), pp.z);
      farmerRoot.rotation.y = Math.atan2(pa.x - pp.x, pa.z - pp.z);
    }

    if (mixer) mixer.update(dt);

    // ------------------------------------------------------------------
    // Objetos de mão orientados no MUNDO, não por ângulo local fixo.
    //
    // Os eixos do osso do punho estão bem girados (o Y local do WristR aponta
    // para [0.02, 0.45, 0.89] no meio do clipe Interact), e ainda mudam a cada
    // quadro da animação. Qualquer Euler fixo escrito à mão dá certo em UM
    // quadro e sai torto em todos os outros — foi assim que o regador acabou
    // deitado com o bico para cima. Aqui o alvo é declarado no mundo e a rotação
    // local sai por inversa do quaternion do osso, então vale em qualquer pose,
    // qualquer clipe e qualquer direção que o personagem esteja olhando.
    // ------------------------------------------------------------------
    if (wristL || wristR) {
      const qb = new THREE.Quaternion(), qt = new THREE.Quaternion();
      const orientProp = (prop, bone, pitchDeg, yawOffsetDeg, rollDeg = 0) => {
        if (!prop || !bone || !prop.visible) return;
        bone.getWorldQuaternion(qb);
        // O giro é somado ao rumo do personagem, então o ângulo continua valendo
        // com ele virado para qualquer lado do hectare.
        qt.setFromEuler(new THREE.Euler(
          THREE.MathUtils.degToRad(pitchDeg),
          farmerRoot.rotation.y + THREE.MathUtils.degToRad(yawOffsetDeg),
          THREE.MathUtils.degToRad(rollDeg), 'YXZ'));
        prop.quaternion.copy(qb).invert().multiply(qt);
      };
      // regador: corpo inclinado 62° à frente — nessa inclinação o bico, que sai
      // a 57,6° do eixo do corpo, aponta para baixo e para a frente
      // Bico em +X: o giro alinha o bico com a frente do personagem e a
      // rolagem o inclina para baixo. Estava 180° fora — o bico apontava para
      // trás e a água caía atrás dele.
      orientProp(wateringCan, wristR, 8, -84, -52);

      if (phone && phone.visible && phoneAim) {
        // ------------------------------------------------------------------
        // O celular MOSTRA a tela para a lente.
        //
        // A tela é o +Z do grupo do aparelho (o `inner` só rola em torno desse
        // mesmo eixo para endireitar o texto). Uma matriz lookAt da mão para a
        // câmera é exatamente a rotação que põe esse +Z apontado para ela — em
        // qualquer pose, com o produtor virado para qualquer lado. Depois é só
        // levar do mundo para o osso, como no orientProp.
        // ------------------------------------------------------------------
        // O aparelho SAI da palma na direção da lente.
        //
        // Na mão fechada do modelo os dedos vão até a altura do visor: com o
        // celular assentado na posição de repouso, três deles cruzavam a tela.
        // Empurrar o aparelho uns centímetros para a frente resolve sem mexer no
        // rig — a mão continua embaixo, segurando, e o visor fica livre.
        //
        // O deslocamento parte SEMPRE da posição de repouso, nunca da atual: a
        // partir da atual, cada quadro empurraria mais um pouco e em três
        // segundos o celular estaria voando na frente da câmera.
        phone.position.copy(phone.userData.base);
        const mao = phone.getWorldPosition(new THREE.Vector3());
        const paraLente = camera.position.clone().sub(mao).normalize();
        wristL.updateWorldMatrix(true, false);
        phone.position.copy(wristL.worldToLocal(
          mao.clone().addScaledVector(paraLente, .085).add(V3(0, .025, 0))));

        // Ordem dos argumentos ao contrário da intuição: Matrix4.lookAt monta o
        // +Z como (primeiro − segundo). Para o +Z do aparelho apontar da MÃO
        // para a LENTE, a câmera vem primeiro. Trocado, o que fica virado para o
        // público é a traseira do celular — uma lousa preta no meio do plano.
        const m = new THREE.Matrix4().lookAt(camera.position, mao, camera.up);
        const qAlvo = new THREE.Quaternion().setFromRotationMatrix(m);
        // Com o aparelho de pé e de frente, o texto já sai na vertical: a
        // rolagem de 150° existe para consertar a composição da OUTRA pose, e
        // aqui ela só deitaria a leitura.
        phone.userData.inner.rotation.z = 0;
        // Uma pitada de inclinação para trás: tela cravada a 90° na lente vira
        // adesivo colado no vidro, sem volume nenhum.
        qAlvo.multiply(new THREE.Quaternion().setFromEuler(
          new THREE.Euler(THREE.MathUtils.degToRad(-9), 0, THREE.MathUtils.degToRad(4))));
        wristL.getWorldQuaternion(qb);
        phone.quaternion.copy(qb).invert().multiply(qAlvo);
      } else if (phone) {
        // fora desse plano: tela virada para o rosto de quem segura
        phone.userData.inner.rotation.z = THREE.MathUtils.degToRad(150);
        phone.position.copy(phone.userData.base);
        orientProp(phone, wristL, 180, 180, 30);
      }
    }

    // Jato: nasce na ponta do bico e segue a direção REAL do bico mais gravidade.
    // Antes as gotas caíam sempre para +Z do mundo, o que só ficava certo com o
    // personagem virado para um lado específico.
    if (waterDrops) {
      if (producerState === 'water' && wateringCan && wateringCan.visible) {
        const tip = new THREE.Vector3(), dir = new THREE.Vector3();
        wateringCan.userData.tip.getWorldPosition(tip);
        // Eixo do bico declarado pelo próprio modelo (+X local), levado para o
        // mundo. O valor antigo era o ângulo do bico da versão em primitivas.
        dir.copy(wateringCan.userData.spout)
           .applyQuaternion(wateringCan.getWorldQuaternion(new THREE.Quaternion()))
           .normalize();
        waterDrops.items.forEach(d => {
          const c = (time * 1.6 + d.phase) % 1;
          d.mesh.visible = true;
          d.mesh.position.copy(tip)
            .addScaledVector(dir, c * .55)
            .add(new THREE.Vector3((Math.random()-.5)*.05, -c*c*1.9, (Math.random()-.5)*.05));
          d.mesh.material.opacity = .85 * (1 - c);
          d.mesh.scale.setScalar(1 - c*.35);
        });
      } else {
        waterDrops.items.forEach(d => { d.mesh.visible = false; });
      }
    }

    // dreno: a água escorre enquanto ele estiver à vista
    if (dreno.visible && drenoMat && drenoMat.map) {
      drenoMat.map.offset.x -= dt * .55;
    }

    // pacotes correndo pelos enlaces: é isto que mostra a malha viva
    {
      const d = new THREE.Object3D();
      packetCurves.forEach((pc, ci) => {
        for (let i = 0; i < pc.count; i++) {
          const u = ((time * pc.speed) + i / pc.count + ci * .13) % 1;
          const p = pc.curve.getPointAt(u);
          d.position.copy(p);
          // encolhe nas pontas, para o pacote nascer e morrer no equipamento
          const fade = Math.sin(u * Math.PI);
          d.scale.setScalar(.35 + fade * .75);
          d.updateMatrix();
          pc.inst.setMatrixAt(i, d.matrix);
        }
        pc.inst.instanceMatrix.needsUpdate = true;
      });
    }

    // tracejados correndo = dado em trânsito
    uplinks.forEach((l, i) => { l.material.dashOffset = (l.material.dashOffset||0) - dt*(2.2 + i*.2); });
    uplinks.forEach(l => { l.material.dashOffset = (l.material.dashOffset||0) - dt*3.0; });
    meteoLink.material.dashOffset = (meteoLink.material.dashOffset||0) - dt*2.0;

    // As sondas se viram para a lente. A cor de cada uma vem do pior estado do
    // seu sensor, e é atualizada junto com a simulação, mais abaixo.
    if (sensorVisual.encararCamera) sensorVisual.encararCamera(camera);

    // anemômetro e biruta acompanham o vento simulado
    if (cupsGroup) cupsGroup.rotation.y += dt * (0.35 + weather.wind * 0.16);
    if (vaneGroup) vaneGroup.rotation.y += (weather.windDir - vaneGroup.rotation.y) * Math.min(1, dt*1.5);

    // rótulos de mapa somem quando a lente desce ao chão
    {
      const alt = camera.position.y - elevationAt(camera.position.x, camera.position.z);
      const vAlt = clamp((alt - 10) / 9, 0, 1);

      // ---- névoa adaptativa ----
      // Até 40 m de altura vale a atmosfera; a partir de 120 m ela é empurrada
      // para longe o bastante para não tocar em nada da cena. Entre os dois,
      // transição suave — sem "liga/desliga" visível durante o zoom.
      {
        const t = clamp((alt - 40) / 80, 0, 1);
        scene.fog.near = 170 + t * 1400;
        scene.fog.far  = 460 + t * 3200;
      }
      // Altitude sozinha não basta: num plano a 11 m de altura o rótulo da Caixa
      // Principal ainda passava a 8 m da lente e ocupava meia tela. Um sprite de
      // tamanho fixo em metros cresce sem limite conforme encosta na câmera, então
      // ele também precisa sumir por PROXIMIDADE.
      const wp = new THREE.Vector3();
      mapLabels.forEach(l => {
        l.getWorldPosition(wp);
        const d = wp.distanceTo(camera.position);
        const v = vAlt * clamp((d - 18) / 22, 0, 1);
        l.visible = v > .02;
        l.material.opacity = v;
      });
      // Os ícones de alerta seguem a mesma regra de proximidade. Um sprite de
      // tamanho fixo em metros a 4 m da lente ocupa meia tela — foi assim que o
      // triângulo vermelho de um sensor cobriu o plano do regador.
      blockWarnIcons.forEach(w => {
        w.getWorldPosition(wp);
        w.material.opacity = vAlt * clamp((wp.distanceTo(camera.position) - 18) / 22, 0, 1);
      });
      Object.values(sensorVisual.warn).forEach(w => {
        if (!w.visible) return;
        w.getWorldPosition(wp);
        w.material.opacity = clamp((wp.distanceTo(camera.position) - 6) / 9, 0, 1);
      });
    }

    lcdT += dt;
    if (lcdT > 3.5 && lcdDraw && !storyActive) {
      lcdT = 0; lcdI = (lcdI + 1) % LCD.length; lcdDraw(...LCD[lcdI]);
    }

    // ---- chuva
    if (rainPhase === 1) {
      rainTimer += dt * rainSpeed;
      const arr = rainSys.geometry.attributes.position.array;
      const fall = 140 * dt * rainSpeed;
      for (let i = 1; i < rainCount*3; i += 3) {
        arr[i] -= fall;
        if (arr[i] < -30) arr[i] = 110;
      }
      rainSys.geometry.attributes.position.needsUpdate = true;
      rainMat.opacity = Math.min(.55, rainTimer * .6);
      uRain.value = Math.min(1, rainTimer / 2);
      weather.rainAcc = Math.min(38, rainTimer * 8.4);
      weather.hum = Math.min(96, weather.hum + dt * rainSpeed * 8);
      if (rainTimer > 4.5) {
        rainPhase = 2; rainTimer = 0;
        rainStatus.innerText = '☀️  A CHUVA PAROU\nA água escoa pelas curvas de nível rumo ao sopé.';
        SFX.rainStop();
      }
    } else if (rainPhase === 2) {
      rainTimer += dt * rainSpeed;
      rainMat.opacity = Math.max(0, .55 - rainTimer * .5);
      uDry.value = Math.min(1, rainTimer / 5);
      uPuddle.value = Math.min(1, rainTimer / 3);
      pondSurface.material.opacity = Math.min(.72, rainTimer * .22);
      weather.hum = Math.max(52, weather.hum - dt * rainSpeed * 2.2);
      if (rainTimer > 4.5 && rainTimer < 4.6)
        rainStatus.innerText = '📉  DINÂMICA DO TERRENO\nA zona alta seca rápido.\n'
          + 'O sopé recebe a água de cima e empoça.';
      if (rainTimer > 18) {
        rainPhase = 0;
        uRain.value = 0; uDry.value = 0; uPuddle.value = 0;
        rainStatus.style.opacity = '0';
      }
    } else {
      pondSurface.material.opacity = Math.max(.14, pondSurface.material.opacity - dt*.05);
      weather.rainAcc = Math.max(0, weather.rainAcc - dt * .35);
    }

    // ---- simulação e HUD, 2x por segundo (não por frame)
    if (Date.now() - lastData > 500) {
      lastData = Date.now();

      weather.temp += (Math.random() - .5) * .08;
      weather.temp = clamp(weather.temp, 18, 34);
      weather.hum = clamp(weather.hum + (Math.random() - .5) * .6, 35, 97);
      weather.wind = clamp(weather.wind + (Math.random() - .5) * .7, 1.5, 26);
      weather.windDir += (Math.random() - .5) * .12;
      renderWeather();

      const all = [];
      const warnScale = 1.5 + Math.sin(time*4) * .22;
      const blockAlert = {};
      let tintSujo = false;

      sensors.forEach(s => {
        // Deriva leve, e sempre puxando de volta para o centro da faixa da zona.
        // Passeio puramente aleatório sobre 24 sensores acaba levando algum para
        // fora do limite e enchendo o painel de alerta que não significa nada.
        const zb = zoneBase[s.zone];
        const pull = (k, rate) => {
          const mid = (zb[k][0] + zb[k][1]) / 2;
          s[k] += (Math.random()-.5)*rate + (mid - s[k])*.02;
        };
        pull('ph', .010); pull('ec', 1.1); pull('sal', .005);
        pull('tds', .9);  pull('temp', .05);

        if (rainPhase === 1) {
          const wr = s.zone === 'alta' ? 3.5 : s.zone === 'media' ? 4.5 : 6.0;
          s.moisture = Math.min(s.zone === 'baixa' ? 92 : 80, s.moisture + wr*.16);
          s.temp = Math.max(19, s.temp - .12);
          s.ec = Math.max(60, s.ec - (s.zone === 'alta' ? 2.2 : 1.0));
          if (s.zone === 'baixa') s.sal += .004;
        } else if (rainPhase === 2) {
          let dr = s.zone === 'alta' ? 1.1 : s.zone === 'media' ? .55 : .05;
          if (s.zone === 'baixa' && rainTimer < 10) dr = -.7;
          s.moisture = Math.max(zoneBase[s.zone].moisture[0], s.moisture - dr);
          s.temp = Math.min(zoneBase[s.zone].temp[1] + 1, s.temp + .08);
          if (s.zone === 'baixa') s.ec += .6;
        } else {
          const b = zoneBase[s.zone];
          s.moisture += ((b.moisture[0] + b.moisture[1])/2 - s.moisture) * .01;
        }
        clampPhysical(s);

        const c = cells[s.id];
        if (c) {
          const set = (el, val, key) => {
            const r = evalParam(key, s[key]);
            el.innerText = val;
            const cls = r.level === 'danger' ? 'cell-danger' : r.level === 'warn' ? 'cell-warn' : '';
            if (el.className !== cls) el.className = cls;
          };
          set(c.umi,  s.moisture.toFixed(1), 'moisture');
          set(c.temp, s.temp.toFixed(1),     'temp');
          set(c.ec,   s.ec.toFixed(0),       'ec');
          set(c.ph,   s.ph.toFixed(2),       'ph');
          set(c.sal,  s.sal.toFixed(2),      'sal');
          set(c.tds,  s.tds.toFixed(0),      'tds');
        }

        const a = computeAlerts(s, Date.now());
        if (a.length) {
          blockAlert[s.block] = true;
          a.forEach(x => all.push({ id:s.id, ...x }));
        }

        // Verde tudo certo · âmbar atenção · vermelho crítico. É a mesma
        // classificação do painel, agora legível de dentro da lavoura sem
        // precisar abrir tabela nenhuma.
        if (sensorVisual.tons) {
          const critico = a.some(x => x.level === 'danger');
          // Cores mais fortes do que pareceriam certas num seletor: o tone
          // mapping ACES da cena clareia bastante, e um verde claro vira branco.
          corSonda.setHex(critico ? 0xe0342b : a.length ? 0xe8a317 : 0x2fbe7e);
          const idx = sensorIndex[s.id];
          sensorVisual.tons.forEach(({ attr, k }) =>
            attr.setXYZ(idx, corSonda.r * k, corSonda.g * k, corSonda.b * k));
          tintSujo = true;
        }
        const w = sensorVisual.warn[s.id];
        if (w) { w.visible = a.length > 0; if (a.length) w.scale.set(warnScale, warnScale, 1); }
      });

      BLOCKS.forEach(b => {
        const w = sensorVisual.warn['BLOCK_' + b.id];
        if (w) { w.visible = !!blockAlert[b.id]; w.scale.set(warnScale*1.6, warnScale*1.6, 1); }
      });

      if (tintSujo) sensorVisual.tons.forEach(({ attr }) => { attr.needsUpdate = true; });

      all.sort((a, b) => (a.level === 'danger' ? 0 : 1) - (b.level === 'danger' ? 0 : 1));
      alertSummaryEl.innerText = `Alertas ativos: ${all.length}`;
      renderAlerts(all.slice(0, 5), all.length);

      // A ficha aberta de um sensor acompanha a leitura, em vez de congelar o
      // valor do instante do clique.
      if (cardSensor) pintarLeituras(cardSensor);
    }

    renderer.render(scene, camera);
  }

  // Os painéis começam RECOLHIDOS. Abertos por padrão, quatro cartões ocupavam
  // um terço da tela antes de o visitante decidir que queria ver alguma coisa —
  // e o que ele veio ver é a lavoura. Cada um abre no clique do próprio título.

  // Superfície de diagnóstico: o que uma auditoria externa precisa para conferir,
  // sem precisar reimplementar a geometria do plantio do lado de fora.
  window.__terahecta = {
    scene, renderer, camera, coffeeStats, sensors, setTopo,
    plantXZ: new Float32Array(plantXZ),
    // Salta direto para um plano do filme, sem esperar os anteriores — com a
    // narração no ponto certo, que é como se confere se o plano casa com a fala.
    // Serve para auditar um enquadramento isolado durante o desenvolvimento.
    gotoStage: async (i) => {
      SFX.resume();
      await NARRACAO.pronta();
      rodarFilme(stages[i].t + .01);
    },
    // Congela a órbita e crava a câmera num ponto. Sem isso, qualquer posição
    // definida de fora é sobrescrita no quadro seguinte pela auto-rotação.
    freeze: (pos, look) => {
      autoRotate = false;
      camPos.set(pos[0], pos[1], pos[2]);
      camLook.set(look[0], look[1], look[2]);
      applyCam();
    },
    canopyDepth, rowSpacing: ROW_SPACING, roadHalf: ROAD_HALF, plantEdge: PLANT_EDGE,
    blocks: BLOCKS, pond: POND, elevationAt, curvasPorArea, estudoPorArea,
    estudos: estudoPorArea, __DRY_ID: DRY_ID, __WET_ID: WET_ID, zonas: ZONAS,
    fluxo: FLUXO, depressao: DEPRESSAO,
    estacoes: ESTACAO, carreadores: corredoresPorArea,
    walkDry, walkWet, stages, passeioSede, obstaculosSede, sede: SEDE,
    narracao: NARRACAO, relogioDoFilme,
    info: () => renderer.info.render,
  };

  /* COMPILAR OS SHADERS AGORA, e não quando cada objeto aparecer.

     Sem esta linha, o programa de cada material só é compilado na primeira vez
     que aquele objeto entra no campo de visão. Compilar shader é caro e
     acontece na thread principal: o resultado é o engasgo clássico ao girar a
     câmera para um lado ainda não visto, e de novo quando a chuva liga, e de
     novo quando o filme traz elementos novos.

     `compile()` percorre a cena e compila tudo de uma vez. É síncrono e trava
     a thread — de propósito: aqui a cortina de carregamento ainda está no ar,
     que é justamente o lugar onde travar não incomoda ninguém.

     O `render()` logo em seguida desenha o primeiro quadro ainda atrás da
     cortina, para que o upload de textura e a montagem dos buffers também
     aconteçam antes de a cena ficar visível. */
  renderer.compile(scene, camera);
  renderer.render(scene, camera);

  animate();
}
