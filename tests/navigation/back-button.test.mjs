import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function read(relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

const component = read('../../src/components/navigation/BackButton.tsx');
const hoje = read('../../src/app/hoje/page.tsx');

assert.ok(component.includes("'use client'"));
assert.ok(component.includes("useRouter"));
assert.ok(component.includes('router.back()'));
assert.ok(component.includes("label = 'Voltar'"));
assert.ok(hoje.includes("from '@/components/navigation/BackButton'"));
assert.ok(hoje.includes('<BackButton />'));

const forbidden = ['window.location=', 'location.href=', 'localStorage', 'sessionStorage', 'fetch(', '.from('];
for (const token of forbidden) {
  assert.ok(!component.includes(token), `BackButton não deve conter ${token}`);
}

console.log('PASS: botão Voltar usa o histórico de navegação sem alterar estado.');
