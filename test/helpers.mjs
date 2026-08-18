import { spawn } from 'node:child_process';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Sobe o servidor num porto próprio para o teste não depender de nada rodando. */
export async function startServer(port, env = {}) {
  const child = spawn('node', ['server/index.js'], {
    env: { ...process.env, PORT: String(port), ...env },
    stdio: 'ignore',
  });

  for (let i = 0; i < 40; i++) {
    await sleep(150);
    try {
      const res = await fetch(`http://localhost:${port}/healthz`);
      if (res.ok) return { child, stop: () => child.kill('SIGKILL') };
    } catch {
      /* ainda subindo */
    }
  }

  child.kill('SIGKILL');
  throw new Error(`servidor não subiu na porta ${port}`);
}

export function reporter() {
  const results = [];
  return {
    check(label, ok, extra = '') {
      results.push(ok);
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  ${extra}` : ''}`);
      return ok;
    },
    finish() {
      const failed = results.filter((ok) => !ok).length;
      console.log(`\n${results.length - failed}/${results.length} checks OK`);
      return failed;
    },
  };
}

export { sleep };
