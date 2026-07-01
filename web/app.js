let candidates = [];
let index = 0;
let busy = false;

const els = {
  counter: document.querySelector("#counter"),
  subtitle: document.querySelector("#subtitle"),
  frame: document.querySelector("#detailFrame"),
  externalLink: document.querySelector("#externalLink"),
  price: document.querySelector("#price"),
  title: document.querySelector("#title"),
  grootte: document.querySelector("#grootteInput"),
  rijdt: document.querySelector("#rijdtInput"),
  staat: document.querySelector("#staatInput"),
  prev: document.querySelector("#prevButton"),
  next: document.querySelector("#nextButton"),
  yes: document.querySelector("#yesButton"),
  no: document.querySelector("#noButton")
};

function current() {
  return candidates[index] ?? null;
}

function setBusy(value) {
  busy = value;
  els.yes.disabled = value || !current();
  els.no.disabled = value || !current();
  els.prev.disabled = value || index <= 0;
  els.next.disabled = value || index >= candidates.length - 1;
}

function render() {
  const item = current();

  if (!item) {
    els.counter.textContent = "Geen kandidaten";
    els.subtitle.textContent = "Alles is verwerkt of er zijn geen nieuwe resultaten.";
    els.frame.removeAttribute("src");
    els.externalLink.href = "#";
    els.price.textContent = "";
    els.title.textContent = "";
    els.grootte.value = "";
    els.rijdt.value = "";
    els.staat.value = "";
    setBusy(false);
    return;
  }

  els.counter.textContent = `${index + 1} / ${candidates.length}`;
  els.subtitle.textContent = "←/→ navigeren, y = yes, n = no";
  els.frame.src = `/proxy?url=${encodeURIComponent(item.url)}`;
  els.externalLink.href = item.url;
  els.price.textContent = item.price;
  els.title.textContent = item.title;
  els.grootte.value = item.suggestions.grootte;
  els.rijdt.value = item.suggestions.rijdtNog;
  els.staat.value = item.suggestions.staat;
  setBusy(false);
}

async function loadCandidates(refresh = false) {
  els.counter.textContent = "Zoeken...";
  els.subtitle.textContent = "2dehands resultaten worden gefilterd.";
  setBusy(true);
  const response = await fetch(`/api/candidates${refresh ? "?refresh=1" : ""}`);
  const data = await response.json();
  if (data.error) {
    throw new Error(data.error);
  }
  candidates = data.candidates ?? [];
  index = 0;
  if (data.stats) {
    els.subtitle.textContent = `${data.stats.reviewQueue} te reviewen, ${data.stats.rejectedByFilter} automatisch geweigerd`;
  }
  render();
}

function move(delta) {
  if (busy) return;
  index = Math.max(0, Math.min(candidates.length - 1, index + delta));
  render();
}

async function decide(decision) {
  const item = current();
  if (!item || busy) return;
  setBusy(true);

  const response = await fetch("/api/decision", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: item.url,
      decision,
      grootte: els.grootte.value,
      rijdtNog: els.rijdt.value,
      staat: els.staat.value
    })
  });
  const result = await response.json();
  if (!response.ok || result.error) {
    throw new Error(result.error || "Decision failed");
  }

  candidates.splice(index, 1);
  if (index >= candidates.length) {
    index = Math.max(0, candidates.length - 1);
  }
  render();
}

els.prev.addEventListener("click", () => move(-1));
els.next.addEventListener("click", () => move(1));
els.yes.addEventListener("click", () => decide("yes").catch(alert));
els.no.addEventListener("click", () => decide("no").catch(alert));

function handleShortcut(key) {
  if (key === "ArrowLeft") {
    move(-1);
  }
  if (key === "ArrowRight") {
    move(1);
  }
  if (key.toLowerCase() === "y") {
    decide("yes").catch(alert);
  }
  if (key.toLowerCase() === "n") {
    decide("no").catch(alert);
  }
}

window.addEventListener("keydown", (event) => {
  if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
    return;
  }
  handleShortcut(event.key);
});

window.addEventListener("message", (event) => {
  if (event.data?.type === "review-key") {
    handleShortcut(event.data.key);
  }
});

loadCandidates().catch((error) => {
  els.counter.textContent = "Fout";
  els.subtitle.textContent = error.message;
  setBusy(false);
});
