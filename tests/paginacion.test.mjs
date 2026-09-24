// La paginacion de las tablas de administracion: 10, 20 o 50 por pagina.
import assert from 'node:assert/strict'
import test from 'node:test'

const { paginar, numerosDePagina, TAMANOS_DE_PAGINA } = await import('@/lib/paginacion')

const lista = Array.from({ length: 45 }, (_, i) => i + 1)

test('se puede elegir 10, 20 o 50 por pagina, y 10 es el de siempre', () => {
  assert.deepEqual([...TAMANOS_DE_PAGINA], [10, 20, 50])
})

test('cada pagina trae sus registros y dice cuales son', () => {
  const segunda = paginar(lista, 2, 20)
  assert.deepEqual(segunda.visibles, lista.slice(20, 40))
  assert.equal(segunda.total, 3)
  assert.equal(segunda.desde, 21)
  assert.equal(segunda.hasta, 40)
  const ultima = paginar(lista, 3, 20)
  assert.equal(ultima.visibles.length, 5)
  assert.equal(ultima.hasta, 45)
  assert.equal(paginar(lista, 1, 50).total, 1)
})

test('una pagina que ya no existe (al filtrar) se acota, no queda vacia', () => {
  const acotada = paginar(lista.slice(0, 12), 5, 10)
  assert.equal(acotada.actual, 2)
  assert.deepEqual(acotada.visibles, [11, 12])
  const vacia = paginar([], 3, 10)
  assert.equal(vacia.actual, 1)
  assert.equal(vacia.desde, 0)
  assert.equal(vacia.hasta, 0)
})

test('con muchas paginas los numeros se resumen con …', () => {
  assert.deepEqual(numerosDePagina(1, 5), [1, 2, 3, 4, 5])
  assert.deepEqual(numerosDePagina(1, 50), [1, 2, 3, 4, 5, '…', 50])
  assert.deepEqual(numerosDePagina(25, 50), [1, '…', 24, 25, 26, '…', 50])
  assert.deepEqual(numerosDePagina(50, 50), [1, '…', 46, 47, 48, 49, 50])
})
