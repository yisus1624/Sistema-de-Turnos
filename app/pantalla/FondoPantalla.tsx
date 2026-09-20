/**
 * La imagen de fondo del televisor de la sala de espera.
 *
 * La usan LOS DOS diseños —la cuadricula de consultorios y la cartelera— y por
 * eso vive aqui y no dentro de uno de ellos: las reglas que hacen que el turno
 * siga leyendose por encima de una foto son las mismas en ambos, y duplicarlas
 * significaria que el dia que se suba una imagen mas oscura se arregla una
 * pantalla y la otra se queda ilegible.
 *
 * REGLA DE LA CASA: LA IMAGEN NUNCA SOSTIENE INFORMACION. Es decoracion. Si no
 * hay ninguna configurada, o si el navegador no la puede cargar, las dos
 * pantallas se ven igual de correctas sobre el fondo liso institucional. Nada
 * de lo que el paciente necesita leer depende de que la foto aparezca.
 *
 * ---------------------------------------------------------------------------
 * POR QUE HAY DOS COPIAS DE LA MISMA IMAGEN
 * ---------------------------------------------------------------------------
 *
 * El problema: la fotografia del hospital es casi cuadrada y un televisor es
 * apaisado. Con las dos formas obvias se pierde algo:
 *
 * - `object-cover` la amplia hasta llenar la pantalla y recorta el resto. Se
 *   veia un primerisimo plano de unos dedos y media lupa; la escena entera
 *   —el medico, el mapa, los iconos— quedaba fuera de cuadro.
 * - `object-contain` la muestra completa, pero deja dos franjas vacias a los
 *   lados que parecen un error de configuracion.
 *
 * La solucion es la que usan los reproductores de video para el mismo caso:
 * DOS COPIAS SUPERPUESTAS. Debajo, la imagen ampliada y muy desenfocada, que
 * llena la pantalla entera con sus propios colores y hace de relleno; encima,
 * la imagen COMPLETA y nitida, centrada. El resultado no tiene franjas muertas
 * ni recorta nada: la foto se ve entera y el fondo se ve lleno.
 *
 * Cuesta una sola descarga —es el mismo archivo, el navegador lo reutiliza— y
 * ningun trabajo por fotograma: son dos imagenes quietas.
 */

/** Cuanto se atenua la imagen en cada diseño. */
type Intensidad = 'cartelera' | 'cuadricula'

/*
 * EL VELO BLANCO POR ENCIMA.
 *
 * Son dos intensidades porque los dos diseños apoyan el texto de forma
 * distinta:
 *
 * - `cartelera`: el panel de turnos es de vidrio y deja ver la foto por
 *   detras, asi que la foto tiene que quedar VISIBLE pero tranquila. Un velo
 *   corto le baja el contraste lo justo para que no compita con los numeros
 *   que van encima.
 * - `cuadricula`: ahi las fichas blancas opacas se apoyan directamente sobre
 *   la imagen y ocupan casi toda la pantalla, asi que el fondo solo tiene que
 *   aportar un tono de color.
 */
const VELO: Record<Intensidad, string> = {
  cartelera: 'bg-white/45',
  cuadricula: 'bg-white/[0.88]',
}

type FondoPantallaProps = {
  /** Ruta de la imagen, de `ConfiguracionSistema.fondoPantalla`. Vacio = sin fondo. */
  ruta: string
  intensidad: Intensidad
}

export default function FondoPantalla({ ruta, intensidad }: FondoPantallaProps) {
  if (!ruta) return null

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/*
        CAPA DE RELLENO: la misma foto, ampliada y desenfocada.

        `scale-110` evita que el desenfoque deje los bordes transparentes —el
        blur difumina tambien el filo de la imagen—, y `saturate` le devuelve
        el color que el propio desenfoque apaga. Nadie la mira: esta ahi para
        que no haya franjas muertas a los lados.
      */}
      {/* eslint-disable-next-line @next/next/no-img-element -- ruta configurable por el administrador */}
      <img
        src={ruta}
        alt=""
        className="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl saturate-150"
      />

      {/*
        CAPA NITIDA: la foto COMPLETA, sin recortar, centrada.

        Es la que el paciente ve de verdad. `object-contain` garantiza que
        entra entera sea cual sea la proporcion del televisor.
      */}
      {/* eslint-disable-next-line @next/next/no-img-element -- ruta configurable por el administrador */}
      <img src={ruta} alt="" className="absolute inset-0 h-full w-full object-contain" />

      <div className={`absolute inset-0 ${VELO[intensidad]}`} />
    </div>
  )
}
