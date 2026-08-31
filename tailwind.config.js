/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        slate: {
          950: '#0B1220',
        },
        charge: {
          50: '#FFFBEB',
          100: '#FEF3C7',
          400: '#F5B942',
          500: '#EAA916',
          600: '#C88A0C',
          700: '#9A6A08',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
