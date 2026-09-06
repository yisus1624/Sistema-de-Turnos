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

Es la confusion mas comun. El servidor **no se conecta al televisor**: el
televisor (o el equipito que lo maneja) se conecta al servidor **por la red**,
como cualquier computador del hospital, y abre una direccion web.

Lo unico que viaja por HDMI es el medio metro entre el equipito y el televisor,
si se usa la opcion 1.

## Opciones, de mejor a peor

### 1. Mini PC o Raspberry Pi pegado detras del televisor ← recomendada

Un equipito barato colgado detras del televisor, con un HDMI corto, conectado a
la red del hospital (mejor por cable que por wifi).

Es lo que mejor aguanta y lo mas facil de arreglar cuando algo falla: es un
navegador de escritorio de verdad, con su sonido, su pantalla completa y su
modo kiosco.

Configuracion en Windows:

1. Abrir **Microsoft Edge** o **Chrome** en `http://IP-DEL-SERVIDOR:3000/pantalla`.
2. Pulsar **Activar pantalla** una vez. Este clic es obligatorio y no hay forma
   de saltarselo: ningun navegador deja sonar audio sin un gesto de una persona.
   Ese mismo clic pone la pantalla completa.
3. Comprobar el sonido con el enlace **Probar sonido** antes de dejarlo montado.

Para que arranque solo al prender el equipo, crear un acceso directo en la
carpeta de inicio (`Win+R` → `shell:startup`) con:

```
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --kiosk http://IP-DEL-SERVIDOR:3000/pantalla --edge-kiosk-type=fullscreen --no-first-run
```

Ojo: despues de cada reinicio alguien tiene que pulsar **Activar pantalla** para
que vuelva el sonido. Conviene reiniciar el equipo solo cuando haya personal en
la sala.

### 2. Televisor "smart" con su propio navegador

Sin equipito de por medio: se abre el navegador del televisor y se escribe
`http://IP-DEL-SERVIDOR:3000/pantalla`. Es lo mas barato y no necesita ningun
cable mas que la corriente.

Funciona, pero hay que probarlo en ESE televisor antes de confiarle la sala,
porque los navegadores de los televisores son viejos y limitados. Lo que hay que
verificar, en este orden:

- Que la campanita **suene** al llamar un turno (muchos son muy estrictos con el
  audio automatico; el boton "Activar pantalla" existe justamente para eso).
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

1. Abrir `/pantalla` y pulsar **Activar pantalla**.
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

El televisor y los computadores de los funcionarios tienen que ver al servidor
por la red interna del hospital. **Anote la IP fija del servidor**: si cambia,
hay que actualizar el acceso directo del televisor y el de cada ventanilla.

Lo ideal es pedirle a sistemas un nombre en el DNS interno (por ejemplo
`turnos.hospital.local`) y usar ese en todas partes: asi, si algun dia cambia la
IP del servidor, no hay que ir maquina por maquina.
