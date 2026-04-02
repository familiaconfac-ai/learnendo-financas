import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5174,
    host: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return

          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
            return 'vendor-react'
          }

          if (id.includes('recharts') || id.includes('d3-')) {
            return 'vendor-charts'
          }

          if (id.includes('firebase')) {
            return 'vendor-firebase'
          }

          if (id.includes('jspdf') || id.includes('html2canvas') || id.includes('pdfjs-dist')) {
            return 'vendor-pdf'
          }
        },
      },
    },
  },
})
