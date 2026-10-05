const imageButtonEl = document.getElementById('image-button') as HTMLButtonElement;
const imageInputEl = document.getElementById('image-input') as HTMLInputElement;
const imageChipsEl = document.getElementById('image-chips') as HTMLElement;

// Voorcheck voor directe feedback; main controleert het echte type (eerste bytes), aantal en grootte opnieuw.
const DRAFT_IMAGE_TYPES = new Set(['image/png', 'image/jpeg']);
const MAX_DRAFT_IMAGES = 4;
const MAX_DRAFT_IMAGE_BYTES = 10 * 1024 * 1024;

function isImageFile(file: File): boolean {
  return DRAFT_IMAGE_TYPES.has(file.type);
}

/** Afbeeldingen bij de vraag die nog getypt wordt (plakken, slepen of de knop "Afbeelding"). */
async function addDraftImages(files: File[]): Promise<void> {
  clearComposerError();
  for (const file of files) {
    if (!isImageFile(file)) {
      showComposerError(`"${file.name}" is geen PNG- of JPEG-afbeelding.`);
      continue;
    }
    if (file.size > MAX_DRAFT_IMAGE_BYTES) {
      showComposerError(`"${file.name}" is te groot (max ${MAX_DRAFT_IMAGE_BYTES / (1024 * 1024)} MB).`);
      continue;
    }
    const data = new Uint8Array(await file.arrayBuffer());
    // Pas ná de await tellen: twee snelle plak- of sleepacties lopen anders samen over de grens.
    if (appState.draftImages.length >= MAX_DRAFT_IMAGES) {
      showComposerError(`Maximaal ${MAX_DRAFT_IMAGES} afbeeldingen per vraag.`);
      break;
    }
    appState.draftImages.push({ name: file.name || 'afbeelding.png', data, url: URL.createObjectURL(file) });
  }
  renderImageChips();
  updateSendButton();
  chatInputEl.focus();
}

function removeDraftImage(image: DraftImage): void {
  URL.revokeObjectURL(image.url);
  appState.draftImages = appState.draftImages.filter((other) => other !== image);
  renderImageChips();
  updateSendButton();
}

/** Bij versturen: de afbeeldingen gaan mee met het bericht (hun blob-URL blijft voor de miniatuur in de chat). */
function takeDraftImages(): DraftImage[] {
  const images = appState.draftImages;
  appState.draftImages = [];
  renderImageChips();
  return images;
}

function renderImageChips(): void {
  imageChipsEl.textContent = '';
  for (const image of appState.draftImages) {
    const thumb = h('img', { class: 'image-chip-thumb' });
    thumb.src = image.url;
    thumb.alt = image.name;
    imageChipsEl.appendChild(h('div', { class: 'image-chip', title: image.name }, [thumb, iconButton('close', 'Afbeelding weghalen', 'solid', () => removeDraftImage(image))]));
  }
  imageChipsEl.hidden = appState.draftImages.length === 0;
}

const storedImageUrls = new Map<number, Promise<string>>();

/** Blob-URL voor een opgeslagen afbeelding; één keer per sessie opgehaald. */
function storedImageUrl(id: number): Promise<string> {
  let url = storedImageUrls.get(id);
  if (!url) {
    url = window.relay.conversations.image(id).then(({ mime, data }) => URL.createObjectURL(new Blob([new Uint8Array(data)], { type: mime })));
    url.catch(() => storedImageUrls.delete(id));
    storedImageUrls.set(id, url);
  }
  return url;
}

/**
 * Bij wisselen van gesprek: de miniaturen van het vorige gesprek gaan uit
 * beeld (renderActive bouwt alles opnieuw op), dus hun blob-URL's — tot 10 MB
 * per afbeelding — kunnen vrij. Nog niet verstuurde afbeeldingen (de invoer)
 * en die van net verstuurde berichten blijven staan.
 */
function releaseStoredImageUrls(): void {
  for (const url of storedImageUrls.values()) {
    url.then(
      (value) => URL.revokeObjectURL(value),
      () => undefined,
    );
  }
  storedImageUrls.clear();
}

imageButtonEl.addEventListener('click', () => imageInputEl.click());

imageInputEl.addEventListener('change', () => {
  const files = Array.from(imageInputEl.files ?? []);
  imageInputEl.value = '';
  void addDraftImages(files);
});

chatInputEl.addEventListener('paste', (event: ClipboardEvent) => {
  const files = Array.from(event.clipboardData?.files ?? []).filter(isImageFile);
  if (files.length === 0) return;
  event.preventDefault();
  void addDraftImages(files);
});
