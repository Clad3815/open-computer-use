import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 7989,
    watch: {
      // Exclure les fichiers du dossier server pour éviter le rechargement de la page quand les JSON changent
      ignored: ['**/server/**', '**/omnibox/**', '**/omniparserserver/**']
    }
  },
  build: {
    outDir: 'server/dist',
    rollupOptions: {
      external: ['server/**', 'omnibox/**', 'omniparserserver/**']
    }
  }
})
