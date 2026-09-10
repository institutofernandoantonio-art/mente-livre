# Protocolo de desenvolvimento seguro — Mente Livre

Este protocolo define como mudanças técnicas serão conduzidas para reduzir bugs, proteger dados e diminuir drasticamente a dependência de intervenção operacional do usuário.

## Objetivo

Permitir desenvolvimento rápido com IA sem transformar velocidade em risco. A IA pode executar leitura, diagnóstico, implementação, testes, documentação e preparação de PRs; decisões de produto, mudanças irreversíveis ou alterações de risco relevante continuam exigindo decisão humana explícita.

## Regra principal

**Nenhuma mudança de código deve ser feita diretamente em `main`.** Toda alteração parte de uma branch dedicada, passa por validação e é apresentada como Pull Request antes de ser integrada.

## Fluxo padrão obrigatório

1. **Entender antes de alterar**
   - ler `AGENTS.md`, `CLAUDE.md`, `PROJECT_CONTEXT.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md` e `docs/DECISIONS.md` quando a mudança tocar arquitetura, segurança ou escopo;
   - localizar código e testes relacionados;
   - identificar efeitos colaterais e dependências.

2. **Mudança mínima e reversível**
   - preferir a menor alteração capaz de resolver o problema;
   - evitar refatorações amplas misturadas com feature ou correção;
   - não antecipar tabelas, campos ou infraestrutura de fases futuras sem autorização explícita;
   - manter rollback simples.

3. **Branch isolada**
   - uma branch por objetivo;
   - `main` permanece estável;
   - nunca force-push em `main`.

4. **Validação antes de integrar**
   - executar lint e build quando houver alteração de código;
   - executar os testes específicos da área alterada;
   - executar testes de segurança quando a mudança tocar autenticação, autorização, banco, RLS, Google OAuth/Calendar, dados pessoais ou Server Functions;
   - adicionar teste de regressão para todo bug reproduzível corrigido sempre que tecnicamente viável.

5. **Pull Request obrigatório**
   - descrever problema, causa, solução, risco, testes executados e plano de rollback;
   - não misturar mudanças sem relação direta;
   - mudanças de alto risco devem permanecer em PR até revisão adicional.

6. **Integração controlada**
   - mudanças documentais, testes e correções de baixo risco podem ser integradas após validação completa;
   - mudanças de produto, banco destrutivo, segurança, permissões, autenticação, cobrança, exclusão de dados ou comportamento irreversível exigem aprovação explícita antes da integração;
   - produção nunca deve ser usada como ambiente de experimento.

## Gates de segurança

### Banco e Supabase

- RLS explícito por operação em toda tabela nova;
- `anon` sem acesso quando não houver necessidade;
- `user_id` nunca confiado a partir do cliente quando puder ser obtido da sessão;
- migration nova deve ser aditiva sempre que possível;
- alteração destrutiva requer plano de backup, rollback e aprovação explícita;
- nenhuma `service_role` no frontend;
- não executar SQL manual destrutivo em produção como atalho.

### Autenticação e autorização

- autenticação validada no servidor;
- rotas privadas protegidas no servidor;
- mensagens de erro não podem facilitar enumeração de contas;
- redirects aceitam apenas destinos controlados;
- alterações em MFA, recovery, OAuth ou sessão exigem testes de fluxo feliz e de falha.

### Integrações externas

- usar privilégio mínimo nos scopes;
- operações externas com efeito real devem ser idempotentes quando possível;
- confirmação explícita antes de ações relevantes em nome do usuário;
- falha externa não pode corromper estado local já confirmado;
- tokens e segredos nunca aparecem em log, resposta ao cliente ou repositório.

### IA e dados pessoais

- modelo nunca é tratado como fonte confiável sem validação estrutural;
- respostas da IA devem ser validadas contra schema/allow-list quando alimentarem lógica do sistema;
- inferência sobre a pessoa deve ser identificada como inferência, não fato;
- minimizar envio de dados pessoais ao modelo;
- não registrar conteúdo pessoal desnecessariamente em logs;
- decisões importantes da IA devem permanecer revisáveis e, quando adequado, confirmáveis pelo usuário.

## Gate de qualidade

Antes de considerar uma mudança pronta:

- lint sem erro relevante;
- build concluído;
- testes da área afetada aprovados;
- teste de regressão incluído quando aplicável;
- nenhuma exposição nova de segredo;
- nenhuma quebra conhecida de isolamento de usuário;
- documentação de arquitetura/decisão atualizada quando necessário;
- rollback compreendido.

## Redução da dependência do usuário

A IA está autorizada a conduzir autonomamente, sem pedir confirmação a cada passo:

- leitura e diagnóstico do repositório;
- investigação de bugs;
- criação de branches;
- implementação de baixo e médio risco em branch;
- criação e atualização de testes;
- lint/build/testes;
- documentação técnica;
- preparação de Pull Requests;
- revisão de PR e identificação de riscos.

A IA deve interromper e pedir decisão humana apenas quando houver:

- mudança de escopo ou comportamento de produto não previamente aprovado;
- exclusão ou transformação irreversível de dados;
- alteração relevante em segurança, autenticação ou permissões;
- custo externo relevante ou contratação de serviço;
- mudança legal/privacidade com impacto de política;
- dúvida real de negócio que não possa ser resolvida tecnicamente.

## Regra para bugs

Ao corrigir bug:

1. reproduzir ou isolar a causa;
2. criar teste que represente o problema quando viável;
3. corrigir a causa, não apenas o sintoma;
4. rodar regressão da área próxima;
5. verificar se a solução introduz novo caminho inseguro;
6. documentar a decisão quando ela alterar uma regra de sistema.

## Produção

Antes de deploy de mudança de risco médio ou alto:

- branch validada;
- PR revisado;
- testes aprovados;
- migrations conhecidas e reversíveis quando aplicável;
- estado anterior identificável por commit;
- sem segredos no diff;
- plano de rollback definido.

## Princípio final

**IA pode acelerar muito o desenvolvimento; o que evita bugs futuros não é reduzir o uso de IA, e sim aumentar disciplina de engenharia, isolamento de mudanças, testes, validação, observabilidade e capacidade de rollback.**
