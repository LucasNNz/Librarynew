# 0.20.60 — Quiz Core Renderer

- O mesmo Core/MCP passa a provisionar `BROWSER`, o Cloudflare Browser Rendering.
- Jobs do Quiz entram na fila `MATERIALIZE_QUEUE` como `QUIZ_JOB` e rodam sem o navegador pessoal.
- `quiz-teste` nasce com uma cena real persistida em R2/D1.
- `quiz_ver` aguarda brevemente e entrega PNG inline por padrão.
- `quiz_gerar_mp4` simplifica a exportação de cena/projeto; o resultado persistido contém os links.
- O bridge headless aceita apenas operações de asset e upload enquanto o lease do job estiver ativo.
- O executor Docker anterior continua disponível como fallback.
