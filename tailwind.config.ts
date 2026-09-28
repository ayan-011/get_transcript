import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: { ink: "#14212B", mist: "#EEF2F4", line: "#D3DCE1", teal: { DEFAULT: "#0F766E", dark: "#0B5B55" } },
    },
  },
  plugins: [],
};
export default config;
