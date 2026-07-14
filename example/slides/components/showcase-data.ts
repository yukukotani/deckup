export interface ShowcaseRecord {
  readonly month: string;
  readonly views: number;
  readonly completionRate: number;
  readonly interactions: number;
}

export interface ShowcaseChartPoint {
  readonly index: number;
  readonly month: string;
  readonly views: number;
  readonly x: number;
  readonly y: number;
  readonly visible: boolean;
  readonly selected: boolean;
}

export interface ShowcaseSnapshot {
  readonly selectedIndex: number;
  readonly selectedRecord: ShowcaseRecord;
  readonly chartPoints: readonly ShowcaseChartPoint[];
  readonly polylinePoints: string;
  readonly rangeValueText: string;
  readonly statusText: string;
}

export const SHOWCASE_CHART_WIDTH = 640;
export const SHOWCASE_CHART_HEIGHT = 220;
export const SHOWCASE_CHART_PADDING = 28;

export const SHOWCASE_RECORDS = [
  { month: "Jan", views: 820, completionRate: 58, interactions: 132 },
  { month: "Feb", views: 1_040, completionRate: 61, interactions: 174 },
  { month: "Mar", views: 1_280, completionRate: 65, interactions: 226 },
  { month: "Apr", views: 1_490, completionRate: 68, interactions: 285 },
  { month: "May", views: 1_760, completionRate: 72, interactions: 362 },
  { month: "Jun", views: 2_040, completionRate: 76, interactions: 448 },
] as const satisfies readonly ShowcaseRecord[];

const numberFormatter = new Intl.NumberFormat("en-US");

export function normalizeShowcaseIndex(index: number) {
  if (!Number.isFinite(index)) return 0;
  return Math.min(Math.max(Math.round(index), 0), SHOWCASE_RECORDS.length - 1);
}

export function getShowcaseSnapshot(index: number): ShowcaseSnapshot {
  const selectedIndex = normalizeShowcaseIndex(index);
  const selectedRecord = SHOWCASE_RECORDS[selectedIndex] ?? SHOWCASE_RECORDS[0];
  const maxViews = Math.max(...SHOWCASE_RECORDS.map((record) => record.views));
  const drawableWidth = SHOWCASE_CHART_WIDTH - SHOWCASE_CHART_PADDING * 2;
  const drawableHeight = SHOWCASE_CHART_HEIGHT - SHOWCASE_CHART_PADDING * 2;
  const pointGap = drawableWidth / (SHOWCASE_RECORDS.length - 1);
  const chartPoints = SHOWCASE_RECORDS.map((record, pointIndex) => ({
    index: pointIndex,
    month: record.month,
    views: record.views,
    x: Number((SHOWCASE_CHART_PADDING + pointGap * pointIndex).toFixed(2)),
    y: Number(
      (
        SHOWCASE_CHART_HEIGHT -
        SHOWCASE_CHART_PADDING -
        (record.views / maxViews) * drawableHeight
      ).toFixed(2),
    ),
    visible: pointIndex <= selectedIndex,
    selected: pointIndex === selectedIndex,
  }));
  const polylinePoints = chartPoints
    .filter((point) => point.visible)
    .map((point) => `${point.x},${point.y}`)
    .join(" ");
  const statusText = `${selectedRecord.month}: ${numberFormatter.format(selectedRecord.views)} views, ${selectedRecord.completionRate}% completion, ${numberFormatter.format(selectedRecord.interactions)} interactions.`;

  return {
    selectedIndex,
    selectedRecord,
    chartPoints,
    polylinePoints,
    rangeValueText: `${selectedRecord.month}, month ${selectedIndex + 1} of ${SHOWCASE_RECORDS.length}`,
    statusText,
  };
}
