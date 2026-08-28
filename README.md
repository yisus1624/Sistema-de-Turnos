# Sistema de Gestion y Llamado de Turnos

Sistema de turnos de atencion al usuario para la **ESE Hospital San Rafael de
Chinu**, segun el documento de requerimientos v1.0 (agosto de 2026).

## Que hace

- Genera turnos por servicio, con prefijo configurable (`A-025`, `F-014`...).
- Permite al funcionario llamar el siguiente turno, repetirlo y marcarlo como
  atendido o ausente desde su computador.
- Muestra en tiempo real el turno llamado y su modulo en una pantalla para la
  sala de espera, con llamado por audio.
- Guarda el historico de turnos para consultas y estadisticas.

## Las tres interfaces

| Ruta        | Para quien              | Sesion |
| ----------- | ----------------------- | ------ |
| `/operador` | Funcionario / operador  | Si     |
| `/admin/*`  | Administrador           | Si     |
| `/pantalla` | Televisor de sala de espera | No |

## Arquitectura

Monolito **Next.js (App Router)**. Lo importante es la separacion de la fuente
de datos:

```
app/            Rutas y API (route handlers)
components/     UI compartida
lib/turnos/     Tipos de dominio + contrato TurnoRepository
lib/usuarios/   Tipos de dominio + contrato UsuarioRepository
lib/hospital/   Adaptador a la API del hospital  [PENDIENTE]
lib/realtime/   Bus de eventos en proceso (SSE hacia la pantalla)
lib/seguridad/  Limite de intentos y registro de actividad
```

La aplicacion **nunca** habla con una base de datos ni con una API concreta:
habla con `TurnoRepository` y `UsuarioRepository`. Hoy corren implementaciones
**en memoria** (`in-memory-repository.ts`), pensadas solo para desarrollo.

### Estado de la integracion

El hospital todavia no ha entregado la informacion de su API. Hasta que lo
haga no se inventan endpoints, campos ni datos. Lo que falta esta listado en
[`lib/hospital/README.md`](lib/hospital/README.md).

**No hay base de datos propia** y no se usa Prisma: la persistencia vendra de
la API del hospital.

## Desarrollo

```bash
npm install
npm run dev
```

Variables de entorno (`.env.local`):

```
NEXTAUTH_SECRET=<cadena aleatoria larga>
NEXTAUTH_URL=http://localhost:3000

# Cuentas semilla temporales (solo mientras no exista la fuente real)
TURNOS_ADMIN_USUARIO=admin
TURNOS_ADMIN_PASSWORD=<contrasena>
TURNOS_OPERADOR_USUARIO=operador
TURNOS_OPERADOR_PASSWORD=<contrasena>
```

Verificacion antes de dar por terminado un cambio:

```bash
npm run verify
```

## Limitaciones actuales

- Los datos viven en memoria del proceso: se pierden al reiniciar el servidor.
- El bus de eventos en tiempo real es en proceso; con varias instancias del
  servidor habria que cambiarlo por un bus compartido.
- Los modulos de administracion (servicios, modulos, usuarios, historico,
  estadisticas) estan en el menu pero aun sin implementar.
