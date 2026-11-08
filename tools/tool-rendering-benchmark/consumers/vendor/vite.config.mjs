import tailwindcss from '@tailwindcss/vite';
export default {
  plugins: [tailwindcss()],
  esbuild: { jsx: 'automatic' },
  server: { host: '127.0.0.1', port: 4810, strictPort: true },
};
