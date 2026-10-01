/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React from "react";
import { Pie, PieChart as ReChartsDonutChart, ResponsiveContainer, Sector, Tooltip } from "recharts";
import {
  AvailableChartColors,
  constructCategoryColors,
  getColorClassName,
  type AvailableChartColorsKeys,
} from "@/lib/chartUtils";
import { cn } from "@/lib/utils";

type DonutChartVariant = "donut" | "pie";
type BaseEventProps = { eventType: "sector"; categoryClicked: string; [key: string]: number | string };
export type DonutChartEventProps = BaseEventProps | null | undefined;

type TooltipProps = {
  active?: boolean;
  payload?: any[];
  valueFormatter: (value: number) => string;
};

interface DonutChartProps extends React.HTMLAttributes<HTMLDivElement> {
  data: Record<string, any>[];
  category: string;
  value: string;
  colors?: AvailableChartColorsKeys[];
  variant?: DonutChartVariant;
  valueFormatter?: (value: number) => string;
  locale?: string;
  label?: string;
  totalLabel?: string;
  emptyLabel: string;
  showLabel?: boolean;
  showTooltip?: boolean;
  onValueChange?: (value: DonutChartEventProps) => void;
  tooltipCallback?: (content: TooltipProps) => void;
  customTooltip?: React.ComponentType<TooltipProps>;
}

type ParsedDatum = Record<string, any> & {
  color: AvailableChartColorsKeys;
  className: string;
};

const sumNumericArray = (values: number[]) => values.reduce((sum, number) => sum + number, 0);

const parseData = (data: Record<string, any>[], categoryColors: Map<string, AvailableChartColorsKeys>, category: string): ParsedDatum[] =>
  data.map(dataPoint => {
    const color = categoryColors.get(String(dataPoint[category])) ?? AvailableChartColors[0];
    return { ...dataPoint, color, className: getColorClassName(color, "fill") };
  });

const renderInactiveShape = (props: any) => <Sector {...props} fill="" opacity={0.3} style={{ outline: "none" }}/>;

function ChartTooltip({ active, payload, valueFormatter, category, value, callback, customTooltip: CustomTooltip }: TooltipProps & {
  category: string;
  value: string;
  callback?: (content: TooltipProps) => void;
  customTooltip?: React.ComponentType<TooltipProps>;
}) {
  const content = React.useMemo<TooltipProps>(() => ({ active, payload, valueFormatter }), [active, payload, valueFormatter]);
  const activeCategory = active && payload?.length ? String(payload[0]?.payload?.[category] ?? "") : undefined;
  const previousActive = React.useRef<boolean | undefined>(undefined);
  const previousCategory = React.useRef<string | undefined>(undefined);

  React.useEffect(() => {
    if (callback && (previousActive.current !== active || previousCategory.current !== activeCategory)) callback(content);
    previousActive.current = active;
    previousCategory.current = activeCategory;
  }, [active, activeCategory, callback, content]);

  if (CustomTooltip) return <CustomTooltip {...content}/>;
  if (!active || !payload?.length) return null;

  return <div className="chart-tooltip">
    {payload.map((item, index) => {
      const datum = item.payload as ParsedDatum;
      return <div key={`${String(datum[category])}-${index}`}>
        <span><i className={getColorClassName(datum.color, "bg")}/>{String(datum[category])}</span>
        <strong>{valueFormatter(Number(datum[value]))}</strong>
      </div>;
    })}
  </div>;
}

export const DonutChart = React.forwardRef<HTMLDivElement, DonutChartProps>(function DonutChart({
  data = [],
  value,
  category,
  colors = [...AvailableChartColors],
  variant = "donut",
  valueFormatter,
  locale = "en-GB",
  label,
  totalLabel,
  emptyLabel,
  showLabel = false,
  showTooltip = true,
  onValueChange,
  tooltipCallback,
  customTooltip,
  className,
  ...other
}, forwardedRef) {
  const formatter = React.useMemo(() => valueFormatter ?? ((number: number) => number.toLocaleString(locale)), [locale, valueFormatter]);
  const rows = React.useMemo(() => data.filter(dataPoint => Number(dataPoint[value]) > 0), [data, value]);
  const total = sumNumericArray(rows.map(dataPoint => Number(dataPoint[value])));
  const categories = Array.from(new Set(rows.map(item => String(item[category]))));
  const categoryColors = constructCategoryColors(categories, colors);
  const parsedData = parseData(rows, categoryColors, category);
  const [activeIndex, setActiveIndex] = React.useState<number | undefined>(undefined);
  const isDonut = variant === "donut";
  const parsedLabel = label || formatter(total);

  const handleShapeClick = (datum: any, index: number, event: React.MouseEvent) => {
    event.stopPropagation();
    if (!onValueChange) return;
    if (activeIndex === index) {
      setActiveIndex(undefined);
      onValueChange(null);
      return;
    }
    setActiveIndex(index);
    onValueChange({ eventType: "sector", categoryClicked: String(datum.payload[category]), ...datum.payload });
  };

  if (!total) return <p className={cn("ops-empty-inline", className)}>{emptyLabel}</p>;

  const ariaLabel = parsedData.map(datum => `${String(datum[category])}: ${formatter(Number(datum[value]))}`).join(", ");

  return <div ref={forwardedRef} className={cn("donut-chart", className)} data-variant={variant} {...other}>
    <div className="donut-chart-plot" role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <ReChartsDonutChart onClick={onValueChange && activeIndex !== undefined ? () => { setActiveIndex(undefined); onValueChange(null); } : undefined} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          {showLabel && isDonut && <text className="donut-chart-label" x="50%" y="50%" textAnchor="middle" dominantBaseline="middle">{parsedLabel}</text>}
          <Pie
            className={cn("donut-chart-sectors", onValueChange ? "cursor-pointer" : "cursor-default")}
            data={parsedData}
            dataKey={value}
            nameKey={category}
            cx="50%"
            cy="50%"
            startAngle={90}
            endAngle={-270}
            innerRadius={isDonut ? "66%" : "0%"}
            outerRadius="92%"
            paddingAngle={parsedData.length > 1 ? 1 : 0}
            stroke="#fff"
            strokeWidth={2}
            activeIndex={activeIndex}
            inactiveShape={renderInactiveShape}
            isAnimationActive={false}
            onClick={handleShapeClick}
          />
          {showTooltip && <Tooltip content={props => <ChartTooltip {...props} category={category} value={value} valueFormatter={formatter} callback={tooltipCallback} customTooltip={customTooltip}/>} />}
        </ReChartsDonutChart>
      </ResponsiveContainer>
      {isDonut && !showLabel && <span><strong>{formatter(total)}</strong><small>{totalLabel}</small></span>}
    </div>
    <ul className="ops-chart-legend">
      {parsedData.map(datum => <li key={String(datum[category])}>
        <i className={getColorClassName(datum.color, "bg")}/>
        <span title={String(datum[category])}>{String(datum[category])}</span>
        <strong>{formatter(Number(datum[value]))}</strong>
        <small>{Math.round(Number(datum[value]) / total * 100)}%</small>
      </li>)}
    </ul>
  </div>;
});
