/* ==========================================================================
   TeraBoard · Area do Investidor — o portao de senha

   Notas de manutencao em _originais-nao-publicar/NOTAS-PROTECAO.md, fora da
   pasta publicada. O que estiver escrito aqui dentro qualquer visitante le.
   ========================================================================== */

/* Uma linha por convidado: codigo de acesso e o identificador que vai para o
   carimbo. Use sempre identificadores opacos (INV-01, INV-02) — o de/para
   fica fora do site, nas notas. Acrescentar linha da acesso; apagar linha
   tira, sem mexer nos outros. */
var CONVIDADOS = {
  '1203': 'INV-00'
};

var CHAVE_ACESSO = 'tb:investidor';
var CHAVE_QUEM   = 'tb:investidor:quem';
var CHAVE_TERMOS = 'tb:investidor:termos';

(function () {
  var portao   = document.getElementById('portao');
  var projetos = document.getElementById('projetos');
  var form     = document.getElementById('portaoForm');
  var erro     = document.getElementById('portaoErro');
  var linha    = document.getElementById('pinLinha');
  var aceite   = document.getElementById('aceiteTermos');
  if (!portao || !projetos || !form || !linha) return;

  var caixas = [].slice.call(linha.querySelectorAll('.pin'));

  function temAcesso() {
    try { return sessionStorage.getItem(CHAVE_ACESSO) === 'ok'; } catch (e) { return false; }
  }

  function abrirProjetos(guardar, quem) {
    if (guardar) {
      try {
        sessionStorage.setItem(CHAVE_ACESSO, 'ok');
        sessionStorage.setItem(CHAVE_QUEM, quem || '');
        sessionStorage.setItem(CHAVE_TERMOS, new Date().toISOString());
      } catch (e) {}
      /* O carimbo ja foi montado no carregamento, quando ainda nao se sabia
         quem era. Agora se sabe: refaz para o codigo entrar nele. */
      if (window.TBProtecao) window.TBProtecao.marcar();
    }
    portao.hidden = true;
    projetos.hidden = false;
    // leva o foco para o comeco da grade: quem entrou pelo teclado ou por
    // leitor de tela continua de onde a pagina mudou, e nao do topo do documento
    var alvo = document.getElementById('projetosTitulo');
    if (alvo && guardar) alvo.focus();
  }

  /* Ja entrou nesta visita: a grade aparece direto, sem pedir de novo. */
  if (temAcesso()) abrirProjetos(false);

  function valorDigitado() {
    return caixas.map(function (c) { return c.value; }).join('');
  }

  function limpar() {
    caixas.forEach(function (c) { c.value = ''; c.classList.remove('cheio'); });
    caixas[0].focus();
  }

  function recusar() {
    erro.textContent = 'Senha incorreta';
    linha.classList.remove('errou');
    void linha.offsetWidth;          // reinicia a animacao mesmo em erros seguidos
    linha.classList.add('errou');
    limpar();
  }

  /* Termos nao marcados: avisa e para por aqui, sem apagar o que foi digitado.
     Apagar o PIN de quem so esqueceu a caixinha seria punir o distraido. */
  function faltaAceite() {
    if (!aceite || aceite.checked) return false;
    erro.textContent = 'Aceite os termos de acesso para entrar';
    var etiqueta = aceite.closest('.aceite');
    if (etiqueta) {
      etiqueta.classList.remove('falta');
      void etiqueta.offsetWidth;     // reinicia a animacao em tentativas seguidas
      etiqueta.classList.add('falta');
    }
    aceite.focus();
    return true;
  }

  function conferir() {
    if (faltaAceite()) return;

    /* hasOwnProperty e nao CONVIDADOS[pin] direto: um PIN digitado como
       "constructor" ou "toString" acharia coisa herdada do Object e abriria
       o portao. Sao quatro digitos, entao nao chega a acontecer — mas a
       forma certa custa a mesma linha. */
    var pin = valorDigitado();
    if (Object.prototype.hasOwnProperty.call(CONVIDADOS, pin)) {
      erro.textContent = '';
      abrirProjetos(true, CONVIDADOS[pin]);
    } else {
      recusar();
    }
  }

  /* Digitou os quatro numeros antes de marcar a caixa: marcou, entra. Sem
     isto a pessoa teria de apagar e redigitar o PIN so por causa da ordem. */
  if (aceite) {
    aceite.addEventListener('change', function () {
      var etiqueta = aceite.closest('.aceite');
      if (etiqueta) etiqueta.classList.remove('falta');
      if (aceite.checked) {
        if (erro.textContent) erro.textContent = '';
        if (valorDigitado().length === 4) conferir();
      }
    });
  }

  caixas.forEach(function (caixa, i) {
    caixa.addEventListener('input', function () {
      // teclado de celular manda coisa que nao e digito; aqui so passa numero
      var so = caixa.value.replace(/\D/g, '');
      caixa.value = so.slice(-1);
      caixa.classList.toggle('cheio', caixa.value !== '');
      if (erro.textContent) erro.textContent = '';
      if (caixa.value && i < caixas.length - 1) caixas[i + 1].focus();
      // completou os quatro: nao faz esperar por um botao
      if (valorDigitado().length === 4) conferir();
    });

    caixa.addEventListener('keydown', function (e) {
      if (e.key === 'Backspace' && !caixa.value && i > 0) {
        e.preventDefault();
        caixas[i - 1].value = '';
        caixas[i - 1].classList.remove('cheio');
        caixas[i - 1].focus();
      }
      if (e.key === 'ArrowLeft'  && i > 0)                { e.preventDefault(); caixas[i - 1].focus(); }
      if (e.key === 'ArrowRight' && i < caixas.length - 1){ e.preventDefault(); caixas[i + 1].focus(); }
    });

    // colar os quatro digitos de uma vez distribui pelas caixas
    caixa.addEventListener('paste', function (e) {
      var texto = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
      if (!texto) return;
      e.preventDefault();
      caixas.forEach(function (c, j) {
        c.value = texto[j] || '';
        c.classList.toggle('cheio', c.value !== '');
      });
      caixas[Math.min(texto.length, caixas.length) - 1].focus();
      if (valorDigitado().length === 4) conferir();
    });

    caixa.addEventListener('focus', function () { caixa.select(); });
  });

  form.addEventListener('submit', function (e) { e.preventDefault(); conferir(); });
})();
