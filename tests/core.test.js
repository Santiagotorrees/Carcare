const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../core.js");

const seedState = async () => ({
  users: [
    { id: "u_admin", nombre: "Admin", email: "admin@carcare.co", rol: "admin", password: await Core.hashPassword("admin12345"), bloqueado: false },
    { id: "u_cliente", nombre: "Cliente", email: "cliente@carcare.co", rol: "cliente", password: await Core.hashPassword("cliente12345"), bloqueado: false },
    { id: "u_bloq", nombre: "Bloqueado", email: "bloqueado@carcare.co", rol: "cliente", password: await Core.hashPassword("bloqueado12345"), bloqueado: true }
  ],
  vehicles: [{ id: "v1", userId: "u_cliente", placa: "ABC123", marca: "Mazda", modelo: "CX-5", anio: 2020, km: 45000, color: "Gris" }],
  agendas: [{ id: "a1", fecha: "2030-03-10", inicio: "08:00", fin: "09:00", espacio: "Bahía 1", estado: "disponible" }],
  reservas: [],
  solicitudes: [],
  correos: [],
  auditoria: []
});

// HU-01
test("HU-01 CA-02: registro con campos inválidos señala cada campo y no crea la cuenta", async () => {
  const state = await seedState();
  const res = await Core.registrar(state, { nombre: "Ab", email: "no-es-correo", password: "solo", confirm: "otra" });
  assert.equal(res.ok, false);
  assert.ok(res.errors.nombre && res.errors.email && res.errors.password && res.errors.confirm);
  assert.equal(state.users.length, 3);
});

test("HU-01 CA-01: registro válido crea cuenta con contraseña hasheada, no en texto plano", async () => {
  const state = await seedState();
  const res = await Core.registrar(state, { nombre: "Nuevo Cliente", email: "Nuevo@Mail.co", password: "clave1234", confirm: "clave1234" });
  assert.equal(res.ok, true);
  const u = state.users.find((x) => x.email === "nuevo@mail.co");
  assert.ok(u, "el correo se guarda en minúsculas");
  assert.equal(JSON.stringify(u).includes("clave1234"), false);
  assert.equal(res.user.rol, "cliente");
});

test("HU-01: no permite dos cuentas con el mismo correo", async () => {
  const state = await seedState();
  const res = await Core.registrar(state, { nombre: "Otro", email: "cliente@carcare.co", password: "clave1234", confirm: "clave1234" });
  assert.equal(res.ok, false);
  assert.ok(res.errors.email);
});

// HU-02
test("HU-02 CA-01 / CA-02: acceso válido y credenciales incorrectas con mensaje genérico", async () => {
  const state = await seedState();
  const ok = await Core.login(state, "cliente@carcare.co", "cliente12345");
  assert.equal(ok.ok, true);
  assert.equal(ok.user.rol, "cliente");
  const bad = await Core.login(state, "cliente@carcare.co", "mala-clave");
  assert.equal(bad.ok, false);
  assert.match(bad.error, /Verifica tus credenciales/);
});

test("HU-02: cuenta bloqueada no puede iniciar sesión", async () => {
  const state = await seedState();
  const res = await Core.login(state, "bloqueado@carcare.co", "bloqueado12345");
  assert.equal(res.ok, false);
  assert.match(res.error, /bloqueada/);
});

// HU-03
test("HU-03: valida campos obligatorios y formato de placa, y evita placas repetidas", () => {
  const state = { vehicles: [{ placa: "ABC123", userId: "u_cliente" }] };
  const vacio = Core.registrarVehiculo(state, "u_cliente", { placa: "", marca: "", modelo: "", anio: "" });
  assert.equal(vacio.ok, false);
  assert.ok(vacio.errors.placa && vacio.errors.marca && vacio.errors.modelo && vacio.errors.anio);
  const mala = Core.registrarVehiculo(state, "u_cliente", { placa: "12-ABC", marca: "X", modelo: "Y", anio: 2020 });
  assert.ok(mala.errors.placa);
  const repetida = Core.registrarVehiculo(state, "u_cliente", { placa: "abc123", marca: "X", modelo: "Y", anio: 2020 });
  assert.match(repetida.errors.placa, /ya está registrada/);
  const ok = Core.registrarVehiculo(state, "u_cliente", { placa: "xyz98k", marca: "Renault", modelo: "Logan", anio: 2019, km: "", color: "Blanco" }, 2026);
  assert.equal(ok.ok, true);
  assert.equal(ok.vehiculo.placa, "XYZ98K");
});

// HU-06
test("HU-06 CA-02 y reglas: no publica agendas incompletas, en el pasado ni solapadas", async () => {
  const state = await seedState();
  const hoy = "2030-01-01";
  const vacia = Core.crearAgenda(state, "u_admin", { fecha: "", inicio: "", fin: "", espacio: "" }, hoy);
  assert.equal(vacia.ok, false);
  const pasada = Core.crearAgenda(state, "u_admin", { fecha: "2029-12-31", inicio: "08:00", fin: "09:00", espacio: "Bahía 2" }, hoy);
  assert.ok(pasada.errors.fecha);
  const solapada = Core.crearAgenda(state, "u_admin", { fecha: "2030-03-10", inicio: "08:30", fin: "09:30", espacio: "Bahía 1" }, hoy);
  assert.ok(solapada.errors.horario);
  const ok = Core.crearAgenda(state, "u_admin", { fecha: "2030-03-10", inicio: "09:00", fin: "10:00", espacio: "Bahía 1" }, hoy);
  assert.equal(ok.ok, true);
});

test("HU-06: solo el administrador puede crear agendas", async () => {
  const state = await seedState();
  const res = Core.crearAgenda(state, "u_cliente", { fecha: "2030-03-11", inicio: "08:00", fin: "09:00", espacio: "Bahía 1" }, "2030-01-01");
  assert.equal(res.ok, false);
  assert.equal(res.code, "NO_AUTORIZADO");
});

// HU-05
test("HU-05 CA-01: reserva confirmada ocupa la agenda y programa el recordatorio", async () => {
  const state = await seedState();
  const res = Core.reservar(state, "u_cliente", "v1", "a1", "2030-03-01 10:00");
  assert.equal(res.ok, true);
  assert.equal(state.agendas[0].estado, "reservada");
  assert.equal(state.correos.length, 1);
  assert.equal(state.correos[0].envioEn, "2030-03-09 08:00");
});

test("HU-05 CA-02: si la agenda ya fue ocupada, la reserva se rechaza", async () => {
  const state = await seedState();
  Core.reservar(state, "u_cliente", "v1", "a1", "2030-03-01 10:00");
  const otra = Core.reservar(state, "u_cliente", "v1", "a1", "2030-03-01 10:05");
  assert.equal(otra.ok, false);
  assert.equal(otra.code, "OCUPADA");
  assert.equal(state.reservas.length, 1);
});

test("HU-05 CA-03: faltan vehículo o agenda, no registra la reserva", async () => {
  const state = await seedState();
  const res = Core.reservar(state, "u_cliente", "", "a1");
  assert.equal(res.ok, false);
  assert.equal(res.code, "INCOMPLETO");
  assert.equal(state.reservas.length, 0);
});

test("HU-05: no se puede reservar con un vehículo de otra cuenta", async () => {
  const state = await seedState();
  const res = Core.reservar(state, "u_bloq", "v1", "a1", "2030-03-01 10:00");
  assert.equal(res.ok, false);
});

// HU-08
test("HU-08 CA-02: si el correo falla, no se marca como enviado", async () => {
  const state = await seedState();
  state.correos.push({ id: "c1", to: "x@y.co", subject: "s", body: "b", envioEn: "2030-03-09 08:00", estado: "pendiente" });
  const r = await Core.sendDueReminders(state, "2030-03-09 08:00", async () => { throw new Error("Servicio caído"); });
  assert.deepEqual(r, { enviados: 0, fallidos: 1 });
  assert.equal(state.correos[0].estado, "fallido");
});

test("HU-08 CA-01: envía solo los recordatorios vencidos", async () => {
  const state = await seedState();
  state.correos.push({ id: "c1", to: "a@b.co", envioEn: "2030-03-09 08:00", estado: "pendiente" });
  state.correos.push({ id: "c2", to: "a@b.co", envioEn: "2030-03-12 08:00", estado: "pendiente" });
  const r = await Core.sendDueReminders(state, "2030-03-09 09:00", async () => {});
  assert.deepEqual(r, { enviados: 1, fallidos: 0 });
  assert.equal(state.correos[0].estado, "enviado");
  assert.equal(state.correos[1].estado, "pendiente");
});

// HU-09
test("HU-09 CA-01: el administrador atiende la solicitud y queda registrado", async () => {
  const state = await seedState();
  Core.solicitarAyuda(state, "bloqueado@carcare.co", "cuenta_bloqueada");
  const sol = state.solicitudes[0];
  const res = Core.resolverSolicitud(state, "u_admin", sol.id, "desbloquear");
  assert.equal(res.ok, true);
  assert.equal(state.users[2].bloqueado, false);
  assert.equal(sol.estado, "atendida");
  assert.equal(state.auditoria.length, 1);
});

test("HU-09 CA-02: el cliente no puede gestionar solicitudes", async () => {
  const state = await seedState();
  Core.solicitarAyuda(state, "cliente@carcare.co", "contrasena");
  const sol = state.solicitudes[0];
  const res = Core.resolverSolicitud(state, "u_cliente", sol.id, "restablecer");
  assert.equal(res.ok, false);
  assert.equal(res.code, "NO_AUTORIZADO");
  assert.equal(sol.estado, "pendiente");
});

test("HU-09: la ayuda no revela si el correo existe", () => {
  const state = { users: [], solicitudes: [] };
  const res = Core.solicitarAyuda(state, "nadie@x.co", "contrasena");
  assert.equal(res.ok, true);
  assert.equal(state.solicitudes.length, 0);
});
