# Vitrine TeraBoard — como colocar no site

Pasta autossuficiente. Copie `propaganda/` inteira para qualquer lugar do seu
projeto, com qualquer nome — os caminhos internos são todos relativos e não
dependem do nível de diretório.

```
propaganda/
├── index.html              ← a vitrine
├── ad.css                  ← camada "nada clicável, só rolável"
├── foto3d.js               ← encenação do card 09 (three.js)
├── tela-*.html             ← as 10 telas do app
└── assets/
    ├── app.css             ← o design system do app
    ├── device.css/.js/.svg ← a moldura do celular
    ├── logo-cream.svg
    ├── MorangoApp.webp     ← foto do post
    ├── ProdutorApp.webp    ← foto do perfil
    └── morango.obj         ← modelo 3D (6 MB)
```

Os `.png` originais das duas fotos continuam na pasta, mas nada mais aponta
para eles — pode apagar.

---

## Jeito 1 — página própria

Aponte um link para `propaganda/index.html`. Nada mais a fazer.

## Jeito 2 — seção dentro de uma página que já existe (recomendado)

```html
<iframe
  src="/caminho/propaganda/index.html"
  title="TeraBoard em ação"
  style="width:100%; height:1100px; border:0; display:block;"
  loading="lazy">
</iframe>
```

O `loading="lazy"` importa: a vitrine só carrega quando o visitante chega
perto dela.

Por que iframe e não colar o HTML na página: `index.html` traz um
`<style>` com reset global (`* { margin:0 }`) e um `<script type="importmap">`.
O reset atropelaria o CSS do seu site, e **só pode existir um importmap por
documento** — se a sua página já tiver um, os dois brigam. Dentro do iframe
nada disso encosta no resto do site.

## Jeito 3 — colado direto na página

Dá, mas exige trabalho: trocar o reset global por regras com prefixo,
fundir o importmap com o seu (ou trocar os `import` por URLs absolutas do
unpkg) e conferir colisão de nomes de classe. Se for esse o caminho, me diga
qual é a stack do site que eu faço a adaptação.

---

## O que precisa estar de pé

**Servidor HTTP.** Abrir por `file://` não funciona: o `foto3d.js` é um módulo
ES e o navegador bloqueia `import` fora de HTTP. Qualquer hospedagem serve
(Vercel, Netlify, Apache, nginx, GitHub Pages).

**Três CDNs**, herdados dos protótipos originais:

| o quê | de onde | quebra o quê se cair |
| --- | --- | --- |
| Google Fonts | `fonts.googleapis.com` | tipografia vira fonte do sistema |
| Ícones Phosphor | `unpkg.com/@phosphor-icons/web` | ícones somem |
| three.js 0.169 | `unpkg.com/three` | só o card 09 |

Se o site precisar rodar sem internet externa, peça que eu baixo os três para
dentro de `assets/`. São ~1,5 MB no total.

---

## Peso

A abertura carrega cerca de **600 KB**. O modelo 3D de 6 MB **só desce quando
alguém clica no card 09** — numa página de propaganda esse peso não pode estar
na abertura.

As duas fotos já estão em WebP: 2,9 MB de PNG viraram 56 KB. O avatar do
produtor também foi reduzido de 1311 px para 200 px, porque ele renderiza a
36 px de tela e o resto era desperdício puro.

---

## Como funciona, em duas linhas

Cada tela é um HTML de verdade rodando num `<iframe>`, posicionado dentro do
furo vazado da moldura em SVG. Por isso o conteúdo continua rolável e nítido
em qualquer resolução, sem ser captura de tela.

As telas **não são clicáveis** — e a garantia não é CSS, é a marcação: não há
um `<a href>` nem um `<button>` dentro delas. A única exceção é o botão
"Entrar" da tela de login, que é justamente o gesto que abre a apresentação.
