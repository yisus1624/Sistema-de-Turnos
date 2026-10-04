// La pantalla de la sala tiene que ajustarse a CUALQUIER televisor y leerse
// desde el fondo de la sala.
//
// No se sabe que televisor va a tener el hospital: 720p, 1080p, 4K, un monitor
// 4:3 o uno puesto en vertical. La distribucion (columnas, filas, letra) se
// calcula con el espacio REAL de la ventana y el numero de consultorios:
//
//   - nunca se recorta ni se solapa nada;
//   - la letra se mide contra el LADO CORTO de la pantalla (regla de
//     señaletica: ~2,5 cm de letra por cada 3 m). Minimo: turno 4,5 %,
//     medico y consultorio 2,8 %. Con pocos consultorios, mucho mas grande;
//   - si con el minimo no caben, mas columnas; y solo al final, paginas.
import assert from 'node:assert/strict'
import test from 'node:test'

const { planDeCartelera, tablaConFoto, MINIMO_TURNO, MINIMO_TEXTO, MAXIMO_EN_UNA_PANTALLA } = await import(
  '@/lib/turnos/distribucion-pantalla'
)

/**
 * Cada televisor con el espacio que le queda a los turnos, MEDIDO en el
 * navegador con /pantalla/muestra (la ventana menos cabecera, encabezado de la
 * tabla, relleno y pie), con el `rem` de la pantalla ya con su piso de 16 px.
 * La cartelera tiene dos anchos: con 3 a 5 filas en pantallas panoramicas la
 * tabla deja ver la foto a su izquierda (80 % del ancho); si no, usa todo.
 * 21:9 y 16:10 no se midieron: salen de las mismas proporciones.
 */
const PANTALLAS = {
  '1280x720': { pantalla: { ancho: 1280, alto: 720 }, conFoto: { ancho: 979, alto: 533 }, ancha: { ancho: 1228, alto: 533 } },
  '1366x768': { pantalla: { ancho: 1366, alto: 768 }, conFoto: { ancho: 1046, alto: 579 }, ancha: { ancho: 1312, alto: 579 } },
  '1920x1080': { pantalla: { ancho: 1920, alto: 1080 }, conFoto: { ancho: 1469, alto: 736 }, ancha: { ancho: 1842, alto: 779 } },
  '3840x2160': { pantalla: { ancho: 3840, alto: 2160 }, conFoto: { ancho: 2938, alto: 1471 }, ancha: { ancho: 3684, alto: 1558 } },
  '1024x768 (4:3)': { pantalla: { ancho: 1024, alto: 768 }, conFoto: { ancho: 773, alto: 579 }, ancha: { ancho: 970, alto: 579 } },
  '1080x1920 (vertical)': { pantalla: { ancho: 1080, alto: 1920 }, conFoto: { ancho: 1002, alto: 1571 }, ancha: { ancho: 1002, alto: 1571 } },
  '2560x1080 (21:9)': { pantalla: { ancho: 2560, alto: 1080 }, conFoto: { ancho: 1981, alto: 736 }, ancha: { ancho: 2482, alto: 779 } },
  '1680x1050 (16:10)': { pantalla: { ancho: 1680, alto: 1050 }, conFoto: { ancho: 1278, alto: 708 }, ancha: { ancho: 1604, alto: 751 } },
}
const PANORAMICAS = ['1280x720', '1366x768', '1920x1080', '3840x2160']
/** Donde el ancho escasea: el objetivo de letra con pocos consultorios tambien vale aqui. */
const ESTRECHAS = ['1080x1920 (vertical)', '1024x768 (4:3)']
// 9 a 11: los doctores que el hospital tiene a la vez en cada jornada, mañana o tarde.
const CANTIDADES = [1, 2, 3, 4, 6, 8, 9, 10, 11, 12, 16, 20]

const ladoCorto = ({ ancho, alto }) => Math.min(ancho, alto)
const espacioDeCartelera = (tv, n) => (tablaConFoto(n, tv.pantalla) ? tv.conFoto : tv.ancha)
const cartelera = (nombre, n, medico) => {
  const tv = PANTALLAS[nombre]
  return planDeCartelera(espacioDeCartelera(tv, n), casillas(n, medico), tv.pantalla)
}

/**
 * La cartelera con el nombre del paciente: sin codigo, y el nombre en el hueco
 * del medico (asi la mide `Cartelera` con la variante `paciente`).
 */
const paciente = (nombre, n, nombrePaciente) => {
  const tv = PANTALLAS[nombre]
  const filas = casillas(n).map((c, i) => ({
    moduloNombre: c.moduloNombre,
    codigo: null,
    profesionalNombre: nombrePaciente ?? `JUAN CARLOS PEREZ GOMEZ ${i + 1}`,
  }))
  return planDeCartelera(espacioDeCartelera(tv, n), filas, tv.pantalla, { sinTurno: true })
}

/**
 * Casillas como las del hospital: casi todas de un mismo servicio, y con los
 * nombres largos de verdad ("CONS 01 - CONSULTA EXTERNA").
 */
function casillas(n, medico) {
  return Array.from({ length: n }, (_, i) => ({
    grupo: i < Math.ceil(n * 0.8) ? 'consulta' : 'odontologia',
    codigo: `${i < Math.ceil(n * 0.8) ? 'C' : 'O'}-${String(10 + i).padStart(3, '0')}`,
    profesionalNombre: medico ?? `DR. MEDICO DE PRUEBA NUMERO ${i + 1}`,
    moduloNombre: `CONS ${String(i + 1).padStart(2, '0')} - CONSULTA EXTERNA`,
  }))
}

/** Holgura de medio pixel: el navegador redondea. */
const alMenos = (valor, minimo, que) => assert.ok(valor >= minimo - 0.5, `${que}: ${valor.toFixed(1)} < ${minimo.toFixed(1)}`)

/**
 * El minimo legible. Con hasta `MAXIMO_EN_UNA_PANTALLA` turnos se admite un
 * piso mas apretado (el 55 % del minimo), porque verlos todos a la vez en un
 * solo televisor pesa mas que la letra minima de siempre.
 */
function letraLegible(letra, lado, n = Infinity) {
  const factor = n <= MAXIMO_EN_UNA_PANTALLA ? 0.55 : 1
  alMenos(letra.turno, MINIMO_TURNO * lado * factor, 'turno')
  alMenos(letra.medico, MINIMO_TEXTO * lado * factor, 'medico')
  alMenos(letra.consultorio, MINIMO_TEXTO * lado * factor, 'consultorio')
}

test('los minimos de legibilidad son los acordados: turno 4,5 % y textos 2,8 % del lado corto', () => {
  assert.equal(MINIMO_TURNO, 0.045)
  assert.equal(MINIMO_TEXTO, 0.028)
})

for (const [nombre, tv] of Object.entries(PANTALLAS)) {
  const lado = ladoCorto(tv.pantalla)
  for (const n of CANTIDADES) {
    test(`cartelera ${nombre} con ${n}: todas las filas caben y se leen de lejos`, () => {
      const espacio = espacioDeCartelera(tv, n)
      const plan = cartelera(nombre, n)
      const { letra, reja } = plan

      assert.equal(plan.porPagina * plan.paginas >= n, true, 'ninguna fila se pierde')
      letraLegible(letra, lado, n)
      const filasPorColumna = Math.ceil(Math.min(n, plan.porPagina) / plan.columnas)
      assert.ok(filasPorColumna * plan.altoFila + (filasPorColumna - 1) * plan.separacionFilas <= espacio.alto + 0.5)
      // El codigo entero en una linea, y el nombre del medico en dos como mucho.
      alMenos(plan.altoFila, letra.turno * 1.2, 'alto para el codigo')
      alMenos(plan.altoFila, letra.medico * 2.2, 'alto para dos lineas de medico')
      alMenos(reja[0], letra.turno * 4, 'ancho para el codigo')
      const anchoFila = reja.reduce((suma, ancho) => suma + ancho, 0) + (reja.length - 1) * plan.separacionCeldas + 2 * plan.rellenoX
      assert.ok(anchoFila <= plan.anchoColumna + 0.5, `la fila no desborda su columna (${anchoFila} > ${plan.anchoColumna})`)
      const anchoColumnas = plan.columnas * plan.anchoColumna + (plan.columnas - 1) * plan.separacionColumnas
      assert.ok(anchoColumnas <= espacio.ancho + 0.5, 'las columnas no desbordan la tabla')
    })
  }
}

// --- El tamaño es el de una jornada normal, con 1 o con 10 consultorios -------------
//
// Con la letra "al maximo" un solo turno ocupaba media pantalla, y la letra se
// iba achicando a medida que llegaban consultorios: la pantalla cambiaba de
// cara durante el dia. Ahora el tope es el tamaño de 8 a 10 consultorios.

for (const nombre of PANORAMICAS) {
  const lado = ladoCorto(PANTALLAS[nombre].pantalla)

  test(`cartelera ${nombre}: con 1 turno la letra es la misma que con 8`, () => {
    const con8 = cartelera(nombre, 8).letra
    for (const n of [1, 2, 4, 6]) {
      const { letra } = cartelera(nombre, n)
      assert.ok(Math.abs(letra.turno - con8.turno) <= 0.006 * lado, `turno con ${n}: ${letra.turno} vs ${con8.turno}`)
    }
  })

  test(`cartelera ${nombre}: un solo turno no llena la pantalla`, () => {
    const { letra, altoFila } = cartelera(nombre, 1)
    assert.ok(letra.turno <= 0.055 * lado + 0.5, `turno ${letra.turno}`)
    assert.ok(altoFila <= 0.15 * lado, `fila de ${altoFila} px`)
  })
}

for (const nombre of Object.keys(PANTALLAS)) {
  const lado = ladoCorto(PANTALLAS[nombre].pantalla)
  test(`${nombre}: con pocos consultorios la letra nunca baja del minimo legible`, () => {
    for (const n of [1, 2, 3, 4]) {
      for (const { letra } of [cartelera(nombre, n), paciente(nombre, n)]) {
        alMenos(letra.turno, 0.045 * lado, `turno con ${n}`)
        alMenos(letra.medico, 0.028 * lado, `medico con ${n}`)
      }
    }
  })
}

test('jerarquia: el turno es lo mas grande, luego el consultorio y luego el medico', () => {
  for (const nombre of Object.keys(PANTALLAS)) {
    for (const n of CANTIDADES) {
      for (const { letra } of [cartelera(nombre, n)]) {
        assert.ok(letra.turno > letra.consultorio, `${nombre} con ${n}`)
        assert.ok(letra.consultorio >= letra.medico, `${nombre} con ${n}`)
        assert.ok(letra.servicio < letra.medico, 'el servicio es secundario')
      }
    }
  }
})

test('la foto queda al lado de la tabla de 1 a 5 filas en pantallas panoramicas', () => {
  const panoramica = { ancho: 1920, alto: 1080 }
  assert.deepEqual([1, 2, 3, 5, 6].map((n) => tablaConFoto(n, panoramica)), [true, true, true, true, false])
  assert.equal(tablaConFoto(4, { ancho: 1024, alto: 768 }), false, '4:3 no tiene ancho que ceder')
  assert.equal(tablaConFoto(4, { ancho: 1080, alto: 1920 }), false, 'vertical tampoco')
})

// En la fila de dos pisos el medico va DEBAJO del consultorio: si su nombre
// se parte en dos lineas, esa linea suma alto. El plan suponia una sola linea
// en celdas anchas y, con nombres reales, la fila recortaba al medico y a la
// pastilla del consultorio.
test('en dos pisos la fila tiene alto para consultorio, medico en dos lineas y servicio', () => {
  const MEDICO_LARGO = 'DRA. MARIA CAMILA RODRIGUEZ MONTERROSA'
  const tv = PANTALLAS['1280x720']
  const filas = casillas(12, MEDICO_LARGO)
  const plan = planDeCartelera(tv.ancha, filas, tv.pantalla)
  const { letra } = plan

  assert.equal(plan.forma, 'dos-pisos', 'el caso de prueba usa la fila apilada')
  const consultorio = (1.1 + 0.4) * letra.consultorio
  const medico = 2 * 1.1 * letra.medico + (plan.conServicio ? 1.25 * letra.servicio : 0)
  alMenos(plan.altoFila, consultorio + plan.separacionPisos + medico, 'alto de la fila apilada')
})

// El hueco del codigo se media con los codigos en pantalla: al pasar de
// "C-010" a "M-010" (una M es mas ancha) la forma y la letra de toda la
// cartelera podian cambiar a mitad del dia. Se reserva el formato, no el
// codigo de turno que haya.
test('la cartelera no cambia segun que letra o numero traiga el codigo', () => {
  const tv = PANTALLAS['1366x768']
  const con = (codigo) => casillas(12).map((c) => ({ ...c, codigo: codigo(c.codigo) }))
  const base = planDeCartelera(tv.ancha, con((c) => c), tv.pantalla)
  for (const codigo of [() => 'M-010', () => 'W-999', (c) => c.replace(/\d+$/, '001')]) {
    assert.deepEqual(planDeCartelera(tv.ancha, con(codigo), tv.pantalla), base)
  }
})

test('con pocos consultorios la letra es mayor que con muchos', () => {
  for (const nombre of Object.keys(PANTALLAS)) {
    assert.ok(cartelera(nombre, 1).letra.turno >= cartelera(nombre, 12).letra.turno, nombre)
  }
})

test('en 4K todo mide el doble que en 1080p: la letra sale de la pantalla, no de pixeles fijos', () => {
  for (const n of [1, 4, 12]) {
    const en1080 = cartelera('1920x1080', n).letra.turno
    const en4k = cartelera('3840x2160', n).letra.turno
    assert.ok(en4k > en1080 * 1.8, `con ${n}: ${en4k} vs ${en1080}`)
  }
})

test('el nombre del servicio solo aparece si cabe sin achicar lo demas', () => {
  const holgada = cartelera('1920x1080', 2)
  assert.equal(holgada.conServicio, true)
  alMenos(holgada.altoFila, holgada.letra.medico * 2.2 + holgada.letra.servicio * 1.2, 'cabe bajo el medico')
  // Filas apretadas contra el minimo: no hay sitio y no se muestra.
  assert.equal(cartelera('1280x720', 8).conServicio, false)
})

const NOMBRE_LARGO = 'CARLOS RAMON DE LEON CASTILLO'
const NOMBRE_LARGUISIMO = 'MARIA FERNANDA DE LOS ANGELES DEL SOCORRO PEREZ DE LA ESPRIELLA GUTIERREZ'

test('un nombre de medico largo pasa a dos lineas antes de achicar la letra', () => {
  for (const plan of [(m) => cartelera('1920x1080', 4, m), (m) => paciente('1920x1080', 4, m)]) {
    assert.equal(plan(NOMBRE_LARGO).letra.medico, plan('DRA. ANA RUIZ').letra.medico)
  }
})

test('un nombre que no cabe ni en dos lineas achica SOLO al medico, sin bajar del minimo', () => {
  for (const nombre of Object.keys(PANTALLAS)) {
    const lado = ladoCorto(PANTALLAS[nombre].pantalla)
    for (const n of [1, 4, 12]) {
      const normal = cartelera(nombre, n).letra
      const largo = cartelera(nombre, n, NOMBRE_LARGUISIMO).letra
      assert.equal(largo.turno, normal.turno, 'el turno no se toca')
      assert.ok(largo.medico <= normal.medico)
      // Con la pantalla apretada para que quepan todos, un nombre larguisimo
      // puede bajar hasta el 80 % de su letra antes que cortarse.
      const piso = normal.medico < MINIMO_TEXTO * lado ? normal.medico * 0.8 : MINIMO_TEXTO * lado
      alMenos(largo.medico, piso, `medico en ${nombre} con ${n}`)
    }
  }
  assert.ok(cartelera('1920x1080', 1, NOMBRE_LARGUISIMO).letra.medico < cartelera('1920x1080', 1).letra.medico)
})

// --- Paginar, solo como ultimo recurso -----------------------------------------------

/** Los consultorios con nombre corto, como los deja el administrador al renombrarlos. */
const conNombreCorto = (lista) => lista.map((c, i) => ({ ...c, moduloNombre: `Consultorio ${i + 1}` }))

test('la cartelera usa varias columnas antes que paginas: 12 con nombre corto caben en una pagina', () => {
  for (const nombre of ['1920x1080', '1366x768', '1280x720']) {
    const tv = PANTALLAS[nombre]
    const plan = planDeCartelera(tv.ancha, conNombreCorto(casillas(12)), tv.pantalla)
    assert.equal(plan.paginas, 1, nombre)
    assert.ok(plan.columnas >= 2, nombre)
    letraLegible(plan.letra, ladoCorto(tv.pantalla))
  }
})

test('diez turnos en curso con los nombres largos del reporte caben en una sola pagina de la cartelera', () => {
  for (const nombre of ['1920x1080', '1366x768', '1280x720']) {
    const plan = cartelera(nombre, 10, 'CARLOS RAMON DE LEON CASTILLO')
    assert.equal(plan.paginas, 1, nombre)
    letraLegible(plan.letra, ladoCorto(PANTALLAS[nombre].pantalla))
  }
})

test('doce consultorios con los nombres largos del reporte caben en UNA pagina en 1080p y en 1366x768', () => {
  for (const nombre of ['1920x1080', '1366x768']) {
    const plan = cartelera(nombre, 12, 'CARLOS RAMON DE LEON CASTILLO')
    assert.equal(plan.paginas, 1, nombre)
    letraLegible(plan.letra, ladoCorto(PANTALLAS[nombre].pantalla))
  }
})

test('con muchos mas, la cartelera pagina antes que bajar del minimo o cortar texto', () => {
  const plan = cartelera('1366x768', 40)
  assert.ok(plan.paginas > 1)
  letraLegible(plan.letra, 768)
})

test('la cartelera tambien pagina sin bajar del minimo: 40 filas en 1280x720', () => {
  const tv = PANTALLAS['1280x720']
  const plan = planDeCartelera(tv.ancha, casillas(40), tv.pantalla)
  assert.ok(plan.paginas > 1)
  assert.ok(plan.porPagina * plan.paginas >= 40)
  letraLegible(plan.letra, 720)
})

test('sin espacio medido todavia, no revienta y la columna nunca mide negativo', () => {
  const sinMedir = { ancho: 0, alto: 0 }
  const plan = planDeCartelera(sinMedir, casillas(12), sinMedir)
  assert.equal(plan.paginas >= 1, true)
  assert.ok(plan.anchoColumna > 0)
})

// --- Rotacion de paginas que sigue al llamado ----------------------------------

const { decidirPagina } = await import('@/lib/turnos/distribucion-pantalla')
const MS_PAGINA = 10_000
const MS_RETENER = 8_000

test('sin llamados, la pagina cambia cada 10 s', () => {
  let estado = { pagina: 0, cambioEn: MS_PAGINA }
  estado = decidirPagina(estado, { paginas: 3, ahora: 9_999, msPorPagina: MS_PAGINA })
  assert.equal(estado.pagina, 0)
  estado = decidirPagina(estado, { paginas: 3, ahora: 10_000, msPorPagina: MS_PAGINA })
  assert.deepEqual(estado, { pagina: 1, cambioEn: 20_000 })
})

test('un llamado en otra pagina salta a ella en el acto', () => {
  const estado = decidirPagina(
    { pagina: 0, cambioEn: 10_000 },
    { paginas: 3, ahora: 3_000, msPorPagina: MS_PAGINA, llamado: { pagina: 2, retenerMs: MS_RETENER } },
  )
  assert.equal(estado.pagina, 2)
})

test('tras el salto se queda al menos lo que dura el resalte y luego reinicia la cuenta de 10 s', () => {
  const tras = decidirPagina(
    { pagina: 0, cambioEn: 4_000 },
    { paginas: 3, ahora: 3_000, msPorPagina: MS_PAGINA, llamado: { pagina: 2, retenerMs: MS_RETENER } },
  )
  assert.equal(tras.cambioEn, 3_000 + MS_RETENER + MS_PAGINA)
  assert.equal(decidirPagina(tras, { paginas: 3, ahora: 12_000, msPorPagina: MS_PAGINA }).pagina, 2, 'sigue a la vista')
})

test('dos llamados seguidos desde paginas distintas: se ve el ultimo y se retiene desde el', () => {
  const llamado = (pagina) => ({ pagina, retenerMs: MS_RETENER })
  let estado = { pagina: 0, cambioEn: 10_000 }

  estado = decidirPagina(estado, { paginas: 3, ahora: 1_000, msPorPagina: MS_PAGINA, llamado: llamado(2) })
  assert.equal(estado.pagina, 2)
  estado = decidirPagina(estado, { paginas: 3, ahora: 2_000, msPorPagina: MS_PAGINA, llamado: llamado(1) })
  assert.equal(estado.pagina, 1, 'salta a la pagina del segundo llamado')
  assert.equal(estado.cambioEn, 2_000 + MS_RETENER + MS_PAGINA, 'la retencion cuenta desde el segundo')

  const antesDeRotar = decidirPagina(estado, { paginas: 3, ahora: 2_000 + MS_RETENER, msPorPagina: MS_PAGINA })
  assert.equal(antesDeRotar.pagina, 1, 'el segundo llamado sigue a la vista mientras dura su resalte')
})

test('con una sola pagina no hay nada que rotar', () => {
  assert.equal(decidirPagina({ pagina: 3, cambioEn: 0 }, { paginas: 1, ahora: 50_000, msPorPagina: MS_PAGINA }).pagina, 0)
})

// --- Un solo televisor: hasta 15 turnos, todos a la vista ------------------------------
//
// Una pagina 2 que rota cada diez segundos es un paciente que no ve su turno
// cuando mira. Hasta `MAXIMO_EN_UNA_PANTALLA` turnos no se pagina nunca, en
// ninguna pantalla ni en ninguna de las dos carteleras.
for (const nombre of Object.keys(PANTALLAS)) {
  test(`${nombre}: de 1 a 15 turnos, todos en una sola pantalla`, () => {
    for (let n = 1; n <= MAXIMO_EN_UNA_PANTALLA; n += 1) {
      assert.equal(cartelera(nombre, n).paginas, 1, `cartelera con ${n}`)
      assert.equal(paciente(nombre, n).paginas, 1, `cartelera con paciente con ${n}`)
    }
  })
}

test('en un TV 1080p, 12 turnos se ven con la letra normal y 15 apenas mas apretados', () => {
  const con12 = cartelera('1920x1080', 12).letra
  const con15 = cartelera('1920x1080', 15).letra
  alMenos(con12.turno, MINIMO_TURNO * 1080, 'turno con 12')
  alMenos(con15.turno, 0.038 * 1080, 'turno con 15')
  alMenos(con15.consultorio, 0.023 * 1080, 'consultorio con 15')
})

// En ventana (el navegador sin pantalla completa, unos 165 px menos de alto) el
// mismo TV salia con 3 columnas y en pantalla completa con 2: la tabla se
// rearmaba al entrar o salir de pantalla completa. Una columna mas solo si la
// letra crece de verdad.
test('en ventana y en pantalla completa el televisor reparte igual', () => {
  const tv = PANTALLAS['1920x1080']
  const ventana = { pantalla: { ancho: 1920, alto: 915 }, ancha: { ancho: tv.ancha.ancho, alto: tv.ancha.alto - 165 } }
  for (const n of [8, 10, 12, 15]) {
    const completa = planDeCartelera(tv.ancha, casillas(n), tv.pantalla)
    const enVentana = planDeCartelera(ventana.ancha, casillas(n), ventana.pantalla)
    assert.equal(enVentana.columnas, completa.columnas, `con ${n}`)
  }
})

test('en ventana y en pantalla completa la fila tiene la misma forma', () => {
  const tv = PANTALLAS['1920x1080']
  const ventana = { pantalla: { ancho: 1920, alto: 915 }, ancha: { ancho: tv.ancha.ancho, alto: tv.ancha.alto - 165 } }
  for (const n of [4, 8, 10, 12, 15]) {
    const completa = planDeCartelera(tv.ancha, casillas(n), tv.pantalla)
    const enVentana = planDeCartelera(ventana.ancha, casillas(n), ventana.pantalla)
    assert.equal(enVentana.forma, completa.forma, `con ${n}`)
  }
})

// --- La cartelera con el nombre del paciente (sin turno ni medico) ----------------------
//
// El nombre del paciente ocupa el hueco del medico y la celda del codigo
// desaparece: la fila tiene una columna menos y el mismo cuidado de no cortar.

for (const [nombre, tv] of Object.entries(PANTALLAS)) {
  test(`cartelera con paciente ${nombre}: sin columna de turno, nada se recorta y se lee de lejos`, () => {
    for (const n of CANTIDADES) {
      const espacio = espacioDeCartelera(tv, n)
      const plan = paciente(nombre, n, 'MARIA CAMILA RODRIGUEZ MONTERROSA')
      const { reja, letra } = plan
      assert.equal(reja.length, plan.forma === 'una-planta' ? 2 : 1, 'la celda del turno no se reserva')
      assert.equal(plan.celdas.turno, 0)
      assert.equal(plan.porPagina * plan.paginas >= n, true, 'ninguna fila se pierde')
      letraLegible(letra, ladoCorto(tv.pantalla), n)
      alMenos(plan.altoFila, letra.medico * 2.2, 'alto para dos lineas de nombre')
      const anchoFila = reja.reduce((suma, ancho) => suma + ancho, 0) + (reja.length - 1) * plan.separacionCeldas + 2 * plan.rellenoX
      assert.ok(anchoFila <= plan.anchoColumna + 0.5, `la fila no desborda su columna (${anchoFila} > ${plan.anchoColumna})`)
      const filasPorColumna = Math.ceil(Math.min(n, plan.porPagina) / plan.columnas)
      assert.ok(filasPorColumna * plan.altoFila + (filasPorColumna - 1) * plan.separacionFilas <= espacio.alto + 0.5)
    }
  })
}

// La jornada real del hospital: de 9 a 11 doctores a la vez, mañana o tarde.
// Con nombres largos del reporte, las DOS carteleras los muestran todos en una
// sola pagina (sin rotar) y con letra legible, en cualquier televisor.
for (const nombre of Object.keys(PANTALLAS)) {
  test(`${nombre}: de 9 a 11 doctores, las dos carteleras en una sola pagina`, () => {
    const lado = ladoCorto(PANTALLAS[nombre].pantalla)
    for (const n of [9, 10, 11]) {
      const conTurno = cartelera(nombre, n, 'CARLOS RAMON DE LEON CASTILLO')
      const conPaciente = paciente(nombre, n, 'MARIA CAMILA RODRIGUEZ MONTERROSA')
      for (const plan of [conTurno, conPaciente]) {
        assert.equal(plan.paginas, 1, `${n} filas`)
        letraLegible(plan.letra, lado, n)
      }
    }
  })
}

test('la cartelera con paciente va en una planta en los televisores horizontales: paciente | consultorio', () => {
  for (const nombre of Object.keys(PANTALLAS).filter((n) => !n.includes('vertical'))) {
    for (const n of [1, 4, 9, 11, 15]) {
      const plan = paciente(nombre, n, 'MARIA CAMILA RODRIGUEZ MONTERROSA')
      assert.equal(plan.forma, 'una-planta', `${nombre} con ${n}`)
      assert.equal(plan.reja.length, 2, 'dos columnas: paciente y consultorio')
    }
  }
})
