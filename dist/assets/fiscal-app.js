// fiscal-app.js — telas pós-abertura de turno do app do Fiscal (Início, Fim,
// Refeição, Viagens, Menu). Vanilla JS, sem framework, mesmo padrão de
// fiscal-entrada.js e painel-coordenador.js.
//
// Handoff explícito: fiscal-entrada.js chama window.__fiscalApp.init(ctx) com
// { token, fiscal, turno, partidasPorTabela } assim que o turno é aberto (ou
// encontrado já aberto no refresh). Esse arquivo NUNCA é carregado antes do
// login — só passa a fazer algo a partir do init().
//
// Offline-first: toda ação (veículo, dupla, confirmar/perder viagem, jornada,
// refeição) grava primeiro em localStorage (estado local otimista + fila de
// envio) e só depois tenta a rede. Ver seção "Fila offline" abaixo.

(function () {
  "use strict";

  const API_BASE = "/api/v1";

  const NOME_TERMINAL = { TP: "Cem. Pq. dos Pinheiros", TS: "Metrô Santana" };

  const MOTIVOS_PERDA = [
    { valor: "FALTA_MOTORISTA", titulo: "Falta de Motorista", desc: "Tabela sem condutor escalado" },
    { valor: "FALTA_COBRADOR", titulo: "Falta de Cobrador", desc: "Tabela sem cobrador escalado" },
    { valor: "RA", titulo: "Recolhida Anormal (RA)", desc: "Veículo recolhido fora do previsto" },
    { valor: "SOS", titulo: "Socorro Mecânico (SOS)", desc: "Pane ou problema mecânico no veículo" },
    { valor: "TRANSITO", titulo: "Trânsito", desc: "Atraso por congestionamento ou via bloqueada" },
    { valor: "ATRASO_PATIO", titulo: "Atraso no Pátio", desc: "Veículo não saiu a tempo da garagem" },
    { valor: "OUTROS", titulo: "Outros", desc: "Descreva o motivo no campo abaixo" },
  ];

  // ── Ícones SVG inline (estilo Feather — stroke, sem dependência externa) ──
  function svgIcone(pathContent, tamanho) {
    return (
      '<svg width="' + tamanho + '" height="' + tamanho + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      pathContent + "</svg>"
    );
  }

  const ICONES = {
    inicio: svgIcone('<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>', 20),
    fim: svgIcone('<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>', 20),
    refeicao: svgIcone('<path d="M3 2v7a2 2 0 0 0 2 2v11"/><path d="M6 2v7"/><path d="M9 2v7"/><path d="M18 2c-2.5 2-2.5 6-2.5 8 0 2 1 3 2.5 3v9"/>', 20),
    viagens: svgIcone('<rect x="3" y="6" width="18" height="11" rx="2"/><path d="M3 11h18"/><circle cx="7.5" cy="19" r="1.5"/><circle cx="16.5" cy="19" r="1.5"/>', 20),
    menu: svgIcone('<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>', 20),
    sync: svgIcone('<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>', 14),
    olho: svgIcone('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>', 18),
    olhoCortado: svgIcone('<path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>', 18),
    info: svgIcone('<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>', 18),
    chevron: svgIcone('<polyline points="6 9 12 15 18 9"/>', 16),
  };

  // ── Estado do módulo ──────────────────────────────────────────────────────
  let ctx = null; // { token, fiscal, turno, partidasPorTabela }
  let root = null;
  let estado = null; // cache local otimista (persistido por turno)
  let fila = []; // fila offline (persistida por turno)
  let telaAtual = null;
  let pilha = [];
  let operacoesExpandido = false;
  let enviandoFila = false;
  let debounceBusca = null;

  // ── Utilidades ─────────────────────────────────────────────────────────────
  function gerarUuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function escaparHtml(texto) {
    if (texto === null || texto === undefined) return "";
    const div = document.createElement("div");
    div.textContent = String(texto);
    return div.innerHTML;
  }

  function minutosDoHorario(hhmm) {
    if (!hhmm) return 0;
    const partes = hhmm.split(":");
    return parseInt(partes[0], 10) * 60 + parseInt(partes[1], 10);
  }

  function minutosAgora() {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }

  function horaAtualHHMM() {
    const d = new Date();
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  function formatarData(dataISO) {
    const partes = String(dataISO).split("-");
    if (partes.length !== 3) return dataISO;
    return partes[2] + "/" + partes[1] + "/" + partes[0];
  }

  function rotuloMotivo(valor) {
    const m = MOTIVOS_PERDA.find(function (x) { return x.valor === valor; });
    return m ? m.titulo : valor;
  }

  // ── Persistência local (cache otimista + fila offline), por turno ─────────
  function chaveCache() { return "fiscal_app_cache_v1_" + ctx.turno.id; }
  function chaveFila() { return "fiscal_app_fila_v1_" + ctx.turno.id; }

  function salvarEstado() {
    try { localStorage.setItem(chaveCache(), JSON.stringify(estado)); } catch (e) { /* localStorage indisponível */ }
  }
  function carregarEstado() {
    try {
      const bruto = localStorage.getItem(chaveCache());
      return bruto ? JSON.parse(bruto) : null;
    } catch (e) { return null; }
  }
  function salvarFila() {
    try { localStorage.setItem(chaveFila(), JSON.stringify(fila)); } catch (e) { /* localStorage indisponível */ }
  }
  function carregarFila() {
    try {
      const bruto = localStorage.getItem(chaveFila());
      return bruto ? JSON.parse(bruto) : [];
    } catch (e) { return []; }
  }

  function construirEstadoInicial() {
    return { setupTabela: {}, partidas: {}, jornada: {}, refeicao: {}, mostrarOcultos: false };
  }

  function getSetupTabela(numero) {
    if (!estado.setupTabela[numero]) estado.setupTabela[numero] = {};
    return estado.setupTabela[numero];
  }
  function getPartidaEstado(id) {
    if (!estado.partidas[id]) estado.partidas[id] = { status: "PENDENTE", oculta: false, syncStatus: "ok" };
    return estado.partidas[id];
  }
  function getJornadaEstado(numero, tipo) {
    const chave = numero + "|" + tipo;
    if (!estado.jornada[chave]) estado.jornada[chave] = { syncStatus: "ok" };
    return estado.jornada[chave];
  }
  function getRefeicaoEstado(numero) {
    if (!estado.refeicao[numero]) estado.refeicao[numero] = { syncStatus: "ok" };
    return estado.refeicao[numero];
  }

  // ── Chamadas à API (mesmo padrão de fiscal-entrada.js) ────────────────────
  async function chamarApi(caminho, opcoes) {
    const cabecalhos = Object.assign({ "Content-Type": "application/json" }, (opcoes && opcoes.headers) || {});
    if (ctx.token) cabecalhos["Authorization"] = "Bearer " + ctx.token;
    const resposta = await fetch(API_BASE + caminho, Object.assign({}, opcoes, { headers: cabecalhos }));
    if (!resposta.ok) {
      let detalhe = "Erro ao consultar a API (" + resposta.status + ")";
      try {
        const corpo = await resposta.json();
        if (corpo && corpo.detail) detalhe = corpo.detail;
      } catch (e) { /* corpo não é JSON — mantém mensagem padrão */ }
      const erro = new Error(detalhe);
      erro.status = resposta.status;
      throw erro;
    }
    if (resposta.status === 204) return null;
    return resposta.json();
  }

  // ── Fila offline ───────────────────────────────────────────────────────────
  // Cada ação vira um item na fila: {id, tipo, metodo, caminho, corpo, status,
  // erroMsg, refTipo, refChave}. status: 'pendente' (aguardando rede ou nova
  // tentativa) | 'enviando' | 'erro' (o servidor respondeu com 4xx/5xx —
  // problema real, não adianta reenviar sozinho). Falha de rede mantém
  // 'pendente' pra reenviar automaticamente quando a conexão voltar.
  function contarPendentes() {
    return fila.filter(function (i) { return i.status === "pendente" || i.status === "enviando"; }).length;
  }

  function enfileirarAcao(item) {
    const acao = Object.assign({ id: gerarUuid(), criado_em: new Date().toISOString(), status: "pendente", erroMsg: null }, item);
    fila.push(acao);
    salvarFila();
    atualizarBadgeSync();
    if (navigator.onLine) tentarEnviarItem(acao.id);
    return acao;
  }

  function marcarSincronizado(item) {
    const mapa = item.refTipo === "partida" ? estado.partidas : item.refTipo === "jornada" ? estado.jornada : item.refTipo === "refeicao" ? estado.refeicao : null;
    if (mapa && mapa[item.refChave]) { mapa[item.refChave].syncStatus = "ok"; mapa[item.refChave].erroMsg = null; }
  }
  function marcarErro(item) {
    const mapa = item.refTipo === "partida" ? estado.partidas : item.refTipo === "jornada" ? estado.jornada : item.refTipo === "refeicao" ? estado.refeicao : null;
    if (mapa && mapa[item.refChave]) { mapa[item.refChave].syncStatus = "erro"; mapa[item.refChave].erroMsg = item.erroMsg; }
  }

  async function tentarEnviarItem(id) {
    const item = fila.find(function (i) { return i.id === id; });
    if (!item || item.status === "enviando") return;
    item.status = "enviando";
    atualizarBadgeSync();
    try {
      await chamarApi(item.caminho, { method: item.metodo, body: JSON.stringify(item.corpo) });
      fila = fila.filter(function (i) { return i.id !== id; });
      marcarSincronizado(item);
      salvarFila();
      salvarEstado();
      atualizarBadgeSync();
      rerenderizarTelaAtual();
    } catch (erro) {
      if (typeof erro.status === "number") {
        item.status = "erro";
        item.erroMsg = erro.message;
        marcarErro(item);
      } else {
        item.status = "pendente"; // falha de rede — tenta de novo depois
      }
      salvarFila();
      salvarEstado();
      atualizarBadgeSync();
      rerenderizarTelaAtual();
    }
  }

  async function processarFila() {
    if (enviandoFila) return;
    enviandoFila = true;
    try {
      const pendentes = fila.filter(function (i) { return i.status === "pendente"; }).map(function (i) { return i.id; });
      for (const id of pendentes) {
        await tentarEnviarItem(id);
      }
    } finally {
      enviandoFila = false;
    }
  }

  window.addEventListener("online", function () { if (ctx) processarFila(); });

  function atualizarBadgeSync() {
    const btn = document.getElementById("fa-btn-sync");
    if (!btn) return;
    const n = contarPendentes();
    btn.classList.toggle("fa-sync-pendente", n > 0);
    const label = btn.querySelector(".fa-sync-label");
    if (label) label.textContent = n > 0 ? "Sincronizar (" + n + ")" : "Sincronizar";
  }

  function rerenderizarTelaAtual() {
    atualizarBadgeSync();
    if (telaAtual === "inicio") atualizarListaInicio();
    else if (telaAtual === "fim") atualizarListaFim();
    else if (telaAtual === "viagens") { atualizarListaViagens(); atualizarCardOperacoes(); }
    else if (telaAtual === "refeicao") atualizarListaRefeicao();
  }

  // ── Layout raiz + navegação ─────────────────────────────────────────────────
  function montarLayout() {
    root.innerHTML =
      '<div class="fa-tela" id="fa-conteudo"></div>' +
      '<nav class="fa-nav" id="fa-nav">' +
      navItem("inicio", "Início", ICONES.inicio) +
      navItem("fim", "Fim", ICONES.fim) +
      navItem("refeicao", "Refeição", ICONES.refeicao) +
      navItem("viagens", "Viagens", ICONES.viagens) +
      navItem("menu", "Menu", ICONES.menu) +
      "</nav>";
  }
  function navItem(tela, rotulo, icone) {
    return '<button type="button" class="fa-nav-item" data-acao="nav" data-tela="' + tela + '">' + icone + "<span>" + rotulo + "</span></button>";
  }

  function navegarPara(tela, semHistorico) {
    if (!semHistorico && telaAtual && telaAtual !== tela) pilha.push(telaAtual);
    telaAtual = tela;
    atualizarNavAtiva();
    if (tela === "inicio") renderInicio();
    else if (tela === "fim") renderFim();
    else if (tela === "refeicao") renderRefeicao();
    else if (tela === "viagens") renderViagens();
    else if (tela === "menu") renderMenu();
    window.scrollTo(0, 0);
  }
  function atualizarNavAtiva() {
    document.querySelectorAll(".fa-nav-item").forEach(function (btn) {
      btn.classList.toggle("fa-ativo", btn.dataset.tela === telaAtual);
    });
  }
  function voltar() {
    const anterior = pilha.pop();
    navegarPara(anterior || "inicio", true);
  }
  // Início é a única tela cujo ← sai do app do fiscal de volta pra escolha de
  // terminal (fiscal-entrada.js) — as outras telas voltam entre si (pilha).
  function voltarParaEntrada() {
    if (!confirm("Voltar para a escolha de terminal? O turno continua aberto.")) return;
    root.hidden = true;
    const telaTerminal = document.getElementById("tela-terminal");
    if (telaTerminal) telaTerminal.hidden = false;
  }

  function htmlHeader(titulo, opcoes) {
    opcoes = opcoes || {};
    const btnVoltar = '<button type="button" class="fa-voltar" data-acao="' + (opcoes.voltarEntrada ? "voltar-entrada" : "voltar") + '" aria-label="Voltar">←</button>';
    return '<div class="fa-header">' + btnVoltar + "<h1>" + escaparHtml(titulo) + "</h1>" + (opcoes.acaoDireita || "") + "</div>";
  }

  function filtroTexto(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim().toLowerCase() : "";
  }
  function tabelaCombinaBusca(numero, termo) {
    if (!termo) return true;
    const setup = getSetupTabela(numero);
    const alvo = [String(numero), setup.motorista_re, setup.motorista_nome, setup.cobrador_re, setup.cobrador_nome]
      .filter(Boolean).join(" ").toLowerCase();
    return alvo.indexOf(termo) !== -1;
  }

  // ── Bottom sheet genérico ─────────────────────────────────────────────────
  function abrirSheet(innerHtml, aposMontar) {
    fecharSheetAtual();
    const overlay = document.createElement("div");
    overlay.className = "fa-sheet-overlay";
    overlay.id = "fa-sheet-overlay";
    overlay.innerHTML = '<div class="fa-sheet"><div class="fa-sheet-alca"></div>' + innerHtml + "</div>";
    overlay.addEventListener("click", function (ev) {
      if (ev.target === overlay || ev.target.closest('[data-acao="sheet-fechar"]')) fecharSheetAtual();
    });
    document.body.appendChild(overlay);
    if (aposMontar) aposMontar(overlay);
    return overlay;
  }
  function fecharSheetAtual() {
    const el = document.getElementById("fa-sheet-overlay");
    if (el) el.remove();
  }

  function htmlBuscaOperador(idPrefix) {
    return (
      '<input type="text" class="fa-busca" id="' + idPrefix + '-input" placeholder="Buscar por chapa ou nome...">' +
      '<div class="fa-resultado-busca" id="' + idPrefix + '-resultados"></div>'
    );
  }
  function wireBuscaOperador(overlay, idPrefix, tipoFiltro, aoSelecionar) {
    const input = overlay.querySelector("#" + idPrefix + "-input");
    const resultados = overlay.querySelector("#" + idPrefix + "-resultados");
    input.addEventListener("input", function () {
      clearTimeout(debounceBusca);
      const termo = input.value.trim();
      if (termo.length < 2) { resultados.innerHTML = ""; return; }
      debounceBusca = setTimeout(async function () {
        try {
          const lista = await chamarApi("/operadores/busca?q=" + encodeURIComponent(termo));
          const filtrada = tipoFiltro ? lista.filter(function (o) { return o.tipo === tipoFiltro; }) : lista;
          resultados.innerHTML = filtrada.map(function (o) {
            return (
              '<button type="button" class="fa-resultado-item" data-re="' + escaparHtml(o.re) + '" data-nome="' + escaparHtml(o.nome) + '" data-tipo="' + o.tipo + '">' +
              '<span><span class="fa-resultado-nome">' + escaparHtml(o.nome) + '</span><br><span class="fa-resultado-chapa">' + escaparHtml(o.re) + '</span></span>' +
              '<span class="fa-resultado-tipo">' + o.tipo + "</span></button>"
            );
          }).join("") || '<div class="fa-vazio">Nenhum colaborador encontrado.</div>';
          resultados.querySelectorAll("[data-re]").forEach(function (btn) {
            btn.addEventListener("click", function () {
              aoSelecionar({ re: btn.dataset.re, nome: btn.dataset.nome, tipo: btn.dataset.tipo });
            });
          });
        } catch (e) {
          resultados.innerHTML = '<div class="fa-vazio">Falha ao buscar. Verifique a conexão.</div>';
        }
      }, 300);
    });
  }

  // ── Cartões de operador (chapa clicável / somente leitura) ────────────────
  function campoOperadorHtml(numero, tipo, re, nome) {
    const acao = tipo === "MOTORISTA" ? "abrir-motorista" : "abrir-cobrador";
    const rotulo = tipo === "MOTORISTA" ? "Motorista" : "Cobrador";
    return (
      '<div class="fa-campo-operador' + (re ? "" : " fa-vazio-campo") + '" data-acao="' + acao + '" data-tabela="' + numero + '"' +
      (nome ? ' title="' + escaparHtml(nome) + '"' : "") + '>' +
      '<div class="fa-operador-chapa' + (re ? "" : " fa-placeholder") + '">' + escaparHtml(re || "Selecionar") + "</div>" +
      '<div class="fa-operador-rotulo">' + rotulo + "</div></div>"
    );
  }
  function campoOperadorSomenteLeitura(rotulo, re) {
    return (
      '<div class="fa-campo-operador" style="cursor:default">' +
      '<div class="fa-operador-chapa' + (re ? "" : " fa-placeholder") + '">' + escaparHtml(re || "—") + "</div>" +
      '<div class="fa-operador-rotulo">' + rotulo + "</div></div>"
    );
  }

  // Cartão compartilhado por Início (modo 'entrada') e Fim (modo 'saida') —
  // mesmo layout visual, só troca o rótulo/campo de horário e se a dupla é
  // editável (Início) ou somente leitura (Fim, já travada pela tela Início).
  function htmlCardJornada(numero, partidaRef, modo) {
    const setup = getSetupTabela(numero);
    const jm = estado.jornada[numero + "|MOTORISTA"] || {};
    const jc = estado.jornada[numero + "|COBRADOR"] || {};
    const campo = modo === "entrada" ? "horario_entrada" : "horario_saida";
    const rotuloCampo = modo === "entrada" ? "Entrada" : "Saída";
    const passada = minutosDoHorario(partidaRef.horario) < minutosAgora();
    return (
      '<div class="fa-card' + (passada ? " fa-card-passada" : "") + '">' +
      '<div class="fa-card-topo"><div class="fa-horario-grande">' + partidaRef.horario.slice(0, 5) + "</div>" +
      (modo === "entrada"
        ? '<button type="button" class="fa-btn-veiculo' + (setup.prefixo_carro ? " fa-preenchido" : "") + '" data-acao="abrir-veiculo" data-tabela="' + numero + '">' + escaparHtml(setup.prefixo_carro || "Veículo") + "</button>"
        : '<div class="fa-btn-veiculo' + (setup.prefixo_carro ? " fa-preenchido" : "") + '" style="pointer-events:none">' + escaparHtml(setup.prefixo_carro || "—") + "</div>") +
      "</div>" +
      '<div class="fa-linha-tabela"><div><span class="fa-rotulo">LINHA</span>' + escaparHtml(ctx.turno.linha_codigo) + "</div>" +
      '<div><span class="fa-rotulo">TABELA</span>' + numero + "</div></div>" +
      '<div class="fa-dupla-row">' +
      (modo === "entrada"
        ? campoOperadorHtml(numero, "MOTORISTA", setup.motorista_re, setup.motorista_nome) + campoOperadorHtml(numero, "COBRADOR", setup.cobrador_re, setup.cobrador_nome)
        : campoOperadorSomenteLeitura("Motorista", setup.motorista_re) + campoOperadorSomenteLeitura("Cobrador", setup.cobrador_re)) +
      "</div>" +
      '<div class="fa-horario-row">' +
      '<div class="fa-campo-time"><label>' + rotuloCampo + ' motorista</label><input type="time" data-campo="jornada-' + modo + '" data-tipo="MOTORISTA" data-tabela="' + numero + '" value="' + (jm[campo] || "") + '"' + (setup.motorista_re ? "" : " disabled") + "></div>" +
      '<div class="fa-campo-time"><label>' + rotuloCampo + ' cobrador</label><input type="time" data-campo="jornada-' + modo + '" data-tipo="COBRADOR" data-tabela="' + numero + '" value="' + (jc[campo] || "") + '"' + (setup.cobrador_re ? "" : " disabled") + "></div>" +
      "</div></div>"
    );
  }

  function primeiraPartidaId(numero) {
    const t = ctx.partidasPorTabela.find(function (x) { return x.tabela === numero; });
    return t && t.partidas[0] ? t.partidas[0].id : null;
  }

  // ── Ação compartilhada: upsert do "setup" da tabela (veículo/dupla) ────────
  // Grava sempre na PRIMEIRA partida programada da tabela, com status PENDENTE
  // (ou o status atual, se já tiver sido confirmada/perdida) — ver Contexto no
  // plano: reaproveita RegistroPartida como log "última linha vence".
  function salvarEstadoEEnfileirarSetup(numero, motivoTroca) {
    const setup = getSetupTabela(numero);
    const partidaId = primeiraPartidaId(numero);
    if (!partidaId) { salvarEstado(); rerenderizarTelaAtual(); return; }
    const est = getPartidaEstado(partidaId);
    const statusAtual = est.status === "REALIZADA" || est.status === "PERDIDA" ? est.status : "PENDENTE";
    est.syncStatus = "pendente";
    if (motivoTroca) est.motivo_troca_operador = motivoTroca;
    salvarEstado();
    rerenderizarTelaAtual();

    const primeira = ctx.partidasPorTabela.find(function (x) { return x.tabela === numero; }).partidas[0];
    enfileirarAcao({
      tipo: "partida_setup",
      metodo: "POST",
      caminho: "/turno/" + ctx.turno.id + "/partida",
      corpo: {
        partida_programada_id: partidaId,
        numero_tabela: numero,
        horario_programado: primeira.horario,
        terminal: ctx.turno.terminal,
        prefixo_carro: setup.prefixo_carro || null,
        motorista_re: setup.motorista_re || null,
        cobrador_re: setup.cobrador_re || null,
        status: statusAtual,
        motivo_troca_operador: motivoTroca || null,
        idempotency_key: gerarUuid(),
      },
      refTipo: "partida",
      refChave: partidaId,
    });
  }

  function abrirSheetVeiculo(numero) {
    const setup = getSetupTabela(numero);
    const conteudo =
      "<h2>Veículo</h2>" +
      '<p class="fa-sheet-sub">Tabela ' + numero + "</p>" +
      '<label class="fa-campo-label">Prefixo do carro</label>' +
      '<input type="text" id="fa-sheet-prefixo" inputmode="numeric" placeholder="Ex: 12345" value="' + escaparHtml(setup.prefixo_carro || "") + '">' +
      '<div class="fa-sheet-acoes">' +
      '<button type="button" class="fa-btn-cancelar" data-acao="sheet-fechar">Cancelar</button>' +
      '<button type="button" class="fa-btn-ok-verde" id="fa-sheet-ok">Salvar</button>' +
      "</div>";
    abrirSheet(conteudo, function (overlay) {
      const input = overlay.querySelector("#fa-sheet-prefixo");
      input.focus();
      overlay.querySelector("#fa-sheet-ok").addEventListener("click", function () {
        const valor = input.value.trim();
        fecharSheetAtual();
        if (!valor) return;
        setup.prefixo_carro = valor;
        salvarEstadoEEnfileirarSetup(numero, null);
      });
    });
  }

  function abrirSheetMotivoTroca(aoConfirmar) {
    const conteudo =
      "<h2>Troca de operador</h2>" +
      '<p class="fa-sheet-sub">A dupla desta tabela já foi registrada. Justifique a troca.</p>' +
      '<textarea id="fa-sheet-motivo-troca" placeholder="Ex: motorista escalado faltou, substituído por..."></textarea>' +
      '<p class="fa-sheet-erro" id="fa-sheet-erro" hidden></p>' +
      '<div class="fa-sheet-acoes">' +
      '<button type="button" class="fa-btn-cancelar" data-acao="sheet-fechar">Cancelar</button>' +
      '<button type="button" class="fa-btn-ok-verde" id="fa-sheet-ok">Confirmar troca</button>' +
      "</div>";
    abrirSheet(conteudo, function (overlay) {
      overlay.querySelector("#fa-sheet-ok").addEventListener("click", function () {
        const texto = overlay.querySelector("#fa-sheet-motivo-troca").value.trim();
        if (!texto) {
          const erroEl = overlay.querySelector("#fa-sheet-erro");
          erroEl.textContent = "Descreva o motivo da troca.";
          erroEl.hidden = false;
          return;
        }
        fecharSheetAtual();
        aoConfirmar(texto);
      });
    });
  }

  function abrirSheetSelecionarOperador(numero, tipo) {
    const rotulo = tipo === "MOTORISTA" ? "motorista" : "cobrador";
    const conteudo =
      "<h2>Selecionar " + rotulo + "</h2>" +
      '<p class="fa-sheet-sub">Tabela ' + numero + "</p>" +
      htmlBuscaOperador("fa-op") +
      '<div class="fa-sheet-acoes"><button type="button" class="fa-btn-cancelar" data-acao="sheet-fechar">Cancelar</button></div>';
    abrirSheet(conteudo, function (overlay) {
      overlay.querySelector("#fa-op-input").focus();
      wireBuscaOperador(overlay, "fa-op", tipo, function (op) {
        fecharSheetAtual();
        aplicarSelecaoOperador(numero, tipo, op);
      });
    });
  }

  function aplicarSelecaoOperador(numero, tipo, op) {
    const setup = getSetupTabela(numero);
    const campoRe = tipo === "MOTORISTA" ? "motorista_re" : "cobrador_re";
    const campoNome = tipo === "MOTORISTA" ? "motorista_nome" : "cobrador_nome";
    const valorAnterior = setup[campoRe];

    if (valorAnterior && valorAnterior !== op.re) {
      abrirSheetMotivoTroca(function (motivo) {
        setup[campoRe] = op.re;
        setup[campoNome] = op.nome;
        salvarEstadoEEnfileirarSetup(numero, motivo);
      });
      return;
    }
    setup[campoRe] = op.re;
    setup[campoNome] = op.nome;
    salvarEstadoEEnfileirarSetup(numero, null);
  }

  // ── Campos de horário (jornada entrada/saída, refeição início/fim) ────────
  function aoMudarCampoTempo(inputEl) {
    const campo = inputEl.dataset.campo;
    const numero = parseInt(inputEl.dataset.tabela, 10);
    const valor = inputEl.value;
    if (!valor) return;

    if (campo === "jornada-entrada" || campo === "jornada-saida") {
      const tipo = inputEl.dataset.tipo;
      const setup = getSetupTabela(numero);
      const operadorRe = tipo === "MOTORISTA" ? setup.motorista_re : setup.cobrador_re;
      if (!operadorRe) return;
      const chave = numero + "|" + tipo;
      const est = getJornadaEstado(numero, tipo);
      est.operador_re = operadorRe;
      est.syncStatus = "pendente";
      if (campo === "jornada-entrada") est.horario_entrada = valor; else est.horario_saida = valor;
      salvarEstado();
      if (campo === "jornada-entrada") {
        enfileirarAcao({
          tipo: "jornada_entrada", metodo: "POST", caminho: "/turno/" + ctx.turno.id + "/jornada",
          corpo: { numero_tabela: numero, operador_re: operadorRe, tipo: tipo, horario_entrada: valor + ":00", origem: "MANUAL" },
          refTipo: "jornada", refChave: chave,
        });
      } else {
        enfileirarAcao({
          tipo: "jornada_saida", metodo: "PATCH", caminho: "/turno/" + ctx.turno.id + "/jornada",
          corpo: { numero_tabela: numero, operador_re: operadorRe, tipo: tipo, horario_saida: valor + ":00" },
          refTipo: "jornada", refChave: chave,
        });
      }
    } else if (campo === "refeicao-inicio" || campo === "refeicao-fim") {
      const setup = getSetupTabela(numero);
      const est = getRefeicaoEstado(numero);
      est.syncStatus = "pendente";
      if (campo === "refeicao-inicio") {
        est.horario_inicio = valor;
        salvarEstado();
        enfileirarAcao({
          tipo: "refeicao_inicio", metodo: "POST", caminho: "/turno/" + ctx.turno.id + "/refeicao",
          corpo: { numero_tabela: numero, motorista_re: setup.motorista_re || null, cobrador_re: setup.cobrador_re || null, horario_inicio: valor + ":00" },
          refTipo: "refeicao", refChave: numero,
        });
      } else {
        est.horario_fim = valor;
        salvarEstado();
        enfileirarAcao({
          tipo: "refeicao_fim", metodo: "PATCH", caminho: "/turno/" + ctx.turno.id + "/refeicao",
          corpo: { numero_tabela: numero, horario_fim: valor + ":00" },
          refTipo: "refeicao", refChave: numero,
        });
      }
    }
  }

  // ── Tela Início ─────────────────────────────────────────────────────────────
  function renderInicio() {
    const cont = document.getElementById("fa-conteudo");
    cont.innerHTML =
      htmlHeader("Início", { voltarEntrada: true }) +
      '<div class="fa-busca-wrap"><input type="text" class="fa-busca" id="fa-busca-inicio" placeholder="Pesquisar Colaborador..."></div>' +
      '<div class="fa-data">' + formatarData(ctx.turno.data) + '</div>' +
      '<div class="fa-lista" id="fa-lista"></div>';
    atualizarListaInicio();
  }
  function tabelasOrdenadasParaInicio() {
    const nowMin = minutosAgora();
    const lista = ctx.partidasPorTabela.map(function (t) { return { numero: t.tabela, primeira: t.partidas[0] }; }).filter(function (t) { return t.primeira; });
    lista.sort(function (a, b) {
      const ma = minutosDoHorario(a.primeira.horario), mb = minutosDoHorario(b.primeira.horario);
      const fa = ma >= nowMin ? 0 : 1, fb = mb >= nowMin ? 0 : 1;
      if (fa !== fb) return fa - fb;
      return ma - mb;
    });
    return lista;
  }
  function atualizarListaInicio() {
    const listaEl = document.getElementById("fa-lista");
    if (!listaEl) return;
    const termo = filtroTexto("fa-busca-inicio");
    const itens = tabelasOrdenadasParaInicio().filter(function (t) { return tabelaCombinaBusca(t.numero, termo); });
    listaEl.innerHTML = itens.length
      ? itens.map(function (t) { return htmlCardJornada(t.numero, t.primeira, "entrada"); }).join("")
      : '<div class="fa-vazio">Nenhuma tabela encontrada.</div>';
  }

  // ── Tela Fim ────────────────────────────────────────────────────────────────
  function renderFim() {
    const cont = document.getElementById("fa-conteudo");
    cont.innerHTML =
      htmlHeader("Fim") +
      '<div class="fa-busca-wrap"><input type="text" class="fa-busca" id="fa-busca-fim" placeholder="Pesquisar Colaborador..."></div>' +
      '<div class="fa-data">' + formatarData(ctx.turno.data) + '</div>' +
      '<div class="fa-lista" id="fa-lista"></div>';
    atualizarListaFim();
  }
  function tabelasOrdenadasParaFim() {
    const nowMin = minutosAgora();
    const lista = ctx.partidasPorTabela.map(function (t) { return { numero: t.tabela, ultima: t.partidas[t.partidas.length - 1] }; }).filter(function (t) { return t.ultima; });
    lista.sort(function (a, b) {
      const ma = minutosDoHorario(a.ultima.horario), mb = minutosDoHorario(b.ultima.horario);
      const fa = ma >= nowMin ? 0 : 1, fb = mb >= nowMin ? 0 : 1;
      if (fa !== fb) return fa - fb;
      return ma - mb;
    });
    return lista;
  }
  function atualizarListaFim() {
    const listaEl = document.getElementById("fa-lista");
    if (!listaEl) return;
    const termo = filtroTexto("fa-busca-fim");
    const itens = tabelasOrdenadasParaFim().filter(function (t) { return tabelaCombinaBusca(t.numero, termo); });
    listaEl.innerHTML = itens.length
      ? itens.map(function (t) { return htmlCardJornada(t.numero, t.ultima, "saida"); }).join("")
      : '<div class="fa-vazio">Nenhuma tabela encontrada.</div>';
  }

  // ── Tela Refeição ───────────────────────────────────────────────────────────
  function renderRefeicao() {
    const cont = document.getElementById("fa-conteudo");
    cont.innerHTML =
      htmlHeader("Refeição") +
      '<div class="fa-busca-wrap"><input type="text" class="fa-busca" id="fa-busca-refeicao" placeholder="Pesquisar Colaborador..."></div>' +
      '<div class="fa-data">' + formatarData(ctx.turno.data) + '</div>' +
      '<div class="fa-lista" id="fa-lista"></div>';
    atualizarListaRefeicao();
  }
  function htmlCardRefeicao(numero) {
    const setup = getSetupTabela(numero);
    const ref = estado.refeicao[numero] || {};
    return (
      '<div class="fa-card">' +
      '<div class="fa-linha-tabela" style="margin-top:0;border-top:none;padding-top:0">' +
      '<div><span class="fa-rotulo">LINHA</span>' + escaparHtml(ctx.turno.linha_codigo) + "</div>" +
      '<div><span class="fa-rotulo">TABELA</span>' + numero + "</div></div>" +
      '<div class="fa-dupla-row">' + campoOperadorSomenteLeitura("Motorista", setup.motorista_re) + campoOperadorSomenteLeitura("Cobrador", setup.cobrador_re) + "</div>" +
      '<div class="fa-horario-row">' +
      '<div class="fa-campo-time"><label>Início refeição</label><input type="time" data-campo="refeicao-inicio" data-tabela="' + numero + '" value="' + (ref.horario_inicio || "") + '"></div>' +
      '<div class="fa-campo-time"><label>Fim refeição</label><input type="time" data-campo="refeicao-fim" data-tabela="' + numero + '" value="' + (ref.horario_fim || "") + '"></div>' +
      "</div></div>"
    );
  }
  function atualizarListaRefeicao() {
    const listaEl = document.getElementById("fa-lista");
    if (!listaEl) return;
    const termo = filtroTexto("fa-busca-refeicao");
    const numeros = ctx.partidasPorTabela.map(function (t) { return t.tabela; }).filter(function (n) { return tabelaCombinaBusca(n, termo); });
    listaEl.innerHTML = numeros.length ? numeros.map(htmlCardRefeicao).join("") : '<div class="fa-vazio">Nenhuma tabela encontrada.</div>';
  }

  // ── Tela Viagens ────────────────────────────────────────────────────────────
  // Estado interno já pensado como array de linhas ativas (hoje só 1 elemento)
  // pra tornar trivial adicionar a 2ª linha em pontos finais com mais de uma
  // linha, quando essa lista for informada — ver Contexto no plano.
  function linhasAtivas() {
    return [{ codigo: ctx.turno.linha_codigo, terminal: ctx.turno.terminal }];
  }

  function todasPartidasOrdenadas() {
    const lista = [];
    ctx.partidasPorTabela.forEach(function (t) {
      t.partidas.forEach(function (p, idx) {
        lista.push({ numero: t.tabela, partida: p, indice: idx + 1 });
      });
    });
    lista.sort(function (a, b) { return minutosDoHorario(a.partida.horario) - minutosDoHorario(b.partida.horario); });
    return lista;
  }
  function localizarItem(partidaId) {
    for (const t of ctx.partidasPorTabela) {
      const idx = t.partidas.findIndex(function (p) { return p.id === partidaId; });
      if (idx !== -1) return { numero: t.tabela, partida: t.partidas[idx], indice: idx + 1 };
    }
    return null;
  }
  function proximaPartidaPendente() {
    const nowMin = minutosAgora();
    const todas = todasPartidasOrdenadas();
    return todas.find(function (item) { return getPartidaEstado(item.partida.id).status === "PENDENTE" && minutosDoHorario(item.partida.horario) >= nowMin; })
      || todas.find(function (item) { return getPartidaEstado(item.partida.id).status === "PENDENTE"; });
  }

  function renderViagens() {
    const cont = document.getElementById("fa-conteudo");
    const pendentes = contarPendentes();
    const btnSync =
      '<button type="button" class="fa-btn-sync' + (pendentes ? " fa-sync-pendente" : "") + '" id="fa-btn-sync" data-acao="sincronizar">' +
      ICONES.sync + '<span class="fa-sync-label">' + (pendentes ? "Sincronizar (" + pendentes + ")" : "Sincronizar") + "</span></button>";
    cont.innerHTML =
      htmlHeader("Viagens", { acaoDireita: btnSync }) +
      '<div id="fa-card-operacoes"></div>' +
      '<div class="fa-busca-wrap"><input type="text" class="fa-busca" id="fa-busca-viagens" placeholder="Pesquisar tabela..."></div>' +
      '<label style="display:flex;align-items:center;gap:6px;color:#a3a3a3;font-size:11px;margin-bottom:10px">' +
      '<input type="checkbox" id="fa-toggle-ocultos"' + (estado.mostrarOcultos ? " checked" : "") + "> Mostrar ocultos</label>" +
      '<div class="fa-lista" id="fa-lista"></div>';
    atualizarCardOperacoes();
    atualizarListaViagens();
  }

  function atualizarCardOperacoes() {
    const el = document.getElementById("fa-card-operacoes");
    if (!el) return;
    const linhas = linhasAtivas();
    const nTabelas = ctx.partidasPorTabela.length;
    const proxima = proximaPartidaPendente();
    const nomeTerminal = NOME_TERMINAL[ctx.turno.terminal] || ctx.turno.terminal;
    const codigosLinhas = linhas.map(function (l) { return l.codigo; }).join(" - ");
    el.innerHTML =
      '<div class="fa-card-operacoes' + (operacoesExpandido ? " fa-aberto" : "") + '" data-acao="expandir-operacoes">' +
      '<div class="fa-operacoes-topo"><span class="fa-operacoes-titulo">OPERAÇÕES EM ANDAMENTO</span><span class="fa-operacoes-chevron">' + ICONES.chevron + "</span></div>" +
      '<div class="fa-operacoes-nome">' + escaparHtml(nomeTerminal) + "</div>" +
      '<div class="fa-operacoes-linhas">' + escaparHtml(codigosLinhas) + " — " + nTabelas + " tabela" + (nTabelas === 1 ? "" : "s") + " ativa" + (nTabelas === 1 ? "" : "s") + "</div>" +
      '<div class="fa-operacoes-linhas">Próximo evento: Saída • ' + (proxima ? proxima.partida.horario.slice(0, 5) : "—") + "</div>" +
      (operacoesExpandido
        ? '<div class="fa-operacoes-detalhe">' + linhas.map(function (l) { return "Linha " + escaparHtml(l.codigo) + " — Terminal " + l.terminal; }).join("<br>") + "</div>"
        : "") +
      "</div>";
  }

  function resumoObservacao(est) {
    const linhas = [];
    if (est.motivo_perda) linhas.push("Motivo: " + escaparHtml(rotuloMotivo(est.motivo_perda)));
    if (est.motivo_ajuste_horario) linhas.push("Ajuste de horário: " + escaparHtml(est.motivo_ajuste_horario));
    if (est.motivo_troca_operador) linhas.push("Troca de operador: " + escaparHtml(est.motivo_troca_operador));
    return linhas.map(function (l) { return "<div>" + l + "</div>"; }).join("");
  }

  function htmlCardViagem(item) {
    const est = getPartidaEstado(item.partida.id);
    const setup = getSetupTabela(item.numero);
    const passada = minutosDoHorario(item.partida.horario) < minutosAgora();
    const podeAgir = est.status === "PENDENTE";
    const classesEstado = est.status === "REALIZADA" ? " fa-status-realizada" : est.status === "PERDIDA" ? " fa-status-perdida" : "";
    const classeSync = est.syncStatus === "pendente" || est.syncStatus === "enviando" ? " fa-status-sincronizando" : "";
    let badge = "";
    if (est.status === "REALIZADA") badge += '<span class="fa-badge fa-badge-realizada">Realizada</span> ';
    else if (est.status === "PERDIDA") badge += '<span class="fa-badge fa-badge-perdida">Perdida</span> ';
    if (est.syncStatus === "pendente" || est.syncStatus === "enviando") badge += '<span class="fa-badge fa-badge-pendente-sync">Pendente de sincronismo</span>';
    else if (est.syncStatus === "erro") badge += '<span class="fa-badge fa-badge-erro" title="' + escaparHtml(est.erroMsg || "") + '">Erro</span>';
    const temObservacao = est.motivo_perda || est.motivo_ajuste_horario || est.motivo_troca_operador;

    return (
      '<div class="fa-card' + classesEstado + classeSync + (passada && podeAgir ? " fa-card-passada" : "") + '">' +
      '<div class="fa-viagem-topo">' +
      '<button type="button" class="fa-icone-btn" data-acao="ocultar" data-partida="' + item.partida.id + '" aria-label="Ocultar">' + (est.oculta ? ICONES.olhoCortado : ICONES.olho) + "</button>" +
      (badge ? "<div>" + badge + "</div>" : "<div></div>") +
      '<button type="button" class="fa-icone-btn" data-acao="info" data-partida="' + item.partida.id + '" aria-label="Observações">' + ICONES.info + "</button>" +
      "</div>" +
      '<div class="fa-viagem-cols"><span>Linha <b>' + escaparHtml(ctx.turno.linha_codigo) + "</b></span>" +
      "<span>Tabela <b>" + item.numero + "</b></span>" +
      "<span>Veículo <b>" + escaparHtml(setup.prefixo_carro || "—") + "</b></span></div>" +
      '<div class="fa-viagem-meio"><span class="fa-viagem-label">Saída ' + item.indice + '</span><span class="fa-viagem-horario">' + item.partida.horario.slice(0, 5) + "</span></div>" +
      (podeAgir
        ? '<div class="fa-viagem-acoes">' +
          '<button type="button" class="fa-btn-perdida" data-acao="perdida" data-partida="' + item.partida.id + '">Perdida</button>' +
          '<button type="button" class="fa-btn-confirmar" data-acao="confirmar" data-partida="' + item.partida.id + '">Confirmar</button>' +
          "</div>"
        : "") +
      (temObservacao ? '<div class="fa-observacoes">' + resumoObservacao(est) + "</div>" : "") +
      "</div>"
    );
  }

  function atualizarListaViagens() {
    const listaEl = document.getElementById("fa-lista");
    if (!listaEl) return;
    const termo = filtroTexto("fa-busca-viagens");
    const todas = todasPartidasOrdenadas().filter(function (item) {
      const est = getPartidaEstado(item.partida.id);
      if (est.oculta && !estado.mostrarOcultos) return false;
      if (!termo) return true;
      return String(item.numero).indexOf(termo) !== -1;
    });
    listaEl.innerHTML = todas.length ? todas.map(htmlCardViagem).join("") : '<div class="fa-vazio">Nenhuma viagem encontrada.</div>';
  }

  function motivoBtnHtml(m) {
    return '<button type="button" class="fa-motivo-btn" data-motivo="' + m.valor + '"><div class="fa-motivo-titulo">' + escaparHtml(m.titulo) + '</div><div class="fa-motivo-desc">' + escaparHtml(m.desc) + "</div></button>";
  }

  function confirmarViagem(item, horarioReal, motivoAjuste) {
    const setup = getSetupTabela(item.numero);
    const est = getPartidaEstado(item.partida.id);
    est.status = "REALIZADA";
    est.horario_real = horarioReal;
    est.motivo_ajuste_horario = motivoAjuste || null;
    est.syncStatus = "pendente";
    salvarEstado();
    rerenderizarTelaAtual();
    enfileirarAcao({
      tipo: "partida_confirmar",
      metodo: "POST",
      caminho: "/turno/" + ctx.turno.id + "/partida",
      corpo: {
        partida_programada_id: item.partida.id,
        numero_tabela: item.numero,
        horario_programado: item.partida.horario,
        terminal: ctx.turno.terminal,
        prefixo_carro: setup.prefixo_carro || null,
        motorista_re: setup.motorista_re || null,
        cobrador_re: setup.cobrador_re || null,
        status: "REALIZADA",
        horario_real: horarioReal,
        motivo_ajuste_horario: motivoAjuste || null,
        idempotency_key: gerarUuid(),
      },
      refTipo: "partida",
      refChave: item.partida.id,
    });
  }

  function abrirSheetConfirmar(partidaId) {
    const item = localizarItem(partidaId);
    if (!item) return;
    const setup = getSetupTabela(item.numero);
    if (item.indice === 1 && (!setup.motorista_re || !setup.cobrador_re)) {
      alert("Defina o veículo e a dupla desta tabela na tela Início antes de confirmar a primeira viagem.");
      return;
    }
    const horarioInicial = horaAtualHHMM();
    const conteudo =
      "<h2>Confirmar viagem</h2>" +
      '<p class="fa-sheet-sub">Tabela ' + item.numero + " — programado " + item.partida.horario.slice(0, 5) + "</p>" +
      '<label class="fa-campo-label">Horário real</label>' +
      '<input type="time" id="fa-sheet-horario" value="' + horarioInicial + '">' +
      '<div id="fa-sheet-motivo-wrap" hidden>' +
      '<label class="fa-campo-label">Motivo do ajuste</label>' +
      '<div class="fa-motivos-grid" id="fa-sheet-motivos">' + MOTIVOS_PERDA.map(motivoBtnHtml).join("") + "</div>" +
      '<label class="fa-campo-label">Detalhe (opcional)</label>' +
      '<textarea id="fa-sheet-motivo-texto" placeholder="Descreva rapidamente..."></textarea>' +
      "</div>" +
      '<p class="fa-sheet-erro" id="fa-sheet-erro" hidden></p>' +
      '<div class="fa-sheet-acoes">' +
      '<button type="button" class="fa-btn-cancelar" data-acao="sheet-fechar">Cancelar</button>' +
      '<button type="button" class="fa-btn-ok-verde" id="fa-sheet-ok">Confirmar</button>' +
      "</div>";

    let motivoSelecionado = null;
    abrirSheet(conteudo, function (overlay) {
      const inputHorario = overlay.querySelector("#fa-sheet-horario");
      const wrapMotivo = overlay.querySelector("#fa-sheet-motivo-wrap");
      const erroEl = overlay.querySelector("#fa-sheet-erro");

      // Justificativa só é exigida se o FISCAL editar o horário pré-preenchido
      // (agora), não sempre que "agora" difere do programado — isso aconteceria
      // em quase toda confirmação e tornaria o motivo obrigatório o tempo todo.
      function horarioMudou() { return inputHorario.value && inputHorario.value !== horarioInicial; }
      function atualizarVisibilidadeMotivo() { wrapMotivo.hidden = !horarioMudou(); }
      inputHorario.addEventListener("input", atualizarVisibilidadeMotivo);
      atualizarVisibilidadeMotivo();

      overlay.querySelectorAll("[data-motivo]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          motivoSelecionado = btn.dataset.motivo;
          overlay.querySelectorAll("[data-motivo]").forEach(function (b) { b.classList.toggle("fa-selecionado", b === btn); });
        });
      });

      overlay.querySelector("#fa-sheet-ok").addEventListener("click", function () {
        erroEl.hidden = true;
        const horario = inputHorario.value;
        if (!horario) { erroEl.textContent = "Informe o horário."; erroEl.hidden = false; return; }
        let motivoTexto = null;
        if (horarioMudou()) {
          const textoLivre = overlay.querySelector("#fa-sheet-motivo-texto").value.trim();
          if (!motivoSelecionado && !textoLivre) {
            erroEl.textContent = "Selecione um motivo ou descreva o ajuste de horário.";
            erroEl.hidden = false;
            return;
          }
          motivoTexto = (motivoSelecionado ? rotuloMotivo(motivoSelecionado) : "") + (textoLivre ? (motivoSelecionado ? " — " : "") + textoLivre : "");
        }
        fecharSheetAtual();
        confirmarViagem(item, horario + ":00", motivoTexto);
      });
    });
  }

  function marcarPerdida(item, motivo, descricao, operadorFaltante) {
    const setup = getSetupTabela(item.numero);
    const est = getPartidaEstado(item.partida.id);
    est.status = "PERDIDA";
    est.motivo_perda = motivo;
    est.descricao_perda = descricao || null;
    if (operadorFaltante) { est.operador_faltante_re = operadorFaltante.re; est.operador_faltante_tipo = operadorFaltante.tipo; }
    est.syncStatus = "pendente";
    salvarEstado();
    rerenderizarTelaAtual();
    enfileirarAcao({
      tipo: "partida_perdida",
      metodo: "POST",
      caminho: "/turno/" + ctx.turno.id + "/partida",
      corpo: {
        partida_programada_id: item.partida.id,
        numero_tabela: item.numero,
        horario_programado: item.partida.horario,
        terminal: ctx.turno.terminal,
        prefixo_carro: setup.prefixo_carro || null,
        motorista_re: setup.motorista_re || null,
        cobrador_re: setup.cobrador_re || null,
        status: "PERDIDA",
        motivo_perda: motivo,
        descricao_perda: descricao || null,
        operador_faltante_re: operadorFaltante ? operadorFaltante.re : null,
        // CHECK constraint em registro_partida.operador_faltante_tipo exige minúsculo ('motorista'/'cobrador')
        operador_faltante_tipo: operadorFaltante ? operadorFaltante.tipo.toLowerCase() : null,
        idempotency_key: gerarUuid(),
      },
      refTipo: "partida",
      refChave: item.partida.id,
    });
  }

  function abrirSheetPerdida(partidaId) {
    const item = localizarItem(partidaId);
    if (!item) return;
    const conteudo =
      "<h2>Marcar como perdida</h2>" +
      '<p class="fa-sheet-sub">Tabela ' + item.numero + " — programado " + item.partida.horario.slice(0, 5) + "</p>" +
      '<div class="fa-motivos-grid" id="fa-sheet-motivos">' + MOTIVOS_PERDA.map(motivoBtnHtml).join("") + "</div>" +
      '<div id="fa-sheet-operador-wrap" hidden>' +
      '<label class="fa-campo-label">Operador faltante</label>' +
      '<div id="fa-sheet-operador-selecionado" style="font-size:12px;color:#a3a3a3;margin-bottom:6px"></div>' +
      htmlBuscaOperador("fa-perdida-op") +
      "</div>" +
      '<label class="fa-campo-label">Descrição (obrigatória em "Outros")</label>' +
      '<textarea id="fa-sheet-descricao" placeholder="Descreva o que aconteceu..."></textarea>' +
      '<p class="fa-sheet-erro" id="fa-sheet-erro" hidden></p>' +
      '<div class="fa-sheet-acoes">' +
      '<button type="button" class="fa-btn-cancelar" data-acao="sheet-fechar">Cancelar</button>' +
      '<button type="button" class="fa-btn-ok-vermelho" id="fa-sheet-ok">Marcar perdida</button>' +
      "</div>";

    let motivoSelecionado = null;
    let operadorFaltante = null;
    abrirSheet(conteudo, function (overlay) {
      const wrapOperador = overlay.querySelector("#fa-sheet-operador-wrap");
      const erroEl = overlay.querySelector("#fa-sheet-erro");

      overlay.querySelectorAll("[data-motivo]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          motivoSelecionado = btn.dataset.motivo;
          operadorFaltante = null;
          overlay.querySelector("#fa-sheet-operador-selecionado").textContent = "";
          overlay.querySelectorAll("[data-motivo]").forEach(function (b) { b.classList.toggle("fa-selecionado", b === btn); });
          wrapOperador.hidden = motivoSelecionado !== "FALTA_MOTORISTA" && motivoSelecionado !== "FALTA_COBRADOR";
        });
      });

      wireBuscaOperador(overlay, "fa-perdida-op", null, function (op) {
        operadorFaltante = op;
        overlay.querySelector("#fa-sheet-operador-selecionado").textContent = "Selecionado: " + op.re + " — " + op.nome;
      });

      overlay.querySelector("#fa-sheet-ok").addEventListener("click", function () {
        erroEl.hidden = true;
        if (!motivoSelecionado) { erroEl.textContent = "Selecione um motivo."; erroEl.hidden = false; return; }
        const descricao = overlay.querySelector("#fa-sheet-descricao").value.trim();
        if (motivoSelecionado === "OUTROS" && !descricao) {
          erroEl.textContent = 'Descrição obrigatória para o motivo "Outros".';
          erroEl.hidden = false;
          return;
        }
        if ((motivoSelecionado === "FALTA_MOTORISTA" || motivoSelecionado === "FALTA_COBRADOR") && !operadorFaltante) {
          erroEl.textContent = "Selecione o operador faltante.";
          erroEl.hidden = false;
          return;
        }
        fecharSheetAtual();
        marcarPerdida(item, motivoSelecionado, descricao, operadorFaltante);
      });
    });
  }

  function abrirSheetObservacoes(partidaId) {
    const item = localizarItem(partidaId);
    if (!item) return;
    const t = ctx.partidasPorTabela.find(function (x) { return x.tabela === item.numero; });
    const linhas = [];
    t.partidas.forEach(function (p, idx) {
      const est = estado.partidas[p.id];
      if (!est) return;
      const rotulo = "Saída " + (idx + 1) + " (" + p.horario.slice(0, 5) + ")";
      if (est.motivo_perda) linhas.push(rotulo + ": perdida — " + rotuloMotivo(est.motivo_perda) + (est.descricao_perda ? " — " + est.descricao_perda : ""));
      if (est.motivo_ajuste_horario) linhas.push(rotulo + ": horário ajustado — " + est.motivo_ajuste_horario);
      if (est.motivo_troca_operador) linhas.push(rotulo + ": troca de operador — " + est.motivo_troca_operador);
    });
    const conteudo =
      "<h2>Observações — Tabela " + item.numero + "</h2>" +
      (linhas.length
        ? '<div style="display:flex;flex-direction:column;gap:8px;font-size:13px;color:#d4d4d4">' + linhas.map(function (l) { return "<div>" + escaparHtml(l) + "</div>"; }).join("") + "</div>"
        : '<p class="fa-sheet-sub">Nenhuma ocorrência registrada nesta tabela hoje.</p>') +
      '<div class="fa-sheet-acoes"><button type="button" class="fa-btn-cancelar" data-acao="sheet-fechar">Fechar</button></div>';
    abrirSheet(conteudo);
  }

  function alternarOculto(partidaId) {
    const est = getPartidaEstado(partidaId);
    est.oculta = !est.oculta;
    salvarEstado();
    rerenderizarTelaAtual();
  }

  async function acaoSincronizar() {
    const btn = document.getElementById("fa-btn-sync");
    if (btn) btn.classList.add("fa-sync-girando");
    try {
      const partidasAtualizadas = await chamarApi(
        "/escalas/partidas/" + encodeURIComponent(ctx.turno.linha_codigo) + "?tipo_dia=" + ctx.turno.tipo_dia + "&terminal=" + ctx.turno.terminal
      );
      ctx.partidasPorTabela = partidasAtualizadas;
    } catch (e) {
      // sem rede — segue só tentando esvaziar a fila
    }
    await processarFila();
    if (btn) btn.classList.remove("fa-sync-girando");
    rerenderizarTelaAtual();
  }

  // ── Tela Menu ───────────────────────────────────────────────────────────────
  function renderMenu() {
    const cont = document.getElementById("fa-conteudo");
    cont.innerHTML =
      htmlHeader("Menu") +
      '<div class="fa-menu-grid">' +
      '<div class="fa-menu-card fa-menu-perigo" data-acao="fechar-turno">Fechar turno</div>' +
      '<div class="fa-menu-card fa-menu-sair" data-acao="sair">Sair</div>' +
      '<div class="fa-menu-card fa-menu-placeholder">Módulo em breve</div>' +
      '<div class="fa-menu-card fa-menu-placeholder">Módulo em breve</div>' +
      '<div class="fa-menu-card fa-menu-placeholder">Módulo em breve</div>' +
      '<div class="fa-menu-card fa-menu-placeholder">Módulo em breve</div>' +
      "</div>";
  }

  async function acaoFecharTurno() {
    await processarFila();
    const pendentes = contarPendentes();
    if (pendentes > 0) {
      alert("Não é possível fechar o turno agora: existem " + pendentes + " ação(ões) não sincronizadas. Conecte-se à internet e tente novamente.");
      return;
    }
    if (!confirm("Fechar o turno agora? Essa ação não pode ser desfeita.")) return;
    try {
      await chamarApi("/turno/" + ctx.turno.id + "/fechar", { method: "POST", body: JSON.stringify({}) });
      localStorage.removeItem(chaveCache());
      localStorage.removeItem(chaveFila());
      alert("Turno fechado com sucesso.");
      location.reload();
    } catch (e) {
      alert("Falha ao fechar o turno: " + e.message);
    }
  }

  function acaoSair() {
    const pendentes = contarPendentes();
    const mensagem = pendentes > 0
      ? "Existem " + pendentes + " ação(ões) pendentes de sincronização. Elas continuam salvas neste aparelho e serão reenviadas no próximo login. Sair mesmo assim?"
      : "Sair do sistema?";
    if (!confirm(mensagem)) return;
    location.reload();
  }

  // ── Delegação de eventos globais (chrome persistente: nav, headers, cards) ─
  function ligarEventosGlobais() {
    root.addEventListener("click", function (ev) {
      const alvo = ev.target.closest("[data-acao]");
      if (!alvo) return;
      const acao = alvo.dataset.acao;
      if (acao === "nav") navegarPara(alvo.dataset.tela);
      else if (acao === "voltar") voltar();
      else if (acao === "voltar-entrada") voltarParaEntrada();
      else if (acao === "sincronizar") acaoSincronizar();
      else if (acao === "abrir-veiculo") abrirSheetVeiculo(parseInt(alvo.dataset.tabela, 10));
      else if (acao === "abrir-motorista") abrirSheetSelecionarOperador(parseInt(alvo.dataset.tabela, 10), "MOTORISTA");
      else if (acao === "abrir-cobrador") abrirSheetSelecionarOperador(parseInt(alvo.dataset.tabela, 10), "COBRADOR");
      else if (acao === "confirmar") abrirSheetConfirmar(alvo.dataset.partida);
      else if (acao === "perdida") abrirSheetPerdida(alvo.dataset.partida);
      else if (acao === "ocultar") alternarOculto(alvo.dataset.partida);
      else if (acao === "info") abrirSheetObservacoes(alvo.dataset.partida);
      else if (acao === "expandir-operacoes") { operacoesExpandido = !operacoesExpandido; atualizarCardOperacoes(); }
      else if (acao === "fechar-turno") acaoFecharTurno();
      else if (acao === "sair") acaoSair();
    });

    root.addEventListener("input", function (ev) {
      if (ev.target.id === "fa-busca-inicio") atualizarListaInicio();
      else if (ev.target.id === "fa-busca-fim") atualizarListaFim();
      else if (ev.target.id === "fa-busca-refeicao") atualizarListaRefeicao();
      else if (ev.target.id === "fa-busca-viagens") atualizarListaViagens();
    });

    root.addEventListener("change", function (ev) {
      if (ev.target.matches("input[data-campo]")) aoMudarCampoTempo(ev.target);
      else if (ev.target.id === "fa-toggle-ocultos") {
        estado.mostrarOcultos = ev.target.checked;
        salvarEstado();
        atualizarListaViagens();
      }
    });
  }

  // ── Ponto de entrada explícito (chamado por fiscal-entrada.js) ────────────
  window.__fiscalApp = {
    init: function (contexto) {
      ctx = contexto;
      root = document.getElementById("fiscal-app-root");
      if (!root) return;
      estado = carregarEstado() || construirEstadoInicial();
      fila = carregarFila();
      telaAtual = null;
      pilha = [];
      operacoesExpandido = false;
      root.hidden = false;
      montarLayout();
      ligarEventosGlobais();
      navegarPara("inicio", true);
      if (navigator.onLine) processarFila();
    },
  };
})();
