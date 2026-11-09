import { el } from "./firebase.js";

// Sexuality / identity flags. Straight first, then roughly most → least common.
// stripes: top → bottom (equal height). chevrons: left-side triangles, outermost first. circle: Intersex ring.
export const FLAGS = [
  { id: "straight",    name: "Straight",       stripes: ["#000000", "#ffffff", "#000000", "#ffffff", "#000000", "#ffffff"] },
  { id: "gay",         name: "Gay",            stripes: ["#078d70", "#26ceaa", "#98e8c1", "#ffffff", "#7bade2", "#5049cc", "#3d1a78"] },
  { id: "lesbian",     name: "Lesbian",        stripes: ["#d52d00", "#ff9a56", "#ffffff", "#d362a4", "#a30262"] },
  { id: "bisexual",    name: "Bisexual",       stripes: ["#d60270", "#d60270", "#9b4f96", "#0038a8", "#0038a8"] },
  { id: "pansexual",   name: "Pansexual",      stripes: ["#ff218c", "#ffd800", "#21b1ff"] },
  { id: "asexual",     name: "Asexual",        stripes: ["#000000", "#a3a3a3", "#ffffff", "#800080"] },
  { id: "transgender", name: "Transgender",    stripes: ["#5bcefa", "#f5a9b8", "#ffffff", "#f5a9b8", "#5bcefa"] },
  { id: "nonbinary",   name: "Nonbinary",      stripes: ["#fcf434", "#ffffff", "#9c59d1", "#2c2c2c"] },
  { id: "pride",       name: "Pride (rainbow)", stripes: ["#e40303", "#ff8c00", "#ffed00", "#008026", "#24408e", "#732982"] },
  { id: "progress",    name: "Progress Pride", stripes: ["#e40303", "#ff8c00", "#ffed00", "#008026", "#24408e", "#732982"],
                       chevrons: ["#000000", "#784f17", "#5bcefa", "#f5a9b8", "#ffffff"] },
  { id: "genderfluid", name: "Genderfluid",    stripes: ["#ff76a4", "#ffffff", "#c011d7", "#000000", "#2f3cbe"] },
  { id: "demisexual",  name: "Demisexual",     stripes: ["#ffffff", "#ffffff", "#6e0070", "#d2d2d2", "#d2d2d2"], chevrons: ["#000000"] },
  { id: "aromantic",   name: "Aromantic",      stripes: ["#3da542", "#a7d379", "#ffffff", "#a9a9a9", "#000000"] },
  { id: "aroace",      name: "Aroace",         stripes: ["#e28c00", "#eccd00", "#ffffff", "#62aedc", "#203856"] },
  { id: "genderqueer", name: "Genderqueer",    stripes: ["#b57edc", "#ffffff", "#4a8123"] },
  { id: "omnisexual",  name: "Omnisexual",     stripes: ["#fe9ace", "#ff53bf", "#200044", "#6760fe", "#8ea6ff"] },
  { id: "polysexual",  name: "Polysexual",     stripes: ["#f714ba", "#01d66a", "#1594f6"] },
  { id: "graysexual",  name: "Graysexual",     stripes: ["#740194", "#aeb1aa", "#ffffff", "#aeb1aa", "#740194"] },
  { id: "agender",     name: "Agender",        stripes: ["#000000", "#bcc4c7", "#ffffff", "#b7f684", "#ffffff", "#bcc4c7", "#000000"] },
  { id: "bigender",    name: "Bigender",       stripes: ["#c479a2", "#eda5cd", "#d6c7e8", "#ffffff", "#d6c7e8", "#9ac7e8", "#6d82d1"] },
  { id: "intersex",    name: "Intersex",       stripes: ["#ffd800"], circle: "#7902aa" },
];
export const flagById = id => FLAGS.find(f => f.id === id) || null;

// A small drawn flag. size: height in px (width is 1.6× height)
export function flagEl(id, h = 16) {
  const f = flagById(id); if (!f) return null;
  const n = f.stripes.length, stops = f.stripes.map((c, i) => `${c} ${(i / n * 100).toFixed(2)}% ${((i + 1) / n * 100).toFixed(2)}%`).join(", ");
  const box = el("span", { class: "flag", title: f.name, style: { width: Math.round(h * 1.6) + "px", height: h + "px", background: `linear-gradient(180deg, ${stops})` } });
  (f.chevrons || []).forEach((c, i) => {
    const k = 1 - i * 0.14; // each inner chevron a bit smaller
    box.append(el("span", { class: "flag-chev", style: { background: c, width: (k * 46) + "%", clipPath: "polygon(0 0, 100% 50%, 0 100%)",
      top: ((1 - k) * 50) + "%", height: (k * 100) + "%" } }));
  });
  if (f.circle) box.append(el("span", { class: "flag-ring", style: { borderColor: f.circle, width: (h * 0.55) + "px", height: (h * 0.55) + "px", borderWidth: Math.max(2, h * 0.09) + "px" } }));
  return box;
}

// Flag + name, for profiles
export function flagChip(id) {
  const f = flagById(id); if (!f) return null;
  return el("span", { class: "flag-chip" }, flagEl(id, 14), f.name);
}
