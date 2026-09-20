import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Identidad institucional del hospital: teal sanitario sobre azul
        // profundo. Alto contraste, pensado tambien para leerse de lejos en la
        // pantalla publica de sala de espera.
        brand: {
          50:  '#eff8fb',
          100: '#d7eef5',
          200: '#aeddeb',
          300: '#79c4da',
          400: '#41a4c2',
          500: '#1c86a8',
          600: '#146c8c',
          700: '#135872',
          800: '#14495e',
          900: '#143d4f',
          950: '#0a2634',
        },

        /*
         * ACENTO: EL AZUL DE LO QUE SE PUEDE TOCAR.
         *
         * El teal de `brand` es la identidad —la barra lateral, el logo, la
         * pantalla de sala de espera— y por eso esta en todas partes. Eso era
         * justo el problema: cuando el color de la marca tambien es el color
         * del boton, de la pestaña encendida y de la seccion activa, nada
         * destaca, porque todo lleva el mismo tono.
         *
         * Este azul se reserva para UNA cosa: donde esta el usuario y que
         * puede pulsar. Es mas saturado y mas frio que el teal, asi que salta
         * sobre el, y no se usa para superficies grandes ni para decorar.
         */
        acento: {
          50:  '#eff5ff',
          100: '#dbe8fe',
          200: '#bfd7fe',
          300: '#93bbfd',
          400: '#6098fa',
          500: '#3b78f6',
          600: '#1d6fe0',
          700: '#1a54b8',
          800: '#1b4794',
          900: '#1c3f75',
          950: '#152847',
        },
      },
    },
  },
  plugins: [],
}
export default config
