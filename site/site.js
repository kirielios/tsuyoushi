// Shared by every page: theme toggle, copy buttons, numbers from index.json, and the Extensions list.
const REPO = new URL("index.json", location.href).href;

// theme: the system's until the visitor picks one
const themeBtn = document.querySelector(".theme");
const dark = () => (document.documentElement.dataset.theme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark";
const paintTheme = () => themeBtn && (themeBtn.textContent = dark() ? "☀" : "☾");
try {
  const saved = localStorage.getItem("theme");
  if (saved) document.documentElement.dataset.theme = saved;
} catch {}
paintTheme();
themeBtn?.addEventListener("click", () => {
  const next = dark() ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("theme", next);
  } catch {}
  paintTheme();
});

// the repo URL is this site's own index.json, so a fork shows its own
document.querySelectorAll("[data-repo]").forEach((el) => (el.tagName === "INPUT" ? (el.value = REPO) : (el.textContent = REPO)));
document.querySelectorAll("[data-add]").forEach((a) => (a.href = `https://neetshelf.app/settings/browse/extension-stores?url=${encodeURIComponent(REPO)}`));
document.querySelectorAll("[data-copy]").forEach((b) =>
  b.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(REPO);
    } catch {
      b.previousElementSibling?.select?.();
      document.execCommand?.("copy");
    }
    const was = b.textContent;
    b.textContent = "Copied!";
    setTimeout(() => (b.textContent = was), 1500);
  }),
);

const index = fetch("index.json").then((r) => r.json());

// one card per extension (an extension can list a source per language)
const byPkg = (list) => {
  const map = new Map();
  for (const s of list) {
    const e = map.get(s.pkg) ?? { ...s, langs: [] };
    if (!e.langs.includes(s.lang)) e.langs.push(s.lang);
    map.set(s.pkg, e);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
};

// home: the numbers
const stats = document.querySelector("[data-stats]");
if (stats)
  index.then(({ extensions }) => {
    const pkgs = byPkg(extensions);
    const set = (k, v) => (stats.querySelector(`[data-stat="${k}"]`).textContent = v.toLocaleString());
    set("extensions", pkgs.length);
    set("sources", extensions.length);
    set("anime", pkgs.filter((e) => e.kind === "anime").length);
    set("langs", new Set(extensions.map((e) => e.lang).filter((l) => l !== "all")).size);
  });

// extensions page
const grid = document.querySelector("[data-grid]");
if (grid) {
  const q = document.querySelector("[data-q]");
  const nsfw = document.querySelector("[data-nsfw]");
  const count = document.querySelector("[data-count]");
  const state = { lang: "any", kind: "any" };
  const params = new URLSearchParams(location.search);
  if (params.get("q")) q.value = params.get("q");
  if (params.get("kind")) state.kind = params.get("kind");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  let all = [];

  const card = (e) => {
    const host = (() => {
      try {
        return new URL(e.baseUrl).host;
      } catch {
        return "";
      }
    })();
    return `<article class="card ext">
      ${e.icon ? `<img src="${esc(e.icon)}" alt="" loading="lazy" width="56" height="56" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'noicon',textContent:'${esc(e.name[0])}'}))">` : `<div class="noicon">${esc(e.name[0])}</div>`}
      <div>
        <h3>${esc(e.name)}</h3>
        <div class="meta">
          ${e.langs.map((l) => `<span class="tag lang">${esc(l)}</span>`).join("")}
          ${e.kind === "anime" ? `<span class="tag anime">Anime</span>` : ""}
          ${e.contentWarning === "NSFW" ? `<span class="tag nsfw">18+</span>` : ""}
        </div>
        ${host ? `<a class="site" href="${esc(e.baseUrl)}" rel="noopener nofollow" target="_blank">${esc(host)} ↗</a>` : ""}
        <div class="ver">v${esc(e.version)} · ${esc(e.pkg)}</div>
      </div>
    </article>`;
  };

  const render = () => {
    const term = q.value.trim().toLowerCase();
    const list = all.filter(
      (e) =>
        (nsfw.checked || e.contentWarning !== "NSFW") &&
        (state.lang === "any" || e.langs.includes(state.lang)) &&
        (state.kind === "any" || (state.kind === "anime") === (e.kind === "anime")) &&
        (!term || e.name.toLowerCase().includes(term) || e.pkg.includes(term) || (e.baseUrl ?? "").includes(term)),
    );
    count.textContent = `${list.length} of ${all.length}`;
    grid.innerHTML = list.length ? list.map(card).join("") : `<div class="card empty"><h3>Nothing here.</h3><p>Try another word, or <a href="https://github.com/kirielios/tsuyoushi/issues/new">request a source</a>.</p></div>`;
  };

  for (const seg of document.querySelectorAll("[data-seg]")) {
    const key = seg.dataset.seg;
    const paint = () => seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.value === state[key])));
    seg.addEventListener("click", (ev) => {
      const b = ev.target.closest("button");
      if (!b) return;
      state[key] = b.value;
      paint();
      render();
    });
    paint();
  }
  q.addEventListener("input", render);
  nsfw.addEventListener("change", render);
  index
    .then(({ extensions }) => {
      all = byPkg(extensions);
      render();
    })
    .catch(() => (grid.innerHTML = `<div class="card empty"><h3>Couldn't load index.json.</h3></div>`));
}
