# Site TeraBoard

Site institucional da TeraBoard — cinco páginas estáticas, sem build e sem dependências
de instalação. O que antes eram cinco arquivos HTML de página única (cada um com todo o
CSS e todo o JS embutidos, e as imagens hospedadas fora) virou a estrutura abaixo.

## Estrutura

```
Site/
├── index.html          Início
├── produtos.html       Catálogo + comparador
├── terasensor.html     Produto: analisador portátil (3D do aparelho)
├── terasmart.html      Produto: irrigação autônoma (3D da estufa)
├── equipe.html         Equipe
│
├── robots.txt          Libera a indexação e aponta o sitemap
├── sitemap.xml         As cinco páginas, para os buscadores
│
├── assets/
│   ├── logo/           A marca em SVG (nav, rodapé, favicon, fonte da geometria 3D)
│   ├── icons/          Ícones de contato (Instagram, WhatsApp) já em creme
│   └── img/
│       ├── fotos/      Fotografias de contexto
│       ├── produtos/   Capas usadas como textura nos modelos 3D
│       ├── telas/      Capturas da tela E-ink do TeraSensor
│       └── equipe/     Retratos (.png) e as ilustrações dos cards (*-avatar.svg)
│
├── css/
│   ├── tokens.css      Cores e medidas da marca — a fonte de verdade da paleta
│   ├── base.css        Reset, tipografia, utilitários de texto
│   ├── layout.css      Container, respiros, réguas, canvas de fundo
│   ├── loader.css      Tela de abertura e a luz que viaja até a nav
│   ├── nav.css         Barra fixa, marca reativa ao scroll, menu mobile
│   ├── components.css  Cards, botões, tags, marquee, sliders, logs
│   ├── themes.css      Contextos que reescrevem os tokens (card verde, faixa creme)
│   └── pages/          Só o que é exclusivo de cada página
│
└── js/
    ├── loader.js       Abertura; configurada por data-* no HTML
    ├── nav.js          Encolhe no scroll, menu mobile, revelação das seções
    ├── scene-3d.js     Marca 3D de fundo; configurada por data-* no HTML
    ├── ui-effects.js   Barra de leitura, contadores, cards com inclinação
    └── pages/          Um arquivo por página (e os modelos 3D pesados)
```

## Ordem dos estilos

Os `<link>` seguem a ordem da lista acima e **ela importa**: `themes.css` redefine
variáveis dentro de `.plate`, `.icard` e `.cream`, então precisa vir depois de
`components.css`. O CSS da página é sempre o último.

## Como configurar cada página

Não é preciso mexer em JavaScript para ajustar a abertura ou a cena 3D — as duas leem
atributos do próprio HTML:

```html
<div class="site-loader" id="siteLoader"
     data-min-ms="4200"
     data-phrases="Preparando o terreno|Calibrando os sensores|Lendo o solo">

<div id="canvas-container" data-scale="0.0000030" data-intro-fade="true"></div>
```

| Atributo | Onde | O que faz |
|---|---|---|
| `data-min-ms` | `#siteLoader` | Tempo mínimo que a abertura fica no ar |
| `data-phrases` | `#siteLoader` | Frases que se alternam, separadas por `\|` |
| `data-scale` | `#canvas-container` | Tamanho da marca 3D de fundo |
| `data-intro-fade` | `#canvas-container` | Apaga o aviso "role para explorar" ao rolar |

## Rodando localmente

Abrir o HTML direto do disco funciona para navegar, mas o `file://` bloqueia o
carregamento de texturas locais no WebGL — os modelos 3D do TeraSensor e do TeraSmart
aparecem sem as capas. Suba um servidor estático para ver o site como ele é:

```bash
npx serve .
# ou
python -m http.server 8000
```

## Cores da marca nos SVGs

Os logos e os ícones de contato têm o creme **`#F0F1E3`** gravado dentro do arquivo —
é o mesmo valor de `--ink` em `tokens.css`. Se um dia mudar o creme da marca, troque
nos dois lugares: no token e nos SVGs de `assets/logo/` e `assets/icons/`.

Os ícones de WhatsApp que aparecem **dentro de botões** continuam sendo da fonte
Phosphor (`<i class="ph-bold ph-whatsapp-logo">`), de propósito: ali eles precisam
herdar a cor do botão, que muda conforme o fundo.

## Por que ainda existe SVG dentro do HTML

Quase todo SVG virou arquivo em `assets/`. Sobraram **quatro**, de propósito — dois no
`index.html` e dois no `terasensor.html`. São gráficos, não desenhos, e só funcionam
embutidos:

- leem as variáveis de cor da página (`var(--clay)`, `var(--signal-deep)`) — um SVG
  carregado por `<img>` fica isolado e não enxerga o CSS do site;
- têm partes movidas por JavaScript (`#hpLine`, `#ph-line`, `#stem`, as folhas do
  simulador de solo).

Tirá-los do HTML quebraria os dois.

## Endereço do site

As tags `canonical` e Open Graph apontam para `https://teraboard.com.br`. Se o domínio
mudar, atualize nos cinco HTMLs, no `robots.txt` e no `sitemap.xml`.

## Dependências externas

Continuam vindo de CDN, sem instalação: Tailwind, Phosphor Icons, Google Fonts,
three.js r128 (+ SVGLoader e OrbitControls) e GSAP 3.12 (+ ScrollTrigger). Se algum CDN
cair, o `loader.js` tem uma rede de segurança de 9 s que libera a página do mesmo jeito.

## Pendência conhecida

`assets/img/fotos/morango-estufa.jpg` **não está no repositório**. É uma foto de banco de
imagens da Vecteezy e o site bloqueia download direto (HTTP 403), além da questão de
licença. Em `index.html` e `produtos.html` a tag aponta para o caminho local e cai de
volta para a URL remota se o arquivo não existir:

```html
<img src="assets/img/fotos/morango-estufa.jpg" onerror="...vecteezy.com/...">
```

Ou seja: o site funciona hoje. Para ficar 100% local, baixe a imagem com a licença da
Vecteezy, salve nesse caminho e remova o `onerror`.
