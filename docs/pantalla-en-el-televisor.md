# Poner la pantalla de turnos en el televisor

La pantalla (`/pantalla`) es una pagina web normal: lo unico que hace falta es un
televisor que muestre un navegador. Esta es la guia practica para el montaje.

## Lo que hay que resolver

1. Algo que corra un navegador y lo pinte en el televisor.
2. Que arranque solo, a pantalla completa, sin barras ni avisos.
3. Que tenga **sonido**, porque el llamado se anuncia por voz.
4. Que tenga una **voz en español de Colombia** instalada.

## Opciones, de mejor a peor

### 1. Mini PC con Windows conectado al televisor por HDMI  ← recomendada

Es lo que mejor funciona y lo mas facil de arreglar cuando algo falla.

- Sirve cualquier mini PC barato o un computador viejo de la institucion.
- El televisor se usa solo como monitor: no importa la marca ni si es "smart".
- El audio sale por el HDMI al televisor, o por un parlante conectado al mini PC.
- **Permite instalar la voz colombiana**, que es la razon principal para preferirla.

Configuracion:

1. Instalar la voz de español (Colombia):
   Configuracion → Hora e idioma → Idioma y region → Agregar idioma →
   "Español (Colombia)" → marcar **Voz**. Reiniciar.
2. Abrir **Microsoft Edge** (trae las voces neuronales, que suenan a persona y no
   a robot) en `http://IP-DEL-SERVIDOR:3000/pantalla`.
3. Pulsar **Activar pantalla** una vez. Este clic es obligatorio: ningun
   navegador deja reproducir audio sin un gesto del usuario.
4. Pantalla completa con `F11`.

Para que arranque solo al prender el equipo, crear un acceso directo en la
carpeta de inicio (`Win+R` → `shell:startup`) con:

```
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --kiosk http://IP-DEL-SERVIDOR:3000/pantalla --edge-kiosk-type=fullscreen --no-first-run
```

Ojo: en modo kiosco alguien tiene que pulsar **Activar pantalla** despues de cada
reinicio. Conviene reiniciar el equipo solo cuando haya personal en la sala.

### 2. Televisor "smart" con navegador propio

Funciona para ver los turnos, pero **el audio casi nunca sirve**: los navegadores
de los televisores Samsung, LG y Android TV traen pocas voces o ninguna en
español, y el sistema entonces se queda callado a proposito (ver mas abajo).

Uselo solo si acepta tener la pantalla sin voz, o combinado con un parlante
manejado desde otro equipo.

### 3. Chromecast / duplicar la pantalla de un computador

Sirve para una demostracion rapida, no para el dia a dia: cualquiera que use ese
computador tumba la pantalla, y la duplicacion suele cortar el audio.

## La voz

El sistema **prefiere siempre la voz de español de Colombia**. Si no la
encuentra, busca otra latinoamericana, luego una de España. Y si el equipo no
tiene **ninguna** voz en español, **no habla**: es preferible el silencio a que
una voz inglesa lea los turnos.

La pantalla dice cual voz esta usando antes de activarse. Si avisa que no hay
voces en español, siga el paso 1 de la opcion 1.

## Prueba de aceptacion antes del montaje

En el equipo que va a quedar conectado al televisor:

1. Abrir `/pantalla` y pulsar **Activar pantalla**.
2. Confirmar que abajo dice una voz que empiece por "Spanish (Colombia)".
3. Desde otro computador, llamar un turno.
4. Verificar que en el televisor: suena la campanita, se dice el turno y el
   consultorio (nunca el nombre del paciente), se repite una vez tras dos
   segundos, y el turno queda listado a la izquierda.
5. Alejarse unos 8 metros y comprobar que el codigo del turno se lee sin
   esfuerzo. Si no, acercar el televisor o subir su tamaño.

## Red

El televisor y los computadores de los funcionarios tienen que ver al servidor
por la red interna del hospital. Anote la IP fija del servidor: si cambia, hay
que actualizar el acceso directo del televisor y el de cada ventanilla.
