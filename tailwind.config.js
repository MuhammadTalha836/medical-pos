/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        pharmacy: {
          50: '#f0fdf9',
          100: '#ccfbf1',
          200: '#99f6e4',
          300: '#5eead4',
          400: '#2dd4bf',
          500: '#14b8a6', // Primary Teal
          600: '#0d9488',
          700: '#0f766e',
          800: '#115e59',
          900: '#134e4a',
          950: '#042f2e',
        },
        surface: {
          base: {
            light: '#f8fafc',
            dark: '#0a0e17'
          },
          card: {
            light: '#ffffff',
            dark: '#111827'
          },
          elevated: {
            light: '#ffffff',
            dark: '#162032'
          },
          inset: {
            light: '#f1f5f9',
            dark: '#0d131f'
          }
        },
        slate: {
          850: '#162032',
          900: '#111827',
          950: '#0a0e17', // Calibrated soft obsidian dark canvas
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
}
