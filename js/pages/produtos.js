/* ==========================================================================
   TeraBoard · Produtos — diagnóstico de perfil

   As caixas de "qual é o seu caso" continuam calculando a recomendação, mas
   ela fica GUARDADA: só aparece depois que o visitante confirma o formulário.
   É a troca honesta da página — ele conta como planta, a gente responde o que
   serve para ele.

   ---------------------------------------------------------------------------
   PARA ONDE VÃO OS DADOS

   Este site é estático: não há servidor nosso para receber um POST, então o
   envio passa por um repassador de formulário (FormSubmit), que encaminha as
   respostas para o e-mail abaixo. Trocar de serviço é mexer só em `enviar()`.

   O endereço usa o truque de subendereçamento do Gmail: tudo que chega em
   ...+FormsSite@ cai na mesma caixa e pode ser filtrado por um rótulo.

   >>> ANTES DE PUBLICAR: o FormSubmit exige ativar o endereço uma única vez.
   >>> O primeiro envio dispara um e-mail de confirmação para a caixa; depois
   >>> de clicar no link, os envios seguintes chegam direto.
   ========================================================================== */
(function () {
  'use strict';

  var form = document.getElementById('perfilForm');
  if (!form) return;

  var DESTINO = 'teraboardoficial+FormsSite@gmail.com';
  var ENDERECO = 'https://formsubmit.co/ajax/' + DESTINO.replace('+', '%2B');
  var WHATSAPP = 'https://wa.me/5522998745065';

  var opts     = form.querySelectorAll('.cmp-opt');
  var convite  = document.getElementById('frmConvite');
  var corpo    = document.getElementById('frmCorpo');
  var seEstufa = document.getElementById('frmSeEstufa');
  var erroBox  = document.getElementById('frmErro');
  var enviarBt = document.getElementById('frmEnviar');
  var resultado= document.getElementById('frmResultado');

  var barS = document.getElementById('cmpBarS'), barM = document.getElementById('cmpBarM');
  var pcS  = document.getElementById('cmpPcS'),  pcM  = document.getElementById('cmpPcM');
  var ico  = document.getElementById('cmpIcon'), tit  = document.getElementById('cmpTitle');
  var txt  = document.getElementById('cmpText'), lnk  = document.getElementById('cmpLink');

  /* ---------------------------------------------------------------- caso */

  function marcados() {
    return Array.prototype.filter.call(opts, function (o) {
      return o.classList.contains('on');
    });
  }

  function pontuar() {
    var s = 0, m = 0;
    marcados().forEach(function (o) { o.dataset.p === 's' ? s++ : m++; });
    var total = s + m;
    return {
      s: s, m: m, total: total,
      pS: total ? Math.round(s / total * 100) : 0,
      pM: total ? 100 - Math.round(s / total * 100) : 0,
    };
  }

  function abrirFormulario() {
    if (!corpo.hidden) return;
    convite.hidden = true;
    corpo.hidden = false;
    // Sem o foco, quem clicou no botão não percebe que nasceram campos
    // abaixo — em celular eles nascem fora da tela.
    var primeiro = corpo.querySelector('input, select, textarea');
    if (primeiro) primeiro.focus({ preventScroll: true });
    corpo.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  Array.prototype.forEach.call(opts, function (o) {
    o.addEventListener('click', function () {
      o.classList.toggle('on');
      o.setAttribute('aria-pressed', o.classList.contains('on') ? 'true' : 'false');
    });
  });
  document.getElementById('frmAbrir').addEventListener('click', abrirFormulario);

  /* Perguntas de estufa só existem para quem tem estufa. */
  form.addEventListener('change', function (e) {
    if (e.target.name !== 'ambiente') return;
    seEstufa.hidden = e.target.value === 'Campo aberto';
  });

  /* ----------------------------------------------------------- validação */

  var OBRIGATORIOS = [
    ['ambiente',  'Diga se o plantio é em estufa ou campo aberto.'],
    ['area',      'Informe a área de plantio.'],
    ['cultura',   'Informe a cultura principal.'],
    ['irrigacao', 'Escolha o método de irrigação que você usa hoje.'],
    ['nome',      'Escreva o seu nome.'],
    ['whatsapp',  'Precisamos de um WhatsApp para responder.'],
    ['cidade',    'Informe a cidade e o estado.'],
    ['perfil',    'Diga se você é produtor, agrônomo, revenda…'],
  ];

  function valorDe(nome) {
    var campos = form.elements[nome];
    if (!campos) return '';
    if (campos.length && !campos.tagName) {              // grupo de rádio
      var escolhido = Array.prototype.find.call(campos, function (c) { return c.checked; });
      return escolhido ? escolhido.value : '';
    }
    return (campos.value || '').trim();
  }

  function marcarInvalido(nome, sim) {
    var campos = form.elements[nome];
    if (!campos) return;
    if (campos.length && !campos.tagName) {
      var grupo = campos[0].closest('.frm-chips');
      if (grupo) grupo.classList.toggle('invalido', sim);
    } else {
      campos.classList.toggle('invalido', sim);
    }
  }

  function validar() {
    var faltando = [];
    OBRIGATORIOS.forEach(function (par) {
      var vazio = !valorDe(par[0]);
      marcarInvalido(par[0], vazio);
      if (vazio) faltando.push(par);
    });

    var mail = valorDe('email');
    if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail)) {
      marcarInvalido('email', true);
      faltando.push(['email', 'Confira o e-mail: parece incompleto.']);
    }

    // 8 dígitos já cobre um fixo sem DDD; o resto é do dono do número.
    var zap = valorDe('whatsapp').replace(/\D/g, '');
    if (zap && zap.length < 10) {
      marcarInvalido('whatsapp', true);
      faltando.push(['whatsapp', 'O WhatsApp parece curto — inclua o DDD.']);
    }
    return faltando;
  }

  function mostrarErro(texto) {
    erroBox.innerHTML = texto;
    erroBox.hidden = false;
    erroBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* -------------------------------------------------------------- pacote */

  function multiplos(nome) {
    return Array.prototype.filter.call(form.elements[nome] || [], function (c) { return c.checked; })
      .map(function (c) { return c.value; }).join(', ');
  }

  /** @param p  a contagem de pontuar()   @param r  o veredito de recomendar() */
  function montarPacote(p, r) {
    var caso = marcados().map(function (o) { return o.textContent.trim(); });
    var d = {
      _subject: 'Site · novo perfil: ' + (valorDe('nome') || 'sem nome') +
                ' · ' + (valorDe('cidade') || 'sem cidade'),
      _template: 'table',
      _captcha: 'false',

      'Nome':            valorDe('nome'),
      'WhatsApp':        valorDe('whatsapp'),
      'E-mail':          valorDe('email') || '—',
      'Cidade/UF':       valorDe('cidade'),
      'Perfil':          valorDe('perfil'),
      'Prazo':           valorDe('prazo') || '—',

      'Ambiente':        valorDe('ambiente'),
      'Estufas':         valorDe('estufas') || '—',
      'Pé-direito':      valorDe('pe_direito') || '—',
      'Apoio das plantas': multiplos('cultivo') || '—',
      'Área':            valorDe('area') + ' ' + valorDe('area_unidade'),
      'Cultura':         valorDe('cultura'),
      'Solo/substrato':  valorDe('solo') || '—',
      'Setores':         valorDe('setores') || '—',

      'Irrigação hoje':  valorDe('irrigacao'),
      'Fertirrigação':   valorDe('fertirrigacao') || '—',
      'Automação':       valorDe('automacao') || '—',
      'Quem opera':      valorDe('operador') || '—',
      'Água':            valorDe('agua') || '—',
      'Energia':         valorDe('energia') || '—',
      'Maior dor':       valorDe('dor') || '—',

      'Caso marcado':    caso.length ? caso.join(' | ') : '(nenhum)',
      'Recomendação':    r.texto + '  (TeraSensor ' + p.pS + '% / TeraSmart ' + p.pM + '%)',
      'Enviado em':      new Date().toLocaleString('pt-BR'),
      'Página':          location.href,
    };
    if (form.elements._honey) d._honey = form.elements._honey.value;
    return d;
  }

  /* --------------------------------------------------------- recomendação */

  function recomendar(p) {
    if (!p.total) {
      return { chave: 'nenhum', texto: 'Sem caso marcado',
               titulo: 'Vamos olhar o seu caso com calma',
               corpo: 'Você não marcou nenhuma das opções, então a leitura vai '
                    + 'sair da conversa mesmo. A equipe já recebeu o seu perfil.',
               icone: 'ph-chats-circle', href: 'terasensor.html',
               link: 'Conhecer o TeraSensor →' };
    }
    if (p.s > p.m) {
      return { chave: 'sensor', texto: 'TeraSensor',
               titulo: 'Comece pelo TeraSensor',
               corpo: 'O seu uso é de campo e diagnóstico: você precisa medir em '
                    + 'muitos pontos e sair com a recomendação pronta.',
               icone: 'ph-device-mobile', href: 'terasensor.html',
               link: 'Ver a página do TeraSensor →' };
    }
    if (p.m > p.s) {
      return { chave: 'smart', texto: 'TeraSmart',
               titulo: 'Comece pelo TeraSmart',
               corpo: 'O seu uso é de operação contínua: vale mais tirar a irrigação '
                    + 'e a fertirrigação do controle manual.',
               icone: 'ph-plant', href: 'terasmart.html',
               link: 'Ver a página do TeraSmart →' };
    }
    return { chave: 'ambos', texto: 'Os dois',
             titulo: 'Os dois se completam no seu caso',
             corpo: 'Você mede o campo com o TeraSensor e deixa a estufa no '
                  + 'automático com o TeraSmart — o mesmo dado nos dois.',
             icone: 'ph-arrows-left-right', href: '#terasensor',
             link: 'Comparar os dois abaixo →' };
  }

  function revelar(p, r) {
    corpo.hidden = true;
    resultado.hidden = false;

    ico.className = 'ph-fill ' + r.icone;
    tit.textContent = r.titulo;
    txt.textContent = r.corpo;
    lnk.href = r.href;
    lnk.textContent = r.link;
    lnk.style.display = 'inline-block';

    // Um quadro depois de sair do `hidden`, para a barra ter de onde animar.
    requestAnimationFrame(function () {
      barS.style.width = p.pS + '%'; pcS.textContent = p.pS + '%';
      barM.style.width = p.pM + '%'; pcM.textContent = p.pM + '%';
    });
    resultado.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* --------------------------------------------------------------- envio */

  function enviar(pacote) {
    return fetch(ENDERECO, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(pacote),
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    erroBox.hidden = true;

    var faltando = validar();
    if (faltando.length) {
      mostrarErro('<strong>Falta pouco:</strong><br>' +
        faltando.map(function (f) { return '• ' + f[1]; }).join('<br>'));
      var alvo = form.elements[faltando[0][0]];
      var foco = (alvo && alvo.length && !alvo.tagName) ? alvo[0] : alvo;
      if (foco && foco.focus) foco.focus();
      return;
    }

    var p = pontuar();
    var r = recomendar(p);

    enviarBt.disabled = true;
    enviarBt.innerHTML = '<i class="ph-bold ph-circle-notch"></i> Enviando…';

    enviar(montarPacote(p, r)).then(function () {
      revelar(p, r);
    }).catch(function (erro) {
      /*
       * O visitante fez a parte dele. Mesmo com o envio falhando, ele vê a
       * recomendação — e ganha um caminho para falar com a gente, para o
       * contato não se perder numa falha que não é dele.
       */
      console.warn('Envio do formulário falhou:', erro);
      revelar(p, r);
      mostrarErro('Não conseguimos enviar as suas respostas agora — pode ter sido a '
        + 'conexão. Sua recomendação está aí embaixo, e se quiser falar direto: '
        + '<a href="' + WHATSAPP + '" target="_blank" rel="noopener" '
        + 'style="color:#fff;text-decoration:underline">chamar no WhatsApp</a>.');
      erroBox.hidden = false;
    }).then(function () {
      enviarBt.disabled = false;
      enviarBt.innerHTML = '<i class="ph-bold ph-paper-plane-tilt"></i> Confirmar e ver a recomendação';
    });
  });
})();
