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
        // PANTONE Color System (Very Peri 17-3938 & Ultra Violet 18-3838 / CMU Library Palette)
        gov: {
          50: '#F6F5FB',   // PANTONE Lavender Mist
          100: '#EDEAF7',  // PANTONE Pastel Lilac
          200: '#DCD6F0',  // PANTONE Orchid Ice
          300: '#C1B7E4',  // PANTONE Lavender Fog
          400: '#9E91D3',  // PANTONE Violet Tulle
          500: '#7D6EC0',  // PANTONE Jacaranda
          600: '#6667AB',  // PANTONE 17-3938 Very Peri
          700: '#5F4B8B',  // PANTONE 18-3838 Ultra Violet
          800: '#49386E',  // PANTONE Deep Amethyst
          900: '#2E2348',  // PANTONE Nightshade Violet
        },
        pantone: {
          cloud: '#F6F4F0',    // PANTONE 11-4201 Cloud Dancer
          sand: '#EFECE6',     // PANTONE Warm Sand
          peri: '#6667AB',     // PANTONE 17-3938 Very Peri
          violet: '#5F4B8B',   // PANTONE 18-3838 Ultra Violet
          peach: '#FFBE98',    // PANTONE 13-1023 Peach Fuzz
          coral: '#FF6F61',    // PANTONE 16-1546 Living Coral
          greenery: '#5B9E7D', // PANTONE Greenery Sage
          serenity: '#92A8D1', // PANTONE 15-3919 Serenity
          rose: '#F7CAC9',     // PANTONE 13-1520 Rose Quartz
          mocha: '#A47864',    // PANTONE 17-1230 Mocha Mousse
        }
      }
    },
  },
  plugins: [],
}
