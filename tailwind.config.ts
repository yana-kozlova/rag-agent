/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        // Sans carries prose: chat, headings, descriptions.
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        // Mono carries data: times, tags, ids, counters, code.
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [require("daisyui")],
  daisyui: {
    // Flat minimal system. One light theme (`silk`) and its dark twin (`dark`).
    // Structure comes from hairlines (base-300) and whitespace, not shadows or
    // filled cards. A single blue accent (primary/accent) is the only vivid hue;
    // everything else is a warm-tinted neutral. base-100 = canvas, base-200 =
    // subtle fill, base-300 = hairline.
    themes: [
      {
        silk: {
          'color-scheme': 'light',
          primary: '#2e7cf6',
          'primary-content': '#ffffff',
          secondary: '#787774',
          'secondary-content': '#ffffff',
          accent: '#2e7cf6',
          'accent-content': '#ffffff',
          neutral: '#37352f',
          'neutral-content': '#f7f7f5',
          'base-100': '#ffffff',
          'base-200': '#f7f7f5',
          'base-300': '#eaeae8',
          // Warm near-black; ~10.9:1 on base-100.
          'base-content': '#37352f',
          info: '#2e7cf6',
          'info-content': '#ffffff',
          success: '#3f8f5b',
          'success-content': '#ffffff',
          warning: '#b07d1e',
          'warning-content': '#ffffff',
          error: '#c8392f',
          'error-content': '#ffffff',
          '--rounded-box': '0.5rem',
          '--rounded-btn': '0.375rem',
          '--rounded-badge': '2rem',
          '--border-btn': '1px',
          '--tab-border': '2px',
          '--tab-radius': '0.375rem',
        },
      },
      {
        dark: {
          'color-scheme': 'dark',
          primary: '#4c8df6',
          'primary-content': '#ffffff',
          secondary: '#9b9a97',
          'secondary-content': '#191919',
          accent: '#4c8df6',
          'accent-content': '#ffffff',
          neutral: '#e9e9e7',
          'neutral-content': '#191919',
          'base-100': '#191919',
          'base-200': '#212121',
          'base-300': '#2c2c2c',
          'base-content': '#e9e9e7',
          info: '#4c8df6',
          'info-content': '#ffffff',
          success: '#5aa876',
          'success-content': '#101710',
          warning: '#c9a23b',
          'warning-content': '#1a1405',
          error: '#e0655b',
          'error-content': '#1a0b09',
          '--rounded-box': '0.5rem',
          '--rounded-btn': '0.375rem',
          '--rounded-badge': '2rem',
          '--border-btn': '1px',
          '--tab-border': '2px',
          '--tab-radius': '0.375rem',
        },
      },
    ],
  },
}
