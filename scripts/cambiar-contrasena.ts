/**
 * Cambia la contrasena de una cuenta desde la consola del servidor.
 *
 * Para cuando nadie puede entrar a Usuarios a cambiarla: por ejemplo, el unico
 * administrador olvido la suya. La contrasena se escribe aqui, en la consola,
 * y no queda en ningun archivo ni en el historial de comandos. Al cambiarla se
 * cierran las sesiones abiertas de esa cuenta (sube `versionCredenciales`).
 *
 * Uso:  npm run cuenta:contrasena -- jesus
 */
import { createInterface } from 'node:readline/promises'
import { PrismaClient } from '@prisma/client'
import { cifrarContrasena } from '../lib/usuarios/contrasenas.ts'

const MINIMO = 8

const usuario = (process.argv[2] ?? '').trim().toLowerCase()
if (!usuario) {
  console.error('Indica el usuario: npm run cuenta:contrasena -- jesus')
  process.exit(1)
}

const prisma = new PrismaClient()
const consola = createInterface({ input: process.stdin, output: process.stdout })

try {
  const cuenta = await prisma.usuario.findUnique({ where: { usuario }, select: { id: true, nombre: true } })
  if (!cuenta) throw new Error(`No existe ninguna cuenta con el usuario "${usuario}".`)

  const nueva = (await consola.question(`Nueva contrasena para ${cuenta.nombre} (${usuario}): `)).trim()
  if (nueva.length < MINIMO) throw new Error(`La contrasena debe tener minimo ${MINIMO} caracteres.`)
  const otraVez = (await consola.question('Escribela otra vez: ')).trim()
  if (otraVez !== nueva) throw new Error('Las dos contrasenas no coinciden. No se cambio nada.')

  await prisma.usuario.update({
    where: { id: cuenta.id },
    data: { passwordHash: await cifrarContrasena(nueva), versionCredenciales: { increment: 1 }, activo: true },
  })
  console.log(`Listo: ${usuario} ya puede entrar con la contrasena nueva.`)
} catch (error) {
  console.error((error as Error).message)
  process.exitCode = 1
} finally {
  consola.close()
  await prisma.$disconnect()
}
