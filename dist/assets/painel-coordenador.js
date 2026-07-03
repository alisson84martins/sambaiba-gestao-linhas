// painel-coordenador.js — Painel do Coordenador (vanilla JS, sem frameworks)
// Consome GET /api/v1/coordenador/panorama/{linha}?data=&tipo_dia=
// Acesso restrito a papéis COORDENADOR e ADMIN — o backend também valida isso.

(function () {
  "use strict";

  const API_BASE = "/api/v1";
  const CHAVE_SESSAO = "painel_coordenador_sessao";

  // ── Elementos ──────────────────────────────────────────────────────────────
  const blocoLogin = document.getElementById("bloco-login");
  const blocoPanorama = document.getElementById("bloco-panorama");
  const formLogin = document.getElementById("form-login");
  const loginErro = document.getElementById("login-erro");
  const usuarioLogadoEl = document.getElementById("usuario-logado");
  const usuarioNomeEl = document.getElementById("usuario-nome");
  const btnSair = document.getElementById("btn-sair");

  const toggleSenha = document.getElementById("toggle-senha");
  const inputSenha = document.getElementById("login-senha");
  const apiStatusDot = document.getElementById("api-status-dot");
  const apiStatusText = document.getElementById("api-status-text");

  const formPanorama = document.getElementById("form-panorama");
  const filtroLinha = document.getElementById("filtro-linha");
  const filtroData = document.getElementById("filtro-data");
  const filtroTipoDia = document.getElementById("filtro-tipo-dia");
  const panoramaErro = document.getElementById("panorama-erro");
  const panoramaVazio = document.getElementById("panorama-vazio");
  const legenda = document.getElementById("legenda");
  const timelineEl = document.getElementById("timeline");

  // ── Sessão (sessionStorage — token não sobrevive ao fechar a aba) ──────────
  function obterSessao() {
    try {
      const bruto = sessionStorage.getItem(CHAVE_SESSAO);
      return bruto ? JSON.parse(bruto) : null;
    } catch (e) {
      return null;
    }
  }

  function salvarSessao(token, usuario) {
    sessionStorage.setItem(CHAVE_SESSAO, JSON.stringify({ token, usuario }));
  }

  function limparSessao() {
    sessionStorage.removeItem(CHAVE_SESSAO);
  }

  // ── Chamadas à API ───────────────────────────────────────────────────────
  async function chamarApi(caminho, opcoes) {
    const sessao = obterSessao();
    const cabecalhos = Object.assign(
      { "Content-Type": "application/json" },
      (opcoes && opcoes.headers) || {}
    );
    if (sessao && sessao.token) {
      cabecalhos["Authorization"] = "Bearer " + sessao.token;
    }
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

  // ── Login ────────────────────────────────────────────────────────────────
  formLogin.addEventListener("submit", async function (ev) {
    ev.preventDefault();
    loginErro.hidden = true;
    const re = document.getElementById("login-re").value.trim();
    const senha = document.getElementById("login-senha").value;

    try {
      const resultado = await chamarApi("/auth/login", {
        method: "POST",
        body: JSON.stringify({ re: re, senha: senha }),
      });
      const usuario = resultado.usuario;
      if (usuario.papel !== "COORDENADOR" && usuario.papel !== "ADMIN") {
        loginErro.textContent = "Acesso restrito a Coordenador ou Administrador.";
        loginErro.hidden = false;
        return;
      }
      salvarSessao(resultado.access_token, usuario);
      mostrarPainel(usuario);
    } catch (erro) {
      loginErro.textContent = erro.message || "Falha ao entrar.";
      loginErro.hidden = false;
    }
  });

  btnSair.addEventListener("click", function () {
    limparSessao();
    location.reload();
  });

  if (toggleSenha && inputSenha) {
    toggleSenha.addEventListener("click", function () {
      inputSenha.type = inputSenha.type === "password" ? "text" : "password";
    });
  }

  // ── Status do servidor (GET /api/health) ────────────────────────────────
  async function verificarStatusServidor() {
    if (!apiStatusDot || !apiStatusText) return;
    try {
      const resposta = await fetch("/api/health");
      if (!resposta.ok) throw new Error();
      apiStatusDot.classList.remove("erro");
      apiStatusDot.classList.add("ok");
      apiStatusText.textContent = "Servidor online";
    } catch (e) {
      apiStatusDot.classList.remove("ok");
      apiStatusDot.classList.add("erro");
      apiStatusText.textContent = "Servidor indisponível";
    }
  }
  verificarStatusServidor();

  function mostrarPainel(usuario) {
    blocoLogin.hidden = true;
    blocoPanorama.hidden = false;
    usuarioLogadoEl.hidden = false;
    usuarioNomeEl.textContent = usuario.nome + " (" + usuario.papel + ")";
    if (!filtroData.value) {
      filtroData.value = new Date().toISOString().slice(0, 10);
    }
  }

  // ── Panorama ─────────────────────────────────────────────────────────────
  formPanorama.addEventListener("submit", async function (ev) {
    ev.preventDefault();
    panoramaErro.hidden = true;
    panoramaVazio.hidden = true;
    timelineEl.innerHTML = "";
    legenda.hidden = true;

    const linha = filtroLinha.value.trim().toUpperCase();
    const data = filtroData.value;
    const tipoDia = filtroTipoDia.value;

    if (!linha || !data) return;

    try {
      const params = new URLSearchParams({ data: data, tipo_dia: tipoDia });
      const resultado = await chamarApi(
        "/coordenador/panorama/" + encodeURIComponent(linha) + "?" + params.toString()
      );
      renderizarTimeline(resultado.itens || []);
    } catch (erro) {
      if (erro.status === 401) {
        limparSessao();
        location.reload();
        return;
      }
      panoramaErro.textContent = erro.message || "Falha ao buscar o panorama.";
      panoramaErro.hidden = false;
    }
  });

  const ROTULO_MOTIVO = {
    FALTA_MOTORISTA: "Falta de motorista",
    FALTA_COBRADOR: "Falta de cobrador",
    RA: "Recolhida anormal (RA)",
    SOS: "Socorro mecânico (SOS)",
    TRANSITO: "Trânsito",
    ATRASO_PATIO: "Atraso no pátio",
    OUTROS: "Outros",
  };

  function renderizarTimeline(itens) {
    if (!itens.length) {
      panoramaVazio.hidden = false;
      return;
    }
    legenda.hidden = false;

    const fragmento = document.createDocumentFragment();
    itens.forEach(function (item) {
      const li = document.createElement("li");
      const statusClasse = "status-" + item.status.toLowerCase();
      const temCobertura = item.coberto_por_tabela != null && item.coberto_por_tabela !== item.numero_tabela;
      li.className = "timeline-item " + statusClasse + (temCobertura ? " tem-cobertura" : "");

      const terminalClasse = item.terminal === "TP" ? "badge-terminal-tp" : "badge-terminal-ts";
      const statusClasseBadge = "badge-status-" + item.status.toLowerCase();

      const dupla = item.motorista_re || item.cobrador_re
        ? "Mot. " + (item.motorista_re || "—") + " / Cob. " + (item.cobrador_re || "—")
        : "Dupla não registrada";

      let html = "";
      html += '<div class="timeline-linha1">';
      html += '<span class="timeline-horario">' + item.horario_previsto.slice(0, 5) + "</span>";
      html += '<span class="badge ' + terminalClasse + '">' + item.terminal + "</span>";
      html += '<span class="timeline-tabela">Tabela ' + item.numero_tabela + "</span>";
      html += '<span class="badge ' + statusClasseBadge + '">' + item.status + "</span>";
      html += "</div>";

      html += '<div class="timeline-linha2">';
      html += (item.prefixo_carro ? "Carro " + escaparHtml(item.prefixo_carro) + " — " : "") + escaparHtml(dupla);
      html += "</div>";

      if (temCobertura) {
        html += '<div class="timeline-cobertura">Coberto pela tabela ' + item.coberto_por_tabela;
        if (item.motivo_perda) html += " — motivo: " + (ROTULO_MOTIVO[item.motivo_perda] || item.motivo_perda);
        html += "</div>";
      } else if (item.status === "PERDIDA" && item.motivo_perda) {
        html += '<div class="timeline-cobertura">Motivo: ' + (ROTULO_MOTIVO[item.motivo_perda] || item.motivo_perda) + "</div>";
      }

      if (item.motivo_troca_operador) {
        html += '<div class="timeline-motivo-troca">Troca de operador: ' + escaparHtml(item.motivo_troca_operador) + "</div>";
      }

      li.innerHTML = html;
      fragmento.appendChild(li);
    });
    timelineEl.appendChild(fragmento);
  }

  function escaparHtml(texto) {
    const div = document.createElement("div");
    div.textContent = texto;
    return div.innerHTML;
  }

  // ── Inicialização ────────────────────────────────────────────────────────
  const sessaoExistente = obterSessao();
  if (sessaoExistente && sessaoExistente.usuario) {
    mostrarPainel(sessaoExistente.usuario);
  }
})();
