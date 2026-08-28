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
import NextAuth from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { usuarioRepository } from '@/lib/usuarios/in-memory-repository'
import type { RolUsuario } from '@/lib/usuarios/types'
import { contextoPeticion, limitarIntentos, registrarEvento } from '@/lib/seguridad/registro'
import { useSecureAuthCookies } from './auth-cookies'

/** Jornada larga en ventanilla: la sesion dura un dia habil completo. */
const duracionSesionSegundos = 12 * 60 * 60

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.NEXTAUTH_SECRET,
  trustHost: true,
  useSecureCookies: useSecureAuthCookies,
  session: { strategy: 'jwt', maxAge: duracionSesionSegundos },
  pages: { signIn: '/auth/login' },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        usuario: { label: 'Usuario', type: 'text' },
        password: { label: 'Contrasena', type: 'password' },
      },
      async authorize(credentials) {
        const usuario = String(credentials?.usuario ?? '').trim()
        const password = String(credentials?.password ?? '')
        const { ip } = await contextoPeticion()

        function rechazar(motivo: string) {
          registrarEvento({
            tipo: 'INICIO_SESION',
            exito: false,
            identificador: usuario || null,
            ip,
            detalle: { motivo },
          })
          return null
        }

        if (!usuario || !password) return rechazar('credenciales_incompletas')

        const porIp = limitarIntentos('login_ip', ip, 20, 15 * 60 * 1000)
        if (!porIp.permitido) return rechazar('demasiados_intentos_ip')

        const porUsuario = limitarIntentos('login_usuario', usuario, 8, 15 * 60 * 1000)
        if (!porUsuario.permitido) return rechazar('demasiados_intentos_usuario')

        const encontrado = await usuarioRepository.verificarCredenciales(usuario, password)
        if (!encontrado) return rechazar('credenciales_invalidas')

        registrarEvento({
          tipo: 'INICIO_SESION',
          exito: true,
          usuarioId: encontrado.id,
          identificador: encontrado.usuario,
          ip,
        })

        return {
          id: encontrado.id,
          name: encontrado.nombre,
          usuario: encontrado.usuario,
          rol: encontrado.rol,
          area: encontrado.area,
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.sub = user.id

      if (token.sub) {
        // Revalidar en cada peticion: si el administrador desactiva la cuenta,
        // la sesion abierta debe caer sin esperar a que expire el token.
        const actual = await usuarioRepository.buscarPorId(token.sub)
        if (!actual) return null

        token.name = actual.nombre
        token.usuario = actual.usuario
        token.rol = actual.rol
        token.area = actual.area
      }

      return token
    },

    async session({ session, token }) {
      session.user.id = token.sub as string
      session.user.usuario = token.usuario as string
      session.user.rol = token.rol as RolUsuario
      session.user.area = token.area as string | null
      return session
    },
  },
})
