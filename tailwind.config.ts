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
    // One light theme and its dark twin. `dark` mirrors `silk`: the same warm
    // hue axis, inverted. Buttons stay a single flat surface in both, and the
    // vivid label colours (acid green / orange / teal) carry the identity.
    themes: [
      {
        silk: {
          'color-scheme': 'light',
          primary: 'oklch(23.27% 0.0249 284.3)',
          'primary-content': 'oklch(94.22% 0.2505 117.44)',
          secondary: 'oklch(23.27% 0.0249 284.3)',
          'secondary-content': 'oklch(73.92% 0.2135 50.94)',
          accent: 'oklch(23.27% 0.0249 284.3)',
          'accent-content': 'oklch(88.92% 0.2061 189.9)',
          neutral: 'oklch(20% 0 0)',
          'neutral-content': 'oklch(80% 0.0081 61.42)',
          'base-100': 'oklch(97% 0.0035 67.78)',
          'base-200': 'oklch(95% 0.0081 61.42)',
          'base-300': 'oklch(90% 0.0081 61.42)',
          // Darkened from 40% so body text clears 7:1 on base-100.
          'base-content': 'oklch(35% 0.0081 61.42)',
          info: 'oklch(80.39% 0.1148 241.68)',
          'info-content': 'oklch(30.39% 0.1148 241.68)',
          success: 'oklch(83.92% 0.0901 136.87)',
          'success-content': 'oklch(23.92% 0.0901 136.87)',
          warning: 'oklch(83.92% 0.1085 80)',
          'warning-content': 'oklch(43.92% 0.1085 80)',
          error: 'oklch(75.1% 0.1814 22.37)',
          'error-content': 'oklch(35.1% 0.1814 22.37)',
          '--rounded-box': '1rem',
          '--rounded-btn': '0.5rem',
          '--rounded-badge': '2rem',
          '--border-btn': '1px',
          '--tab-border': '2px',
          '--tab-radius': '0.5rem',
        },
      },
      {
        dark: {
          'color-scheme': 'dark',
          // Inverted: the button surface is now warm light, and the label keeps
          // silk's vivid hue, darkened enough to read against it.
          primary: 'oklch(93% 0.008 67.78)',
          'primary-content': 'oklch(43% 0.16 117.44)',
          secondary: 'oklch(93% 0.008 67.78)',
          'secondary-content': 'oklch(45% 0.19 50.94)',
          accent: 'oklch(93% 0.008 67.78)',
          'accent-content': 'oklch(45% 0.13 189.9)',
          neutral: 'oklch(85% 0.006 61.42)',
          'neutral-content': 'oklch(22% 0.006 61.42)',
          'base-100': 'oklch(21% 0.006 67.78)',
          'base-200': 'oklch(25% 0.007 61.42)',
          'base-300': 'oklch(31% 0.008 61.42)',
          'base-content': 'oklch(89% 0.008 61.42)',
          // Status colours are shared with silk: light fill, dark label. They
          // read as badges on either base without a second set of values.
          info: 'oklch(80.39% 0.1148 241.68)',
          'info-content': 'oklch(30.39% 0.1148 241.68)',
          success: 'oklch(83.92% 0.0901 136.87)',
          'success-content': 'oklch(23.92% 0.0901 136.87)',
          warning: 'oklch(83.92% 0.1085 80)',
          'warning-content': 'oklch(43.92% 0.1085 80)',
          error: 'oklch(75.1% 0.1814 22.37)',
          'error-content': 'oklch(35.1% 0.1814 22.37)',
          '--rounded-box': '1rem',
          '--rounded-btn': '0.5rem',
          '--rounded-badge': '2rem',
          '--border-btn': '1px',
          '--tab-border': '2px',
          '--tab-radius': '0.5rem',
        },
      },
    ],
  },
}
