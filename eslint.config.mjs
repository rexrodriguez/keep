import nextConfig from "eslint-config-next";

const config = [
  {
    ignores: [
      "packages/**",
      ".next/**",
      "node_modules/**",
      "out/**",
    ],
  },
  ...nextConfig,
  {
    rules: {
      // Data-URI thumbnails and AR canvas captures can't use next/image
      "@next/next/no-img-element": "off",
      // Ref sync during render is an established pattern (contextRef.current = context)
      // and createPortal with refs is standard React usage
      "react-hooks/refs": "off",
    },
  },
];

export default config;
