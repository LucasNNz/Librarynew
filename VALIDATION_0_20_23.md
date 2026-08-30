# Validation 0.20.23 — MCP Internal Key Rotation

- checkpoint validator: PASS / 0 erros
- frontend TypeScript estrutural: PASS
- Worker TypeScript estrutural: PASS
- bundle embutido: `node --check` PASS
- bundle contém `/control/rotate-app-key`: PASS
- bundle contém implementação `rotateAppKey`: PASS
- `EXPECTED_CORE_VERSION` permanece 0.20.22: PASS
- modal MCP mantém autenticação do ChatGPT = Nenhuma: PASS
- botão `Revogar e gerar nova chave`: PASS
- nova chave salva por `saveBrowserConnection`: PASS
- chave nova não é renderizada no modal: PASS
- nenhuma migration nova: PASS
- schema 2.18.0 preservado: PASS
