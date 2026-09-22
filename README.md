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
- [x] Fase 4 — RAG over documenten

## Vereisten

- Node.js 22+
- [Ollama](https://ollama.com) lokaal draaiend op `http://localhost:11434`
- Het model gepulled: `ollama pull gemma4:12b`
- Voor Fase 4 (documenten doorzoeken): een embedding-model gepulld, bv.
  `ollama pull embeddinggemma` (zie config.json's `embedModel`)

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
  "numCtx": 8192,
  "embedModel": "embeddinggemma"
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
    main.ts          Electron-lifecycle + venster aanmaken + composition root
    db.ts             Opent de SQLite-database (node:sqlite), PRAGMA user_version-migraties
    config.ts         Leest config/config.json + .env-overrides
    ollama-client.ts   Streaming NDJSON-client voor Ollama's /api/chat
    ollama-embed.ts    Client voor Ollama's /api/embed (document-embeddings, Fase 4)
    preload.ts         contextBridge-API voor de renderer
    ipc/
      chat-handler.ts    IPC-validatie + wiring tussen renderer en agent-loop
      memory-handler.ts   invoke/handle-CRUD voor het geheugen-instellingenscherm
      documents-handler.ts invoke/handle-CRUD + dialog.showOpenDialog voor documenten
    chat/
      agent-loop.ts    Multi-turn tool-calling-loop (guards, dedupe, timeouts)
      tool-protocol.ts Native + prompt-tool-call parsing (pure functies)
      capabilities.ts  Detecteert of het model native tools ondersteunt
      system-prompt.ts  Assembleert system prompt: base + memory + tool-appendix
    tools/
      index.ts         Tool-registry (web_search, web_fetch, remember, search_documents)
      web-search.ts     Ollama's hosted web search API
      web-fetch.ts       Ollama's hosted web fetch API
      remember.ts         Tool waarmee het model zelf een feit opslaat
      search-documents.ts  Tool die geïndexeerde documenten doorzoekt
      sanitize.ts        Strip protocol-markers uit externe content + size cap
    memory/
      store.ts           CRUD + validatie + budget-selectie voor de system prompt
    documents/
      extract.ts        Tekst-extractie per bestandsextensie (txt/md/pdf/docx)
      chunker.ts          Pure chunking-functie (alinea's, zinsgrenzen, overlap)
      vector.ts            Float32<->BLOB, normalize, dot, topK (pure functies)
      store.ts              DocumentStore: CRUD + brute-force cosine similarity search
      ingest.ts              Pipeline: extract -> chunk -> embed -> store
  renderer/    Chat-UI + instellingenscherm (HTML/CSS/TS), praat alleen via de preload-bridge
  shared/      IPC-typedefinities die de preload-grens passeren
config/        config.json — instelbare system prompt / model / URL / toolMode / numCtx / embedModel
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
raakt alleen `src/main/db.ts` (met Fase 4 gedeeld met de documenten-tabellen,
zie hieronder — één database, `PRAGMA user_version` als migratiemechanisme).
De database staat in Electrons `userData`-map (niet in de repo/`config/`), pad
wordt bij opstarten gelogd.

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
je kunt zien wat het model zelf heeft besloten te bewaren. Bij een upsert op
identieke tekst wint `source: 'user'` bovendien altijd — een `remember`-call
kan een handmatig ingevoerd feit dus nooit stilzwijgend als "door Relay
onthouden" laten verschijnen.

**Persistent-prompt-injection-mitigatie (security-review Fase 3):** een
succesvolle `remember`-aanroep komt onvoorwaardelijk terug in élk toekomstig
gesprek — dat maakt `remember` een aantrekkelijker doelwit voor prompt
injection via `web_fetch`/`web_search`-resultaten dan een eenmalig
tool-resultaat. `agent-loop.ts` weigert daarom `remember` zodra er in
**dezelfde beurt** al `web_search`/`web_fetch` is gebruikt (met een duidelijk
geweigerd-resultaat terug naar het model, zichtbaar in de UI). **Bekende
beperking:** dit dekt niet het multi-beurt-scenario (webpagina ophalen in de
ene beurt, `remember` pas in een latere beurt aanroepen) — agent-loop houdt
bewust geen state tussen beurten bij (zie Fase 2's transcript-eigenaarschap).
Een volledige oplossing (bv. een expliciete bevestigingsstap voor
model-feiten, of state op gespreksniveau) is een structurele keuze voor een
latere iteratie, via de `architect`-subagent.

## Documenten / RAG (Fase 4)

Documenten toevoegen kan via **⚙ Instellingen → Documenten → "Document
toevoegen..."** (opent een native bestandskiezer). Ondersteunde formaten:
**.txt, .md, .pdf, .docx** — expliciet gekozen door de gebruiker; de
architect-aanbeveling was om met alleen tekst/markdown te beginnen, maar PDF
en Word bleken allebei nodig.

### Embeddings: Ollama's `/api/embed`, lokaal model

Documenten worden in stukken geknipt (zie "Chunking" hieronder) en per stuk
omgezet naar een vector via Ollama's `/api/embed` — dezelfde lokale
`ollamaUrl` als de chat (`assertLocalOllamaUrl` in `config.ts` dwingt al af
dat dit alleen `localhost`/`127.0.0.1`/`::1` mag zijn). Vereist een apart
gepulled embedding-model, geconfigureerd via `embedModel` in `config.json`
(default `embeddinggemma`, meertalig en klein). Ontbreekt het model, dan
mislukt het toevoegen van een document met een duidelijke foutmelding
("Voer `ollama pull <model>` uit") — chat, memory en web blijven gewoon
werken.

### Vector-opslag: BLOB in dezelfde database, brute-force cosine similarity

Geen SQLite-vector-extensie (sqlite-vec/vss) en geen aparte vectordatabase:
embeddings staan als Float32-BLOB in `document_chunks` (dezelfde `relay.db`
als memory, met een tweede migratiestap op `PRAGMA user_version`), en een
zoekopdracht vergelijkt in JavaScript met alle chunks van het huidige
`embedModel` (`src/main/documents/vector.ts`). Voor persoonlijk gebruik
(honderden tot een paar duizend chunks) duurt dat ~10-20ms — geen extra
native dependency, geen rebuild-risico. Bij >20k chunks of merkbaar trage
zoekopdrachten: eerst een in-memory vectorcache overwegen, pas daarna een
vector-extensie.

Wisselt `embedModel`, dan zijn oude documenten niet meer doorzoekbaar (hun
vectoren zijn onvergelijkbaar met een ander model) — ze blijven bewaard en
staan in het instellingenscherm gemarkeerd als "verouderd embedding-model"
tot je ze opnieuw toevoegt.

### Chunking

Pure functie (`src/main/documents/chunker.ts`, unit-testbaar zonder Ollama):
alinea's gretig samenvoegen tot een doellengte, met terugval op zinsgrenzen
en daarna een harde woordgrens voor te lange alinea's, plus overlap tussen
chunks. Geen tokenizer in dit project (net als Fase 3's memory-budget) — de
constanten zijn in tekens:

- `CHUNK_TARGET_CHARS = 1200`, `CHUNK_MAX_CHARS = 1500`
- `CHUNK_OVERLAP_CHARS = 200`, `MIN_CHUNK_CHARS = 200` (een te korte laatste
  chunk wordt samengevoegd met de vorige)
- Een markdown-kop (`#`) begint bij voorkeur een nieuwe chunk.

Bovengrenzen tegen te grote/trage documenten: **20 MB** bronbestand voor
`.txt`/`.md` (direct ingelezen, geen decompressiestap), **5 MB** specifiek
voor `.pdf`/`.docx` (zie "Veiligheid" hieronder), **1.000.000 tekens** na
extractie (ruim voldoende voor persoonlijk gebruik, ~830 chunks), en een
**30-seconden timeout** rond de hele extractiestap — daarboven een
duidelijke foutmelding i.p.v. een trage of halfwerkende ingest.

### Retrieval als tool, niet als automatische injectie

Net als `web_search`/`web_fetch`/`remember`: een nieuwe `search_documents(query)`-tool
(altijd beschikbaar zodra er minstens één document met het huidige
`embedModel` bestaat, geen `OLLAMA_API_KEY` nodig — embeddings zijn volledig
lokaal). Overwogen alternatief: memory's aanpak (altijd automatisch de
relevantste chunks meesturen). Afgewezen omdat dat (a) bij élk bericht een
embedding-aanroep + modelwissel in Ollama's geheugen zou kosten, (b) de
zoekvraag naïef op het laatste bericht zou baseren i.p.v. het model een
zelfstandige vraag laten formuleren, en (c) **onzichtbaar** zou zijn — botst
met CLAUDE.md's eis dat elke tool-aanroep zichtbaar getoond wordt vóór
gebruik. De beschikbare documenttitels staan in de dynamische
tool-description, wat helpt bij modellen die de tool anders te weinig kiezen
(vooral in prompt-modus).

### Veiligheid (security-review Fase 4)

- **Bestandsselectie gebeurt uitsluitend in main** via `dialog.showOpenDialog`
  — de renderer levert nooit een bestandspad aan. Zonder deze maatregel zou
  een gecompromitteerde renderer een willekeurig pad kunnen opgeven (bv.
  `~/.ssh/id_rsa`), dat dan ingelezen én doorzoekbaar gemaakt zou worden.
- De `remember`-na-externe-content-guard uit Fase 3 (weigert `remember` na
  `web_search`/`web_fetch` in dezelfde beurt) is uitgebreid met
  `search_documents`: een geïndexeerd document kan zo evenmin, binnen één
  beurt, het model overtuigen om iets blijvends via `remember` op te slaan.
  Dezelfde bekende beperking als bij Fase 3 geldt (dekt geen multi-beurt-scenario).
- `search_documents` roept zelf geen `sanitizeExternalContent()` aan — dat
  gebeurt al centraal in `agent-loop.ts` ná elke tool-uitvoering (zelfde
  patroon als `web_search`/`web_fetch`), dus documentinhoud met een
  nagemaakte protocol-marker wordt net zo gestript.
- Content-hash-dedupe (sha256) voorkomt dat hetzelfde document twee keer
  wordt toegevoegd; een `ingestInProgress`-vlag staat maar één
  document-toevoeging tegelijk toe.
- **`isEvalSupported: false`** staat expliciet aan bij `pdf-parse`'s
  `PDFParse`-constructor. Zonder deze vlag compileert pdfjs-dist (de
  onderliggende PDF-parser) ingebedde PostScript-calculatorfuncties
  (Separation/DeviceN-kleurruimtes, Type3-fonts) via `new Function(...)` en
  voert die uit — in dit (niet-gesandboxde) Electron main process, niet in
  een geïsoleerde worker. Niet nodig voor platte tekstextractie, dus uit.
- **Decompressie-bommen (`.pdf`/`.docx`) — deels gemitigeerd, niet
  uitgesloten.** `MAX_EXTRACTED_CHARS` wordt pas gecontroleerd ná volledige
  extractie, dus een sterk gecomprimeerd kwaadaardig bestand kan tijdens het
  uitpakken/parsen zelf al een geheugen-/CPU-piek veroorzaken vóórdat die
  grens ingrijpt. Twee maatregelen beperken de impact: een lagere
  bestandsgrootte-limiet van **5 MB** specifiek voor `.pdf`/`.docx` (i.p.v.
  de algemene 20 MB voor platte tekst, die geen decompressiestap kent) en
  een **30 seconden-timeout** (`withTimeout`, gedeeld met de bestaande
  tool-timeout uit `agent-loop.ts`, zie `src/main/timeout.ts`) rond de hele
  extractiestap. Belangrijke kanttekening: `withTimeout` race't een `Promise`
  tegen een `setTimeout` — het annuleert of onderbreekt het onderliggende werk
  niet. Voor een hang die zelf async blijft yielden (bv. wachtend op I/O)
  werkt dat prima, maar bij een lange **synchrone**, niet-yieldende bewerking
  (zoals zlib/pako-decompressie van een docx-zip-bom, of een zwaar
  PDF-contentstream) kan de event loop de timer pas afvuren zodra die
  synchrone aanroep zelf terugkeert — de timeout begrenst dan dus niet de
  werkelijke blokkade, en de weesgeraakte extractie (incl. `pdf-parse`'s
  `parser.destroy()`-cleanup) blijft op de achtergrond CPU/geheugen
  verbruiken tot hij vanzelf afrondt. De 5 MB-grens beperkt vooral hóéveel
  data zo'n synchrone bewerking kan verwerken, niet hóé lang die kan duren.
  Bewust **niet** geïmplementeerd: extractie in een apart
  child-/utility-process met harde geheugen-/tijdslimieten (de enige manier
  om synchroon werk daadwerkelijk te kunnen afbreken). Dat is voor dit
  persoonlijke, single-user bureaubladproject disproportioneel — de "aanval"
  vereist dat dezelfde gebruiker zelf bewust een kwaadaardig bestand kiest
  via een native OS-dialoog die ze zelf openen. Deze resterende, bewust
  geaccepteerde restrisico past bij hoe Fase 2's `web_fetch`-bestemmingsrisico
  en Fase 3's `remember`-multi-beurt-gat zijn behandeld: transparant
  gedocumenteerd in plaats van volledig weggeëngineerd.
