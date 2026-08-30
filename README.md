# Corvo Library V2 0.20.23 — MCP Internal Key Rotation

Checkpoint de interface sobre a 0.20.22. Mantém o Core esperado em 0.20.22 e adiciona no modal MCP um controle explícito para revogar a chave interna administrativa e gerar outra automaticamente, sem alterar o MCP público do ChatGPT.

Garantias desta versão:

- o endpoint público `/mcp` continua sem autenticação para o ChatGPT;
- a chave rotacionada é somente `CORVO_APP_KEY`, usada nas rotas administrativas internas da Library;
- botão `Revogar e gerar nova chave` fica no modal MCP;
- a ação exige confirmação explícita;
- o Worker gera uma chave criptograficamente aleatória nova e substitui o secret `CORVO_APP_KEY` na Cloudflare;
- a resposta devolve a nova chave somente para a sessão que solicitou a rotação;
- a interface sobrescreve imediatamente a conexão local com a nova chave e não a exibe em texto;
- a chave anterior deixa de ser usada pelo navegador e se torna inválida após a propagação do secret no Worker;
- a interface verifica automaticamente a nova chave via health e informa quando ela está ativa;
- se a chamada falhar antes de retornar uma nova chave válida, a conexão local existente não é sobrescrita;
- nenhuma migration nova, nenhuma alteração no D1/R2 e nenhuma republicação obrigatória do Core.

## Base preservada — 0.20.22


Checkpoint sobre a 0.20.21 que transforma a materialização de candidatas do Coletor em execução imediata e independente por URL, mantendo a arquitetura Control Plane → Queue → Consumer → R2 → D1.

Garantias desta versão:

- o consumer da Queue é reconciliado com `batch_size=1`, `max_wait_time_ms=0` e `max_concurrency=20`;
- cada mensagem da Queue representa uma única candidata e pode concluir em tempo diferente das demais;
- quando uma execução termina, a Cloudflare Queue pode ocupar imediatamente o consumer liberado com a próxima mensagem pendente;
- FAST PUSH por projeto/cena usa `target_candidates` como meta de estoque MATERIALIZED;
- URLs excedentes ficam vinculadas ao projeto/item em `DISCOVERED` como reserva e não são baixadas sem necessidade;
- quando uma candidata falha definitivamente, a próxima reserva da mesma cena é promovida automaticamente para `QUEUED` até completar a meta;
- HTTP 400/403/404 são falhas finais na primeira tentativa, não contam como MATERIALIZED e acionam reposição imediata quando há reserva;
- 408/425/429/5xx, timeouts e falhas transitórias continuam usando retry/backoff; reposição ocorre somente se a falha se tornar final;
- a reposição considera a cena inteira, inclusive reservas criadas por outra operação simultânea do mesmo projeto/item;
- candidatas de projeto/item usam ID determinístico por URL, e o claim `QUEUED/RETRYING → DOWNLOADING` é atômico para impedir download duplicado em redelivery concorrente;
- o snapshot consolidado expõe `reserve` e só retorna `NEEDS_MORE` quando a cena está abaixo da meta e não possui mais reserva local;
- o producer pode usar `sendBatch` apenas para reduzir round-trips de ACK; a execução não forma batch porque o consumer recebe `batch_size=1`;
- nenhuma migration nova;
- nenhuma limpeza de D1/R2;
- correções da 0.20.21 para auditorias R2 sem compound SELECT são preservadas.

Fluxo esperado por cena:

`URLs → DISCOVERED/reserva → ativa apenas o necessário → QUEUED → DOWNLOADING → MATERIALIZED`

Falha final:

`FAILED → libera necessidade lógica → promove próxima DISCOVERED → QUEUED`

Conclusão:

`materialized_count >= target_candidates → collection_status=COMPLETE → qa_status=READY_FOR_QA`
