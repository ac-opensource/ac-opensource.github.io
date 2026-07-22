const path = require("path");

module.exports = {
  darkMode: "class",
  content: [process.env.TAILWIND_CONTENT || path.join(__dirname, "..", "dist", "**", "*.html")],
  theme: {
    extend: {
      colors: {
        "on-error": "#fff7f6",
        "on-secondary": "#f6f9ff",
        background: "#faf9f4",
        tertiary: "#1f5cba",
        "inverse-surface": "#0d0f0c",
        "tertiary-fixed": "#6799fb",
        "on-secondary-container": "#4a535c",
        "tertiary-container": "#6799fb",
        "tertiary-dim": "#024fad",
        "surface-container-lowest": "#ffffff",
        surface: "#faf9f4",
        outline: "#787c73",
        "inverse-primary": "#f0f4fb",
        error: "#9f403d",
        "on-secondary-fixed": "#374049",
        "surface-container-low": "#f4f4ee",
        "on-primary-fixed": "#3b4045",
        "secondary-container": "#dae3ef",
        secondary: "#57606a",
        "primary-container": "#dee3e9",
        "surface-tint": "#5a5f65",
        "primary-fixed": "#dee3e9",
        "on-surface-variant": "#5c6058",
        "on-tertiary-container": "#001b46",
        "on-background": "#2f342d",
        "surface-dim": "#d7dcd0",
        "on-tertiary": "#f9f8ff",
        "on-surface": "#2f342d",
        "on-error-container": "#752121",
        "surface-container": "#edefe7",
        "on-primary-fixed-variant": "#575c62",
        "inverse-on-surface": "#9d9d99",
        "secondary-dim": "#4b545d",
        "outline-variant": "#afb3aa",
        primary: "#5a5f65",
        "error-container": "#fe8983",
        "surface-bright": "#faf9f4",
        "primary-fixed-dim": "#d0d5db",
        "tertiary-fixed-dim": "#598ced",
        "surface-variant": "#e0e4d9",
        "on-tertiary-fixed-variant": "#002559",
        "secondary-fixed-dim": "#ccd5e1",
        "primary-dim": "#4e5358",
        "error-dim": "#4e0309",
        "on-tertiary-fixed": "#000000",
        "surface-container-highest": "#e0e4d9",
        "on-primary": "#f4f8ff",
        "on-secondary-fixed-variant": "#535c66",
        "secondary-fixed": "#dae3ef",
        "on-primary-container": "#4d5258",
        "surface-container-high": "#e7e9e0"
      },
      fontFamily: {
        headline: ["Space Grotesk", "sans-serif"],
        body: ["Manrope", "sans-serif"],
        label: ["Space Grotesk", "sans-serif"]
      },
      borderRadius: {
        DEFAULT: "0px",
        lg: "0px",
        xl: "0px",
        full: "9999px"
      },
      animation: {
        float: "float 6s ease-in-out infinite",
        "pulse-slow": "pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "spin-slow": "spin 12s linear infinite",
        orbit: "orbit 15s linear infinite"
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0) rotate(0deg)" },
          "50%": { transform: "translateY(-20px) rotate(2deg)" }
        },
        orbit: {
          from: { transform: "rotate(0deg) translateX(40px) rotate(0deg)" },
          to: { transform: "rotate(360deg) translateX(40px) rotate(-360deg)" }
        }
      }
    }
  },
  plugins: [require("@tailwindcss/forms")]
};
