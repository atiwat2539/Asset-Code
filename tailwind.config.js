/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Sarabun"', '"Noto Sans Thai"', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        gov: {
          50: '#f0f4fa',
          100: '#dce5f5',
          200: '#bfd1ed',
          300: '#93b3e1',
          400: '#608dd1',
          500: '#3c6dc2',
          600: '#2b55a5',
          700: '#1e3a8a',
          800: '#172e6e',
          900: '#0f172a',
        }
      }
    },
  },
  plugins: [],
}
