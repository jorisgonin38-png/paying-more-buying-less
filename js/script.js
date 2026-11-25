// script.js : le graphique (Chart.js), le panier (Snap.svg) et le lien entre les deux

const years = FOOD_DATA.years;
const COLOURS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"]; // lisibles par les daltoniens
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// L'état de la page : tout l'affichage est recalculé à partir de ces valeurs
const state = {
  measure: "quantity",    // "quantity", "spend" ou "price"
  year: years.length - 1, // position de l'année du panier dans "years"
  hidden: new Set(),      // aliments masqués
  highlighted: null       // aliment survolé
};

let chart;
let series = [];  // chiffres de chaque aliment pour la mesure choisie
const items = {}; // aliments du panier (groupes Snap.svg)

// ---------- Calculs ----------

function format(value, unit) {
  if (state.measure === "quantity") return Math.round(value).toLocaleString("en-GB") + " " + unit;
  const perUnit = state.measure === "price" ? (unit === "ml" ? "/litre" : "/kg") : "";
  return "£" + (value / 100).toFixed(2) + perUnit; // les données sont en pence
}

// Écart avec 2001-02 : "+12%" ou "−8%"
function formatChange(index) {
  const change = Math.round(index - 100);
  return (change > 0 ? "+" : change < 0 ? "−" : "") + Math.abs(change) + "%";
}

function computeSeries() {
  series = FOOD_DATA.categories.map((category, i) => {
    // prix au kilo = dépense ÷ quantité × 1000, comme dans le tableur
    const values = state.measure === "price"
      ? category.spend.map((spend, y) => (spend / category.quantity[y]) * 1000)
      : category[state.measure];
    return {
      id: category.id,
      label: category.label,
      colour: COLOURS[i],
      index: values.map((v) => Math.round((v / values[0]) * 10000) / 100), // indice : 2001-02 = 100
      text: values.map((v) => format(v, category.unit))
    };
  });
}

// ---------- Graphique ----------

// Plugin maison : bandes grises des crises derrière les courbes, trait de l'année du panier devant
const marksPlugin = {
  id: "marks",
  // la souris sort de la zone des courbes : plus rien n'est mis en avant
  afterEvent(c, args) {
    if (!args.inChartArea) highlight(null);
  },
  beforeDatasetsDraw(c) {
    const x = c.scales.x;
    const area = c.chartArea;
    const half = (x.getPixelForValue(1) - x.getPixelForValue(0)) / 2; // pour couvrir toute l'année
    const start = (event) => x.getPixelForValue(years.indexOf(event.from)) - half;
    const end = (event) => x.getPixelForValue(years.indexOf(event.to)) + half;

    c.ctx.save();
    c.ctx.fillStyle = "#f0f0f0";
    FOOD_DATA.events.forEach((event) => c.ctx.fillRect(start(event), area.top, end(event) - start(event), area.height));

    // les noms après toutes les bandes, pour qu'aucune bande ne les cache
    c.ctx.fillStyle = "#4d4d4d";
    c.ctx.font = '600 12px "Public Sans", sans-serif';
    c.ctx.textBaseline = "top";
    FOOD_DATA.events.forEach((event, i) => {
      const left = start(event) + 6;
      const label = c.ctx.measureText(event.label).width > area.right - left ? event.short : event.label; // nom court si pas la place
      const width = c.ctx.measureText(label).width;
      c.ctx.fillText(label, Math.min(left, area.right - 4 - width), area.top + 6 + (i % 2) * 16); // une ligne sur deux plus bas
    });
    c.ctx.restore();
  },
  afterDatasetsDraw(c) {
    const x = c.scales.x.getPixelForValue(state.year);
    c.ctx.save();
    c.ctx.fillStyle = "#1a1a1a";
    c.ctx.fillRect(x - 0.75, c.chartArea.top, 1.5, c.chartArea.height);
    c.ctx.restore();
  }
};

function createChart() {
  Chart.defaults.font.family = '"Public Sans", sans-serif';
  Chart.defaults.font.size = 13;
  Chart.defaults.color = "#4d4d4d";

  chart = new Chart(document.getElementById("food-chart"), {
    type: "line",
    data: {
      labels: years,
      datasets: series.map((s) => ({ label: s.label, data: s.index, backgroundColor: s.colour, pointRadius: 0, pointHitRadius: 12 }))
    },
    plugins: [marksPlugin],
    options: {
      maintainAspectRatio: false, // la hauteur vient du CSS
      animation: reduceMotion ? false : { duration: 700 },
      interaction: { mode: "index", intersect: false }, // infobulle avec tous les aliments de l'année
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 16 } },
        y: {
          title: { display: true, text: "Index (2001-02 = 100)", font: { weight: "600" } },
          border: { display: false },
          grid: { color: (c) => (c.tick.value === 100 ? "#8c8c8c" : "#e6e6e6") } // repère 100 plus foncé
        }
      },
      plugins: {
        legend: {
          align: "start",
          labels: { usePointStyle: true, pointStyle: "line", boxWidth: 22, padding: 16 },
          onClick: (event, item) => toggle(series[item.datasetIndex].id)
        },
        tooltip: {
          usePointStyle: true,
          itemSort: (a, b) => b.parsed.y - a.parsed.y, // du plus haut au plus bas
          callbacks: {
            label: (c) => c.dataset.label + ": " + series[c.datasetIndex].text[c.dataIndex] + " (index " + c.parsed.y.toFixed(1) + ")"
          }
        }
      },
      // survol : la courbe la plus proche du pointeur (à moins de 28 px) est mise en avant
      onHover: (event, points) => {
        const distance = (p) => Math.abs(p.element.y - event.y);
        const closest = points.filter((p) => distance(p) < 28).sort((a, b) => distance(a) - distance(b))[0];
        highlight(closest ? series[closest.datasetIndex].id : null);
      },
      // clic : l'année sous la souris devient l'année du panier
      onClick: (event) => selectYear(chart.scales.x.getValueForPixel(event.x))
    }
  });
}

// Une courbe en avant, les autres pâles ("33" = 20 % d'opacité)
function paintLines() {
  const target = state.hidden.has(state.highlighted) ? null : state.highlighted;
  chart.data.datasets.forEach((dataset, i) => {
    dataset.borderColor = target && series[i].id !== target ? COLOURS[i] + "33" : COLOURS[i];
    dataset.borderWidth = series[i].id === target ? 3 : 2;
  });
}

// ---------- Panier ----------

// Anime un élément (presque instantané si l'utilisateur a demandé moins d'animations)
function animate(element, transform, duration, easing, callback) {
  element.stop().animate({ transform: transform }, reduceMotion ? 1 : duration, easing, callback);
}

// Le dessin est déjà dans index.html : Snap.svg le rend interactif
function createBasket() {
  FOOD_DATA.categories.forEach((category, i) => {
    const group = Snap("#item-" + category.id);
    const item = { group: group, drop: group.select(".item-drop"), art: group.select(".item-art") };
    items[category.id] = item;

    group.select(".tag").attr({ fill: COLOURS[i] }); // même couleur que la courbe
    group.attr({ tabindex: 0, role: "button", "aria-label": category.label });
    group.hover(() => highlight(category.id), () => highlight(null));
    group.click(() => toggle(category.id));
    group.node.addEventListener("focus", () => highlight(category.id));
    group.node.addEventListener("blur", () => highlight(null));
    group.node.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault(); // sinon Espace fait défiler la page
        toggle(category.id);
      }
    });

    // au chargement, les aliments tombent dans le panier un par un
    item.drop.attr({ transform: "t0,-320" });
    setTimeout(() => animate(item.drop, "t0,0", 900, mina.bounce), 150 + i * 140);
  });
}

// ---------- Actions ----------

// Survol d'une courbe ou d'un aliment (null = aucun)
function highlight(id) {
  if (id === state.highlighted) return;
  state.highlighted = id;
  paintLines();
  chart.update("none"); // sans animation, pour suivre la souris

  for (const key in items) {
    items[key].group.toggleClass("is-dimmed", id !== null && key !== id);
  }
  const item = items[id];
  if (item) {
    // petit saut de l'aliment
    animate(item.drop, "t0,-14", 160, mina.easeout, () => animate(item.drop, "t0,0", 380, mina.bounce));
  }
}

function toggle(id) {
  if (state.hidden.has(id)) state.hidden.delete(id);
  else state.hidden.add(id);
  update();
}

function selectYear(index) {
  state.year = Math.min(Math.max(Math.round(index), 0), years.length - 1); // reste dans les années
  update();
}

// Crée un élément HTML avec du texte
function el(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

// ---------- Mise à jour de toute la figure ----------

function update() {
  computeSeries();
  const y = state.year;
  const radio = document.querySelector('input[name="measure"]:checked'); // ses textes sont dans le HTML

  // graphique : on change les données au lieu de le recréer, Chart.js anime le passage
  chart.data.datasets.forEach((dataset, i) => {
    dataset.data = series[i].index;
    dataset.hidden = state.hidden.has(series[i].id);
  });
  paintLines();
  chart.update();

  // panier : la SURFACE de l'aliment suit la valeur, d'où la racine carrée
  series.forEach((s) => {
    const scale = Math.min(Math.max(Math.sqrt(s.index[y] / 100), 0.55), 1.45); // limites pour rester lisible
    animate(items[s.id].art, "s" + scale + "," + scale + ",0,0", 600, mina.easeinout); // grandit depuis le bas
    items[s.id].group.toggleClass("is-hidden", state.hidden.has(s.id));
    items[s.id].group.attr({ "aria-pressed": String(!state.hidden.has(s.id)) });
  });

  // textes et liste des % sous le panier
  document.getElementById("figure-1-subtitle").textContent = radio.dataset.subtitle;
  document.getElementById("year-slider").value = y;
  document.getElementById("year-output").textContent = years[y];
  document.getElementById("basket-caption").textContent = radio.dataset.name + " in " + years[y] + " compared with " + years[0];
  document.getElementById("basket-readout").replaceChildren(...series.map((s) => {
    const li = el("li", "", state.hidden.has(s.id) ? "is-hidden" : "");
    li.append(el("span", "", "key"), el("span", s.label), el("span", formatChange(s.index[y]), "change"));
    li.firstChild.style.color = s.colour;
    return li;
  }));

  // tableau : les mêmes chiffres que le graphique, lisibles sans souris
  const table = document.getElementById("data-table");
  table.replaceChildren(el("caption", radio.dataset.name + " per person per week, " + years[0] + " to " + years[years.length - 1]));
  const head = el("tr", "");
  head.append(el("th", "Year"), ...series.map((s) => el("th", s.label)));
  table.append(head);
  years.forEach((year, i) => {
    const row = el("tr", "");
    row.append(el("th", year), ...series.map((s) => el("td", s.text[i])));
    table.append(row);
  });
}

// ---------- Démarrage ----------

window.addEventListener("load", () => {
  computeSeries();
  createChart();
  createBasket();

  document.querySelectorAll('input[name="measure"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      state.measure = radio.value;
      update();
    });
  });
  const slider = document.getElementById("year-slider");
  slider.max = years.length - 1;
  slider.addEventListener("input", () => selectYear(Number(slider.value)));

  update();
});
