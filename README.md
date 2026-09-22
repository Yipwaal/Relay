# Relay

Lokale AI-assistent: een Electron-app die chat met het lokale Ollama-model
`gemma4:12b`. Zie `CLAUDE.md` voor het volledige projectplan en de fases.

Naam en logo staan vast: **Relay**, icoon in `assets/icon.svg` (gerenderd als
`assets/icon.png` voor het app-icoon). Het schakelaar-symbool verwijst naar wat
de app doet: doorschakelen tussen het lokale model, web search en memory.

## Status

- [x] Fase 1 — Basis chat (streaming, instelbare system prompt)
- [x] Fase 2 — Web search + fetch (tool calling)
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
  "systemPrompt": "Je bent Relay, een behulpzame lokale AI-assistent.",
  "toolMode": "auto"
}
```

Deze wordt bij elk bericht opnieuw ingelezen, dus een wijziging in de system
prompt is direct van kracht bij het volgende bericht — geen herstart nodig.

`toolMode` bepaalt hoe Relay tool-aanroepen (Fase 2) herkent:
- `"auto"` (aanbevolen): Relay vraagt Ollama één keer per model (`/api/show`)
  of het model native tool-calling ondersteunt, en cachet dat. Zo niet, valt
  Relay terug op een prompt-gebaseerd protocol (zie hieronder) — nodig omdat
  Gemma-modellen historisch niet op Ollama's lijst van tools-compatibele
  modellen staan.
- `"native"` / `"prompt"`: forceer één van beide, bijvoorbeeld om te testen.

Optioneel: kopieer `.env.example` naar `.env` om `OLLAMA_URL`, `RELAY_MODEL`
of `OLLAMA_API_KEY` te overschrijven/in te stellen. `.env` staat in
`.gitignore` en wordt nooit gecommit; secrets horen nergens anders.

## Projectstructuur

```
src/
  main/
    main.ts          Electron-lifecycle + venster aanmaken
    config.ts         Leest config/config.json + .env-overrides
    ollama-client.ts   Streaming NDJSON-client voor Ollama's /api/chat
    preload.ts         contextBridge-API voor de renderer
    ipc/chat-handler.ts  IPC-validatie + wiring tussen renderer en agent-loop
    chat/
      agent-loop.ts    Multi-turn tool-calling-loop (guards, dedupe, timeouts)
      tool-protocol.ts Native + prompt-tool-call parsing (pure functies)
      capabilities.ts  Detecteert of het model native tools ondersteunt
    tools/
      index.ts         Tool-registry (web_search, web_fetch)
      web-search.ts     Ollama's hosted web search API
      web-fetch.ts       Ollama's hosted web fetch API
      sanitize.ts        Strip protocol-markers uit externe content + size cap
  renderer/    Chat-UI (HTML/CSS/TS), praat alleen via de preload-bridge
  shared/      IPC-typedefinities die de preload-grens passeren
config/        config.json — instelbare system prompt / model / URL / toolMode
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

**Keuze: Ollama's gehoste web search API** (`https://ollama.com/api/web_search`
en `https://ollama.com/api/web_fetch`), niet SearXNG.

Afweging (architect-advies): SearXNG vereist een tweede lokale service
(Docker), JSON-output staat er standaard uit, en upstream-engines
rate-limiten/captcha'en SearXNG geregeld — dat risico op een "halfwerkende"
tool paste niet bij de kwaliteitseis dat elke fase een werkende app oplevert.
Ollama's API geeft al geëxtraheerde teksinhoud terug (geen eigen
HTML-scraping/extractiepipeline nodig) en dekt zowel zoeken als pagina's
ophalen met één provider en één API-key.

**Let op — dit is de enige plek waar Relay het lokale apparaat verlaat.**
Zodra `OLLAMA_API_KEY` in `.env` staat, sturen `web_search`-zoekopdrachten en
`web_fetch`-URL's (afkomstig uit het gesprek, geformuleerd door het model)
naar `ollama.com`. Zonder de key blijven `web_search`/`web_fetch` uitgeschakeld
en werkt Relay verder exact als in Fase 1 — puur lokale chat met Ollama.

Setup: maak een account op [ollama.com](https://ollama.com), haal een key op
via `ollama.com/settings/keys`, en zet die in `.env` als `OLLAMA_API_KEY`
(zie `.env.example`).

De providerkeuze zit achter een `SearchProvider`-interface
(`src/main/tools/web-search.ts`) met vandaag precies één implementatie — een
latere SearXNG-optie kan ernaast bestaan zonder de tool-calling-loop te
hoeven aanpassen.
