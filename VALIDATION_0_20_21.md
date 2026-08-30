# Validation 0.20.21

- Checkpoint validator: PASS
- Errors: 0
- Schema: 2.18.0
- Frontend structural TypeScript: PASS
- Worker structural TypeScript: PASS
- Embedded Worker version: 0.20.21
- Embedded Worker `node --check`: PASS
- `auditar_armazenamento_r2` source: 0 `UNION ALL`
- `explorar_r2_fisico` source: 0 `UNION ALL`
- Eight independent reference queries tested against local 604-asset live-safety DB: PASS
- Queue consumer desired `max_wait_time_ms`: 0
- Queue consumer desired `max_concurrency`: null
- Queue desired `delivery_delay`: 0
- Queue desired `delivery_paused`: false
- No migration added
- No asset/data cleanup path added
- Live post-deploy queue latency: NOT MEASURED in this local gate; must be benchmarked after deployment.
