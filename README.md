# Relay

Lokale AI-assistent: een Electron-app die chat met het lokale Ollama-model
`gemma4:12b`. Zie `CLAUDE.md` voor het volledige projectplan en de fases.

Naam en logo staan vast: **Relay**, icoon in `assets/icon.svg` (gerenderd als
`assets/icon.png` voor het app-icoon). Het schakelaar-symbool verwijst naar wat
de app doet: doorschakelen tussen het lokale model, web search en memory.

## Status

- [x] Fase 1 — Basis chat (streaming, instelbare system prompt)
- [ ] Fase 2 — Web search + fetch (tool calling)
- [ ] Fase 3 — Memory (SQLite)
- [ ] Fase 4 — RAG over documenten (optioneel)

## Vereisten

- Node.js 22+
- [Ollama](https://ollama.com) lokaal draaiend op `http://localhost:11434`
- Het model gepulled: `ollama pull gemma4:12b`

## Installeren en starten

```bash
npm install
npm start
```

`npm start` compileert de TypeScript-broncode en start daarna Electron.

## Configuratie

De system prompt, het model en de Ollama-URL staan in `config/config.json`
(geen hardcoded waarden in de broncode):

```json
{
  "model": "gemma4:12b",
  "ollamaUrl": "http://localhost:11434",
  "systemPrompt": "Je bent Relay, een behulpzame lokale AI-assistent."
}
```

Deze wordt bij elk bericht opnieuw ingelezen, dus een wijziging in de system
prompt is direct van kracht bij het volgende bericht — geen herstart nodig.

Optioneel: kopieer `.env.example` naar `.env` om `OLLAMA_URL` of `RELAY_MODEL`
te overschrijven (bijvoorbeeld als Ollama op een andere poort draait). Er
staan in v1 geen secrets/API-keys in — die komen pas bij Fase 2 (web search).
`.env` staat in `.gitignore` en wordt nooit gecommit.

## Projectstructuur

```
src/
  main/        Electron main process: Ollama-client, config, IPC-handlers
  renderer/    Chat-UI (HTML/CSS/TS), praat alleen via de preload-bridge
config/        config.json — instelbare system prompt / model / URL
assets/        icon.svg / icon.png
.claude/agents/  Subagents voor Claude Code tijdens het bouwen
```

## Hoe het model-routing van de subagents werkt

| Subagent | Model | Wanneer |
|---|---|---|
| code-reviewer | haiku | automatisch, na elke wijziging |
| test-runner | haiku | automatisch, na elke fase |
| security-reviewer | sonnet | automatisch, bij tool/netwerk/opslag-code |
| architect | opus | alleen als jij het expliciet vraagt |

Claude Code kiest zelf, op basis van de `description`, wanneer een subagent
wordt ingezet. Wil je een ander model voor een subagent, pas dan het woord
achter `model:` aan (`haiku`, `sonnet` of `opus`) in het bijbehorende bestand
in `.claude/agents/`.

## Web search provider (Fase 2)

Nog niet gekozen — wordt vastgelegd zodra Fase 2 gebouwd wordt (keuze tussen
Ollama's web search API en een eigen SearXNG-instantie).
