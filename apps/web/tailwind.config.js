/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx}", "./components/**/*.{js,jsx}"],
  theme: { extend: { colors: { ink: "#111827", brand: "#5B4BDB", canvas: "#F5F6FA" }, boxShadow: { soft: "0 12px 40px rgba(15,23,42,.07)" } } },
  plugins: []
};
