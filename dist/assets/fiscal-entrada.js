// fiscal-entrada.js — telas de entrada do app do Fiscal (vanilla JS, sem framework)
//
// Fluxo: login → escolher linha + período → escolher terminal (TP/TS) → abre turno
// → entrega pro app do fiscal (fiscal-app.js, vanilla), que cuida das telas
// pós-abertura de turno (Início/Fim/Refeição/Viagens/Menu).
//
// O handoff é explícito via window.__fiscalApp.init(ctx) (ver entregarParaFiscalApp
// abaixo) — leva token/fiscal/turno/partidasPorTabela. O bundle React antigo
// (index-DQKWVWsR.js) ainda existe no repositório mas não é mais montado
// (ver docs/STATUS-DEPLOY-2026-07-07.md).

(function () {
  "use strict";

  const API_BASE = "/api/v1";

  // ── Elementos ──────────────────────────────────────────────────────────────
  const telaLogin = document.getElementById("bloco-login");
  const telaLinha = document.getElementById("tela-linha");
  const telaTerminal = document.getElementById("tela-terminal");

  const formLogin = document.getElementById("form-login");
  const loginErro = document.getElementById("login-erro");
  const toggleSenha = document.getElementById("toggle-senha");
  const inputSenha = document.getElementById("login-senha");
  const apiStatusDot = document.getElementById("api-status-dot");
  const apiStatusText = document.getElementById("api-status-text");

  const formLinha = document.getElementById("form-linha");
  const selectLinha = document.getElementById("select-linha");
  const linhaErro = document.getElementById("linha-erro");
  const botoesPeriodo = document.querySelectorAll("[data-periodo]");

  const terminalResumo = document.getElementById("terminal-resumo");
  const botoesTerminal = document.querySelectorAll("[data-terminal]");
  const terminalErro = document.getElementById("terminal-erro");
  const terminalCarregando = document.getElementById("terminal-carregando");
  const btnVoltarLinha = document.getElementById("btn-voltar-linha");

  // ── Estado local (só existe em memória, não persiste — igual ao app React) ──
  let token = null;
  let fiscal = null;
  let linhaEscolhida = null; // { id, codigo, nome }
  let periodoEscolhido = null; // "MANHA" | "TARDE"

  // ── Chamadas à API ───────────────────────────────────────────────────────
  async function chamarApi(caminho, opcoes) {
    const cabecalhos = Object.assign(
      { "Content-Type": "application/json" },
      (opcoes && opcoes.headers) || {}
    );
    if (token) cabecalhos["Authorization"] = "Bearer " + token;
    const resposta = await fetch(API_BASE + caminho, Object.assign({}, opcoes, { headers: cabecalhos }));
    if (!resposta.ok) {
      let detalhe = "Erro ao consultar a API (" + resposta.status + ")";
      try {
        const corpo = await resposta.json();
        if (corpo && corpo.detail) detalhe = corpo.detail;
      } catch (e) {
        /* corpo não é JSON — mantém mensagem padrão */
      }
      const erro = new Error(detalhe);
      erro.status = resposta.status;
      throw erro;
    }
    if (resposta.status === 204) return null;
    return resposta.json();
  }

  function tipoDiaHoje() {
    const dia = new Date().getDay(); // 0 = domingo, 6 = sábado
    if (dia === 0) return "DOMINGO";
    if (dia === 6) return "SABADO";
    return "UTIL";
  }

  function dataHojeISO() {
    const d = new Date();
    const mes = String(d.getMonth() + 1).padStart(2, "0");
    const dia = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + mes + "-" + dia;
  }

  function mostrarTela(nome) {
    telaLogin.hidden = nome !== "login";
    telaLinha.hidden = nome !== "linha";
    telaTerminal.hidden = nome !== "terminal";
  }

  // ── Status do servidor ───────────────────────────────────────────────────
  (async function verificarStatusServidor() {
    if (!apiStatusDot || !apiStatusText) return;
    try {
      const r = await fetch("/api/health");
      if (!r.ok) throw new Error();
      apiStatusDot.classList.add("ok");
      apiStatusText.textContent = "Servidor online";
    } catch (e) {
      apiStatusDot.classList.add("erro");
      apiStatusText.textContent = "Servidor indisponível";
    }
  })();

  if (toggleSenha && inputSenha) {
    toggleSenha.addEventListener("click", function () {
      inputSenha.type = inputSenha.type === "password" ? "text" : "password";
    });
  }

  // ── Tela 1: login ────────────────────────────────────────────────────────
  formLogin.addEventListener("submit", async function (ev) {
    ev.preventDefault();
    loginErro.hidden = true;
    const re = document.getElementById("login-re").value.trim();
    const senha = document.getElementById("login-senha").value;
    const btnEntrar = document.getElementById("btn-entrar");

    btnEntrar.disabled = true;
    try {
      const resultado = await chamarApi("/auth/login", {
        method: "POST",
        body: JSON.stringify({ re: re, senha: senha }),
      });
      token = resultado.access_token;
      fiscal = resultado.fiscal || resultado.usuario;

      // Se já existe um turno aberto pra esse fiscal (ex: página recarregada no
      // meio do turno), pula direto pra tela de fiscalização em vez de pedir
      // pra escolher linha/período/terminal de novo.
      const turnoAtivo = await chamarApi("/turno/ativo").catch(function () { return null; });
      if (turnoAtivo) {
        await entregarParaFiscalApp(turnoAtivo);
        return;
      }

      await carregarLinhas();
      mostrarTela("linha");
    } catch (erro) {
      loginErro.textContent = erro.message || "Falha ao entrar.";
      loginErro.hidden = false;
    } finally {
      btnEntrar.disabled = false;
    }
  });

  // ── Tela 2: escolher linha + período ────────────────────────────────────
  async function carregarLinhas() {
    const linhas = await chamarApi("/linhas/");
    selectLinha.innerHTML = "";
    if (!linhas.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Nenhuma linha cadastrada";
      selectLinha.appendChild(opt);
      return;
    }
    linhas.forEach(function (l) {
      const opt = document.createElement("option");
      opt.value = l.id;
      opt.textContent = l.codigo + " — " + l.nome;
      opt.dataset.codigo = l.codigo;
      selectLinha.appendChild(opt);
    });
  }

  botoesPeriodo.forEach(function (btn) {
    btn.addEventListener("click", function () {
      botoesPeriodo.forEach(function (b) { b.classList.remove("selecionado"); });
      btn.classList.add("selecionado");
      periodoEscolhido = btn.dataset.periodo;
    });
  });

  formLinha.addEventListener("submit", function (ev) {
    ev.preventDefault();
    linhaErro.hidden = true;

    if (!selectLinha.value) {
      linhaErro.textContent = "Selecione uma linha.";
      linhaErro.hidden = false;
      return;
    }
    if (!periodoEscolhido) {
      linhaErro.textContent = "Selecione o período (manhã ou tarde).";
      linhaErro.hidden = false;
      return;
    }

    const opt = selectLinha.selectedOptions[0];
    linhaEscolhida = { id: selectLinha.value, codigo: opt.dataset.codigo, nome: opt.textContent };

    terminalResumo.textContent = "Linha " + linhaEscolhida.codigo + " · " + (periodoEscolhido === "MANHA" ? "Manhã" : "Tarde");
    terminalErro.hidden = true;
    botoesTerminal.forEach(function (b) { b.disabled = false; });
    mostrarTela("terminal");
  });

  // ── Tela 3: escolher terminal (TP/TS) → abre o turno ────────────────────
  botoesTerminal.forEach(function (btn) {
    btn.addEventListener("click", async function () {
      terminalErro.hidden = true;
      botoesTerminal.forEach(function (b) { b.disabled = true; });
      terminalCarregando.hidden = false;
      const terminal = btn.dataset.terminal;
      try {
        await abrirTurno(terminal);
      } catch (erro) {
        terminalCarregando.hidden = true;
        terminalErro.textContent = erro.message || "Falha ao abrir turno.";
        terminalErro.hidden = false;
        botoesTerminal.forEach(function (b) { b.disabled = false; });
      }
    });
  });

  btnVoltarLinha.addEventListener("click", function () {
    terminalErro.hidden = true;
    mostrarTela("linha");
  });

  async function abrirTurno(terminal) {
    const tipoDia = tipoDiaHoje();
    const data = dataHojeISO();

    const partidasPorTabela = await chamarApi(
      "/escalas/partidas/" + encodeURIComponent(linhaEscolhida.codigo) +
      "?tipo_dia=" + tipoDia + "&terminal=" + terminal
    );

    const turno = await chamarApi("/turno/abrir", {
      method: "POST",
      body: JSON.stringify({
        linha_id: linhaEscolhida.id,
        linha_codigo: linhaEscolhida.codigo,
        terminal: terminal,
        periodo: periodoEscolhido,
        data: data,
        tipo_dia: tipoDia,
      }),
    });

    window.__terminal = terminal;
    await entregarParaFiscalApp(turno, partidasPorTabela);
  }

  // ── Handoff pro app do fiscal (Início/Fim/Refeição/Viagens/Menu) ─────────
  // Busca partidas (se ainda não tiver buscado) e entrega tudo pronto pro
  // fiscal-app.js via window.__fiscalApp.init(ctx) — formato explícito de
  // handoff, ver docs/STATUS-DEPLOY-2026-07-07.md. O bundle React
  // (index-DQKWVWsR.js) fica no repositório mas não é mais montado.
  async function entregarParaFiscalApp(turno, partidasPorTabelaJaBuscadas) {
    window.__terminal = turno.terminal;

    const partidasPorTabela = partidasPorTabelaJaBuscadas || await chamarApi(
      "/escalas/partidas/" + encodeURIComponent(turno.linha_codigo) +
      "?tipo_dia=" + turno.tipo_dia + "&terminal=" + turno.terminal
    );

    montarFiscalApp({ fiscal: fiscal, turno: turno, partidasPorTabela: partidasPorTabela, token: token });
  }

  function montarFiscalApp(ctxFiscalApp) {
    telaLogin.hidden = true;
    telaLinha.hidden = true;
    telaTerminal.hidden = true;
    window.__fiscalApp.init(ctxFiscalApp);
  }

  // ── Inicialização ────────────────────────────────────────────────────────
  mostrarTela("login");
})();
