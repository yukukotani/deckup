<script setup lang="ts">
import { computed, ref } from "vue";

import "./showcase.css";
import {
  SHOWCASE_CHART_HEIGHT,
  SHOWCASE_CHART_PADDING,
  SHOWCASE_CHART_WIDTH,
  SHOWCASE_RECORDS,
  getShowcaseSnapshot,
} from "./showcase-data.ts";

const gridLines = [44, 96, 148] as const;
const selectedIndex = ref(0);
const snapshot = computed(() => getShowcaseSnapshot(selectedIndex.value));
const selectedPoint = computed(() => snapshot.value.chartPoints.find((point) => point.selected));
</script>

<template>
  <section class="deckup-showcase deckup-showcase__explorer" aria-labelledby="vue-showcase-title">
    <div class="deckup-showcase__control">
      <p id="vue-showcase-title" class="deckup-showcase__eyebrow">
        Vue island · synthetic local data
      </p>
      <label for="vue-showcase-month">
        Explore month: <strong>{{ snapshot.selectedRecord.month }}</strong>
        <input
          id="vue-showcase-month"
          v-model.number="selectedIndex"
          class="deckup-showcase__range"
          type="range"
          :min="0"
          :max="SHOWCASE_RECORDS.length - 1"
          :step="1"
          :aria-valuetext="snapshot.rangeValueText"
          aria-controls="vue-showcase-chart"
        />
      </label>

      <dl class="deckup-showcase__metrics">
        <div class="deckup-showcase__metric">
          <dt>Views</dt>
          <dd>{{ snapshot.selectedRecord.views.toLocaleString("en-US") }}</dd>
        </div>
        <div class="deckup-showcase__metric">
          <dt>Completion</dt>
          <dd>{{ snapshot.selectedRecord.completionRate }}%</dd>
        </div>
        <div class="deckup-showcase__metric">
          <dt>Interactions</dt>
          <dd>{{ snapshot.selectedRecord.interactions.toLocaleString("en-US") }}</dd>
        </div>
      </dl>

      <p class="deckup-showcase__status" role="status" aria-live="polite">
        {{ snapshot.statusText }}
      </p>
    </div>

    <div class="deckup-showcase__visual">
      <svg
        id="vue-showcase-chart"
        class="deckup-showcase__chart"
        :viewBox.attr="`0 0 ${SHOWCASE_CHART_WIDTH} ${SHOWCASE_CHART_HEIGHT}`"
        role="img"
        aria-labelledby="vue-chart-title vue-chart-description"
      >
        <title id="vue-chart-title">
          Monthly sample deck views through {{ snapshot.selectedRecord.month }}
        </title>
        <desc id="vue-chart-description">
          The line reveals one month at a time. The selected point has a larger dark outline and a
          text label, so selection is not communicated by color alone.
        </desc>
        <line
          v-for="y in gridLines"
          :key="y"
          class="deckup-showcase__chart-grid"
          :x1.attr="SHOWCASE_CHART_PADDING"
          :x2.attr="SHOWCASE_CHART_WIDTH - SHOWCASE_CHART_PADDING"
          :y1.attr="y"
          :y2.attr="y"
        />
        <polyline class="deckup-showcase__chart-path" :points.attr="snapshot.polylinePoints" />
        <g v-for="point in snapshot.chartPoints" :key="point.month">
          <circle
            class="deckup-showcase__chart-point"
            :data-selected="point.selected"
            :cx.attr="point.x"
            :cy.attr="point.y"
            :r.attr="point.selected ? 10 : 6"
            :opacity.attr="point.visible ? 1 : 0.24"
          />
          <text
            class="deckup-showcase__chart-label"
            :x.attr="point.x"
            :y.attr="SHOWCASE_CHART_HEIGHT - 6"
          >
            {{ point.month }}
          </text>
        </g>
        <text
          v-if="selectedPoint"
          class="deckup-showcase__chart-selected-label"
          :x.attr="selectedPoint.x"
          :y.attr="selectedPoint.y - 16"
        >
          {{ selectedPoint.month }} · {{ selectedPoint.views.toLocaleString("en-US") }}
        </text>
      </svg>
    </div>
  </section>
</template>
