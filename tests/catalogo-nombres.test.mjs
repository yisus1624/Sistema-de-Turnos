// Los nombres del catalogo que se copian al registro de actividad.
//
// Se resuelven en la accion MAS FRECUENTE del sistema (cada llamado de turno
// apunta consultorio y doctor), asi que se recuerdan un rato en vez de releer
// el catalogo entero cada vez. Lo que no puede pasar es que ese recuerdo deje
// sin nombre a lo que se acaba de crear: la carga del reporte del hospital da
// de alta consultorios y doctores a media mañana, y el primer llamado de ese
// consultorio nuevo no puede quedar apuntado como un cuid ilegible.
import assert from 'node:assert/strict'
import test from 'node:test'

// ANTES QUE NADA: sin esto las pruebas escriben en la base real del hospital.
const { turnoRepository } = await import('./repositorios-en-memoria.mjs')

const { nombreDeModulo, nombreDeProfesional, nombreDeServicio } = await import(
  '@/lib/turnos/catalogo-nombres'
)

test('traduce el identificador de un consultorio a su nombre', async () => {
  const modulo = await turnoRepository.crearModulo({
    nombre: 'Consultorio de nombres 1',
    servicioId: 'srv-consulta-externa',
    activo: true,
  })

  assert.equal(await nombreDeModulo(modulo.id), 'Consultorio de nombres 1')
})

test('un consultorio creado DESPUES de la primera consulta sale con su nombre', async () => {
  // Es el caso de la carga del reporte: el catalogo crece a media jornada.
  const nuevo = await turnoRepository.crearModulo({
    nombre: 'Consultorio de nombres 2',
    servicioId: 'srv-consulta-externa',
    activo: true,
  })

  assert.equal(
    await nombreDeModulo(nuevo.id),
    'Consultorio de nombres 2',
    'un catalogo recordado no puede dejar sin nombre a lo que acaba de nacer',
  )
})

test('un identificador que no existe se devuelve tal cual, sin romper el apunte', async () => {
  assert.equal(await nombreDeModulo('mod-que-no-existe'), 'mod-que-no-existe')
})

test('sin identificador no hay nombre que buscar', async () => {
  assert.equal(await nombreDeModulo(null), null)
  assert.equal(await nombreDeServicio(undefined), null)
  assert.equal(await nombreDeProfesional(''), null)
})

test('tambien traduce servicios y doctores', async () => {
  const doctor = await turnoRepository.crearProfesional({
    nombre: 'Dra. Nombres',
    servicioId: 'srv-consulta-externa',
    jornada: 'COMPLETA',
  })

  assert.equal(await nombreDeProfesional(doctor.id), 'Dra. Nombres')
  assert.ok(await nombreDeServicio('srv-consulta-externa'))
})
