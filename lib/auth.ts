/**
 * Autenticacion de funcionarios (requerimiento seccion 17).
 *
 * Un solo metodo: usuario + contrasena. No hay registro publico ni proveedores
 * externos: las cuentas las crea el administrador (seccion 16).
 *
 * Los usuarios se leen a traves de `UsuarioRepository`, nunca de una fuente
 * concreta, para poder cambiar a la fuente del hospital sin tocar este archivo
 * mas que en la linea de importacion.
 */
import NextAuth, { CredentialsSignin } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { usuarioRepository } from '@/lib/usuarios/repositorio'
import type { RolUsuario } from '@/lib/usuarios/types'
import { contextoPeticion, registrarEvento } from '@/lib/seguridad/registro'
import { EVENTOS } from '@/lib/seguridad/eventos'
import {
  apuntarFalloDeIngreso,
  frenoDeIngreso,
  olvidarFallosDeIngreso,
  retardoDeIngresoMs,
  type FrenoDeIngreso,
} from '@/lib/seguridad/limite-ingreso'
import { loginSchema } from '@/lib/validators/auth'
import { useSecureAuthCookies } from './auth-cookies'

/**
 * La fuente de usuarios no respondio: base caida, red, o credenciales de
 * conexion mal puestas en el despliegue.
 *
 * Existe como error APARTE del de credenciales invalidas a proposito. Mientras
 * todo fallo se le mostraba al funcionario como "usuario o contrasena
 * incorrectos", un corte de base se buscaba durante horas en las cuentas,
 * porque la pantalla afirmaba con seguridad algo que no era cierto. `code`
 * viaja hasta el cliente y es lo que el login usa para decir la verdad.
 */
class FuenteUsuariosNoDisponible extends CredentialsSignin {
  code = 'fuente_no_disponible'
}

/**
 * La cuenta (o el origen) esta en espera por demasiados intentos fallidos.
 *
 * Aparte de "credenciales invalidas" por lo mismo que la fuente caida: durante
 * la espera se rechaza incluso la contrasena buena, y decirle al funcionario
 * "contrasena incorrecta" lo mandaba a probar otras, alargando la espera.
 */
class IngresoEnEspera extends CredentialsSignin {
  constructor(freno: Exclude<FrenoDeIngreso, 'permitido'>) {
    super()
    this.code = freno
  }
}

/** Cuanto del usuario escrito se anota en el registro de un intento rechazado. */
const LARGO_USUARIO_ANOTADO = 40

/** Jornada larga en ventanilla: la sesion dura un dia habil completo. */
const duracionSesionSegundos = 12 * 60 * 60

/**
 * Un token sin marca es de antes de existir la version de credenciales: se
 * respeta para no cerrar a todo el personal el dia del despliegue.
 */
function esperarRetardoDeIngreso(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolver) => setTimeout(resolver, ms))
}

function credencialesCambiaron(delToken: unknown, actual: number | undefined) {
  return typeof delToken === 'number' && delToken !== (actual ?? 0)
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.NEXTAUTH_SECRET,
  trustHost: true,
  useSecureCookies: useSecureAuthCookies,
  session: { strategy: 'jwt', maxAge: duracionSesionSegundos },
  pages: { signIn: '/auth/login' },
  logger: {
    error(error) {
      // `JWTSessionError` significa que la cookie de sesion del navegador ya no
      // se puede descifrar: quedo de una sesion anterior a un cambio de
      // NEXTAUTH_SECRET. No es un fallo del sistema y no rompe nada —la
      // peticion sigue como "sin sesion" y al volver a entrar la cookie se
      // reemplaza sola—, pero tal cual lo escribe Auth.js es un error rojo sin
      // causa visible que aparece en cada carga de pagina.
      if (error.name === 'JWTSessionError') {
        console.warn(
          '[auth] cookie de sesion antigua o ilegible: se ignora y se pide iniciar sesion de nuevo. ' +
            'Se arregla sola al volver a entrar; para limpiarla antes, borra las cookies del sitio.',
        )
        return
      }

      console.error('[auth]', error)
    },
  },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        usuario: { label: 'Usuario', type: 'text' },
        password: { label: 'Contrasena', type: 'password' },
      },
      async authorize(credentials) {
        const { ip } = await contextoPeticion()
        // Lo que se anota del usuario, SIEMPRE acotado: es texto que escribe
        // quien hace la peticion, y sin tope un usuario de un mega iba entero
        // al limitador, a la consola y al registro de actividad.
        const anotado = String(credentials?.usuario ?? '').trim().slice(0, LARGO_USUARIO_ANOTADO)

        async function rechazar(motivo: string) {
          await registrarEvento({
            tipo: EVENTOS.INICIO_SESION,
            exito: false,
            identificador: anotado || null,
            ip,
            detalle: { motivo },
          })
          return null
        }

        // La misma validacion que el formulario (usuario de 3 a 40 caracteres),
        // ANTES de tocar el limitador o la base.
        const leido = loginSchema.safeParse({ usuario: credentials?.usuario, password: credentials?.password })
        if (!leido.success) return await rechazar('credenciales_invalidas_formato')
        const { usuario, password } = leido.data

        // Primero el freno: por cuenta siempre, y por IP (umbral amplio) solo
        // si la IP es de fiar. Ver `lib/seguridad/limite-ingreso.ts`.
        const freno = frenoDeIngreso(usuario, ip)
        if (freno !== 'permitido') {
          await rechazar(freno === 'cuenta_en_espera' ? 'demasiados_intentos_usuario' : 'demasiados_intentos_ip')
          throw new IngresoEnEspera(freno)
        }

        // Sin IP de fiar no se bloquea la cuenta: se la frena con espera creciente.
        await esperarRetardoDeIngreso(retardoDeIngresoMs(usuario, ip))

        let encontrado
        try {
          encontrado = await usuarioRepository.verificarCredenciales(usuario, password)
        } catch (error) {
          // No se registra como credencial fallida: el funcionario no se
          // equivoco en nada, fallo el sistema. Contarlo ademas dejaria la
          // cuenta bloqueada por fuerza bruta despues de una caida de base.
          await registrarEvento({
            tipo: EVENTOS.INICIO_SESION,
            exito: false,
            identificador: usuario,
            ip,
            detalle: {
              motivo: 'fuente_usuarios_no_disponible',
              error: error instanceof Error ? error.message.split('\n')[0] : String(error),
            },
          })
          throw new FuenteUsuariosNoDisponible()
        }

        if (!encontrado) {
          // Solo cuenta lo que de verdad fallo (ver `limite-ingreso`).
          apuntarFalloDeIngreso(usuario, ip)
          return await rechazar('credenciales_invalidas')
        }

        // Entro bien: se le borra la cuenta de intentos. El limite tiene que
        // contar FALLOS, no usos, o un mostrador compartido se bloquea solo.
        olvidarFallosDeIngreso(usuario, ip)

        await registrarEvento({
          tipo: EVENTOS.INICIO_SESION,
          exito: true,
          usuarioId: encontrado.id,
          usuarioNombre: encontrado.nombre,
          identificador: encontrado.usuario,
          ip,
        })

        return {
          id: encontrado.id,
          name: encontrado.nombre,
          usuario: encontrado.usuario,
          rol: encontrado.rol,
          area: encontrado.area,
          secciones: encontrado.secciones ?? null,
          versionCredenciales: encontrado.versionCredenciales ?? 0,
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id
        token.versionCredenciales = user.versionCredenciales
      }

      if (token.sub) {
        // Revalidar en cada peticion: si el administrador desactiva la cuenta,
        // la sesion abierta debe caer sin esperar a que expire el token.
        //
        // Si la consulta FALLA no se puede distinguir "cuenta desactivada" de
        // "base no disponible", y son cosas opuestas. Lanzar aqui no era una
        // opcion: Auth.js envuelve cualquier excepcion de este callback en un
        // `JWTSessionError` opaco, que aparece en CADA pantalla que lea la
        // sesion y no dice nada de la causa real. Y cerrar la sesion tampoco:
        // un corte de segundos en la base echaria a la vez a todo el personal
        // que esta atendiendo, en mitad de la jornada.
        //
        // Se conserva lo que el token ya traia. La sesion sigue viva como
        // mucho hasta que expire, y la revalidacion vuelve sola en cuanto la
        // base responda.
        let actual
        try {
          actual = await usuarioRepository.buscarPorId(token.sub)
        } catch (error) {
          console.warn(
            '[auth] no se pudo revalidar la sesion contra la fuente de usuarios; se mantiene la sesion actual.',
            error instanceof Error ? error.message.split('\n')[0] : error,
          )
          return token
        }

        if (!actual) return null
        if (credencialesCambiaron(token.versionCredenciales, actual.versionCredenciales)) return null

        token.name = actual.nombre
        token.usuario = actual.usuario
        token.rol = actual.rol
        token.area = actual.area
        token.secciones = actual.secciones ?? null
      }

      return token
    },

    async session({ session, token }) {
      session.user.id = token.sub as string
      session.user.usuario = token.usuario as string
      session.user.rol = token.rol as RolUsuario
      session.user.area = token.area as string | null
      session.user.secciones = (token.secciones as string[] | null) ?? null
      return session
    },
  },
})
