import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    screens: {
      sm: '640px',   // Tablet starts (covers 481-1024px range with sm+md)
      md: '768px',   // Mid-tablet
      lg: '1025px',  // Desktop (requirement 10.3: 1025px+)
      xl: '1280px',  // Large desktop
      '2xl': '1536px',
    },
    extend: {
      colors: {
        primary: {
          DEFAULT: "#2F7A5F",
          dark: "#255F4A",
        },
        accent: "#D97748",
        ink: "#1C1A15",
        paper: "#FDFBF8",
        ledger: "#B8862E",
        success: "#00C853",
        warning: "#FFB300",
        danger: "#D50000",
        bg: {
          DEFAULT: "#FFFFFF",
          secondary: "#F5F5F5",
        },
        text: {
          DEFAULT: "#212121",
          secondary: "#757575",
        },
        border: "#E0E0E0",
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
        serif: ["var(--font-newsreader)", "Georgia", "serif"],
        mono: ["var(--font-jetbrains-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        sm: "8px",
        md: "12px",
        lg: "16px",
      },
      boxShadow: {
        card: "0 2px 8px rgba(0, 0, 0, 0.08)",
        elevated: "0 4px 16px rgba(0, 0, 0, 0.12)",
      },
      transitionDuration: {
        fast: "150ms",
        normal: "200ms",
        slow: "300ms",
      },
      transitionTimingFunction: {
        "ease-out": "ease-out",
        "ease-in-out": "ease-in-out",
      },
      keyframes: {
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        shimmer:
          "shimmer 1.5s infinite linear",
      },
    },
  },
  plugins: [],
};

export default config;
