export const AvailableChartColors = ["red", "charcoal", "slate", "silver", "mist", "stone"] as const;

export type AvailableChartColorsKeys = (typeof AvailableChartColors)[number];

export function constructCategoryColors(categories: string[], colors: AvailableChartColorsKeys[]) {
  return new Map(categories.map((category, index) => [category, colors[index % colors.length] ?? AvailableChartColors[0]]));
}

export function getColorClassName(color: AvailableChartColorsKeys, type: "bg" | "fill") {
  return `chart-${type}-${color}`;
}
