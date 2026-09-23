# Poner la pantalla de turnos en el televisor

La pantalla (`/pantalla`) es una pagina web normal: lo unico que hace falta es
algo que muestre un navegador en el televisor.

## Lo que hay que resolver

1. Algo que corra un navegador y lo pinte en el televisor.
2. Que arranque solo, a pantalla completa, sin barras ni avisos.
3. Que tenga **sonido**, porque cada llamado suena con una campanita.
4. Que aguante **dias encendido sin que nadie lo toque**.

**No hace falta instalar ninguna voz.** El sistema no lee los turnos en voz
alta: suena una campanita corta e igual para todos, y QUE turno paso y a que
consultorio va se leen en la pantalla. Si alguien encuentra instrucciones para
instalar voces en español, son de una version anterior y ya no aplican.

## El televisor no necesita cable HDMI largo hasta el servidor

Es la confusion mas comun. El servidor esta en internet (una VPS) y **no se
conecta al televisor**: el televisor (o el equipito que lo maneja) se conecta al
servidor **por internet**, como cualquier computador del hospital, y abre la
direccion web del sistema: `https://DOMINIO-DEL-SISTEMA/pantalla` (el dominio
real lo da quien monto el servidor; ver `docs/despliegue.md`).

Siempre `https://` y siempre el dominio, **nunca** una IP con `:3000`: ese
puerto esta cerrado en el servidor a proposito y por ahi no se llega.

Lo unico que viaja por HDMI es el medio metro entre el equipito y el televisor,
si se usa la opcion 1.

## Opciones, de mejor a peor

### 1. Mini PC o Raspberry Pi pegado detras del televisor ← recomendada

Un equipito barato colgado detras del televisor, con un HDMI corto, conectado a
la red del hospital con salida a internet (mejor por cable que por wifi).

Es lo que mejor aguanta y lo mas facil de arreglar cuando algo falla: es un
navegador de escritorio de verdad, con su sonido, su pantalla completa y su
modo kiosco.

Configuracion en Windows:

1. Abrir **Microsoft Edge** o **Chrome** en `https://DOMINIO-DEL-SISTEMA/pantalla`.
2. La pantalla muestra los turnos en cuanto carga, sin pulsar nada. Si arriba
   a la derecha aparece un aviso ambar —**Sonido desactivado: toca para
   activar** en pantallas anchas, o **Activar sonido** en las de menos de 1536
   px de ancho—, el navegador
   esta bloqueando el audio. Tocar el aviso lo activa, suena una campanada de
   prueba al volumen configurado y pone la pantalla completa. Tocar cualquier
   otra parte de la pantalla tambien activa el sonido, pero sin campanada de
   prueba ni pantalla completa. Con el modo kiosco de abajo ese aviso no sale.
3. Llamar un turno de prueba desde otro equipo y comprobar que suena.

#### Modo kiosco: que arranque solo, a pantalla completa y con sonido

Crear un acceso directo en la carpeta de inicio (`Win+R` → `shell:startup`) con
UNA de estas dos lineas (todo en una sola linea):

Edge:

```
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --kiosk https://DOMINIO-DEL-SISTEMA/pantalla --edge-kiosk-type=fullscreen --no-first-run --autoplay-policy=no-user-gesture-required --user-data-dir=C:\turnos-kiosco
```

Chrome:

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk https://DOMINIO-DEL-SISTEMA/pantalla --no-first-run --autoplay-policy=no-user-gesture-required --user-data-dir=C:\turnos-kiosco
```

Que hace cada parte:

- `--kiosk`: pantalla completa, sin barras ni pestañas. Para salir: `Alt+F4`.
- `--autoplay-policy=no-user-gesture-required`: deja sonar la campanita **sin
  que nadie toque la pantalla**. Solo afecta a este navegador de kiosco, no al
  resto del equipo.
- `--user-data-dir=C:\turnos-kiosco`: un perfil aparte solo para la pantalla.
  **No es opcional**: si ya hay otra ventana de Edge o Chrome abierta (o Edge
  quedo corriendo en segundo plano, que lo hace por defecto), el navegador
  ignora todos los parametros de la linea y abre una ventana normal, sin kiosco
  y sin permiso de sonido. Con un perfil propio siempre arranca como debe.

**Tras un reinicio o un corte de luz, el televisor vuelve solo.** Al arrancar,
el equipo abre el acceso directo, la pantalla muestra los turnos y se conecta
sin que nadie haga nada; con este acceso directo tambien vuelve el sonido. Si
se abriera sin el modo kiosco, los turnos se ven igual y solo el sonido espera
a que alguien toque el aviso **Sonido desactivado: toca para activar**. Si la
sala se habia dejado en mudo con el boton del altavoz, sigue en mudo.

Ademas, en ese equipo:

- Energia: que la pantalla y el equipo **nunca** se suspendan.
- Windows Update: fijar las "horas activas" en el horario de atencion, para que
  no reinicie a media jornada.
- Si se va la luz, que el equipo arranque solo al volver (opcion de la BIOS,
  normalmente "Restore on AC power loss" o parecida).

### 2. Televisor "smart" con su propio navegador

Sin equipito de por medio: se abre el navegador del televisor y se escribe
`https://DOMINIO-DEL-SISTEMA/pantalla`. Es lo mas barato y no necesita ningun
cable mas que la corriente.

Funciona, pero hay que probarlo en ESE televisor antes de confiarle la sala,
porque los navegadores de los televisores son viejos y limitados. Lo que hay que
verificar, en este orden:

- Que la campanita **suene** al llamar un turno (muchos son muy estrictos con el
  audio automatico: si aparece el aviso **Sonido desactivado: toca para
  activar**, hay que tocarlo despues de cada encendido).
- Que despues de **una hora larga** siga actualizandose sola. Algunos televisores
  cortan la conexion en segundo plano o duermen la pagina, y entonces la pantalla
  se queda congelada mostrando turnos viejos **sin avisar de nada**. Es el fallo
  peligroso: se ve normal y esta mintiendo.
- Que no entre en reposo ni saque salvapantallas.

Si alguna de las tres falla, opcion 1.

### 3. Chromecast / duplicar la pantalla de un computador

Para una demostracion rapida, no para el dia a dia: cualquiera que use ese
computador tumba la pantalla, y la duplicacion suele cortar el audio.

## El sonido

Cada llamado suena una vez. Si varios consultorios pasan paciente casi al mismo
tiempo, las campanadas **se separan un segundo entre si** para que no se pisen:
pasan tres pacientes, se oyen tres campanadas y la sala las puede contar.

El nombre del paciente **nunca** sale por el altavoz, ni aparece en el televisor.

## Prueba de aceptacion antes del montaje

En el equipo que va a quedar conectado al televisor:

1. Abrir `/pantalla` (con el acceso directo de kiosco) y comprobar que se ven
   los turnos y que NO aparece el aviso de sonido desactivado.
2. Desde otro computador, llamar un turno.
3. Verificar que en el televisor: suena la campanita y la casilla de ese
   consultorio cambia al turno nuevo, con el codigo grande.
4. Llamar dos turnos seguidos desde dos consultorios distintos y comprobar que
   se oyen **dos** campanadas separadas, no una.
5. Alejarse unos 8 metros y comprobar que el codigo del turno se lee sin
   esfuerzo. Si no, acercar el televisor o subir su tamaño.
6. Dejarlo una hora largo y volver a llamar un turno: tiene que seguir
   respondiendo al instante.

## Red

El servidor esta en internet, asi que el equipo del televisor solo necesita
**salida a internet** y abrir `https://DOMINIO-DEL-SISTEMA/pantalla`. No hace
falta anotar ninguna IP: se usa siempre el dominio, y si algun dia cambia el
servidor, el dominio se mueve con el y no hay que tocar el televisor.

Si se cae o se pone lento el internet del hospital, la pantalla muestra que esta
reconectando y **vuelve sola** cuando vuelve la red, sin que nadie la recargue.
Mientras tanto no se pierden turnos: al reconectar se pone al dia con lo que
paso durante el corte.
