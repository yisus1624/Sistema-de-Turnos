import type { DefaultSession } from 'next-auth'
import type { RolUsuario } from '@/lib/usuarios/types'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      usuario: string
      rol: RolUsuario
      area: string | null
    } & DefaultSession['user']
  }

  interface User {
    usuario: string
    rol: RolUsuario
    area: string | null
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    usuario: string
    rol: RolUsuario
    area: string | null
  }
}
