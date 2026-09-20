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

Y con `NODE_ENV=production`, **`npm run db:seed` directamente se niega a
sembrar** si esas variables faltan, si traen la contrasena de ejemplo o si
tienen menos de 12 caracteres. Corta antes de escribir nada en la base, asi que
basta con corregir el entorno y volver a ejecutarlo.

En desarrollo los valores por defecto siguen funcionando, para levantar el
entorno sin friccion.

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

## 3. Limite de peticiones: que nadie pueda tumbar el servidor

**Esto lo hace el proxy, NO la aplicacion, y hay una razon.**

Dentro de Node la IP del que pide no se ve: solo llega si el proxy la escribe
en una cabecera, y una cabecera la pone quien quiera. Limitar por un dato que
el atacante controla no protege de nada —cambia la IP en cada peticion y sigue
pasando— y ademas deja bloquear a un tercero poniendo la suya. El proxy si ve
la IP real de la conexion, que no se puede falsificar. Por eso el tope de
peticiones va ahi.

Sin esto, cualquiera dentro de la red del hospital puede lanzar miles de
peticiones por segundo contra el sistema y dejarlo sin atender a nadie. No hace
falta ninguna vulnerabilidad: basta con pedir mucho.

### La cabecera de la IP: SOBRESCRIBIR, nunca anadir

El ejemplo que sale en casi todos los tutoriales de nginx es este, y **aqui
esta mal**:

```nginx
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;   # NO
```

`$proxy_add_x_forwarded_for` ANADE la IP real detras de lo que ya trajera el
cliente. Si alguien manda a mano `X-Forwarded-For: 1.2.3.4`, al servidor le
llega `1.2.3.4, <ip real>`, y la aplicacion se queda con la PRIMERA de la lista
(ver `contextoPeticion` en `lib/seguridad/registro.ts`): la que escribio el
atacante. El limite de intentos de entrada por IP pasaria a contar una IP
inventada distinta cada vez, y el registro de actividad guardaria origenes
falsos.

Lo correcto es descartar lo que venga y poner la IP de la conexion:

```nginx
proxy_set_header X-Forwarded-For $remote_addr;                 # SI
```

### nginx

`limit_req` viene de serie, no hace falta ningun anadido. Las zonas van en el
bloque `http` y el resto dentro del `server` que ya sirve el HTTPS de la
seccion 2:

```nginx
# --- en el bloque http ---
# 10 MB de zona guardan del orden de 160.000 IPs distintas.
limit_req_zone  $binary_remote_addr zone=turnos_general:10m rate=20r/s;
limit_req_zone  $binary_remote_addr zone=turnos_login:10m   rate=1r/s;
limit_conn_zone $binary_remote_addr zone=turnos_conn:10m;

server {
    listen 443 ssl;
    server_name turnos.hospital.local;

    # ssl_certificate / ssl_certificate_key: ver seccion 2.

    # El reporte de citas se sube por aqui. El tope de la aplicacion son 10 MB
    # (ver app/api/turnos/citas/importar); 12 deja margen para la envoltura del
    # formulario. Si esto se queda corto, nginx corta la subida con un 413
    # antes de que la aplicacion pueda explicar nada.
    client_max_body_size 12m;

    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $remote_addr;   # SOBRESCRIBE (ver arriba)
    proxy_set_header X-Forwarded-Proto $scheme;

    # Entrada al sistema: es donde se prueban contrasenas a lo bruto. Muy
    # apretado a proposito —una persona entra una vez por jornada— y ademas la
    # aplicacion lleva su propio limite por usuario, que no depende de la IP.
    location /api/auth/ {
        limit_req zone=turnos_login burst=5 nodelay;
        limit_req_status 429;
        proxy_pass http://127.0.0.1:3000;
    }

    # Canal en vivo (SSE). NO lleva limite de peticiones: es UNA peticion que
    # dura horas, asi que un tope por segundo no le aplica; lo que hay que
    # acotar son las conexiones simultaneas. El tope global de conexiones lo
    # lleva ademas la aplicacion (TURNOS_MAX_CANAL_EN_VIVO).
    #
    # `proxy_buffering off` es OBLIGATORIO: con el buffer puesto, nginx se
    # guarda los eventos en vez de pasarlos, y la pantalla de la sala de espera
    # se queda muda sin dar ningun error. El timeout largo evita que corte la
    # conexion entre latido y latido.
    location = /api/turnos/stream {
        limit_conn turnos_conn 10;
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 1h;
    }

    # Todo lo demas.
    #
    # 20 por segundo con rafagas de 40 esta MUY por encima de lo que hace una
    # pantalla normal (el televisor se resincroniza cada pocos segundos, una
    # ventanilla pide al ritmo al que teclea una persona) y muy por debajo de
    # lo que hace falta para saturar el servidor. Si alguna pantalla empieza a
    # recibir 429 en uso normal, se sube el `rate`; no se quita el limite.
    location / {
        limit_req zone=turnos_general burst=40 nodelay;
        limit_req_status 429;
        limit_conn turnos_conn 50;

        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### Caddy

Caddy gestiona el certificado solo, pero **el limite de peticiones no viene en
el binario normal**: hay que bajar uno con el modulo `caddy-ratelimit` desde
`caddyserver.com/download` (se marca el modulo en la pagina; no hay que
compilar nada). Si se usa el binario de serie, no hay rate limiting: en ese
caso, nginx.

```caddy
turnos.hospital.local {
    tls /ruta/al/certificado.pem /ruta/a/la/clave.pem

    rate_limit {
        zone turnos_login {
            match { path /api/auth/* }
            key    {remote_host}
            events 5
            window 10s
        }
        zone turnos_general {
            key    {remote_host}
            events 200
            window 10s
        }
    }

    # Caddy pone X-Forwarded-For por su cuenta ANADIENDO a lo que traiga el
    # cliente, igual que nginx. Hay que descartarlo primero (ver arriba).
    request_header -X-Forwarded-For
    reverse_proxy 127.0.0.1:3000 {
        header_up X-Forwarded-For {remote_host}
        flush_interval -1          # sin buffer: necesario para el canal en vivo
    }
}
```

### Al terminar

- [ ] `TURNOS_CONFIAR_PROXY=1` en el entorno. **Solo entonces** la aplicacion
      hace caso a la IP del proxy, y se encienden los limites por IP que ya
      lleva escritos (entrada al sistema y enlaces de consultorio). Sin proxy
      delante, esa variable NO se pone: el sistema prefiere no tener IP a tener
      una inventada.
- [ ] El puerto 3000 cerrado desde fuera. Si se puede llegar a Next sin pasar
      por el proxy, todo lo anterior se rodea escribiendo la direccion con el
      puerto.
- [ ] Probado que la pantalla del televisor aguanta una jornada entera sin
      quedarse muda (es lo que rompe el buffer del proxy, y no avisa).
- [ ] Probado que subir el reporte de citas del dia funciona (es lo que rompe
      `client_max_body_size`).

## 4. HSTS: lo ULTIMO, y solo cuando todo lo demas funcione

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

## 5. Cuentas de los funcionarios

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

## 6. Panel de simulacion

`TURNOS_SIMULACION` **vacia en produccion**. Ese panel borra las citas y los
turnos del dia de un clic, y no distingue una cita de ejemplo de una que acaba
de cargar el mostrador.

## Repaso final antes de entregar

- [ ] `NEXTAUTH_SECRET` definido y distinto del de desarrollo.
- [ ] Contrasenas semilla cambiadas.
- [ ] Se entra por `https://` y el candado del navegador sale limpio.
- [ ] El proxy limita las peticiones por IP (seccion 3) y escribe
      `X-Forwarded-For` SOBRESCRIBIENDO, no anadiendo.
- [ ] `TURNOS_CONFIAR_PROXY=1`.
- [ ] El puerto 3000 no se alcanza desde fuera del servidor.
- [ ] `TURNOS_SIMULACION` vacia.
- [ ] `TURNOS_HSTS=1` **y recompilado**, despues de comprobar que entran todos.
- [ ] El servidor arranca sin ningun aviso en rojo ni amarillo por consola.
- [ ] Una cuenta por funcionario, con sus secciones.

## Dependencias fijadas a mano (`overrides` de `package.json`)

`package.json` no admite comentarios, asi que el porque de cada fijacion queda
aqui. Todas salen de avisos de `npm audit` y se quitan en cuanto el paquete de
arriba las arregle por su cuenta:

- `brace-expansion`: version con la correccion de la denegacion de servicio por
  expansion sin tope (la arrastran `eslint` y `exceljs` por caminos distintos).
- `exceljs > uuid`: `exceljs` pide una version de `uuid` con un fallo de limites
  de buffer. Solo se usa al escribir archivos y con `v4`, que no es la ruta
  afectada, pero subirla no rompe nada (comprobado con ida y vuelta de un
  `.xlsx`), asi que se sube.
- `deepmerge-ts`: lo arrastra el CLI de Prisma, que solo corre al compilar. Se
  sube para dejar el informe de `npm audit` en cero y poder ver de un vistazo
  cuando aparezca algo nuevo de verdad.

Despues de tocar cualquiera de estas: `npm run verify`.
