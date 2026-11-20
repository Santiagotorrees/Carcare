# CarCare

Aplicación web para agendar mantenimientos de vehículos. Implementa las historias de usuario HU-01 a HU-09 del proyecto CarCare (Fundación Universitaria Compensar, Requerimientos de Software).

## Cómo ejecutarla

No requiere instalación. Abre `index.html` en el navegador, o sirve la carpeta con cualquier servidor estático:

```bash
npx serve .
```

## Cuentas de prueba

| Rol | Correo | Contraseña |
|---|---|---|
| Cliente | cliente@carcare.co | cliente12345 |
| Administrador | admin@carcare.co | admin12345 |
| Cliente bloqueado | bloqueado@carcare.co | bloqueado12345 |

## Historias implementadas

| HU | Historia | Rol |
|---|---|---|
| HU-01 | Registrarse en CarCare | Cliente nuevo |
| HU-02 | Iniciar sesión | Cliente y Administrador |
| HU-03 | Registrar un vehículo | Cliente |
| HU-04 | Consultar agendas disponibles | Cliente |
| HU-05 | Reservar una cita de mantenimiento | Cliente |
| HU-06 | Crear y publicar agendas | Administrador |
| HU-07 | Consultar reservas realizadas | Administrador |
| HU-08 | Recibir recordatorio por correo | Cliente |
| HU-09 | Gestionar solicitudes de acceso | Administrador |

Los criterios de aceptación Dado/Cuando/Entonces están cubiertos en `tests/core.test.js`.

## Estructura

- `core.js`: lógica de negocio sin interfaz (validaciones, cuentas, reservas, recordatorios).
- `app.js`: interfaz, rutas por rol y formularios.
- `index.html`, `styles.css`: página y estilos (tema claro y oscuro).
- `tests/core.test.js`: pruebas de la lógica.

## Pruebas

```bash
npm test
```

## Notas

- Los datos se guardan en el `localStorage` del navegador. Es un prototipo sin backend: no se comparte entre dispositivos.
- Las contraseñas se guardan con PBKDF2 (SHA-256, 100 000 iteraciones y sal aleatoria), nunca en texto plano.
- Los recordatorios se programan para el día anterior a la cita a las 08:00. El envío es simulado: si el destino contiene “fallo”, el envío falla y el sistema no lo marca como enviado.
- Las reglas marcadas como “por definir” en el documento (campos obligatorios, permisos por rol, momento de envío) se implementaron con valores razonables y deben validarse con el cliente.
