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

**Decidido: el sistema va en una VPS en internet, detras de nginx y con HTTPS.**

Sin HTTPS, todo viaja en texto plano por internet, incluidas las contrasenas de
los funcionarios cada vez que entran. Con HTTPS va cifrado.

El sistema NO termina el HTTPS por si mismo: delante va un **proxy inverso**
(nginx, o Caddy) que recibe las conexiones cifradas y se las pasa por dentro.

Lo que hay que resolver:

- [ ] Un **dominio** que apunte a la IP de la VPS (en esta guia,
      `DOMINIO-DEL-SISTEMA`). No una IP suelta: si algun dia cambia la VPS, no
      hay que ir maquina por maquina cambiando el acceso directo del televisor y
      el de cada ventanilla.
- [ ] El certificado para ese dominio. Con un dominio publico, Let's Encrypt
      (`certbot --nginx`) lo emite y lo renueva solo.
- [ ] Que el proxy sea el UNICO camino hasta la aplicacion: el puerto 3000 de
      Next cerrado en el firewall de la VPS, o se rodea todo lo anterior.

**No hace falta saber la IP del hospital.** Todos sus equipos salen a internet
por la misma IP, que el proveedor cambia cuando quiere; el sistema esta
dimensionado para funcionar detras de una IP cualquiera sin configurarla (ver
seccion 3).

Una vez montado:

- Poner `NEXTAUTH_URL` con la direccion definitiva (`https://DOMINIO-DEL-SISTEMA`).
- Poner `TURNOS_CONFIAR_PROXY=1`. Solo entonces se confia en la IP que reporta
  el proxy, y se activan los frenos por IP.

## 3. Limites: que nadie tumbe el servidor, sin tumbar al hospital

### El dato que lo cambia todo: el hospital entero es UNA sola IP

Los 10-12 consultorios, admision, el operador, el administrador y el PC del
televisor (unas 20-30 pantallas, algunas con varias pestañas) salen a internet
por el mismo NAT. Para nginx y para la aplicacion son **un unico origen**, y
esa IP **cambia sin aviso**. No se le pide a nadie ni se configura en ninguna
parte, igual que una app de domicilios no le pide la IP a una casa desde donde
entran diez personas.

De ahi salen dos reglas:

1. **Los topes por IP se quedan, pero altos.** Son la defensa contra un script
   o un equipo desbocado que lanza miles de peticiones: eso si los alcanza. Una
   oficina entera trabajando, incluida la reconexion masiva despues de un corte
   de internet, no los alcanza nunca.
2. **La proteccion fina va por cuenta, por enlace y por sesion**, que no
   dependen de la IP: quien prueba contrasenas contra una cuenta la deja en
   espera a ella, no al hospital; un enlace de consultorio vencido se frena solo
   a si mismo; las consultas caras se frenan por usuario.

Con la version anterior de esta guia (10 conexiones al canal por IP, 1 intento
de entrada por segundo para todo el hospital), la prueba de QA con 18 pantallas
tras una IP y un corte de un minuto termino con 2 de 18 reconectadas, y unos
pocos funcionarios entrando a la vez recibian 429 en el JavaScript: pantallas
en blanco.

### Las capas, de fuera hacia dentro

| Capa | Que frena | Valor | Por que ese valor |
| --- | --- | --- | --- |
| nginx, `limit_req` general por IP | Rafagas de peticiones a rutas dinamicas | 60/s, rafaga 300 | 30 pantallas recargando a la vez tras un corte piden unos cientos de peticiones en pocos segundos; un script pide miles por segundo. Los archivos de `/_next/static/` no cuentan. |
| nginx, `limit_req` de rutas caras por IP | Historico, estadisticas, importar, purga | 2/s, rafaga 20 | Cada una ocupa la base durante segundos. Varios administradores consultando no llegan; un bucle si. |
| nginx, `limit_req` del login por IP | Envio de usuario y contrasena | 10/s, rafaga 50 | Todo el personal entrando a las 7:00 cabe. La fuerza bruta la frena la aplicacion por cuenta. |
| nginx, `limit_conn` por IP | Conexiones simultaneas | Canal: 120 (zona propia). Resto: 200 (otra zona) | Dos zonas separadas: en HTTP/2 cada peticion cuenta como conexion, y compartiendo zona las pantallas conectadas se comian el cupo de las peticiones normales. El del canal va por encima del tope de la aplicacion (100) para que responda ella con un mensaje claro. |
| nginx, tiempos | Conexiones lentas a proposito (slowloris) | Cabeceras y cuerpo: 15 s. Envio: 30 s | Una peticion legitima manda cabeceras en milisegundos. |
| nginx, tamaño del cuerpo | Subidas gigantes | 1 MB; 12 MB solo en importar | El unico archivo que se sube es el reporte de citas (tope de la aplicacion: 10 MB). |
| App, canal en vivo por IP | Pantallas conectadas desde un origen | 100 (`TURNOS_MAX_CANAL_EN_VIVO_POR_ORIGEN`) | 30 pantallas mas las conexiones colgadas de un corte, que el servidor recicla cada 4-6 min. |
| App, canal en vivo global | Memoria del servidor | 2000 (`TURNOS_MAX_CANAL_EN_VIVO`) | Con 300, tres IPs atacantes con su tope lleno dejaban la sala sin pantalla. Cada conexion cuesta poco. |
| App, login por cuenta y origen | Fuerza bruta contra un usuario | 8 fallos en 15 min | La cuenta queda en espera EN ESA IP (y se le dice asi): un atacante de fuera no deja sin entrar al dueño que esta en el hospital. |
| App, login por cuenta | Ataque repartido entre muchas IPs | 50 fallos en 15 min | Lo que la capa anterior no ve. |
| App, login por IP | Probar cientos de cuentas | 300 fallos en 15 min | Solo cuentan fallos, y el acierto de otra cuenta no los borra. 30 funcionarios con 3 dedazos son 90. |
| App, enlace de consultorio | Enlace vencido recargando / tokens al azar | 30 fallos por enlace; 500 por IP, en 5 min | Varios enlaces vencidos del hospital no dejan fuera al doctor con su enlace bueno. |
| App, consultas caras | Informes en bucle | Por usuario y por IP (ver `lib/seguridad/freno-consultas.ts`); 4 a la vez en todo el servidor | Siempre sobran conexiones de la base para el llamado y el login. |
| App, historico | Traerse la tabla entera | Sin fechas: hoy. Rango: 92 dias. Techo: 10.000 filas | Un informe trimestral cabe; "todo desde siempre" no. |
| App, pantalla publica | Refrescos del televisor | Cache de 1,5 s compartida | Mil peticiones a la vez hacen UNA consulta. |
| Base de datos | Que un pico deje sin conexiones | `connection_limit=10`, `pool_timeout=10`, `statement_timeout` 20 s | Ver "Base de datos" abajo. |

### La cabecera de la IP: SOBRESCRIBIR, nunca anadir

El ejemplo que sale en casi todos los tutoriales de nginx es este, y **aqui
esta mal**:

```nginx
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;   # NO
```

`$proxy_add_x_forwarded_for` ANADE la IP real detras de lo que ya trajera el
cliente. Si alguien manda a mano `X-Forwarded-For: 1.2.3.4`, al servidor le
llega `1.2.3.4, <ip real>`. La aplicacion ya se defiende —toma la ULTIMA de la
lista, que es la que pone nginx (ver `ipReenviadaPorElProxy` en
`lib/seguridad/origen.ts`)—, pero lo correcto es no dejar pasar nada del
cliente:

```nginx
proxy_set_header X-Forwarded-For $remote_addr;                 # SI
```

**Si algun dia se pone un CDN delante de nginx (por ejemplo Cloudflare)**,
`$remote_addr` pasa a ser la IP del CDN y todos los limites por IP contarian al
CDN entero como un solo cliente. Entonces hay que decirle a nginx de quien fiarse
para leer la IP real, con el modulo `realip` (viene de serie):

```nginx
# Rangos publicados por el CDN (Cloudflare los lista en cloudflare.com/ips).
set_real_ip_from 173.245.48.0/20;     # ...uno por rango del CDN
real_ip_header   CF-Connecting-IP;    # o X-Forwarded-For, segun el CDN
```

Con eso `$remote_addr` vuelve a ser la IP del cliente y el resto de la
configuracion sigue igual. Sin CDN, **no** se pone: cualquiera podria escribir
esa cabecera.

### La trampa de la herencia de `proxy_set_header`

En nginx, **una `location` que define un solo `proxy_set_header` pierde TODOS
los del nivel `server`**. No se suman: se reemplazan. Una configuracion anterior
de esta guia caia en eso: el canal en vivo y `location /` ponian su propia
cabecera `Connection`, y con ello perdian `Host`, `X-Real-IP`,
`X-Forwarded-For` y `X-Forwarded-Proto`: el `X-Forwarded-For` que escribiera el
cliente llegaba intacto (IP falsificable) y `Host` llegaba como
`127.0.0.1:3000`.

Por eso todas las cabeceras van en UN archivo que cada `location` incluye
entero, y ninguna `location` escribe un `proxy_set_header` suelto.

### nginx

`/etc/nginx/snippets/turnos-proxy.conf` — lo incluye cada `location`:

```nginx
proxy_pass         http://turnos_app;
proxy_http_version 1.1;
proxy_set_header   Connection        "";
proxy_set_header   Host              $host;
proxy_set_header   X-Real-IP         $remote_addr;
proxy_set_header   X-Forwarded-For   $remote_addr;   # SOBRESCRIBE (ver arriba)
proxy_set_header   X-Forwarded-Proto $scheme;
```

El sitio (`/etc/nginx/sites-available/turnos`). Las zonas y el `upstream`
pertenecen al bloque `http`; en Debian/Ubuntu los archivos de `sites-available`
ya se leen dentro de el, asi que pueden ir aqui mismo:

```nginx
# --- Zonas por IP (10 MB guardan del orden de 160.000 IPs) -----------------
limit_req_zone  $binary_remote_addr zone=turnos_general:10m rate=60r/s;
limit_req_zone  $binary_remote_addr zone=turnos_caros:10m   rate=2r/s;
limit_req_zone  $binary_remote_addr zone=turnos_login:10m   rate=10r/s;
# Dos zonas de conexiones: el canal en vivo y todo lo demas. En HTTP/2 cada
# peticion cuenta como una conexion; compartiendo zona, las pantallas conectadas
# se comerian el cupo de las peticiones normales de esa misma IP.
limit_conn_zone $binary_remote_addr zone=turnos_conn_canal:10m;
limit_conn_zone $binary_remote_addr zone=turnos_conn_general:10m;

upstream turnos_app {
    server 127.0.0.1:3000;
    keepalive 32;          # reutiliza conexiones con Next en vez de abrir una por peticion
    # MENOR que el keepAliveTimeout de Next (65 s, ver `npm run start`). Si nginx
    # reutiliza una conexion que Node esta cerrando justo en ese instante,
    # responde 502; nginx solo reintenta los GET, asi que lo que fallaba de vez
    # en cuando eran los POST clinicos: llamar, atendido, registrar llegada.
    keepalive_timeout 4s;   # esta directiva dentro de `upstream` exige nginx 1.15.3 o superior
}

server {
    listen 80;
    server_name DOMINIO-DEL-SISTEMA;
    return 301 https://$host$request_uri;
}

server {
    # HTTP/2 es OBLIGATORIO aqui. Con HTTP/1.1 el navegador abre como mucho 6
    # conexiones por servidor, y cada pestaña con canal en vivo se queda una
    # para siempre: con varias pestañas abiertas, las siguientes peticiones
    # (la fila, los botones) se quedan en cola sin que nadie sepa por que.
    listen 443 ssl;
    http2 on;         # nginx 1.25.1 o superior. En versiones anteriores:
                      # quitar esta linea y poner "listen 443 ssl http2;"
    server_name DOMINIO-DEL-SISTEMA;

    # ssl_certificate / ssl_certificate_key: los escribe certbot.

    # Contra conexiones lentas a proposito (slowloris): una peticion legitima
    # manda sus cabeceras en milisegundos.
    client_header_timeout 15s;
    client_body_timeout   15s;
    send_timeout          30s;
    client_max_body_size  1m;     # 12 MB solo donde se sube el reporte (abajo)

    limit_req_status  429;
    limit_conn_status 429;

    # Archivos del sistema (JavaScript, estilos). Llevan un hash en el nombre
    # y no cambian nunca: limitarlos solo deja pantallas en blanco cuando todo
    # el hospital carga a la vez.
    location ^~ /_next/static/ {
        include snippets/turnos-proxy.conf;
    }

    # Entrada al sistema: SOLO el envio de usuario y contrasena. Amplio por IP
    # (todo el hospital entra por la misma a las 7:00); la fuerza bruta la
    # frena la aplicacion por cuenta. /api/auth/session y /api/auth/csrf van
    # por la zona general.
    location = /api/auth/callback/credentials {
        limit_req zone=turnos_login burst=50 nodelay;
        include snippets/turnos-proxy.conf;
    }

    # Rutas caras: cada una ocupa la base durante segundos. Limite estricto y
    # un tiempo de respuesta largo, para que un informe pesado no termine en un
    # 504 a los 60 s por defecto.
    location ~ ^/api/turnos/(historico|estadisticas|citas/purga)$ {
        limit_req zone=turnos_caros burst=20 nodelay;
        include snippets/turnos-proxy.conf;
        proxy_read_timeout 120s;
    }

    # El reporte de citas se sube por aqui. El tope de la aplicacion son 10 MB
    # (ver app/api/turnos/citas/importar); 12 deja margen para la envoltura del
    # formulario. Si se queda corto, nginx corta la subida con un 413 antes de
    # que la aplicacion pueda explicar nada.
    location = /api/turnos/citas/importar {
        limit_req zone=turnos_caros burst=5 nodelay;
        client_max_body_size 12m;
        client_body_timeout  60s;
        include snippets/turnos-proxy.conf;
        proxy_read_timeout 180s;
    }

    # Canal en vivo (SSE). NO lleva limite de peticiones: es UNA peticion que
    # dura minutos. Se acotan las conexiones simultaneas por IP, por ENCIMA
    # del tope de la aplicacion (100): asi responde ella, con un mensaje claro,
    # y nginx queda de respaldo.
    #
    # `proxy_buffering off` es OBLIGATORIO: con el buffer puesto, nginx se
    # guarda los eventos en vez de pasarlos y la pantalla se queda muda.
    #
    # `proxy_read_timeout 90s`: el servidor late cada 20 s, asi que 90 s sin
    # recibir nada significa que la aplicacion se colgo; nginx corta y el
    # navegador reconecta solo.
    location = /api/turnos/stream {
        limit_conn turnos_conn_canal 120;
        include snippets/turnos-proxy.conf;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 90s;
    }

    # Todo lo demas: paginas, APIs de la operacion y la pantalla publica.
    # Si alguna pantalla recibe 429 en uso normal, se sube el `rate`; no se
    # quita el limite.
    location / {
        limit_req  zone=turnos_general burst=300 nodelay;
        limit_conn turnos_conn_general 200;
        include snippets/turnos-proxy.conf;
    }
}
```

Despues de cambiarlo: `sudo nginx -t` (tiene que decir "syntax is ok") y
`sudo systemctl reload nginx`.

### Varias pestañas en el mismo equipo: por que HTTP/2 es obligatorio

Cada pestaña del sistema abierta (consultorio, operador, monitor, pantalla)
mantiene su propio canal en vivo: una conexion que no se cierra. Con HTTP/1.1
el navegador abre como mucho 6 conexiones por servidor, asi que con 5 o 6
pestañas del sistema en el mismo equipo las siguientes peticiones (la fila, los
botones) se quedan en cola sin ningun error visible. Con HTTP/2 todo viaja por
una sola conexion y el limite desaparece. Por eso:

- `http2 on` en nginx no es una mejora: es obligatorio (ver arriba).
- En desarrollo (`npm run dev`, sin HTTP/2) no abrir mas de 4 pestañas del
  sistema en el mismo navegador.
- El PC del televisor muestra SOLO `/pantalla`: ninguna otra pestaña del
  sistema abierta en ese navegador.

No se comparte un solo canal entre pestañas (con `BroadcastChannel` y una
pestaña "lider"): coordinar quien lo mantiene cuando se cierra o se duerme una
pestaña es facil de hacer mal y dificil de probar, y con HTTP/2 no hace falta.

### Arranque de la aplicacion

`npm run start` arranca Next escuchando SOLO en `127.0.0.1` y con
`--keepAliveTimeout 65000` (ver `package.json`):

- Solo en `127.0.0.1`: el puerto 3000 no se alcanza desde fuera de la VPS ni
  aunque el firewall se configure mal. El unico camino es nginx.
- `keepAliveTimeout 65000`: Node mantiene las conexiones con nginx mas tiempo
  que el `keepalive_timeout 4s` del `upstream`, que es la combinacion que evita
  los 502 esporadicos en los POST.

Con systemd o pm2, que ejecute `npm run start` y no `next start` a secas. Un
usuario del sistema propio, sin shell ni permisos de administrador, dueño solo
de la carpeta de la aplicacion:

```sh
sudo useradd --system --home /srv/turnos --shell /usr/sbin/nologin turnos
sudo chown -R turnos:turnos /srv/turnos
sudo chmod 600 /srv/turnos/.env.local   # los secretos, legibles solo por ese usuario
```

```ini
# /etc/systemd/system/turnos.service
[Unit]
Description=Sistema de Turnos
# Que la red este arriba antes de arrancar: sin ella, Prisma falla al conectar
# a la base y el servicio entra en un bucle de reinicios.
After=network-online.target
Wants=network-online.target

[Service]
User=turnos
Group=turnos
WorkingDirectory=/srv/turnos
EnvironmentFile=/srv/turnos/.env.local
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm run start
Restart=always
# Una pausa entre reinicios: si algo falla al arrancar, no martillar la base.
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Despues: `sudo systemctl daemon-reload && sudo systemctl enable --now turnos`.

### Base de datos

> **`connection_limit=1` serializa todos los llamados simultaneos.** Con una
> sola conexion, cada "Llamar siguiente", "Atendido" o registro de llegada la
> ocupa mientras dura su transaccion (una docena de idas y vueltas a la base), y
> los demas consultorios esperan en fila; pasados 5 s fallan con "el sistema
> esta muy ocupado". En produccion se recomienda **10**. Como calcularlo: el
> tamaño del pool del servidor de conexiones (pgbouncer, o el "pool size" de
> Supabase) dividido entre las instancias de la aplicacion, dejando margen para
> migraciones y consultas a mano. Con Supabase y una sola instancia de la
> aplicacion, 10 cabe en el pool por defecto.

- **Pool acotado.** `DATABASE_URL` lleva `?connection_limit=10&pool_timeout=10`
  (ver `.env.example`). Sin eso, Prisma abre conexiones segun los nucleos de la
  maquina y un pico puede dejar a la base sin conexiones para el login y el
  llamado; con `pool_timeout`, la peticion que no consigue conexion falla en 10 s
  en vez de colgarse. El servidor avisa al arrancar si falta `connection_limit`.
  Las consultas caras corren como mucho 4 a la vez (`TURNOS_MAX_CONSULTAS_PESADAS`),
  asi que siempre sobran conexiones.
- **Tiempo maximo por consulta.** Lo fija quien administra la base, una sola vez,
  para el usuario con el que entra la aplicacion (no es una migracion):

  ```sql
  ALTER ROLE usuario_de_la_app SET statement_timeout = '20s';
  ```

  Una consulta que se desboca se corta a los 20 s en vez de retener su conexion
  indefinidamente.

### Por que no se usa fail2ban

fail2ban saca del todo a una IP que acumula errores. Aqui **todo el hospital es
una IP**: una sola pestaña con un bucle (un enlace vencido recargando, un
script de pruebas olvidado) sumaria los 429 de esa IP y fail2ban dejaria fuera
del sistema al hospital entero —consultorios, admision y el televisor— durante
el tiempo del baneo. Es justo el fallo que el resto de esta seccion evita. Los
limites de nginx y de la aplicacion ya frenan a la IP abusiva peticion a
peticion, sin castigar a nadie mas de lo que abusa. Si algun dia se quiere
fail2ban, solo para IPs que NO sean la del hospital, y eso exige conocerla, que
es lo que esta guia no pide.

### Conexiones colgadas: el reciclado del canal

Cuando se corta el internet del hospital, las conexiones del canal en vivo
quedan medio abiertas: ni nginx ni la aplicacion se enteran de que al otro lado
ya no hay nadie. Para que ninguna retenga su plaza mas de unos minutos, **el
servidor cierra cada conexion cada 4 a 6 minutos** (al azar, para que las
pantallas no reconecten todas a la vez). Las pantallas vivas reconectan solas
en un segundo y se ponen al dia, sin marcar "reconectando": ese aviso solo sale
si la reconexion tarda mas de unos segundos. No hay que configurarlo.

### Caddy

Caddy gestiona el certificado solo y usa HTTP/2 por defecto, pero **el limite
de peticiones no viene en el binario normal**: hay que bajar uno con el modulo
`caddy-ratelimit` desde `caddyserver.com/download`. Si se usa el binario de
serie, no hay rate limiting: en ese caso, nginx. Los mismos criterios: topes por
IP altos, mas estrictos en las rutas caras, y sin limitar los estaticos.

```caddy
DOMINIO-DEL-SISTEMA {
    rate_limit {
        zone turnos_login {
            match { path /api/auth/callback/credentials }
            key    {remote_host}
            events 500
            window 1m
        }
        zone turnos_caros {
            # Solo las caras: `citas/*` atrapaba tambien `citas/llegada`, que es
            # la operacion diaria de admisiones.
            match { path /api/turnos/historico /api/turnos/estadisticas /api/turnos/citas/importar /api/turnos/citas/purga }
            key    {remote_host}
            events 120
            window 1m
        }
        zone turnos_general {
            match { not path /_next/static/* }
            key    {remote_host}
            events 3600
            window 1m
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
      hace caso a la IP del proxy y se encienden sus frenos por IP. Sin proxy
      delante, esa variable NO se pone: el sistema prefiere no tener IP a tener
      una inventada.
- [ ] `DATABASE_URL` con `connection_limit` y `pool_timeout`, y el
      `statement_timeout` del usuario de la base.
- [ ] El puerto 3000 cerrado desde fuera. Si se puede llegar a Next sin pasar
      por el proxy, todo lo anterior se rodea escribiendo la direccion con el
      puerto.
- [ ] La aplicacion arranca con `npm run start` (lleva el `keepAliveTimeout`).
- [ ] En un equipo del hospital (herramientas de desarrollo del navegador →
      Red → columna "Protocolo"), las peticiones salen como `h2`: HTTP/2 activo.
- [ ] Prueba de corte: con todas las pantallas abiertas, desconectar el
      internet del hospital un par de minutos y volver a conectarlo. Todas
      tienen que volver a "en vivo" solas, sin recargar, en menos de un minuto.
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
- [ ] Se entra por `https://DOMINIO-DEL-SISTEMA` y el candado del navegador sale limpio.
- [ ] El proxy limita las peticiones por IP con los topes altos de la seccion
      3, incluye `snippets/turnos-proxy.conf` en CADA `location` y escribe
      `X-Forwarded-For` SOBRESCRIBIENDO, no anadiendo.
- [ ] HTTP/2 activo en el `listen 443`.
- [ ] `TURNOS_CONFIAR_PROXY=1`.
- [ ] Pool de la base acotado (`connection_limit`) y `statement_timeout` puesto.
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
