import { useState } from "react";

import "./showcase.css";
import {
  SHOWCASE_CHART_HEIGHT,
  SHOWCASE_CHART_PADDING,
  SHOWCASE_CHART_WIDTH,
  SHOWCASE_RECORDS,
  getShowcaseSnapshot,
} from "./showcase-data.ts";

const initialMonthIndex = 0;

export default function ReactDataExplorer() {
  const [selectedIndex, setSelectedIndex] = useState(initialMonthIndex);
  const snapshot = getShowcaseSnapshot(selectedIndex);
  const selectedPoint = snapshot.chartPoints.find((point) => point.selected);

  return (
    <section
      className="deckup-showcase deckup-showcase__explorer"
      aria-labelledby="react-showcase-title"
    >
      <div className="deckup-showcase__control">
        <p id="react-showcase-title" className="deckup-showcase__eyebrow">
          React island · synthetic local data
        </p>
        <label htmlFor="react-showcase-month">
          Explore month: <strong>{snapshot.selectedRecord.month}</strong>
          <input
            id="react-showcase-month"
            className="deckup-showcase__range"
            type="range"
            min={0}
            max={SHOWCASE_RECORDS.length - 1}
            step={1}
            value={snapshot.selectedIndex}
            aria-valuetext={snapshot.rangeValueText}
            aria-controls="react-showcase-chart"
            onChange={(event) => setSelectedIndex(event.currentTarget.valueAsNumber)}
          />
        </label>

        <dl className="deckup-showcase__metrics">
          <div className="deckup-showcase__metric">
            <dt>Views</dt>
            <dd>{snapshot.selectedRecord.views.toLocaleString("en-US")}</dd>
          </div>
          <div className="deckup-showcase__metric">
            <dt>Completion</dt>
            <dd>{snapshot.selectedRecord.completionRate}%</dd>
          </div>
          <div className="deckup-showcase__metric">
            <dt>Interactions</dt>
            <dd>{snapshot.selectedRecord.interactions.toLocaleString("en-US")}</dd>
          </div>
        </dl>

        <p className="deckup-showcase__status" role="status" aria-live="polite">
          {snapshot.statusText}
        </p>
      </div>

      <div className="deckup-showcase__visual">
        <svg
          id="react-showcase-chart"
          className="deckup-showcase__chart"
          viewBox={`0 0 ${SHOWCASE_CHART_WIDTH} ${SHOWCASE_CHART_HEIGHT}`}
          role="img"
          aria-labelledby="react-chart-title react-chart-description"
        >
          <title id="react-chart-title">
            {`Monthly sample deck views through ${snapshot.selectedRecord.month}`}
          </title>
          <desc id="react-chart-description">
            The line reveals one month at a time. The selected point has a larger dark outline and a
            text label, so selection is not communicated by color alone.
          </desc>
          {[44, 96, 148].map((y) => (
            <line
              key={y}
              className="deckup-showcase__chart-grid"
              x1={SHOWCASE_CHART_PADDING}
              x2={SHOWCASE_CHART_WIDTH - SHOWCASE_CHART_PADDING}
              y1={y}
              y2={y}
            />
          ))}
          <polyline className="deckup-showcase__chart-path" points={snapshot.polylinePoints} />
          {snapshot.chartPoints.map((point) => (
            <g key={point.month}>
              <circle
                className="deckup-showcase__chart-point"
                data-selected={point.selected}
                cx={point.x}
                cy={point.y}
                r={point.selected ? 10 : 6}
                opacity={point.visible ? 1 : 0.24}
              />
              <text
                className="deckup-showcase__chart-label"
                x={point.x}
                y={SHOWCASE_CHART_HEIGHT - 6}
              >
                {point.month}
              </text>
            </g>
          ))}
          {selectedPoint ? (
            <text
              className="deckup-showcase__chart-selected-label"
              x={selectedPoint.x}
              y={selectedPoint.y - 16}
            >
              {selectedPoint.month} · {selectedPoint.views.toLocaleString("en-US")}
            </text>
          ) : null}
        </svg>
      </div>
    </section>
  );
}
