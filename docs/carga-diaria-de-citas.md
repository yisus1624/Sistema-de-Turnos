# Cargar la agenda del dia

La agenda no se teclea: la trae el reporte que el hospital ya exporta desde
SaludPlus. Esto es lo primero que se hace al abrir.

## Como se hace

1. En SaludPlus, generar **Reporte de citas asignadas** del dia.
2. Exportarlo como **XML** (recomendado) o como **Excel (.xlsx)**.
3. Entrar al sistema de turnos como **administrador** u **operador**.
4. Ir a **Citas** (administrador) o **Agenda de citas** (operador).
5. Pulsar **Cargar agenda del hospital** y elegir el archivo.
6. Leer el resumen que sale al terminar. No cerrarlo sin mirarlo.

Los dos roles pueden hacerlo a proposito: es lo primero de la jornada, y si
dependiera solo del administrador, el dia que no llegue temprano no habria
agenda y nadie podria registrar una llegada.

## Que formato exportar

| Formato | Se puede cargar | Nota |
|---|---|---|
| XML | Si | El mejor. Es el que el servidor de informes llama "XML". |
| Excel `.xlsx` | Si | La misma tabla; el encabezado se busca solo. |
| `.xls` antiguo (binario) | **No** | El sistema lo detecta y lo dice. Exportar en XML o .xlsx. |

Ojo: el servidor de informes a veces guarda el XML con nombre `.xls`. Ese SI se
puede cargar: el sistema mira el contenido, no la extension.

## Que se guarda de cada cita

Solo lo necesario para operar el turno (requerimiento seccion 17):

- Fecha y hora de la cita
- Tipo y numero de documento
- Nombre del paciente
- Profesional
- Consultorio
- Procedimiento y codigo CUPS

**No se guarda** edad, sexo, telefono, EPS, contrato, observaciones ni quien
creo la cita en SaludPlus, aunque el reporte los traiga.

## Que hace la carga, y que no hace

**Volver a subir el mismo archivo no duplica pacientes.** Cada cita se
identifica por dia + documento + doctor + hora. Si hay dudas de si ya se cargo,
se vuelve a cargar y ya.

**No toca a quien ya llego.** Si el paciente ya registro su llegada, su cita se
queda como esta, con su turno.

**Da de alta el catalogo que falte.** Los servicios, consultorios y doctores que
aparezcan en el reporte y no existan se crean solos, y salen listados en el
resumen.

Los nombres se pueden cambiar despues sin romper nada. El sistema empareja por
una clave interna, no por el nombre que se ve, asi que renombrar
`CONS 01- CONSULTA EXTERNA` a `Consultorio 1` es seguro. Lo mismo vale para los
dos servicios, *Consulta externa* y *Odontologia*: cambiarles mayusculas,
tildes o el nombre entero no hace que la carga siguiente falle ni los duplique.

**Le pone a cada doctor la jornada que dicen sus horas.** El reporte no trae una
columna de jornada, asi que la carga la deduce de las citas del dia: quien solo
tiene pacientes antes de las 12 queda de **mañana**, quien solo los tiene de la 1
en adelante, de **tarde**, y quien tiene de los dos lados, de **dia completo**.

La hora del almuerzo (entre el cierre de la mañana y la apertura de la tarde) no
cuenta para ningun lado. Importa: en el hospital hay cuatro doctores que atienden
de 12:20 a 16:14, que es la tarde entrando un poco antes. Contando esas 12:20
como mañana, los cuatro salian de "dia completo", que es justo lo que se queria
dejar de ver. Antes entraban
todos como dia completo, y el medico que se iba a las once seguia apareciendo en
la parrilla de la tarde con cupos que no existian. Los cambios salen listados en
el resumen; si alguno no es correcto, se cambia en *Profesionales*.

Al doctor que ese dia no tiene ninguna cita no se le toca la jornada: sin citas
no hay nada que deducir.

## La jornada es del doctor Y DEL DIA

El mismo medico hace el lunes completo, el martes solo la mañana y el miercoles
no viene. Eso no cabe en un campo de su ficha, y cada carga lo machacaba con el
veredicto del ultimo archivo, asi que el resto se perdia.

Son dos cosas distintas y se leen en dos sitios distintos:

- **La jornada de un dia** sale de las citas de ese dia. No se guarda en ninguna
  parte: se deduce, hacia atras, para cualquier dia que este cargado. Se ve en
  *Profesionales*, en la columna **Ese dia**, moviendo el selector de fecha. Al
  doctor que ese dia no tiene ni un paciente se le lee **No trabaja**, que es
  una respuesta y no un dato que falte.
- **La jornada habitual** es el campo de la ficha. Decide una sola cosa: a que
  horas se le agenda a mano el **primer** paciente de un dia que todavia esta
  vacio. En cuanto ese dia tiene una cita, mandan sus citas.

Las citas del dia **suman, nunca restan**. Al doctor de mañana que hoy esta
atendiendo de tarde se le puede agendar de tarde, porque su columna de la tarde
esta ahi llena de pacientes. Pero al de dia completo cuyo dia arranca con una
sola cita de las nueve no se le cierra la tarde: ahi no hay nada deducido
todavia, solo un dia a medio llenar.

## Recalcular jornadas

El boton **Recalcular jornadas** de *Configuracion › Profesionales* vuelve a
deducir la jornada **habitual** sobre el periodo que se le indique (por defecto,
el ultimo mes hasta el dia que se este mirando), sin volver a subir nada.

Deduce **dia por dia y gana la que mas se repite**. Juntando las horas del
periodo entero en un solo monton, bastaba una tarde suelta al mes para que un
medico de mañanas saliera de "dia completo", y sobre treinta dias eso acababa
poniendo a todo el hospital en dia completo, que es lo mismo que no decir nada.
En el empate gana "dia completo": quien trabaja las dos mitades por igual no
puede quedarse con media agenda cerrada.

Al doctor sin ni una cita en el periodo no se le toca. El resumen dice el
periodo mirado y, de cada doctor que cambio, la jornada que tenia y la que
queda; en *Registro de actividad* queda lo mismo con quien lo pidio.

**No cancela nada.** Si hay citas en el sistema que no vienen en el archivo, el
resumen las cuenta y avisa, pero no las borra: el reporte puede venir filtrado
por un doctor o por media jornada, y borrar la agenda por eso no tendria vuelta
atras. Hay que mirarlas a mano.

## El resumen: que mirar

- **Citas nuevas** — entraron.
- **Actualizadas** — ya estaban y cambio algun dato.
- **Sin cambios** — ya estaban iguales. Es lo normal al recargar el mismo archivo.
- **Filas que no se pudieron cargar** — **esos pacientes NO estan en la agenda.**
  Sale el numero de fila del archivo y el motivo. Hay que corregir el archivo y
  volver a subirlo, o agendarlos a mano.

Cada carga queda registrada (quien, cuando, que archivo, que se rechazo). Si al
dia siguiente un paciente reclama que no aparece, ahi esta el rastro.

## Las horas y la parrilla

Las citas del hospital vienen a la hora real (7:09, 7:13...), no en franjas
redondas. Se guardan tal cual: cambiarle la hora al paciente para que encaje en
la parrilla seria decirle algo distinto de lo que le dijeron al citarlo.

La **parrilla** de la pantalla de Citas las coloca en su hora real. Sus filas no
son una rejilla fija: son las franjas configuradas **mas la hora exacta de cada
cita del dia**. Asi cada doctor lleva su propio ritmo —uno cada diez minutos,
otro cada trece, uno con treinta pacientes y otro con veintisiete— sin que el
sistema le imponga ninguno, que es como funciona el hospital de verdad.

Las horas que no son franja de la configuracion se ven mas suaves y no ofrecen
el boton de agendar: ahi hay un paciente citado, pero **agendar a mano** solo se
puede en las franjas configuradas, porque es lo unico que el sistema acepta.

Por eso tampoco se habla ya de "cupos": no hay un numero de cupos por doctor que
este sistema pueda afirmar. Lo que se muestra es cuantas **citas** tiene cada
uno.

La seccion **"Citas sin doctor en la parrilla"** solo sale en un caso raro: que
el doctor de esa cita ya no aparezca en la agenda (se le dio de baja, o se le
paso a un servicio de ventanilla). No se esconden, porque ese paciente se va a
presentar igual.

**Solo salen los doctores que hoy atienden.** El catalogo crece carga tras
carga, pero en un dia cualquiera atiende una parte. El doctor que no tiene ni
una cita ese dia no ocupa columna: con todos dentro, la mayoria de la parrilla
son columnas vacias y encontrar la del doctor que se busca es recorrer la
pantalla de lado leyendo nombres.

No se esconden en silencio. Arriba, junto a los cupos, dice cuantos son y hay un
enlace para mostrarlos, que es lo que hay que hacer para agendarle el primer
paciente del dia a un doctor que todavia no tiene ninguno.

## Los datos viejos no se borran: se anonimizan

La historia clinica del paciente vive en SaludPlus. Aqui no hace falta guardar
su nombre pasados unos meses, y por eso hay una purga —*Registro de actividad ›
Anonimizar datos viejos*, solo para el administrador— que a los dias anteriores
al limite les quita **nombre, documento, tipo de documento, procedimiento y
CUPS**, y les deja **fecha, hora, doctor, servicio y estado**.

**Por que no se borra la fila entera.** Porque se llevaria por delante cosas que
no son datos personales y que este sistema si necesita mirar hacia atras:

- La **inasistencia** se mide comparando las citas del dia contra los turnos: el
  que no viene no genera turno, asi que solo existe en la cita. Sin citas, la
  inasistencia de todos los dias pasados queda en cero, que es un numero
  equivocado y no un numero que falte.
- La **jornada de un dia** y la **jornada habitual** se deducen de las citas de
  esos dias.
- El **registro de actividad** guarda punteros (`citaId`, `profesionalId`,
  codigo del turno). Borrado lo que apuntan, queda una lista de ids que no
  resuelven contra nada: se conserva la forma del historial, no el historial.

Vaciando solo las columnas personales no queda ni un dato de paciente y todo lo
anterior sigue exacto. Ademas no hace falta ninguna migracion.

**Tampoco se hace al cargar la agenda.** El reporte del hospital se sube a media
mañana, con pacientes ya presentados y turnos en la mano; encadenarle un borrado
es hacer lo mas peligroso del sistema en el peor momento, y sin que nadie lo haya
pedido esa vez. Ademas, un reporte que venga filtrado por un doctor o por media
jornada hoy solo produce un aviso; con borrado previo se llevaria agenda buena y
sin vuelta atras.

**Lo que la purga no toca nunca:** el dia de hoy y cualquier fecha futura. Esta
cortado en el servidor, no solo en la pantalla.

**Antes de hacer nada dice a cuanto alcanza** (dias, citas y turnos) y pide que
se teclee la fecha limite para confirmar. No se deshace. Queda apuntado con
quien lo pidio, cuando y con que limite —y este apunte concreto tambien se
guarda en la base de datos, porque el registro de actividad todavia vive en
memoria y se pierde al reiniciar.
