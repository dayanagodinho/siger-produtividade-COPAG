import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * A marca da versao e decidida no build, e nao escrita a mao.
 *
 * O numero vem do package.json e muda quando alguma coisa muda de verdade. A
 * data e o commit sao carimbados aqui a cada publicacao, e sao eles que
 * respondem "o que eu pedi ja subiu?" sem depender de ninguem lembrar de
 * atualizar nada.
 */
function marcaDaVersao() {
  const pacote = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

  // No Railway o commit chega por variavel; fora dele, o proprio git responde.
  let commit = process.env.RAILWAY_GIT_COMMIT_SHA ?? null;
  if (!commit) {
    try {
      commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    } catch {
      commit = null;
    }
  }

  return {
    numero: pacote.version.replace(/\.0$/, ''),
    commit: commit ? commit.slice(0, 7) : null,
    publicado_em: new Date().toISOString(),
  };
}

export default defineConfig({
  plugins: [react()],
  define: {
    __VERSAO__: JSON.stringify(marcaDaVersao()),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
