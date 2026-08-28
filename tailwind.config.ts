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
      },
    },
  },
  plugins: [],
}
export default config
