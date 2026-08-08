/* =========================================================================
   Aparelho em SVG — ajuste de escala
   -------------------------------------------------------------------------
   O iframe sempre carrega em 402 × 874 pt, o tamanho lógico do aparelho, e
   esta função só o encolhe para caber no furo da moldura. Assim a página se
   organiza exatamente como no celular, em qualquer tamanho de exibição.
   ========================================================================= */

(function (global) {
	"use strict";

	/** Tamanho lógico da tela do iPhone 17 Pro, em pontos. */
	var PAGE_W = 402;
	var PAGE_H = 874;

	function fit(device) {
		var screen = device.querySelector(".device-screen");
		var frame = screen && screen.querySelector("iframe");
		if (!frame) return;

		var k = screen.clientWidth / PAGE_W;
		frame.style.transform = "scale(" + k + ")";
	}

	function fitAll(root) {
		(root || document).querySelectorAll(".device").forEach(fit);
	}

	/*
	 * A escala depende da largura RENDERIZADA, que muda sem a janela mudar
	 * junto (trilho recolhido, aparelho montado depois da carga). Um
	 * observador na caixa da tela cobre todos esses casos de uma vez.
	 */
	var observer =
		typeof ResizeObserver === "function"
			? new ResizeObserver(function (entries) {
					entries.forEach(function (entry) {
						var device = entry.target.closest(".device");
						if (device) fit(device);
					});
				})
			: null;

	function observe(root) {
		if (!observer) return;
		(root || document).querySelectorAll(".device .device-screen").forEach(function (el) {
			observer.observe(el);
		});
	}

	/**
	 * Monta um aparelho dentro de `host` e devolve o iframe.
	 *
	 * Usar isto em vez de escrever a marcação à mão evita que as
	 * porcentagens da tela sejam copiadas com erro em algum lugar.
	 */
	function mount(host, src, assetsPath) {
		var base = assetsPath || "assets/";

		var device = document.createElement("div");
		device.className = "device";

		var screen = document.createElement("div");
		screen.className = "device-screen";

		var frame = document.createElement("iframe");
		frame.title = "TeraBoard";
		frame.src = src;
		frame.width = PAGE_W;
		frame.height = PAGE_H;

		var chrome = document.createElement("img");
		chrome.className = "device-chrome";
		chrome.src = base + "device.svg";
		chrome.alt = "";
		chrome.setAttribute("aria-hidden", "true");

		screen.appendChild(frame);
		device.appendChild(screen);
		device.appendChild(chrome);
		host.appendChild(device);

		fit(device);
		if (observer) observer.observe(screen);
		return frame;
	}

	addEventListener("resize", function () { fitAll(); });

	function start() {
		fitAll();
		observe();
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", start);
	} else {
		start();
	}

	global.TeraboardDevice = {
		fit: fit,
		fitAll: fitAll,
		observe: observe,
		mount: mount,
		PAGE_W: PAGE_W,
		PAGE_H: PAGE_H,
	};
})(window);
