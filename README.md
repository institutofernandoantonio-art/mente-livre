# Mente Livre

App onde a pessoa despeja tudo o que está ocupando a cabeça (texto ou voz) e
a IA transforma isso em tarefas organizadas, ajuda a priorizar e monta um
plano realista para o dia.

> Sua mente pensa. A IA organiza.

Este projeto está sendo construído em fases pequenas e testáveis. O
histórico de decisões e o que já está pronto ficam registrados em
[`PROJECT_CONTEXT.md`](./PROJECT_CONTEXT.md).

## Pré-requisitos

- [Node.js](https://nodejs.org) 20 ou mais recente
- npm (já vem junto com o Node.js)

## Instalação

```bash
npm install
```

## Variáveis de ambiente

Copie `.env.example` para `.env.local` e preencha os valores. Cada variável
está comentada no próprio arquivo, explicando para que serve e em qual fase
do projeto ela passa a ser necessária.

```bash
cp .env.example .env.local
```

Até a Fase 1 (projeto base), nenhuma variável é obrigatória — o site
funciona sem `.env.local` preenchido.

## Banco de dados

Ainda não configurado. Será adicionado na Fase 2, usando Supabase
(PostgreSQL gerenciado + autenticação).

## Rodando em desenvolvimento

```bash
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000) no navegador.

## Testes

Ainda não configurados. Serão adicionados a partir da Fase 2, conforme as
funcionalidades que precisam ser testadas forem existindo.

## Produção / Deploy

Planejado para a Fase 10, usando Vercel. Instruções completas de deploy
serão adicionadas nessa fase.

## Problemas comuns

**A porta 3000 já está em uso.** Feche outro processo que esteja rodando
`npm run dev`, ou rode `npm run dev -- -p 3001` para usar outra porta.

**`npm install` falhou.** Confirme que o Node.js está instalado rodando
`node -v` no terminal — a versão precisa ser 20 ou mais recente.
