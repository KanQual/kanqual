import { useEffect, useRef, type CSSProperties } from "react";
import { init, use, type EChartsCoreOption, type EChartsType, type SetOptionOpts } from "echarts/core";
import { BarChart, BoxplotChart } from "echarts/charts";
import { DatasetComponent, GridComponent, TooltipComponent, TransformComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

use([
  BarChart,
  BoxplotChart,
  DatasetComponent,
  GridComponent,
  TooltipComponent,
  TransformComponent,
  CanvasRenderer,
]);

export function EChart({
  option,
  style,
  className,
  setOptionOpts,
}: {
  option: EChartsCoreOption;
  style?: CSSProperties;
  className?: string;
  setOptionOpts?: SetOptionOpts;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsType | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = init(containerRef.current, null, { renderer: "canvas" });
    chartRef.current = chart;

    const resizeObserver = new ResizeObserver(() => {
      chart.resize();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, setOptionOpts);
  }, [option, setOptionOpts]);

  return <div ref={containerRef} className={className} style={style} />;
}
