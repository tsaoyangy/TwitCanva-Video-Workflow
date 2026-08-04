import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_ASPECT_RATIO,
  MAX_INPUT_PIXELS,
  MAX_OUTPUT_PIXELS,
  MIN_ASPECT_RATIO,
  MIN_INPUT_SIDE,
  MIN_OUTPUT_PIXELS,
  RATIO_PRESETS,
  clientToWorld,
  fitImageBox,
  isBboxLargeEnough,
  normalizedToWorld,
  toBboxAnnotation,
  toCoordinateValue,
  toPointAnnotation,
  validateInputDimensions,
  validatePixelSize,
  worldToClient,
  worldToNormalized,
} from "../lib/editor-geometry.ts";

function closeTo(actual, expected, epsilon = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} should be close to ${expected}`);
}

function closePoint(actual, expected) {
  closeTo(actual.x, expected.x);
  closeTo(actual.y, expected.y);
}

test("official ratio presets remain valid explicit sizes", () => {
  assert.deepEqual(
    RATIO_PRESETS.map(({ value, width, height }) => ({ value, width, height })),
    [
      { value: "16:9", width: 1424, height: 800 },
      { value: "3:2", width: 1248, height: 832 },
      { value: "4:3", width: 1152, height: 864 },
      { value: "1:1", width: 1024, height: 1024 },
      { value: "3:4", width: 864, height: 1152 },
      { value: "2:3", width: 832, height: 1248 },
      { value: "9:16", width: 800, height: 1424 },
      { value: "21:9", width: 1568, height: 672 },
    ],
  );
  for (const preset of RATIO_PRESETS) {
    assert.equal(validatePixelSize(preset.width, preset.height), true, preset.value);
  }
});

test("output dimensions enforce integer, pixel and aspect boundaries", () => {
  assert.equal(MIN_OUTPUT_PIXELS, 921_600);
  assert.equal(MAX_OUTPUT_PIXELS, 4_624_220);
  assert.equal(MIN_ASPECT_RATIO, 1 / 16);
  assert.equal(MAX_ASPECT_RATIO, 16);

  assert.equal(validatePixelSize(1280, 720), true);
  assert.equal(validatePixelSize(1279, 720), false);
  assert.equal(validatePixelSize(1634, 2830), true);
  assert.equal(1634 * 2830, MAX_OUTPUT_PIXELS);
  assert.equal(validatePixelSize(1634, 2831), false);
  assert.equal(validatePixelSize(3840, 240), true);
  assert.equal(validatePixelSize(240, 3840), true);
  assert.equal(validatePixelSize(3841, 240), false);
  assert.equal(validatePixelSize(240, 3841), false);
  assert.equal(validatePixelSize(1024.5, 1024), false);
});

test("input dimensions enforce documented side, area and aspect boundaries", () => {
  assert.equal(MIN_INPUT_SIDE, 15);
  assert.equal(MAX_INPUT_PIXELS, 36_000_000);
  assert.equal(validateInputDimensions(15, 15), true);
  assert.equal(validateInputDimensions(14, 15), false);
  assert.equal(validateInputDimensions(6000, 6000), true);
  assert.equal(validateInputDimensions(6001, 6000), false);
  assert.equal(validateInputDimensions(6001, 376), true);
  assert.equal(validateInputDimensions(240, 15), true);
  assert.equal(validateInputDimensions(241, 15), false);
  assert.equal(validateInputDimensions(15.5, 15), false);
});

test("client/world transforms are inverse at viewport corners and center under zoom and pan", () => {
  const viewport = { left: 41, top: 73, width: 1200, height: 800 };
  const transform = { zoom: 2.25, pan: { x: -137, y: 82 } };
  const points = [
    { x: 0, y: 0 },
    { x: 600, y: 400 },
    { x: 1200, y: 800 },
    { x: 137.25, y: 699.75 },
  ];

  for (const world of points) {
    closePoint(clientToWorld(worldToClient(world, viewport, transform), viewport, transform), world);
  }
});

test("normalization maps image corners and center, rejecting or clamping points outside the image", () => {
  const box = { x: 100, y: 50, width: 800, height: 400, fit: 0.5 };
  assert.deepEqual(worldToNormalized({ x: 100, y: 50 }, box), { x: 0, y: 0 });
  assert.deepEqual(worldToNormalized({ x: 900, y: 450 }, box), { x: 1, y: 1 });
  assert.deepEqual(worldToNormalized({ x: 500, y: 250 }, box), { x: 0.5, y: 0.5 });
  assert.equal(worldToNormalized({ x: 99, y: 250 }, box), null);
  assert.deepEqual(worldToNormalized({ x: 99, y: 999 }, box, true), { x: 0, y: 1 });
});

test("normalized annotations are invariant across zoom, pan and viewport resize", () => {
  const image = { width: 1600, height: 900 };
  const normalized = { x: 0.125, y: 0.875 };
  const cases = [
    {
      viewport: { left: 0, top: 0, width: 1000, height: 700 },
      transform: { zoom: 1, pan: { x: 0, y: 0 } },
    },
    {
      viewport: { left: 23, top: 19, width: 1440, height: 900 },
      transform: { zoom: 2.7, pan: { x: 211, y: -94 } },
    },
    {
      viewport: { left: 5, top: 7, width: 720, height: 1280 },
      transform: { zoom: 0.4, pan: { x: -55, y: 130 } },
    },
  ];

  for (const { viewport, transform } of cases) {
    const box = fitImageBox(viewport, image);
    assert.ok(box);
    const world = normalizedToWorld(normalized, box);
    const client = worldToClient(world, viewport, transform);
    const recoveredWorld = clientToWorld(client, viewport, transform);
    const recovered = worldToNormalized(recoveredWorld, box);
    assert.ok(recovered);
    closePoint(recovered, normalized);
    assert.deepEqual(toPointAnnotation(recovered), { type: "point", x: 125, y: 875 });
  }
});

test("coordinate annotations clamp to 0..999 and sort inverted boxes", () => {
  assert.equal(toCoordinateValue(-1), 0);
  assert.equal(toCoordinateValue(0), 0);
  assert.equal(toCoordinateValue(0.5), 500);
  assert.equal(toCoordinateValue(1), 999);
  assert.equal(toCoordinateValue(2), 999);
  assert.deepEqual(toPointAnnotation({ x: 0, y: 1 }), { type: "point", x: 0, y: 999 });
  assert.deepEqual(toBboxAnnotation({ x: 1, y: 0.8 }, { x: 0, y: 0.1 }), {
    type: "bbox",
    x1: 0,
    y1: 100,
    x2: 999,
    y2: 800,
  });
});

test("tiny or zero-area boxes are rejected consistently across zoom levels", () => {
  const box = { x: 0, y: 0, width: 1000, height: 500, fit: 1 };
  assert.equal(isBboxLargeEnough({ x: 0.2, y: 0.2 }, { x: 0.2, y: 0.3 }, box, 1), false);
  assert.equal(isBboxLargeEnough({ x: 0.2, y: 0.2 }, { x: 0.205, y: 0.21 }, box, 1), false);
  assert.equal(isBboxLargeEnough({ x: 0.2, y: 0.2 }, { x: 0.205, y: 0.21 }, box, 2), true);

  const hugeBox = { x: 0, y: 0, width: 10_000, height: 10_000, fit: 1 };
  assert.equal(isBboxLargeEnough({ x: 0.5001, y: 0.2 }, { x: 0.50049, y: 0.8 }, hugeBox, 2), false);
  assert.deepEqual(toBboxAnnotation({ x: 0.5001, y: 0.2 }, { x: 0.50049, y: 0.8 }), {
    type: "bbox",
    x1: 500,
    y1: 200,
    x2: 500,
    y2: 800,
  });
});
