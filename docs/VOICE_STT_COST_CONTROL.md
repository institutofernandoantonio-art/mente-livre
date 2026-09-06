# Voz/STT — controle de custo e gate de produção

**Status:** Fase 9B em desenvolvimento. A integração paga deve permanecer desligada em produção até todos os gates externos desta página estarem confirmados.

## Objetivo do MVP

A voz existe somente como entrada para `/conversa`: o usuário grava uma frase curta, o Mente Livre transcreve, coloca o texto no campo já existente e exige revisão + clique em **Enviar**. A voz não executa agenda, tarefas ou qualquer outra ação diretamente.

O desenho mantém um contrato `SpeechToTextProvider`, portanto o provedor/modelo poderá ser trocado no futuro sem refazer a captura de áudio, a UI nem o pipeline conversacional. No MVP, somente OpenAI é permitida e o modelo fica fixado no código para evitar mudança silenciosa de preço.

## Barreiras de custo do MVP

1. **Teto interno global:** US$ 4,00 por mês-calendário UTC para todo o Mente Livre, compartilhado entre todos os usuários.
2. **Reserva antes da chamada:** cada nova transcrição reserva US$ 0,0015, equivalente ao pior caso permitido de 20 segundos no preço adotado para o modelo do MVP. A chamada paga só ocorre após a reserva ser aceita pelo banco.
3. **Teto externo obrigatório:** o projeto OpenAI exclusivo do Mente Livre deve ser configurado com limite rígido de US$ 5,00/mês antes de a feature ser ligada em produção. Esse controle externo ainda precisa ser confirmado fora do repositório.
4. **Áudio curto:** máximo de 20 segundos e 2 MB por requisição.
5. **Idempotência:** `(user_id, request_id)` é único; a mesma gravação não abre uma segunda reserva.
6. **Rate limit:** no máximo 6 novas reservas por minuto por usuário.
7. **Fail-closed:** `MENTE_LIVRE_STT_ENABLED` deve permanecer diferente de `true` enquanto os gates de produção não estiverem completos.
8. **Configuração antes do orçamento:** a chave dedicada é validada ao construir o provider, antes da reserva financeira. Ligar a feature sem chave não consome o teto interno.
9. **Falha de captura não chama STT:** se o `MediaRecorder` emitir erro, o `request_id` da gravação é invalidado e um eventual `stop` posterior não pode iniciar transcrição paga com áudio parcial.

O teto interno é propositalmente conservador: mesmo que uma gravação tenha menos de 20 segundos ou uma chamada falhe depois da reserva, a reserva continua contando para a proteção mensal. Isso favorece previsibilidade de gasto em vez de maximizar o número de chamadas.

## Separação do Mente Livre

A integração usa a variável server-side `MENTE_LIVRE_OPENAI_STT_API_KEY`. Ela deve receber uma chave criada em **projeto OpenAI dedicado exclusivamente ao Mente Livre**. Não reutilizar essa chave, projeto ou orçamento em outro aplicativo, serviço, automação ou ambiente não relacionado ao Mente Livre.

O código não lê uma `OPENAI_API_KEY` genérica para STT e a chave nunca deve receber prefixo `NEXT_PUBLIC_`.

**Verificação de 06/09/2026:** na conta OpenAI conectada foi encontrado apenas o projeto inicial `Default project`; ainda não existe um projeto dedicado ao Mente Livre. Por isso nenhuma chave foi criada/configurada nesta etapa e a feature continua desligada. O projeto dedicado e seu limite externo precisam existir antes da criação/uso da chave de produção.

## Dados armazenados

A tabela `voice_transcription_usage` armazena somente metadados mínimos de consumo: usuário, `request_id`, provedor/modelo, status, duração informada, custo estimado, orçamento reservado e timestamps.

Não são armazenados na tabela:
- áudio bruto;
- transcript/texto reconhecido;
- conteúdo da conversa;
- conteúdo da agenda.

O áudio fica somente em memória durante a requisição ao servidor/provedor e não deve ser escrito em logs. As respostas HTTP da transcrição usam `Cache-Control: no-store`, inclusive em sucesso e erro, para que o texto reconhecido não seja tratado como conteúdo cacheável por intermediários ou pelo navegador.

## Como acompanhar

O Mente Livre expõe ao usuário autenticado apenas o próprio resumo mensal de voz em `/api/voice/usage` e na interface de `/conversa`: chamadas concluídas, minutos estimados, custo estimado, orçamento reservado e teto interno.

Para controle financeiro, o indicador mais importante é **orçamento reservado / US$ 4,00**, porque é ele que governa o bloqueio interno. Minutos e custo estimado são métricas operacionais; a contabilização oficial do provedor deve ser conferida também no projeto OpenAI dedicado.

O acompanhamento externo deve ser feito no painel de uso/custos do projeto OpenAI dedicado ao Mente Livre. Como esse projeto não pode ser compartilhado com outros apps, o valor ali deve representar somente o Mente Livre.

## Gate obrigatório antes de produção

Não fazer merge/ativação da Fase 9B até confirmar todos os itens:

- [ ] projeto OpenAI criado exclusivamente para o Mente Livre;
- [ ] limite rígido externo de US$ 5,00/mês confirmado nesse projeto;
- [ ] chave exclusiva desse projeto criada e configurada somente como segredo server-side no ambiente do Mente Livre;
- [ ] migration `20260906213000_create_voice_transcription_usage.sql` revisada e aplicada no Supabase de produção;
- [ ] decisão final da Fase 9B registrada em `docs/DECISIONS.md`;
- [ ] Quality Gates verdes no commit que será mergeado;
- [ ] `MENTE_LIVRE_STT_ENABLED=true` somente depois dos itens anteriores.

## Regra de mudança de custo

Qualquer alteração que possa elevar materialmente o gasto — aumentar teto, duração, tamanho, rate limit, trocar modelo/provedor, liberar retry automático ou compartilhar a chave/projeto — exige autorização explícita do dono antes da mudança e antes de produção.
