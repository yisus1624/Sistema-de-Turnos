# Puesta en marcha en el hospital

Guia del montaje del servidor. Para el televisor de la sala de espera, ver
[pantalla-en-el-televisor.md](pantalla-en-el-televisor.md).

## Antes de empezar

Copiar `.env.example` a `.env.local` y rellenarlo. Ese archivo documenta cada
variable; aqui va el orden en que hay que hacer las cosas.

## 1. Contrasenas de las cuentas semilla

El sistema arranca con dos cuentas de ejemplo (`admin` y `operador`) cuyas
contrasenas por defecto **estan escritas en el codigo y son publicas**. Definir
`TURNOS_ADMIN_PASSWORD` y `TURNOS_OPERADOR_PASSWORD` ANTES de conectar el
servidor a la red del hospital.

Si se olvida, al arrancar el servidor lo grita por consola en rojo (ver
`instrumentation.ts`). No es un aviso decorativo: sin eso, cualquiera que haya
visto el repositorio entra como administrador.

## 2. HTTPS

**Decidido: el sistema va detras de HTTPS.**

Sin HTTPS, todo viaja en texto plano por la red del hospital, incluidas las
contrasenas de los funcionarios cada vez que entran. Con HTTPS va cifrado.

El sistema NO termina el HTTPS por si mismo: delante va un **proxy inverso**
(Caddy, nginx o Apache) que recibe las conexiones cifradas y se las pasa por
dentro. Caddy es el mas simple porque gestiona el certificado solo.

Lo que hay que resolver con la oficina de sistemas:

- [ ] Un nombre en el DNS interno (ej. `turnos.hospital.local`), no una IP
      suelta: si algun dia cambia la IP del servidor, no hay que ir maquina por
      maquina cambiando el acceso directo del televisor y el de cada ventanilla.
- [ ] El certificado para ese nombre. Si es de una autoridad interna del
      hospital, **hay que instalarlo tambien en el equipo del televisor**, o el
      navegador se plantara con un aviso de seguridad y la sala de espera se
      queda sin pantalla.
- [ ] Que el proxy sea el UNICO camino hasta la aplicacion: el puerto de Next no
      puede quedar accesible por su cuenta, o se rodea todo lo anterior.

Una vez montado:

- Poner `NEXTAUTH_URL` con la direccion definitiva (`https://turnos.hospital.local`).
- Poner `TURNOS_CONFIAR_PROXY=1`. Solo entonces se confia en la IP que reporta
  el proxy, y se activa el limite de intentos de entrada por IP.

## 3. HSTS: lo ULTIMO, y solo cuando todo lo demas funcione

`TURNOS_HSTS=1` le dice al navegador "a este servidor entra siempre por HTTPS".

**Es de ida y no de vuelta.** En cuanto un navegador recibe esa cabecera, se
niega a entrar por http a este servidor durante un ano, y no hay forma de
desdecirlo desde el servidor: hay que ir maquina por maquina a limpiarlo. Si se
enciende antes de que el certificado funcione, el hospital se queda sin acceso
al sistema.

El orden correcto:

1. Montar el proxy con el certificado.
2. Comprobar que entran **todos**: administracion, cada ventanilla, los enlaces
   de los medicos y **el televisor de la sala de espera**.
3. Solo entonces, poner `TURNOS_HSTS=1`.

**OJO: esta variable se lee AL COMPILAR, no al arrancar.** Ponerla y reiniciar
el servidor no hace nada. Hay que volver a ejecutar `npm run build` con la
variable puesta. Si no coinciden, el servidor avisa por consola al arrancar,
para que no se quede nadie creyendo que activo una proteccion que no esta
activa.

## 4. Cuentas de los funcionarios

**Una cuenta por persona.** No una por mostrador, ni una compartida por turno.

No es burocracia: el sistema guarda QUIEN hizo cada cosa —quien agendo la cita,
quien la cancelo y por que, quien registro la llegada, quien llamo el turno y
quien lo cerro—, y todo eso es lo que se mira cuando un paciente reclama. Con una
cuenta compartida, la respuesta a "¿quien le cancelo la cita a este señor?" es
"operador", que no es una respuesta.

Ademas, con cuentas individuales:

- Cuando alguien se va del hospital, se desactiva su cuenta y ya. Con una cuenta
  compartida hay que cambiarle la contrasena a todo el mundo, y hasta que se
  haga, quien se fue sigue entrando.
- El limite de intentos de entrada no estorba. Va por usuario y cuenta solo los
  fallos; con varias personas usando la misma cuenta, un par de dedazos ajenos
  dejan fuera a los demas.
- Se le puede dar a cada uno exactamente las pantallas que necesita (ver
  `lib/permissions/rutas.ts`), en vez de dar el minimo comun a todos.

El administrador las crea en **Configuracion → Usuarios**.

## 5. Panel de simulacion

`TURNOS_SIMULACION` **vacia en produccion**. Ese panel borra las citas y los
turnos del dia de un clic, y no distingue una cita de ejemplo de una que acaba
de cargar el mostrador.

## Repaso final antes de entregar

- [ ] `NEXTAUTH_SECRET` definido y distinto del de desarrollo.
- [ ] Contrasenas semilla cambiadas.
- [ ] Se entra por `https://` y el candado del navegador sale limpio.
- [ ] `TURNOS_CONFIAR_PROXY=1`.
- [ ] `TURNOS_SIMULACION` vacia.
- [ ] `TURNOS_HSTS=1` **y recompilado**, despues de comprobar que entran todos.
- [ ] El servidor arranca sin ningun aviso en rojo ni amarillo por consola.
- [ ] Una cuenta por funcionario, con sus secciones.
