/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0a0b0f",
        panel: "#12141a",
        edge: "#1f2230",
        ink: "#e7e9ee",
        muted: "#8a8f9c",
        accent: "#7cf2c8",
        warn: "#f5b656",
        bad: "#f47174",
      },
    },
  },
  plugins: [],
};
