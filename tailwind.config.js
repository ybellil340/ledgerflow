/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        brand: { 50: '#e8e8f0', 100: '#c8c8dc', 500: '#3a3a6e', 900: '#1a1a2e' },
      },
    },
  },
  plugins: [],
}
