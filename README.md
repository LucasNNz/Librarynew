# Corvo Library V2 0.20.17 — Collector → Materialization → QA

Checkpoint acumulativo baseado no 0.20.16. Consolida o fluxo Coletor → Queue → R2 → READY_FOR_QA → Analista, com FAST PUSH multi-cena, contadores por cena, QA em lote, telemetria e consumer concorrente.

A coleta fecha por **MATERIALIZED**, não por APPROVED.

Veja `RELEASE_0_20_17_COLLECTOR_MATERIALIZATION_QA_PIPELINE.md` e `VALIDATION_0_20_17.txt`.
