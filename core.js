/*
 * CarCare - lógica de negocio (sin DOM).
 * Cubre las historias HU-01 a HU-09 del documento de historias de usuario.
 */
(function (root) {
  "use strict";

  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const PLACA = /^[A-Z]{3}(\d{3}|\d{2}[A-Z])$/;
  const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
  const FECHA = /^\d{4}-\d{2}-\d{2}$/;
  const HORA_ENVIO_RECORDATORIO = "08:00";

  const pad = (n) => String(n).padStart(2, "0");
  const toDateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayStr = (now = new Date()) => toDateStr(now);
  const nowStr = (now = new Date()) => `${toDateStr(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const newId = (prefix) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

  function addDays(fecha, n) {
    const [y, m, d] = fecha.split("-").map(Number);
    return toDateStr(new Date(y, m - 1, d + n));
  }

  function isValidDate(s) {
    if (!FECHA.test(s || "")) return false;
    const [y, m, d] = s.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }

  const toHex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");
  const fromHex = (h) => Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)));

  // ---------- Contraseñas (PBKDF2, nunca en texto plano) ----------
  async function hashPassword(password, saltHex) {
    const salt = saltHex ? fromHex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, key, 256);
    return { salt: toHex(salt), hash: toHex(new Uint8Array(bits)) };
  }

  async function verifyPassword(password, stored) {
    if (!stored || !stored.salt) return false;
    const r = await hashPassword(password, stored.salt);
    return r.hash === stored.hash;
  }

  // ---------- Validaciones ----------
  function validatePassword(p) {
    if (!p) return "La contraseña es obligatoria.";
    if (p.length < 8 || !/[A-Za-z]/.test(p) || !/\d/.test(p)) return "Mínimo 8 caracteres, con letras y números.";
    return null;
  }

  // HU-01 CA-02: señala cada campo inválido y no crea la cuenta
  function validateRegistro(d) {
    const e = {};
    if (!d.nombre || d.nombre.trim().length < 3) e.nombre = "Escribe tu nombre completo (mínimo 3 caracteres).";
    if (!EMAIL.test((d.email || "").trim())) e.email = "Escribe un correo válido.";
    const pw = validatePassword(d.password);
    if (pw) e.password = pw;
    if (d.confirm !== d.password) e.confirm = "Las contraseñas no coinciden.";
    return e;
  }

  function validateLogin(d) {
    const e = {};
    if (!EMAIL.test((d.email || "").trim())) e.email = "Escribe un correo válido.";
    if (!d.password) e.password = "Escribe tu contraseña.";
    return e;
  }

  // HU-03 CA-02: campos obligatorios y formato de placa
  function validateVehiculo(d, year = new Date().getFullYear()) {
    const e = {};
    const placa = (d.placa || "").trim().toUpperCase();
    if (!placa) e.placa = "La placa es obligatoria.";
    else if (!PLACA.test(placa)) e.placa = "Formato de placa no válido. Ejemplo: ABC123 o ABC12D.";
    if (!(d.marca || "").trim()) e.marca = "La marca es obligatoria.";
    if (!(d.modelo || "").trim()) e.modelo = "El modelo es obligatorio.";
    const anio = Number(d.anio);
    if (!d.anio) e.anio = "El año es obligatorio.";
    else if (!Number.isInteger(anio) || anio < 1950 || anio > year + 1) e.anio = `Año entre 1950 y ${year + 1}.`;
    if (d.km !== undefined && d.km !== "" && (!Number.isInteger(Number(d.km)) || Number(d.km) < 0)) {
      e.km = "El kilometraje debe ser un número entero mayor o igual a cero.";
    }
    return e;
  }

  function overlaps(a, b) {
    return a.fecha === b.fecha && a.espacio === b.espacio && a.inicio < b.fin && b.inicio < a.fin;
  }

  // HU-06 CA-02 y reglas: fecha y hora válidas, sin solapes en el mismo espacio
  function validateAgenda(d, agendas, today = todayStr()) {
    const e = {};
    if (!d.fecha) e.fecha = "La fecha es obligatoria.";
    else if (!isValidDate(d.fecha)) e.fecha = "Fecha no válida.";
    else if (d.fecha < today) e.fecha = "La fecha no puede estar en el pasado.";
    if (!HORA.test(d.inicio || "")) e.inicio = "Hora de inicio obligatoria (HH:MM).";
    if (!HORA.test(d.fin || "")) e.fin = "Hora de fin obligatoria (HH:MM).";
    if (!(d.espacio || "").trim()) e.espacio = "El espacio es obligatorio.";
    if (!e.inicio && !e.fin && d.inicio >= d.fin) e.fin = "La hora de fin debe ser posterior a la de inicio.";
    if (Object.keys(e).length === 0) {
      const nueva = { fecha: d.fecha, espacio: d.espacio.trim(), inicio: d.inicio, fin: d.fin };
      if (agendas.some((a) => overlaps(a, nueva))) {
        e.horario = "Ese horario se cruza con otra agenda del mismo espacio.";
      }
    }
    return e;
  }

  // ---------- Usuarios ----------
  const publicUser = (u) => ({ id: u.id, nombre: u.nombre, email: u.email, rol: u.rol, resetPending: !!u.resetPending });

  // HU-02 CA-01 / CA-02
  async function login(state, email, password) {
    const errores = validateLogin({ email, password });
    if (Object.keys(errores).length) return { ok: false, errors: errores };
    const user = state.users.find((u) => u.email === email.trim().toLowerCase());
    const ok = user && (await verifyPassword(password, user.password));
    if (!ok) return { ok: false, error: "Correo o contraseña incorrectos. Verifica tus credenciales." };
    if (user.bloqueado) return { ok: false, error: "Cuenta bloqueada. Solicita ayuda al administrador." };
    return { ok: true, user: publicUser(user) };
  }

  // HU-01 CA-01 / CA-02
  async function registrar(state, d) {
    const errors = validateRegistro(d);
    const email = (d.email || "").trim().toLowerCase();
    if (!errors.email && state.users.some((u) => u.email === email)) {
      errors.email = "Ya existe una cuenta con este correo.";
    }
    if (Object.keys(errors).length) return { ok: false, errors };
    const user = {
      id: newId("u"),
      nombre: d.nombre.trim(),
      email,
      rol: "cliente",
      password: await hashPassword(d.password),
      bloqueado: false
    };
    state.users.push(user);
    return { ok: true, user: publicUser(user) };
  }

  async function cambiarContrasena(state, userId, d) {
    const user = state.users.find((u) => u.id === userId);
    const err = validatePassword(d.password);
    if (!user) return { ok: false, error: "La cuenta no existe." };
    if (err) return { ok: false, errors: { password: err } };
    if (d.password !== d.confirm) return { ok: false, errors: { confirm: "Las contraseñas no coinciden." } };
    user.password = await hashPassword(d.password);
    user.resetPending = false;
    return { ok: true, user: publicUser(user) };
  }

  // HU-09: solicitud desde la pantalla de ayuda; no revela si la cuenta existe
  function solicitarAyuda(state, email, tipo, now = new Date()) {
    const user = state.users.find((u) => u.email === (email || "").trim().toLowerCase());
    if (user) {
      state.solicitudes.push({
        id: newId("sol"),
        userId: user.id,
        tipo,
        estado: "pendiente",
        creada: nowStr(now)
      });
    }
    return { ok: true, mensaje: "Si la cuenta existe, el administrador revisará tu solicitud." };
  }

  // HU-09 CA-01 / CA-02
  function resolverSolicitud(state, actorId, solicitudId, accion, now = new Date()) {
    const actor = state.users.find((u) => u.id === actorId);
    if (!actor || actor.rol !== "admin") {
      return { ok: false, code: "NO_AUTORIZADO", error: "Acción no autorizada: solo el administrador puede gestionar solicitudes." };
    }
    const sol = state.solicitudes.find((s) => s.id === solicitudId);
    if (!sol) return { ok: false, error: "La solicitud no existe." };
    if (sol.estado !== "pendiente") return { ok: false, error: "Esta solicitud ya fue atendida." };
    const user = state.users.find((u) => u.id === sol.userId);
    if (!user) return { ok: false, error: "La cuenta asociada ya no existe." };

    if (accion === "restablecer" && sol.tipo === "contrasena") {
      user.resetPending = true;
    } else if (accion === "desbloquear" && sol.tipo === "cuenta_bloqueada") {
      user.bloqueado = false;
    } else {
      return { ok: false, error: "La acción no corresponde al tipo de solicitud." };
    }
    sol.estado = "atendida";
    sol.atendidaPor = actorId;
    sol.atendidaEn = nowStr(now);
    sol.accion = accion;
    state.auditoria.push({ id: newId("aud"), actorId, accion, solicitudId, fecha: nowStr(now) });
    return {
      ok: true,
      mensaje: accion === "restablecer"
        ? "Contraseña restablecida. El cliente deberá crear una nueva al iniciar sesión."
        : "Cuenta desbloqueada."
    };
  }

  // ---------- Vehículos (HU-03) ----------
  function registrarVehiculo(state, userId, d, year = new Date().getFullYear()) {
    const errors = validateVehiculo(d, year);
    const placa = (d.placa || "").trim().toUpperCase();
    if (!errors.placa && state.vehicles.some((v) => v.placa === placa)) {
      errors.placa = "Esta placa ya está registrada.";
    }
    if (Object.keys(errors).length) return { ok: false, errors };
    const vehiculo = {
      id: newId("v"),
      userId,
      placa,
      marca: d.marca.trim(),
      modelo: d.modelo.trim(),
      anio: Number(d.anio),
      km: d.km ? Number(d.km) : null,
      color: (d.color || "").trim()
    };
    state.vehicles.push(vehiculo);
    return { ok: true, vehiculo };
  }

  // ---------- Agendas (HU-06) ----------
  function crearAgenda(state, actorId, d, today = todayStr()) {
    const actor = state.users.find((u) => u.id === actorId);
    if (!actor || actor.rol !== "admin") {
      return { ok: false, code: "NO_AUTORIZADO", error: "Acción no autorizada: solo el administrador puede crear agendas." };
    }
    const errors = validateAgenda(d, state.agendas, today);
    if (Object.keys(errors).length) return { ok: false, errors };
    const agenda = {
      id: newId("ag"),
      fecha: d.fecha,
      inicio: d.inicio,
      fin: d.fin,
      espacio: d.espacio.trim(),
      estado: "disponible"
    };
    state.agendas.push(agenda);
    return { ok: true, agenda };
  }

  // ---------- Reservas (HU-05) y recordatorios (HU-08) ----------
  function reservar(state, userId, vehiculoId, agendaId, nowS = nowStr()) {
    // HU-05 CA-03
    if (!vehiculoId || !agendaId) {
      return { ok: false, code: "INCOMPLETO", error: "Faltan datos: selecciona vehículo y agenda." };
    }
    const vehiculo = state.vehicles.find((v) => v.id === vehiculoId && v.userId === userId);
    if (!vehiculo) return { ok: false, code: "INCOMPLETO", error: "Selecciona un vehículo registrado en tu cuenta." };
    const agenda = state.agendas.find((a) => a.id === agendaId);
    if (!agenda) return { ok: false, code: "NO_EXISTE", error: "La agenda no existe." };
    // HU-05 CA-02: la agenda ya fue ocupada
    if (agenda.estado !== "disponible") {
      return { ok: false, code: "OCUPADA", error: "Este espacio ya fue reservado. Selecciona otra agenda." };
    }
    const user = state.users.find((u) => u.id === userId);
    const reserva = {
      id: newId("r"),
      userId,
      vehiculoId,
      agendaId,
      estado: "confirmada",
      creada: nowS
    };
    agenda.estado = "reservada";
    state.reservas.push(reserva);
    state.correos.push({
      id: newId("c"),
      reservaId: reserva.id,
      to: user.email,
      subject: `Recordatorio de tu mantenimiento: ${agenda.fecha} ${agenda.inicio}`,
      body: `Hola ${user.nombre}. Tu cita es el ${agenda.fecha} a las ${agenda.inicio} en ${agenda.espacio} para tu ${vehiculo.marca} ${vehiculo.modelo} (${vehiculo.placa}).`,
      envioEn: `${addDays(agenda.fecha, -1)} ${HORA_ENVIO_RECORDATORIO}`,
      estado: "pendiente"
    });
    return { ok: true, reserva };
  }

  // Envía los recordatorios vencidos. Solo marca "enviado" si el servicio confirma el envío.
  async function sendDueReminders(state, nowS, sender) {
    let enviados = 0, fallidos = 0;
    for (const c of state.correos) {
      if (c.estado !== "pendiente" || c.envioEn > nowS) continue;
      try {
        await sender(c);
        c.estado = "enviado";
        c.enviadoEn = nowS;
        enviados++;
      } catch (e) {
        c.estado = "fallido";
        c.error = (e && e.message) || "Error desconocido al enviar.";
        fallidos++;
      }
    }
    return { enviados, fallidos };
  }

  const api = {
    EMAIL, PLACA, HORA, HORA_ENVIO_RECORDATORIO,
    todayStr, nowStr, addDays, isValidDate, newId,
    hashPassword, verifyPassword,
    validatePassword, validateRegistro, validateLogin, validateVehiculo, validateAgenda, overlaps,
    login, registrar, cambiarContrasena, solicitarAyuda, resolverSolicitud,
    registrarVehiculo, crearAgenda, reservar, sendDueReminders,
    publicUser
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Core = api;
})(typeof window !== "undefined" ? window : globalThis);
