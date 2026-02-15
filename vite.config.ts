// import { defineConfig } from 'vite'
// import path from 'node:path'
// import electron from 'vite-plugin-electron/simple'
// import react from '@vitejs/plugin-react'
// import tailwindcss from "@tailwindcss/vite";

// // https://vitejs.dev/config/
// export default defineConfig({
//   plugins: [
//     react(),
//      tailwindcss(),
//     electron({
//       main: {
//         // Shortcut of `build.lib.entry`.
//         entry: 'electron/main.ts',
//       },
//       preload: {
//         // Shortcut of `build.rollupOptions.input`.
//         // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
//         input: path.join(__dirname, 'electron/preload.ts'),
//       },
//       // Ployfill the Electron and Node.js API for Renderer process.
//       // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
//       // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
//       renderer: process.env.NODE_ENV === 'test'
//         // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
//         ? undefined
//         : {},
//     }),
//   ],
// })

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron";
import renderer from "vite-plugin-electron-renderer";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    electron([
      {
        entry: "electron/main.ts",
        onstart(options) {
          options.startup();
        },
        vite: {
          build: {
            outDir: "dist-electron",
            sourcemap: true,
          },
        },
      },
      {
        entry: "electron/preload.ts",
        onstart(options) {
          options.reload();
        },
        vite: {
          build: {
            outDir: "dist-electron",
            sourcemap: true,
          },
        },
      },
    ]),
    renderer(),
  ],
});
