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
      },
      boxShadow: {
        'pantone-sm': '0 2px 8px -2px rgba(102, 103, 171, 0.12), 0 1px 4px -1px rgba(95, 75, 139, 0.08)',
        'pantone-md': '0 8px 20px -4px rgba(102, 103, 171, 0.16), 0 4px 10px -2px rgba(95, 75, 139, 0.10)',
        'pantone-lg': '0 16px 32px -6px rgba(102, 103, 171, 0.20), 0 8px 16px -4px rgba(95, 75, 139, 0.12)',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        slideUpFade: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideDownFade: {
          '0%': { opacity: '0', transform: 'translateY(-12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        popIn: {
          '0%': { opacity: '0', transform: 'scale(0.92)' },
          '65%': { opacity: '1', transform: 'scale(1.02)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        drawerRight: {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.8s infinite linear',
        'slide-up': 'slideUpFade 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'slide-down': 'slideDownFade 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'fade-in': 'fadeIn 0.25s ease-out forwards',
        'pop-in': 'popIn 0.28s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'drawer-right': 'drawerRight 0.32s cubic-bezier(0.16, 1, 0.3, 1) forwards',
      }
    },
  },
  plugins: [],
}
