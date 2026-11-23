import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyDepthBrushStroke,
  applyDepthContrast,
  buildLdiLayers,
  computeCameraRig,
  depthBufferToGrayscaleRgba,
  depthBufferToHeatmapRgba,
  inpaintBackgroundPlate,
  synthesizeDepthBuffer,
} from './depthPipeline';

test('Dolly Zoom maintains constant frustum height at focal distance', () => {
  const baseDistance = 3.2;
  const baseFov = 38;
  const expectedHalfHeight = Math.tan((baseFov * Math.PI) / 360) * baseDistance;

  for (const t of [0, 1.1, 2.4, 4.0]) {
    const rig = computeCameraRig({
      preset: 'dolly-zoom',
      timeSec: t,
      amplitude: 0.75,
      pointerX: 0,
      pointerY: 0,
      exploded: false,
      baseFovDeg: baseFov,
      baseDistance,
    });
    const dist = baseDistance + rig.dollyZ;
    const actualHalfHeight = Math.tan((rig.fov * Math.PI) / 360) * dist;
    assert.ok(
      Math.abs(actualHalfHeight - expectedHalfHeight) < 0.01,
      `Expected frustum half-height ~${expectedHalfHeight}, got ${actualHalfHeight}`,
    );
  }
});

test('Exploded 3D view angles camera for side inspection', () => {
  const rig = computeCameraRig({
    preset: 'orbit',
    timeSec: 0,
    amplitude: 0.5,
    pointerX: 0,
    pointerY: 0,
    exploded: true,
  });
  assert.ok(rig.yaw > 0.35, 'Exploded view should yaw camera to reveal Z-planes');
  assert.ok(rig.dollyZ > 0.3, 'Exploded view should pull back camera to frame separated layers');
});

test('Depth synthesis orders foreground region closer than sky background', () => {
  const w = 32;
  const h = 32;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = 120;
    rgba[i * 4 + 1] = 140;
    rgba[i * 4 + 2] = 180;
    rgba[i * 4 + 3] = 255;
  }

  const depth = synthesizeDepthBuffer(rgba, w, h, {
    horizonY: 0.4,
    groundSlope: 0.4,
    edgeWeight: 0.1,
    regions: [
      {
        label: 'Hero',
        layer: 'foreground',
        shape: 'ellipse',
        cx: 0.5,
        cy: 0.5,
        rx: 0.18,
        ry: 0.25,
        depth: 0.94,
        softness: 0.04,
      },
    ],
  });

  const skyDepth = depth[2 * w + 16];
  const heroDepth = depth[16 * w + 16];
  assert.ok(heroDepth > skyDepth + 0.45, `Hero depth (${heroDepth}) should exceed sky depth (${skyDepth})`);
});

test('LDI layer split + multipass inpaint fills occluded hole strictly with background color (zero foreground bleed)', () => {
  const w = 24;
  const h = 24;
  const rgba = new Uint8ClampedArray(w * h * 4);
  const depth = new Float32Array(w * h);

  // Pure teal background (20, 140, 190) everywhere, bright red foreground square (240, 20, 20) in center
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const isHero = x >= 9 && x <= 14 && y >= 9 && y <= 14;
      depth[i] = isHero ? 0.92 : 0.15;
      rgba[i * 4] = isHero ? 240 : 20;
      rgba[i * 4 + 1] = isHero ? 20 : 140;
      rgba[i * 4 + 2] = isHero ? 20 : 190;
      rgba[i * 4 + 3] = 255;
    }
  }

  const ldi = buildLdiLayers({
    rgba,
    depth,
    width: w,
    height: h,
    foregroundCut: 0.65,
    midgroundCut: 0.35,
    feather: 0.04,
    dilationPx: 1,
  });

  assert.ok(ldi.holePixelCount >= 36, 'Foreground square should generate disocclusion hole');
  const centerIdx = 12 * w + 12;
  assert.equal(ldi.foregroundRgba[centerIdx * 4 + 3], 255, 'Foreground should be opaque at hero center');
  assert.equal(ldi.backgroundRgba[centerIdx * 4 + 3], 0, 'Raw background should have transparent hole at hero center');

  const inpainted = inpaintBackgroundPlate({
    backgroundRgba: ldi.backgroundRgba,
    disocclusionMask: ldi.disocclusionMask,
    width: w,
    height: h,
    algorithm: 'multipass',
  });

  assert.equal(inpainted.filledPixels, ldi.holePixelCount, 'All hole pixels should be filled');
  const filledR = inpainted.inpaintedRgba[centerIdx * 4];
  const filledG = inpainted.inpaintedRgba[centerIdx * 4 + 1];
  const filledB = inpainted.inpaintedRgba[centerIdx * 4 + 2];
  const filledA = inpainted.inpaintedRgba[centerIdx * 4 + 3];

  assert.equal(filledA, 255, 'Inpainted center should be fully opaque');
  assert.ok(filledR < 40, `Foreground red should not bleed into background (got R=${filledR})`);
  assert.ok(Math.abs(filledG - 140) < 15, `Inpainted green should match background (~140, got ${filledG})`);
  assert.ok(Math.abs(filledB - 190) < 15, `Inpainted blue should match background (~190, got ${filledB})`);
});

test('Depth brush stroke updates near/far values and contrast clamps safely', () => {
  const w = 20;
  const h = 20;
  const depth = new Float32Array(w * h).fill(0.5);

  applyDepthBrushStroke({
    depth,
    width: w,
    height: h,
    nx: 0.5,
    ny: 0.5,
    radiusNorm: 0.25,
    strength: 0.8,
    tool: 'near',
  });

  assert.ok(depth[10 * w + 10] > 0.65, 'Near brush should raise depth toward 1.0');
  assert.equal(depth[0], 0.5, 'Pixels outside brush radius remain unchanged');

  applyDepthBrushStroke({
    depth,
    width: w,
    height: h,
    nx: 0.1,
    ny: 0.1,
    radiusNorm: 0.2,
    strength: 0.8,
    tool: 'far',
  });
  assert.ok(depth[2 * w + 2] < 0.4, 'Far brush should lower depth toward 0.0');

  const contrasted = applyDepthContrast(depth, 1.8);
  for (let i = 0; i < contrasted.length; i++) {
    assert.ok(contrasted[i] >= 0 && contrasted[i] <= 1, 'Depth values must stay within [0, 1]');
  }

  const heat = depthBufferToHeatmapRgba(contrasted);
  const gray = depthBufferToGrayscaleRgba(contrasted);
  assert.equal(heat.length, w * h * 4);
  assert.equal(gray.length, w * h * 4);
});
