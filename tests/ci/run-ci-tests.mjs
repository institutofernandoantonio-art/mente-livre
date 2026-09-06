import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const scripts = pkg.scripts ?? {};

const testScripts = Object.keys(scripts)
  .filter((name) => name.startsWith('test:'))
  .filter((name) => !['test:rls', 'test:ci'].includes(name))
  .sort();

if (testScripts.length === 0) {
  console.error('Nenhum script test:* elegível para CI foi encontrado.');
  process.exit(1);
}

for (const script of testScripts) {
  console.log(`\n=== ${script} ===`);
  const result = spawnSync('npm', ['run', script], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });

  if (result.status !== 0) {
    console.error(`\nCI interrompido: ${script} falhou.`);
    process.exit(result.status ?? 1);
  }
}

console.log(`\nTodos os ${testScripts.length} scripts de teste elegíveis passaram.`);
console.log('Observação: test:rls continua fora da CI porque exige duas contas descartáveis reais e credenciais temporárias.');
