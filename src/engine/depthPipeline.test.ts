import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  applyDepthBrushStroke,
  applyDepthContrast,
  buildLdiLayers,
  computeCameraRig,
  depthBufferToGrayscaleRgba,
  depthBufferToHeatmapRgba,
  guidedFilterDepth,
  inpaintBackgroundPlate,
  parseAndValidateSceneManifest,
  synthesizeDepthBuffer,
} from './depthPipeline';

test('Dolly Zoom maintains constant frustum height at focal distance', () => {
  const baseDist = 3.2;
  const baseFov = 38;
  const baseHalfHeight = Math.tan((baseFov * Math.PI) / 360) * baseDist;

  for (const t of [0, 0.7, 1.5, 2.4, 3.8]) {
    const rig = computeCameraRig({
      preset: 'dolly-zoom',
      timeSec: t,
      amplitude: 0.8,
      pointerX: 0,
      pointerY: 0,
      exploded: false,
      baseFovDeg: baseFov,
      baseDistance: baseDist,
    });
    const currentDist = baseDist + rig.dollyZ;
    const currentHalfHeight = Math.tan((rig.fov * Math.PI) / 360) * currentDist;
    assert.ok(
      Math.abs(currentHalfHeight - baseHalfHeight) < 1e-4,
      `Dolly Zoom frustum height mismatch at t=${t}: got ${currentHalfHeight}, expected ${baseHalfHeight}`,
    );
  }
});

test('Exploded 3D view angles camera for side inspection', () => {
  const rig = computeCameraRig({
    preset: 'orbit',
    timeSec: 0,
    amplitude: 0.6,
    pointerX: 0,
    pointerY: 0,
    exploded: true,
  });
  assert.ok(rig.offsetX > 0.35, 'Exploded view should offset camera laterally to reveal Z-planes');
  assert.ok(rig.dollyZ > 0.3, 'Exploded view should pull back camera to frame separated layers');
});

test('Luma-gated polygon preserves bright background window behind dark easel', () => {
  const w = 40;
  const h = 40;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const isEasel = x >= 18 && x <= 22 && y >= 8 && y <= 34;
      rgba[i] = isEasel ? 25 : 245;
      rgba[i + 1] = isEasel ? 20 : 240;
      rgba[i + 2] = isEasel ? 18 : 225;
      rgba[i + 3] = 255;
    }
  }

  const depth = synthesizeDepthBuffer(rgba, w, h, {
    horizonY: 0.5,
    groundSlope: 0.2,
    edgeWeight: 0.04,
    regions: [
      {
        label: 'Window',
        layer: 'background',
        shape: 'rect',
        cx: 0.5,
        cy: 0.5,
        rx: 0.5,
        ry: 0.5,
        depth: 0.08,
        softness: 0.02,
      },
      {
        label: 'Dark Easel',
        layer: 'midground',
        shape: 'polygon',
        cx: 0.5,
        cy: 0.5,
        rx: 0.25,
        ry: 0.4,
        points: [
          [0.25, 0.15],
          [0.75, 0.15],
          [0.75, 0.9],
          [0.25, 0.9],
        ],
        depth: 0.68,
        softness: 0.02,
        lumaMax: 0.35,
      },
    ],
  });

  const easelDepth = depth[20 * w + 20];
  const windowRightBesideEasel = depth[20 * w + 26];
  assert.ok(
    easelDepth > 0.45 && windowRightBesideEasel < 0.22,
    `Dark easel (${easelDepth}) must pop forward while bright window beside it (${windowRightBesideEasel}) stays far background`,
  );
});

test('3-Channel RGB Guided Image Filter snaps coarse depth to luminance AND red/blue isoluminant edges', () => {
  const w = 32;
  const h = 32;
  const rgba = new Uint8ClampedArray(w * h * 4);
  const coarseDepth = new Float32Array(w * h);

  // Isoluminant crimson red (200, 50, 50) on left vs cool teal (40, 125, 160) on right
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const isLeft = x < 16;
      rgba[i * 4] = isLeft ? 200 : 40;
      rgba[i * 4 + 1] = isLeft ? 50 : 125;
      rgba[i * 4 + 2] = isLeft ? 50 : 160;
      rgba[i * 4 + 3] = 255;
      coarseDepth[i] = x < 14 ? 0.9 : x > 18 ? 0.1 : 0.5;
    }
  }

  const refined = guidedFilterDepth(coarseDepth, rgba, w, h, 4, 0.002);
  const leftVal = refined[16 * w + 15];
  const rightVal = refined[16 * w + 16];
  assert.ok(
    leftVal > 0.6 && rightVal < 0.4 && leftVal - rightVal > 0.25,
    `RGB Guided filter should snap isoluminant crimson/teal edge cleanly (left=${leftVal.toFixed(3)}, right=${rightVal.toFixed(3)})`,
  );
});

test('Excess-green foliage gate separates green olive leaves from dark brown wall of identical luminance', () => {
  const w = 32;
  const h = 32;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const isLeaf = x >= 12 && x <= 19 && y >= 8 && y <= 24;
      rgba[i] = isLeaf ? 42 : 72;
      rgba[i + 1] = isLeaf ? 78 : 62;
      rgba[i + 2] = isLeaf ? 34 : 50;
      rgba[i + 3] = 255;
    }
  }

  const depth = synthesizeDepthBuffer(rgba, w, h, {
    horizonY: 0.5,
    groundSlope: 0.2,
    edgeWeight: 0.04,
    regions: [
      {
        label: 'Wall',
        layer: 'midground',
        shape: 'rect',
        cx: 0.5,
        cy: 0.5,
        rx: 0.5,
        ry: 0.5,
        depth: 0.35,
        softness: 0.02,
      },
      {
        label: 'Olive foliage',
        layer: 'foreground',
        shape: 'ellipse',
        cx: 0.5,
        cy: 0.5,
        rx: 0.4,
        ry: 0.4,
        depth: 0.92,
        softness: 0.03,
        lumaMax: 0.5,
        greenMin: 0.015,
      },
    ],
  });

  const leafDepth = depth[16 * w + 16];
  const wallDepth = depth[16 * w + 7];
  assert.ok(
    leafDepth > 0.72 && wallDepth < 0.45,
    `Green leaf (${leafDepth.toFixed(3)}) must pop forward while dark brown wall (${wallDepth.toFixed(3)}) stays midground`,
  );
});

test('Universal colorTarget with invertColorTarget separates arbitrary colored subject from known sky backdrop', () => {
  const w = 32;
  const h = 32;
  const rgba = new Uint8ClampedArray(w * h * 4);
  // Blue sky (110, 165, 230) everywhere; ochre mountaineer jacket (225, 145, 40) in center
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const isSubject = x >= 12 && x <= 19 && y >= 10 && y <= 22;
      rgba[i] = isSubject ? 225 : 110;
      rgba[i + 1] = isSubject ? 145 : 165;
      rgba[i + 2] = isSubject ? 40 : 230;
      rgba[i + 3] = 255;
    }
  }

  const depth = synthesizeDepthBuffer(rgba, w, h, {
    horizonY: 0.5,
    groundSlope: 0.1,
    edgeWeight: 0.04,
    regions: [
      {
        label: 'Sky',
        layer: 'background',
        shape: 'rect',
        cx: 0.5,
        cy: 0.5,
        rx: 0.5,
        ry: 0.5,
        depth: 0.1,
        softness: 0.02,
      },
      {
        label: 'Subject via background exclusion',
        layer: 'foreground',
        shape: 'rect',
        cx: 0.5,
        cy: 0.5,
        rx: 0.45,
        ry: 0.45,
        depth: 0.94,
        softness: 0.02,
        colorTarget: [110, 165, 230],
        colorTolerance: 0.25,
        invertColorTarget: true,
      },
    ],
  });

  const subjectDepth = depth[16 * w + 16];
  const skyBeside = depth[16 * w + 6];
  assert.ok(
    subjectDepth > 0.78 && skyBeside < 0.25,
    `Subject (${subjectDepth.toFixed(3)}) must isolate cleanly from excluded sky color (${skyBeside.toFixed(3)})`,
  );
});

test('LDI layer split + push-pull multipass inpaint fills occluded hole strictly with background color', () => {
  const w = 24;
  const h = 24;
  const rgba = new Uint8ClampedArray(w * h * 4);
  const depth = new Float32Array(w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const inHero = x >= 9 && x <= 14 && y >= 9 && y <= 14;
      rgba[i * 4] = inHero ? 240 : 20;
      rgba[i * 4 + 1] = inHero ? 20 : 140;
      rgba[i * 4 + 2] = inHero ? 20 : 190;
      rgba[i * 4 + 3] = 255;
      depth[i] = inHero ? 0.95 : 0.12;
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
  assert.equal(ldi.foregroundRgba[centerIdx * 4 + 3], 255);
  assert.equal(ldi.backgroundRgba[centerIdx * 4 + 3], 0);

  const inpainted = inpaintBackgroundPlate({
    backgroundRgba: ldi.backgroundRgba,
    disocclusionMask: ldi.disocclusionMask,
    width: w,
    height: h,
    algorithm: 'multipass',
  });

  assert.equal(inpainted.filledPixels, ldi.holePixelCount);
  const filledR = inpainted.inpaintedRgba[centerIdx * 4];
  const filledG = inpainted.inpaintedRgba[centerIdx * 4 + 1];
  const filledB = inpainted.inpaintedRgba[centerIdx * 4 + 2];

  assert.ok(filledR < 40, `Foreground red should not bleed into background (got R=${filledR})`);
  assert.ok(Math.abs(filledG - 140) < 15);
  assert.ok(Math.abs(filledB - 190) < 15);
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
    radiusNorm: 0.2,
    strength: 0.8,
    tool: 'near',
  });

  assert.ok(depth[10 * w + 10] > 0.65);
  assert.equal(depth[0], 0.5);

  applyDepthBrushStroke({
    depth,
    width: w,
    height: h,
    nx: 0.1,
    ny: 0.1,
    radiusNorm: 0.15,
    strength: 0.8,
    tool: 'far',
  });
  assert.ok(depth[2 * w + 2] < 0.4);

  const contrasted = applyDepthContrast(depth, 1.8);
  for (let i = 0; i < contrasted.length; i++) {
    assert.ok(contrasted[i] >= 0 && contrasted[i] <= 1);
  }

  const heat = depthBufferToHeatmapRgba(contrasted);
  const gray = depthBufferToGrayscaleRgba(contrasted);
  assert.equal(heat.length, w * h * 4);
  assert.equal(gray.length, w * h * 4);
});

test('All declarative scene manifests in src/scenes/*.json validate cleanly and reject malformed input', () => {
  const scenesDir = path.resolve(process.cwd(), 'src/scenes');
  const jsonFiles = fs.readdirSync(scenesDir).filter((f) => f.endsWith('.json'));
  assert.ok(jsonFiles.length >= 4, 'Expected at least 4 declarative JSON scene manifests');

  const ids = new Set<string>();
  for (const file of jsonFiles) {
    const raw = JSON.parse(fs.readFileSync(path.join(scenesDir, file), 'utf8'));
    const res = parseAndValidateSceneManifest(raw);
    assert.equal(res.ok, true, `Manifest ${file} failed validation: ${!res.ok ? res.error : ''}`);
    if (res.ok) {
      assert.ok(!ids.has(res.manifest.id), `Duplicate scene id: ${res.manifest.id}`);
      ids.add(res.manifest.id);
      assert.ok(res.manifest.blueprint.regions.length > 0, `Manifest ${file} should define depth regions`);
    }
  }

  const badRes = parseAndValidateSceneManifest({ id: '', title: 'Broken' });
  assert.equal(badRes.ok, false, 'Malformed manifest must be rejected cleanly');
});
