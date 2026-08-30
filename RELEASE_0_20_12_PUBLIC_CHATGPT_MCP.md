# Corvo Library V2 0.20.12 — Public ChatGPT MCP

## Correção

- `/mcp` não exige mais `CORVO_APP_KEY`, Bearer, API key ou OAuth.
- A tela **Configurações → Conectar MCP** mostra somente o endpoint remoto público do Worker.
- O botão para ChatGPT copia apenas `https://<worker>.<subdominio>.workers.dev/mcp`.
- A interface orienta explicitamente a escolher **Autenticação: Nenhuma** no ChatGPT.
- As demais rotas do Core continuam protegidas por `CORVO_APP_KEY`.
- Nenhuma migration de D1 e nenhuma alteração em R2/Queue.

## Compatibilidade

A alteração é limitada à rota MCP e à UI de conexão. Import Queue do 0.20.11 permanece intacta.
