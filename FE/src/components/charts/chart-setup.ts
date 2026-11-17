import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  DoughnutController,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PieController,
  PointElement,
  Tooltip,
} from "chart.js";

// Same Chart.js components and defaults as the template, plus pie + legend for TrackVid charts.
Chart.register(
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  DoughnutController,
  PieController,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
);
Chart.defaults.font.family = '"Manrope Variable", "Segoe UI", sans-serif';
Chart.defaults.font.size = 13;
Chart.defaults.color = "#747567";

/** Chart colours from the TrackVid tokens (read at draw time so dark mode applies). */
export function chartPalette(): string[] {
  if (typeof window === "undefined") return ["#edb744", "#6aa88a", "#6c94b8", "#c9785a", "#9b7fb8", "#b8a77d"];
  const s = getComputedStyle(document.documentElement);
  return [1, 2, 3, 4, 5, 6].map((i) => s.getPropertyValue(`--tv-chart-${i}`).trim() || "#edb744");
}

export { Chart };
