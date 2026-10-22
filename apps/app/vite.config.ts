import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * The dev server labels `.gz` files as already-compressed web content, so the browser unzips the noise model
 * before the filter sees it, and the filter needs the archive itself. Production servers send it as a plain file.
 */
const keepModelArchiveCompressed = (): Plugin => ({
  name: 'keep-model-archive-compressed',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url?.startsWith('/noise/')) {
        const setHeader = res.setHeader.bind(res);
        res.setHeader = (name, value) => (name.toLowerCase() === 'content-encoding' ? res : setHeader(name, value));
      }
      next();
    });
  },
});

export default defineConfig({
  plugins: [react(), keepModelArchiveCompressed()],
  server: { port: 5173, strictPort: true },
});
