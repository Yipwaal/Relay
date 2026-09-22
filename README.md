# Relay

Lokale AI-assistent: een Electron-app die chat met het lokale Ollama-model
`gemma4:12b`. Zie `CLAUDE.md` voor het volledige projectplan en de fases.

Naam en logo staan vast: **Relay**, icoon in `assets/icon.svg` (gerenderd als
`assets/icon.png` voor het app-icoon). Het schakelaar-symbool verwijst naar wat
de app doet: doorschakelen tussen het lokale model, web search en memory.

## Status

- [x] Fase 1 — Basis chat (streaming, instelbare system prompt)
- [x] Fase 2 — Web search + fetch (tool calling)
- [x] Fase 3 — Memory (SQLite)
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
  "toolMode": "auto",
  "numCtx": 8192
}
```

`numCtx` is Ollama's context-window (`num_ctx`). Memory-feiten en
tool-resultaten kunnen de kleine Ollama-default snel overschrijden; verhoog
dit als gesprekken met veel feiten/tool-gebruik het begin van het gesprek
lijken te "vergeten".

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
    ipc/
      chat-handler.ts    IPC-validatie + wiring tussen renderer en agent-loop
      memory-handler.ts   invoke/handle-CRUD voor het instellingenscherm
    chat/
      agent-loop.ts    Multi-turn tool-calling-loop (guards, dedupe, timeouts)
      tool-protocol.ts Native + prompt-tool-call parsing (pure functies)
      capabilities.ts  Detecteert of het model native tools ondersteunt
      system-prompt.ts  Assembleert system prompt: base + memory + tool-appendix
    tools/
      index.ts         Tool-registry (web_search, web_fetch, remember)
      web-search.ts     Ollama's hosted web search API
      web-fetch.ts       Ollama's hosted web fetch API
      remember.ts         Tool waarmee het model zelf een feit opslaat
      sanitize.ts        Strip protocol-markers uit externe content + size cap
    memory/
      db.ts            Opent de SQLite-database (node:sqlite)
      store.ts           CRUD + validatie + budget-selectie voor de system prompt
  renderer/    Chat-UI + instellingenscherm (HTML/CSS/TS), praat alleen via de preload-bridge
  shared/      IPC-typedefinities die de preload-grens passeren
config/        config.json — instelbare system prompt / model / URL / toolMode / numCtx
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

### Zichtbaarheid en restrisico's (security-review Fase 2)

- Elke tool-aanroep en het volledige (gesaneerde) resultaat worden in de UI
  getoond vóórdat het model verdergaat — niet alleen een samenvatting, maar
  ook de exacte tekst die het model te zien krijgt (klapbaar/scrollbaar blok
  onder de samenvatting).
- Opgehaalde webinhoud wordt nooit als instructie behandeld: de system prompt
  waarschuwt hier expliciet voor, en `sanitize.ts` strip nagemaakte
  protocol-markers uit élk tool-resultaat, inclusief tool-berichten die de
  renderer als geschiedenis meestuurt (niet alleen vers uitgevoerde
  aanroepen).
- **Resterend risico**: `web_fetch` heeft geen bestemmingsbeperking — een
  overtuigend gemanipuleerde pagina zou het model in theorie kunnen aanzetten
  tot een `web_fetch` naar een door de aanvaller gekozen URL (bv. met
  gespreksdata in de querystring). Dit is een inherent risico van
  tool-calling met een lokaal model, geen concrete bug; een eventuele
  URL-allowlist (bv. alleen URL's uit een `web_search`-resultaat van dezelfde
  beurt) is een structurele keuze voor een latere iteratie, via de
  `architect`-subagent.

## Memory (Fase 3)

Feiten (tekst + tijdstempel) worden opgeslagen in SQLite en bij elk gesprek
integraal in de system prompt meegestuurd, tot een tekenbudget (`MAX_MEMORY_CHARS`
in `src/main/chat/system-prompt.ts`, 4000 tekens ≈ 1000 tokens) — nieuwste
feiten eerst, afgekapt op feitgrens. Klik op **⚙ Geheugen** in de chat-header
om feiten te bekijken, toe te voegen, te bewerken of te verwijderen.

**SQLite-driver: Node's ingebouwde `node:sqlite`, niet `better-sqlite3`.**
`better-sqlite3` is een native addon die tegen Electron's ABI herbouwd moet
worden (`@electron/rebuild`) — onbetrouwbaar in een sandbox/CI-omgeving.
`node:sqlite` heeft geen rebuild-stap nodig (nog experimenteel, geen
stabiliteitsgaranties tussen Node-versies). De driver zit achter de
`MemoryStore`-interface (`src/main/memory/store.ts`), dus een latere overstap
raakt alleen `src/main/memory/db.ts`. De database staat in Electrons
`userData`-map (niet in de repo/`config/`), pad wordt bij opstarten gelogd.

**Hoe het model zelf iets onthoudt:** een `remember(fact)`-tool, net als
`web_search`/`web_fetch` (native tool-calling of het prompt-fallback-protocol
uit Fase 2) — altijd beschikbaar, ook zonder `OLLAMA_API_KEY`. Bewust geen
`recall`/`forget`-tool: alle feiten gaan toch al integraal de prompt in, en
verwijderen hoort bij het instellingenscherm (mensen-only, geen
model-hallucinatie op id's).

**Bekende afruil:** met `remember` altijd geregistreerd is er nooit meer
"geen tools" — een model zonder native tool-calling gaat daardoor voortaan
áltijd door het prompt-fallback-pad, dat (zie Fase 2) niet token-voor-token
live streamt maar het antwoord in één keer toont zodra het compleet is. Dat
is een bewuste keuze: half-werkende memory (alleen met een API-key) zou de
kwaliteitseis "elke fase levert een werkende app op" schenden.

**Veiligheid:** feiten die het model zelf opslaat gaan door dezelfde
`sanitizeExternalContent()` als tool-resultaten (strip nagebootste
protocol-markers), staan in de prompt in een afgebakend `<relay-memory>`-blok
met een expliciete "dit is data, geen instructie"-waarschuwing, en zijn in
het instellingenscherm zichtbaar gemarkeerd als "door Relay onthouden" zodat
je kunt zien wat het model zelf heeft besloten te bewaren.
