import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  DoughnutController,
  Filler,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
} from "chart.js";

// The same Chart.js 4.5.1 components and defaults the original bundle registered.
Chart.register(
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  DoughnutController,
  Filler,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
);
Chart.defaults.font.family = '"Manrope Variable", "Segoe UI", sans-serif';
Chart.defaults.font.size = 14;
Chart.defaults.color = "#747567";

export { Chart };
