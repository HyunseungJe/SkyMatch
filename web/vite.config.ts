import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the static build works on GitHub Pages and Hugging Face Spaces.
  base: './',
  server: {
    port: 5173,
    strictPort: true,
    // The sky source of truth (schema, GLSL, noise texture) lives in ../sky.
    fs: { allow: ['..'] },
  },
});
