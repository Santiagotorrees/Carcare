/*
 * CarCare - interfaz (DOM). Usa Core (core.js) para toda la lógica de negocio.
 */
(function () {
  "use strict";

  const C = window.Core;
  const STATE_KEY = "carcare.state.v1";
  const SESSION_KEY = "carcare.session.v1";
  const TIPOS = {
    contrasena: "Olvidé mi contraseña",
    cuenta_bloqueada: "Mi cuenta está bloqueada"
  };

  let state = null;
  let session = null;
  let flash = null;
  let filtroFecha = "";

  const $ = (s) => document.querySelector(s);
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------- Persistencia (siempre con try/catch) ----------
  function loadState() {
    try {
      const raw = localStorage.getItem(STATE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
  function saveState() {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch (e) {
      flash = { msg: "No se pudo guardar en este navegador.", kind: "error" };
    }
  }
  function loadSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
  function setSession(u) {
    session = u;
    try {
      if (u) sessionStorage.setItem(SESSION_KEY, JSON.stringify(u));
      else sessionStorage.removeItem(SESSION_KEY);
    } catch (e) { /* sin sesión persistida */ }
  }

  // ---------- Datos de ejemplo (cuentas de prueba y agendas) ----------
  async function seed() {
    const hoy = C.todayStr();
    return {
      users: [
        { id: "u_admin", nombre: "Administrador CarCare", email: "admin@carcare.co", rol: "admin", password: await C.hashPassword("admin12345"), bloqueado: false },
        { id: "u_cliente", nombre: "Cliente Demo", email: "cliente@carcare.co", rol: "cliente", password: await C.hashPassword("cliente12345"), bloqueado: false },
        { id: "u_bloqueado", nombre: "Cliente bloqueado", email: "bloqueado@carcare.co", rol: "cliente", password: await C.hashPassword("bloqueado12345"), bloqueado: true }
      ],
      vehicles: [{ id: "v1", userId: "u_cliente", placa: "ABC123", marca: "Mazda", modelo: "CX-5", anio: 2020, km: 45000, color: "Gris" }],
      agendas: [
        { id: "a1", fecha: C.addDays(hoy, 1), inicio: "08:00", fin: "09:00", espacio: "Bahía 1", estado: "disponible" },
        { id: "a2", fecha: C.addDays(hoy, 1), inicio: "09:00", fin: "10:00", espacio: "Bahía 2", estado: "disponible" },
        { id: "a3", fecha: C.addDays(hoy, 2), inicio: "14:00", fin: "15:00", espacio: "Bahía 1", estado: "disponible" }
      ],
      reservas: [],
      solicitudes: [],
      correos: [],
      auditoria: []
    };
  }

  // ---------- Navegación ----------
  const go = (hash) => (location.hash === hash ? render() : (location.hash = hash));
  const route = () => (location.hash || "#/").replace(/^#/, "") || "/";
  const home = () => (session && session.rol === "admin" ? "#/admin/agendas" : "#/agendas");

  const PUBLIC = { "/login": pageLogin, "/registro": pageRegistro, "/ayuda": pageAyuda };
  const CLIENTE = {
    "/agendas": pageAgendas,
    "/vehiculos": pageVehiculos,
    "/vehiculos/nuevo": pageVehiculoNuevo,
    "/mis-reservas": pageMisReservas,
    "/cambiar-contrasena": pageCambiarContrasena
  };
  const ADMIN = {
    "/admin/agendas": pageAdminAgendas,
    "/admin/reservas": pageAdminReservas,
    "/admin/solicitudes": pageAdminSolicitudes,
    "/admin/correos": pageAdminCorreos
  };

  function renderNav() {
    const r = route();
    const link = (href, label) =>
      `<a href="${href}" class="${"#" + r === href ? "active" : ""}">${esc(label)}</a>`;
    let html = "";
    if (!session) {
      html = link("#/login", "Iniciar sesión") + link("#/registro", "Crear cuenta");
    } else if (session.rol === "admin") {
      html = link("#/admin/agendas", "Agendas") + link("#/admin/reservas", "Reservas") +
        link("#/admin/solicitudes", "Solicitudes") + link("#/admin/correos", "Correos") +
        `<button class="secondary small" data-action="logout">Cerrar sesión</button>`;
    } else {
      html = link("#/agendas", "Agendas") + link("#/mis-reservas", "Mis reservas") +
        link("#/vehiculos", "Mis vehículos") +
        `<button class="secondary small" data-action="logout">Cerrar sesión</button>`;
    }
    $("#nav").innerHTML = html;
  }

  function render() {
    const r = route();
    const app = $("#app");
    renderNav();

    if (!session) {
      if (!PUBLIC[r]) return go("#/login");
      return paint(app, PUBLIC[r]());
    }
    if (session.resetPending && r !== "/cambiar-contrasena") return go("#/cambiar-contrasena");
    if (r === "/" || PUBLIC[r]) return go(home());

    if (r.startsWith("/reservar/")) return paint(app, pageReservar(r.split("/")[2]));
    if (ADMIN[r]) return paint(app, session.rol === "admin" ? ADMIN[r]() : noAutorizado());
    if (CLIENTE[r]) return paint(app, session.rol === "cliente" ? CLIENTE[r]() : noAutorizado());
    paint(app, notFound());
  }

  function paint(app, html) {
    const f = flash ? `<div class="notice ${flash.kind}" role="status">${esc(flash.msg)}</div>` : "";
    flash = null;
    app.innerHTML = f + html;
  }

  // ---------- Utilidades de formulario ----------
  function showErrors(form, errors) {
    for (const el of form.querySelectorAll("[data-err]")) {
      const key = el.dataset.err;
      el.textContent = errors[key] || "";
      const input = form.querySelector(`[name="${key}"]`);
      if (input) input.setAttribute("aria-invalid", errors[key] ? "true" : "false");
    }
    const sinCampo = Object.keys(errors).filter((k) => !form.querySelector(`[data-err="${k}"]`));
    const box = form.querySelector('[data-err="_form"]');
    if (sinCampo.length && box) box.textContent = sinCampo.map((k) => errors[k]).join(" ");
  }

  const badgeEstado = (estado) => {
    const ok = estado === "disponible" || estado === "confirmada" || estado === "enviado" || estado === "atendida";
    const warn = estado === "fallido" || estado === "fallida";
    const label = { disponible: "Disponible", reservada: "Reservada", confirmada: "Confirmada", pendiente: "Pendiente", enviado: "Enviado", fallido: "Fallido", atendida: "Atendida" }[estado] || estado;
    return `<span class="badge ${ok ? "ok" : warn ? "warn" : ""}">${esc(label)}</span>`;
  };

  const sortAgendas = (a, b) => (a.fecha + a.inicio).localeCompare(b.fecha + b.inicio);
  const vehiculoDe = (id) => state.vehicles.find((v) => v.id === id);
  const agendaDe = (id) => state.agendas.find((a) => a.id === id);
  const usuarioDe = (id) => state.users.find((u) => u.id === id);

  // ---------- Páginas públicas ----------
  function pageLogin() {
    return `
    <section class="card login-wrap">
      <h1>Iniciar sesión</h1>
      <form data-form="login" novalidate>
        <div class="field">
          <label for="l-email">Correo electrónico</label>
          <input id="l-email" name="email" type="email" autocomplete="username" required>
          <span class="field-error" data-err="email"></span>
        </div>
        <div class="field">
          <label for="l-pass">Contraseña</label>
          <input id="l-pass" name="password" type="password" autocomplete="current-password" required>
          <span class="field-error" data-err="password"></span>
        </div>
        <span class="field-error" data-err="_form" role="alert"></span>
        <div class="actions"><button type="submit">Iniciar sesión</button></div>
      </form>
      <p class="muted">
        <a href="#/ayuda">Olvidé mi contraseña o mi cuenta está bloqueada</a> ·
        <a href="#/registro">Crear cuenta</a>
      </p>
      <details class="muted">
        <summary>Cuentas de prueba</summary>
        <p>Cliente: cliente@carcare.co / cliente12345<br>
        Administrador: admin@carcare.co / admin12345<br>
        Cliente bloqueado: bloqueado@carcare.co / bloqueado12345</p>
      </details>
    </section>`;
  }

  function pageRegistro() {
    return `
    <section class="card login-wrap">
      <h1>Crear cuenta</h1>
      <form data-form="registro" novalidate>
        <div class="field">
          <label for="r-nombre">Nombre completo *</label>
          <input id="r-nombre" name="nombre" autocomplete="name" required>
          <span class="field-error" data-err="nombre"></span>
        </div>
        <div class="field">
          <label for="r-email">Correo electrónico *</label>
          <input id="r-email" name="email" type="email" autocomplete="email" required>
          <span class="field-error" data-err="email"></span>
        </div>
        <div class="field">
          <label for="r-pass">Contraseña *</label>
          <input id="r-pass" name="password" type="password" autocomplete="new-password" required>
          <span class="muted">Mínimo 8 caracteres, con letras y números.</span>
          <span class="field-error" data-err="password"></span>
        </div>
        <div class="field">
          <label for="r-confirm">Confirmar contraseña *</label>
          <input id="r-confirm" name="confirm" type="password" autocomplete="new-password" required>
          <span class="field-error" data-err="confirm"></span>
        </div>
        <span class="field-error" data-err="_form" role="alert"></span>
        <div class="actions"><button type="submit">Crear cuenta</button></div>
      </form>
      <p class="muted"><a href="#/login">Ya tengo cuenta</a></p>
    </section>`;
  }

  function pageAyuda() {
    const opts = Object.entries(TIPOS).map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join("");
    return `
    <section class="card login-wrap">
      <h1>Solicitar ayuda</h1>
      <p class="muted">El administrador revisará tu solicitud. Por seguridad, no mostramos si el correo está registrado.</p>
      <form data-form="ayuda" novalidate>
        <div class="field">
          <label for="a-email">Correo de tu cuenta</label>
          <input id="a-email" name="email" type="email" required>
          <span class="field-error" data-err="email"></span>
        </div>
        <div class="field">
          <label for="a-tipo">Motivo</label>
          <select id="a-tipo" name="tipo">${opts}</select>
        </div>
        <div class="actions"><button type="submit">Enviar solicitud</button></div>
      </form>
      <p class="muted"><a href="#/login">Volver a iniciar sesión</a></p>
    </section>`;
  }

  function pageCambiarContrasena() {
    return `
    <section class="card login-wrap">
      <h1>Crea una nueva contraseña</h1>
      <p class="notice info">Tu contraseña fue restablecida por el administrador. Crea una nueva para continuar.</p>
      <form data-form="cambiar" novalidate>
        <div class="field">
          <label for="c-pass">Nueva contraseña *</label>
          <input id="c-pass" name="password" type="password" autocomplete="new-password" required>
          <span class="muted">Mínimo 8 caracteres, con letras y números.</span>
          <span class="field-error" data-err="password"></span>
        </div>
        <div class="field">
          <label for="c-confirm">Confirmar nueva contraseña *</label>
          <input id="c-confirm" name="confirm" type="password" autocomplete="new-password" required>
          <span class="field-error" data-err="confirm"></span>
        </div>
        <span class="field-error" data-err="_form" role="alert"></span>
        <div class="actions"><button type="submit">Guardar contraseña</button></div>
      </form>
    </section>`;
  }

  // ---------- Páginas de cliente ----------
  function pageAgendas() {
    const disponibles = state.agendas
      .filter((a) => a.estado === "disponible" && (!filtroFecha || a.fecha === filtroFecha))
      .sort(sortAgendas);
    const filas = disponibles.map((a) => `
      <tr>
        <td>${esc(a.fecha)}</td><td>${esc(a.inicio)} – ${esc(a.fin)}</td><td>${esc(a.espacio)}</td>
        <td>${badgeEstado("disponible")}</td>
        <td><a class="btn small" href="#/reservar/${esc(a.id)}">Reservar</a></td>
      </tr>`).join("");
    const tabla = disponibles.length
      ? `<div class="table-wrap"><table>
          <thead><tr><th>Fecha</th><th>Horario</th><th>Espacio</th><th>Estado</th><th></th></tr></thead>
          <tbody>${filas}</tbody></table></div>`
      : `<p class="empty">No hay espacios disponibles para el periodo consultado. Prueba con otras fechas.</p>`;
    return `
    <h1>Agendas disponibles</h1>
    <section class="card">
      <form data-form="filtro" class="row">
        <div class="field">
          <label for="f-fecha">Fecha</label>
          <input id="f-fecha" name="fecha" type="date" value="${esc(filtroFecha)}">
        </div>
        <div class="actions" style="align-items:flex-end">
          <button type="submit">Buscar</button>
          <button type="button" class="secondary" data-action="limpiar-filtro">Ver todas</button>
        </div>
      </form>
    </section>
    <section class="card">${tabla}</section>`;
  }

  function pageReservar(agendaId) {
    const agenda = agendaDe(agendaId);
    if (!agenda) {
      return `<section class="card"><p class="notice error">La agenda no existe.</p>
        <a href="#/agendas">Volver a agendas</a></section>`;
    }
    if (agenda.estado !== "disponible") {
      return `<section class="card"><p class="notice error">Este espacio ya fue reservado. Selecciona otra agenda.</p>
        <a href="#/agendas">Volver a agendas</a></section>`;
    }
    const misVehiculos = state.vehicles.filter((v) => v.userId === session.id);
    if (!misVehiculos.length) {
      return `<section class="card"><p class="empty">Registra un vehículo antes de reservar.</p>
        <a class="btn" href="#/vehiculos/nuevo">Registrar vehículo</a></section>`;
    }
    const opts = misVehiculos.map((v) => `<option value="${esc(v.id)}">${esc(v.marca)} ${esc(v.modelo)} · ${esc(v.placa)}</option>`).join("");
    return `
    <h1>Reservar cita de mantenimiento</h1>
    <section class="card">
      <p><strong>Agenda:</strong> ${esc(agenda.fecha)} · ${esc(agenda.inicio)} – ${esc(agenda.fin)} · ${esc(agenda.espacio)}</p>
      <form data-form="reserva" novalidate>
        <input type="hidden" name="agendaId" value="${esc(agenda.id)}">
        <div class="field">
          <label for="r-veh">Vehículo *</label>
          <select id="r-veh" name="vehiculoId" required>
            <option value="">Selecciona un vehículo</option>${opts}
          </select>
          <span class="field-error" data-err="vehiculoId"></span>
        </div>
        <span class="field-error" data-err="_form" role="alert"></span>
        <div class="actions">
          <button type="submit">Confirmar reserva</button>
          <a class="btn secondary" href="#/agendas">Cancelar</a>
        </div>
      </form>
    </section>`;
  }

  function pageVehiculos() {
    const mios = state.vehicles.filter((v) => v.userId === session.id);
    const lista = mios.length
      ? `<div class="grid">${mios.map((v) => `
          <article class="card">
            <h2 style="margin-top:0">${esc(v.marca)} ${esc(v.modelo)}</h2>
            <p class="muted">Placa ${esc(v.placa)} · ${esc(v.anio)}${v.color ? " · " + esc(v.color) : ""}${v.km != null ? " · " + esc(v.km) + " km" : ""}</p>
          </article>`).join("")}</div>`
      : `<p class="empty">Aún no tienes vehículos registrados.</p>`;
    return `
    <div class="actions" style="justify-content:space-between;align-items:center">
      <h1>Mis vehículos</h1>
      <a class="btn" href="#/vehiculos/nuevo">Registrar vehículo</a>
    </div>
    ${lista}`;
  }

  function pageVehiculoNuevo() {
    return `
    <h1>Registrar vehículo</h1>
    <section class="card">
      <form data-form="vehiculo" novalidate>
        <div class="row">
          <div class="field">
            <label for="v-placa">Placa *</label>
            <input id="v-placa" name="placa" placeholder="ABC123" required>
            <span class="field-error" data-err="placa"></span>
          </div>
          <div class="field">
            <label for="v-marca">Marca *</label>
            <input id="v-marca" name="marca" placeholder="Ej. Mazda" required>
            <span class="field-error" data-err="marca"></span>
          </div>
          <div class="field">
            <label for="v-modelo">Modelo *</label>
            <input id="v-modelo" name="modelo" placeholder="Ej. CX-5" required>
            <span class="field-error" data-err="modelo"></span>
          </div>
          <div class="field">
            <label for="v-anio">Año *</label>
            <input id="v-anio" name="anio" type="number" inputmode="numeric" placeholder="2020" required>
            <span class="field-error" data-err="anio"></span>
          </div>
          <div class="field">
            <label for="v-km">Kilometraje</label>
            <input id="v-km" name="km" type="number" inputmode="numeric" min="0" placeholder="Ej. 45000">
            <span class="field-error" data-err="km"></span>
          </div>
          <div class="field">
            <label for="v-color">Color</label>
            <input id="v-color" name="color" placeholder="Ej. Gris">
          </div>
        </div>
        <span class="muted">* Campos obligatorios.</span>
        <span class="field-error" data-err="_form" role="alert"></span>
        <div class="actions">
          <button type="submit">Guardar vehículo</button>
          <a class="btn secondary" href="#/vehiculos">Cancelar</a>
        </div>
      </form>
    </section>`;
  }

  function pageMisReservas() {
    const mias = state.reservas.filter((r) => r.userId === session.id);
    const tabla = mias.length
      ? `<div class="table-wrap"><table>
          <thead><tr><th>Fecha</th><th>Horario</th><th>Espacio</th><th>Vehículo</th><th>Estado</th></tr></thead>
          <tbody>${mias.map((r) => {
            const a = agendaDe(r.agendaId) || {};
            const v = vehiculoDe(r.vehiculoId) || {};
            return `<tr><td>${esc(a.fecha)}</td><td>${esc(a.inicio)} – ${esc(a.fin)}</td><td>${esc(a.espacio)}</td>
              <td>${esc(v.placa)}</td><td>${badgeEstado(r.estado)}</td></tr>`;
          }).join("")}</tbody></table></div>`
      : `<p class="empty">Aún no tienes reservas.</p>`;
    return `<h1>Mis reservas</h1><section class="card">${tabla}</section>`;
  }

  // ---------- Páginas de administrador ----------
  function pageAdminAgendas() {
    const filas = [...state.agendas].sort(sortAgendas).map((a) => `
      <tr><td>${esc(a.fecha)}</td><td>${esc(a.inicio)} – ${esc(a.fin)}</td><td>${esc(a.espacio)}</td>
      <td>${badgeEstado(a.estado)}</td></tr>`).join("");
    return `
    <h1>Crear y publicar agendas</h1>
    <section class="card">
      <form data-form="agenda" novalidate>
        <div class="row">
          <div class="field">
            <label for="ag-fecha">Fecha *</label>
            <input id="ag-fecha" name="fecha" type="date" required>
            <span class="field-error" data-err="fecha"></span>
          </div>
          <div class="field">
            <label for="ag-espacio">Espacio *</label>
            <input id="ag-espacio" name="espacio" placeholder="Ej. Bahía 1" required>
            <span class="field-error" data-err="espacio"></span>
          </div>
          <div class="field">
            <label for="ag-inicio">Hora de inicio *</label>
            <input id="ag-inicio" name="inicio" type="time" required>
            <span class="field-error" data-err="inicio"></span>
          </div>
          <div class="field">
            <label for="ag-fin">Hora de fin *</label>
            <input id="ag-fin" name="fin" type="time" required>
            <span class="field-error" data-err="fin"></span>
          </div>
        </div>
        <span class="field-error" data-err="horario"></span>
        <span class="field-error" data-err="_form" role="alert"></span>
        <div class="actions"><button type="submit">Publicar agenda</button></div>
      </form>
    </section>
    <section class="card">
      <h2 style="margin-top:0">Agendas publicadas</h2>
      ${filas
        ? `<div class="table-wrap"><table>
            <thead><tr><th>Fecha</th><th>Horario</th><th>Espacio</th><th>Estado</th></tr></thead>
            <tbody>${filas}</tbody></table></div>`
        : `<p class="empty">Aún no hay agendas publicadas.</p>`}
    </section>`;
  }

  function pageAdminReservas() {
    const filas = state.reservas.map((r) => {
      const a = agendaDe(r.agendaId) || {};
      const u = usuarioDe(r.userId) || {};
      const v = vehiculoDe(r.vehiculoId) || {};
      return `<tr><td>${esc(a.fecha)}</td><td>${esc(a.inicio)} – ${esc(a.fin)}</td><td>${esc(a.espacio)}</td>
        <td>${esc(u.nombre)}</td><td>${esc(v.placa)}</td><td>${badgeEstado(r.estado)}</td></tr>`;
    }).join("");
    return `
    <h1>Reservas realizadas</h1>
    <section class="card">
      ${filas
        ? `<div class="table-wrap"><table>
            <thead><tr><th>Fecha</th><th>Horario</th><th>Espacio</th><th>Cliente</th><th>Vehículo</th><th>Estado</th></tr></thead>
            <tbody>${filas}</tbody></table></div>`
        : `<p class="empty">No hay reservas para mostrar.</p>`}
    </section>`;
  }

  function pageAdminSolicitudes() {
    const filas = state.solicitudes.map((s) => {
      const u = usuarioDe(s.userId) || {};
      let accion = "";
      if (s.estado === "pendiente" && s.tipo === "contrasena") {
        accion = `<button class="small" data-action="resolver" data-id="${esc(s.id)}" data-accion="restablecer">Restablecer contraseña</button>`;
      } else if (s.estado === "pendiente" && s.tipo === "cuenta_bloqueada") {
        accion = `<button class="small" data-action="resolver" data-id="${esc(s.id)}" data-accion="desbloquear">Desbloquear cuenta</button>`;
      }
      return `<tr><td>${esc(s.creada)}</td><td>${esc(u.nombre)}<br><span class="muted">${esc(u.email)}</span></td>
        <td>${esc(TIPOS[s.tipo] || s.tipo)}</td><td>${badgeEstado(s.estado === "atendida" ? "atendida" : "pendiente")}</td>
        <td>${accion}</td></tr>`;
    }).join("");
    return `
    <h1>Solicitudes de acceso</h1>
    <section class="card">
      ${filas
        ? `<div class="table-wrap"><table>
            <thead><tr><th>Fecha</th><th>Cliente</th><th>Motivo</th><th>Estado</th><th>Acción</th></tr></thead>
            <tbody>${filas}</tbody></table></div>`
        : `<p class="empty">No hay solicitudes de acceso.</p>`}
    </section>`;
  }

  function pageAdminCorreos() {
    const filas = state.correos.map((c) => `
      <tr><td>${esc(c.to)}</td><td>${esc(c.subject)}</td><td>${esc(c.envioEn)}</td>
      <td>${badgeEstado(c.estado)}${c.error ? `<br><span class="muted">${esc(c.error)}</span>` : ""}</td></tr>`).join("");
    return `
    <h1>Recordatorios por correo</h1>
    <section class="card">
      <div class="actions">
        <button data-action="enviar-correos">Enviar recordatorios vencidos</button>
      </div>
      <p class="muted">En este prototipo, los destinos que contienen “fallo” simulan un error del servicio de correo.</p>
      ${filas
        ? `<div class="table-wrap"><table>
            <thead><tr><th>Para</th><th>Asunto</th><th>Envío programado</th><th>Estado</th></tr></thead>
            <tbody>${filas}</tbody></table></div>`
        : `<p class="empty">No hay correos programados.</p>`}
    </section>`;
  }

  function noAutorizado() {
    return `<section class="card"><h1>Acción no autorizada</h1>
      <p>No tienes permiso para ver esta sección.</p>
      <a href="${home()}">Ir a mi inicio</a></section>`;
  }

  function notFound() {
    return `<section class="card"><h1>Página no encontrada</h1><a href="${home()}">Ir a mi inicio</a></section>`;
  }

  // ---------- Eventos ----------
  const simularEnvio = async (correo) => {
    if (/fallo/i.test(correo.to)) throw new Error("El servicio de correo no respondió.");
  };

  async function onClick(e) {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const accion = el.dataset.action;

    if (accion === "logout") {
      setSession(null);
      flash = { msg: "Sesión cerrada.", kind: "info" };
      return go("#/login");
    }
    if (accion === "limpiar-filtro") {
      filtroFecha = "";
      return render();
    }
    if (accion === "enviar-correos") {
      const r = await C.sendDueReminders(state, C.nowStr(), simularEnvio);
      saveState();
      flash = {
        msg: `Recordatorios enviados: ${r.enviados}. Con error: ${r.fallidos}.`,
        kind: r.fallidos ? "error" : "ok"
      };
      return render();
    }
    if (accion === "resolver") {
      const r = C.resolverSolicitud(state, session.id, el.dataset.id, el.dataset.accion);
      if (r.ok) {
        saveState();
        flash = { msg: r.mensaje, kind: "ok" };
      } else {
        flash = { msg: r.error, kind: "error" };
      }
      return render();
    }
  }

  async function onSubmit(e) {
    const form = e.target;
    if (!form.dataset || !form.dataset.form) return;
    e.preventDefault();
    showErrors(form, {});
    const d = Object.fromEntries(new FormData(form).entries());

    switch (form.dataset.form) {
      case "login": {
        const res = await C.login(state, d.email || "", d.password || "");
        if (!res.ok) return showErrors(form, res.errors || { _form: res.error });
        setSession(res.user);
        flash = { msg: `Bienvenido, ${res.user.nombre}.`, kind: "ok" };
        return go(res.user.resetPending ? "#/cambiar-contrasena" : home());
      }
      case "registro": {
        const res = await C.registrar(state, d);
        if (!res.ok) return showErrors(form, res.errors);
        saveState();
        flash = { msg: "Cuenta creada. Ya puedes iniciar sesión.", kind: "ok" };
        return go("#/login");
      }
      case "ayuda": {
        if (!C.EMAIL.test((d.email || "").trim())) return showErrors(form, { email: "Escribe un correo válido." });
        C.solicitarAyuda(state, d.email, d.tipo);
        saveState();
        flash = { msg: "Si la cuenta existe, el administrador revisará tu solicitud.", kind: "info" };
        return go("#/login");
      }
      case "cambiar": {
        const res = await C.cambiarContrasena(state, session.id, d);
        if (!res.ok) return showErrors(form, res.errors || { _form: res.error });
        saveState();
        setSession({ ...session, resetPending: false });
        flash = { msg: "Contraseña actualizada.", kind: "ok" };
        return go(home());
      }
      case "vehiculo": {
        const res = C.registrarVehiculo(state, session.id, d);
        if (!res.ok) return showErrors(form, res.errors);
        saveState();
        flash = { msg: "Vehículo registrado.", kind: "ok" };
        return go("#/vehiculos");
      }
      case "agenda": {
        const res = C.crearAgenda(state, session.id, d);
        if (!res.ok) return showErrors(form, res.errors || { _form: res.error });
        saveState();
        flash = { msg: "Agenda publicada y disponible para los clientes.", kind: "ok" };
        return go("#/admin/agendas");
      }
      case "filtro": {
        filtroFecha = d.fecha || "";
        return render();
      }
      case "reserva": {
        const res = C.reservar(state, session.id, d.vehiculoId, d.agendaId);
        if (!res.ok) {
          return showErrors(form, res.code === "INCOMPLETO" && !d.vehiculoId ? { vehiculoId: res.error } : { _form: res.error });
        }
        saveState();
        flash = { msg: "Reserva confirmada. Recibirás un correo con los datos de la cita.", kind: "ok" };
        return go("#/mis-reservas");
      }
    }
  }

  // ---------- Arranque ----------
  async function init() {
    const existente = loadState();
    state = existente || (await seed());
    if (!existente) saveState();
    session = loadSession();
    document.addEventListener("click", onClick);
    document.addEventListener("submit", onSubmit);
    window.addEventListener("hashchange", render);
    render();
  }

  init();
})();
