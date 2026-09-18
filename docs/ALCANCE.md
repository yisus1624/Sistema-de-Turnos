# Alcance de la entrega

Sistema de Gestion y Llamado de Turnos — ESE Hospital San Rafael de Chinu.

Este documento existe para que lo que queda FUERA de esta entrega este dicho por
escrito y no parezca un olvido. Todo lo de aqui es una decision tomada con el
hospital, no una funcion que falto por hacer: el codigo de casi todo sigue en el
repositorio y se puede volver a abrir cambiando una linea.

---

## Lo que el sistema hace hoy

**El dia empieza con la agenda.** Se sube el *Reporte de citas asignadas* que
exporta el servidor de informes del hospital (XML, o el mismo informe en Excel).
De ahi salen las citas del dia y, si hacen falta, los servicios, consultorios y
doctores que el archivo mencione.

**Admisiones registra la llegada.** El paciente llega, se le busca por documento
y su cita pasa a PRESENTADO. Solo entonces se le genera el turno.

**Cada medico llama a sus propios pacientes** desde el enlace temporal de su
consultorio, sin usuario ni contrasena.

**La sala de espera** ve el turno llamado, el consultorio y el doctor, con un
aviso sonoro. Por ahi no sale ni un dato del paciente.

**Queda registro** de quien hizo cada cosa y cuando: entradas al sistema, cargas
de agenda, citas creadas, canceladas y reprogramadas, llegadas, llamados,
cierres, enlaces generados y revocados, y todo cambio de catalogo, de cuentas o
de configuracion.

---

## Lo que queda FUERA, y por que

### 1. Historico, estadisticas y reportes

Las pantallas existen (`app/admin/historico`, `app/admin/estadisticas`,
`app/admin/reportes`) pero estan retiradas del catalogo de secciones
(`lib/permissions/rutas.ts`), asi que hoy no las ve nadie y sus APIs responden
403.

**Por que:** esta sin definir de donde salen esos datos y con que criterio se
agregan. Publicar unas estadisticas que nadie ha validado es peor que no
publicarlas: el hospital tomaria decisiones con ellas.

**Consecuencia:** el criterio de aceptacion de la seccion 26 *"se consultan
turnos atendidos, historico y estadisticas basicas"* **no se cumple** en esta
entrega.

**Para reabrirlas:** descomentar sus lineas en `lib/permissions/rutas.ts` y
auditar antes que los numeros que muestran sean los que el hospital espera.

### 2. Llamado de turnos por ventanilla

La seccion `/operador` (Llamado de turnos) tambien esta retirada. Con ella
quedan sin uso `llamar-siguiente`, `repetir`, `atendido`, `ausente`,
`pendientes` y `ventanilla` del lado del operador.

**Por que:** el hospital confirmo que EL OPERADOR NO PASA TURNOS. Cada medico
llama a sus propios pacientes desde el enlace de su consultorio; el operador
agenda citas y registra llegadas. Esa pantalla servia para las filas por orden
de llegada, que hoy el hospital no usa.

**Consecuencia:** el criterio *"se puede generar un turno"* de la seccion 26 no
es ejecutable por ventanilla en esta entrega. El turno se genera al registrar la
llegada del paciente, que es el flujo real.

**Para reabrirla:** descomentar su linea en `lib/permissions/rutas.ts`. El
codigo esta entero y su trazabilidad ya esta puesta.

### 3. Cuentas propias para los medicos

Los doctores entran por un enlace temporal con vigencia limitada, que reparte el
administrador o el operador del mostrador.

**Por que:** esta pendiente de definir si los medicos van a tener cuenta en este
sistema o si se integrara con la del hospital.

**Limitacion conocida:** el servidor guarda solo el hash del enlace, nunca el
enlace en claro. La copia que permite volver a mostrarlo vive en el navegador
que lo genero y **se pierde al cerrar la pestaña**. Si eso pasa, hay que generar
uno nuevo, y el nuevo invalida el anterior. Es el precio de no guardar en claro
una llave que abre la agenda con nombres de pacientes, y se considera correcto.

### 4. Origen de los datos

Las citas entran por el archivo del reporte, no por una API. Cuando el hospital
comparta la suya, se escribe el adaptador en `lib/hospital` y se cambia una
linea en `lib/turnos/repositorio.ts`; el resto del sistema no se toca.

---

## Lo que hay que hacer en el despliegue

- **Excluir `/consultorio/` del `access_log` del proxy.** El enlace del doctor
  viaja en la URL y por defecto nginx la escribe entera en sus registros.
- **Declarar `TURNOS_CONFIAR_PROXY=1`** solo si hay un proxy inverso que sea el
  unico camino hacia la aplicacion. Sin el, la IP la escribe el cliente y no
  sirve ni para bloquear ni para investigar; el sistema lo sabe y por eso no la
  usa salvo que se le diga.
- **Equipos compartidos en consultorio:** el enlace queda en el historial del
  navegador hasta que vence. Conviene cerrar sesion del equipo o usar ventana
  privada donde varios medicos usen el mismo computador.

---

## Deuda tecnica conocida

Ninguna de estas pone en riesgo a un paciente ni a sus datos. Estan escritas
para que quien siga no las descubra de golpe.

- `components/citas/AgendaCitasClient.tsx` (~1300 lineas) y
  `components/profesionales/EnlacesClient.tsx` (~900) concentran varias
  responsabilidades. Extraer los modales es el siguiente paso natural.
- "Simulacion de carga" sigue en el menu de administracion aunque su ruta
  responda 403 mientras no se declare `TURNOS_SIMULACION=1`.
- Las contraseñas que ya estaban guardadas conservan el coste de cifrado
  anterior y pasan al nuevo cuando su dueño la cambie. Ver
  `lib/usuarios/contrasenas.ts`.
