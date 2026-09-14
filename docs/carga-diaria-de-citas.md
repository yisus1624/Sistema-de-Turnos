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
`CONS 01- CONSULTA EXTERNA` a `Consultorio 1` es seguro.

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

Para lo que se cargo **antes** de que existiera esta regla —doctores que quedaron
todos como "dia completo"— esta el boton **Recalcular jornadas** en
*Configuracion › Profesionales*: hace lo mismo sobre las citas de los ultimos 30
dias, sin volver a subir nada.

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
