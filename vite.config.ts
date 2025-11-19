import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Garante que carregamos as variáveis do diretório atual
  const env = loadEnv(mode, process.cwd(), '');

  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [react()],
    define: {
      // Define as variáveis globais para evitar "process is not defined" no navegador
      // Certifique-se de adicionar 'GEMINI_API_KEY' nas configurações de Environment Variables do Vercel
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
    },
    resolve: {
      alias: {
        // CORREÇÃO: O alias @ deve apontar para a pasta src, não para a raiz (.)
        '@': path.resolve(__dirname, './src'),
      }
    },
    // Configuração de build para garantir compatibilidade
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      sourcemap: false,
    }
  };
});
