# Corvo Library V2 0.20.11 — Import Queue

- Importação de ZIP não mantém mais uma requisição Vercel aberta durante extração/catalogação.
- `/imports/:id/process` apenas enfileira `PROCESS_IMPORT_ZIP` na Queue do Core.
- O consumidor da Queue executa o processamento pesado no Worker e preserva idempotência por SHA-256.
- A interface aceita múltiplas seleções sucessivas de ZIP e acumula os arquivos em uma fila local.
- Cada lote exibe AGUARDANDO → PREPARANDO → ENVIANDO → CONFIRMANDO → NA FILA → PROCESSANDO → CONCLUÍDO/ERRO.
- A fila visual continua para o próximo ZIP mesmo quando um lote falha.
- O erro específico do lote passa a aparecer também no resumo final.
- Nenhuma migration/schema nova.
