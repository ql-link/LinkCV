/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      fontFamily: {
        display: ["var(--ui-font-display)"],
        sans: ["var(--ui-font-sans)"],
        mono: ["var(--ui-font-mono)"],
      },
      colors: {
        background: "var(--ui-background)",
        foreground: "var(--ui-foreground)",
        surface: "var(--ui-surface)",
        "surface-elevated": "var(--ui-surface-elevated)",
        "surface-subtle": "var(--ui-surface-subtle)",
        "text-secondary": "var(--ui-text-secondary)",
        card: {
          DEFAULT: "var(--ui-surface)",
          foreground: "var(--ui-foreground)",
        },
        popover: {
          DEFAULT: "var(--ui-surface-elevated)",
          foreground: "var(--ui-foreground)",
        },
        primary: {
          DEFAULT: "var(--ui-primary)",
          foreground: "var(--ui-primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--ui-secondary)",
          foreground: "var(--ui-secondary-foreground)",
        },
        muted: {
          DEFAULT: "var(--ui-surface-muted)",
          foreground: "var(--ui-text-muted)",
        },
        accent: {
          DEFAULT: "var(--ui-accent-subtle)",
          foreground: "var(--ui-accent)",
        },
        destructive: {
          DEFAULT: "var(--ui-destructive)",
          foreground: "var(--ui-destructive-foreground)",
        },
        success: {
          DEFAULT: "var(--ui-success)",
          foreground: "var(--ui-success-foreground)",
        },
        warning: {
          DEFAULT: "var(--ui-warning)",
          foreground: "var(--ui-warning-foreground)",
        },
        border: "var(--ui-border)",
        input: "var(--ui-input)",
        ring: "var(--ui-ring)",
      },
      borderRadius: {
        xl: "var(--ui-radius-xl)",
        lg: "var(--ui-radius-lg)",
        md: "var(--ui-radius-md)",
        sm: "var(--ui-radius-sm)",
        xs: "var(--ui-radius-xs)",
      },
      boxShadow: {
        xs: "var(--ui-shadow-xs)",
        sm: "var(--ui-shadow-sm)",
        md: "var(--ui-shadow-md)",
      },
      transitionDuration: {
        fast: "var(--ui-duration-fast)",
        base: "var(--ui-duration-base)",
        slow: "var(--ui-duration-slow)",
      },
      transitionTimingFunction: {
        standard: "var(--ui-ease-standard)",
        press: "var(--ui-ease-press)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        marquee: {
          from: { transform: "translateX(0)" },
          to: { transform: "translateX(-50%)" },
        },
        "float-slow": {
          "0%,100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        marquee: "marquee 36s linear infinite",
        "float-slow": "float-slow 7s ease-in-out infinite",
      },
    },
  },
};
