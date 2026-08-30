# Corvo Library V2 0.20.6 — Legacy Core Compatible Boot

Esta release remove o bloqueio criado pela dependência de `/bootstrap` e pelo auto-update do Worker.

## Boot

1. A UI permanece vazia.
2. Usa a rota já existente no Core 0.19+: `POST /control/apply-migrations`.
3. A migration nova `9014_v2_authoritative_factory_zero.sql` zera o D1 uma única vez, preservando somente configuração persistente de infraestrutura D1/R2/Worker.
4. Depois da migration, o frontend lê `health`, `catalog/stats`, `catalog/universes`, `assets`, `projects` e `operations`.
5. O estado só é aplicado à interface quando as leituras críticas terminam.

Nenhum Core é republicado durante a abertura e não existe botão obrigatório “Atualizando Core”.
A migration 9014 é one-shot via `v2_migrations_applied`, então imports reais posteriores sobrevivem a reloads.
