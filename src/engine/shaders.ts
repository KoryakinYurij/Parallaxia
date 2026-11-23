export const POM_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const POM_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform sampler2D uColorMap;
  uniform sampler2D uDepthMap;
  uniform vec2 uParallaxOffset;
  uniform float uDepthScale;
  uniform float uConvergence;
  uniform float uDofAmount;
  uniform float uChromatic;
  uniform float uVignette;
  uniform float uOverlayMode; // 0=final, 1=grayscale, 2=heatmap, 3=split
  uniform float uSplitX;
  uniform float uSteps;
  uniform vec2 uTexelSize;

  varying vec2 vUv;

  vec3 depthToHeatmap(float v) {
    v = clamp(v, 0.0, 1.0);
    if (v < 0.25) {
      return mix(vec3(0.05, 0.07, 0.18), vec3(0.20, 0.22, 0.55), v / 0.25);
    } else if (v < 0.55) {
      return mix(vec3(0.20, 0.22, 0.55), vec3(0.78, 0.42, 0.30), (v - 0.25) / 0.30);
    } else if (v < 0.85) {
      return mix(vec3(0.78, 0.42, 0.30), vec3(0.96, 0.81, 0.21), (v - 0.55) / 0.30);
    }
    return mix(vec3(0.96, 0.81, 0.21), vec3(1.0, 1.0, 0.96), (v - 0.85) / 0.15);
  }

  vec2 clampSafeUv(vec2 uv) {
    return clamp(uv, vec2(0.002), vec2(0.998));
  }

  // Parallax Occlusion Mapping (Raymarching + Binary Refinement)
  vec3 raymarchPom(vec2 uv, vec2 shift) {
    float steps = max(4.0, uSteps);
    vec2 baseUv = uv + shift * (1.0 - uConvergence);
    vec2 stepUv = -shift / steps;

    vec2 currUv = baseUv;
    float currRayDepth = 1.0;
    float stepDepth = 1.0 / steps;
    float sampledDepth = texture2D(uDepthMap, clampSafeUv(currUv)).r;

    for (int i = 0; i < 16; i++) {
      if (float(i) >= steps) break;
      if (sampledDepth >= currRayDepth) break;
      currUv += stepUv;
      currRayDepth -= stepDepth;
      sampledDepth = texture2D(uDepthMap, clampSafeUv(currUv)).r;
    }

    // Binary refinement along the last segment for crisp foreground edges
    vec2 prevUv = currUv - stepUv;
    float prevRay = currRayDepth + stepDepth;
    for (int b = 0; b < 4; b++) {
      vec2 midUv = 0.5 * (currUv + prevUv);
      float midRay = 0.5 * (currRayDepth + prevRay);
      float midSample = texture2D(uDepthMap, clampSafeUv(midUv)).r;
      if (midSample >= midRay) {
        currUv = midUv;
        currRayDepth = midRay;
      } else {
        prevUv = midUv;
        prevRay = midRay;
      }
    }

    float hitDepth = texture2D(uDepthMap, clampSafeUv(currUv)).r;
    return vec3(clampSafeUv(currUv), hitDepth);
  }

  vec3 sampleOptics(vec2 uv, float depthVal) {
    float coc = abs(depthVal - uConvergence) * uDofAmount;
    vec2 chromaVec = (uv - 0.5) * (uChromatic * 0.008 * (0.4 + coc * 1.4));

    if (coc < 0.025) {
      float r = texture2D(uColorMap, clampSafeUv(uv + chromaVec)).r;
      float g = texture2D(uColorMap, uv).g;
      float b = texture2D(uColorMap, clampSafeUv(uv - chromaVec)).b;
      return vec3(r, g, b);
    }

    // 8-tap Poisson disk bokeh blur weighted by Circle of Confusion
    float radius = coc * 5.5;
    vec2 px = uTexelSize * radius;
    vec3 acc = vec3(0.0);
    acc += texture2D(uColorMap, clampSafeUv(uv + chromaVec)).rgb * 0.20;
    acc += texture2D(uColorMap, clampSafeUv(uv + vec2( 0.86,  0.50) * px)).rgb * 0.10;
    acc += texture2D(uColorMap, clampSafeUv(uv + vec2(-0.86,  0.50) * px)).rgb * 0.10;
    acc += texture2D(uColorMap, clampSafeUv(uv + vec2( 0.86, -0.50) * px)).rgb * 0.10;
    acc += texture2D(uColorMap, clampSafeUv(uv + vec2(-0.86, -0.50) * px)).rgb * 0.10;
    acc += texture2D(uColorMap, clampSafeUv(uv + vec2( 0.00,  1.00) * px)).rgb * 0.10;
    acc += texture2D(uColorMap, clampSafeUv(uv + vec2( 0.00, -1.00) * px)).rgb * 0.10;
    acc += texture2D(uColorMap, clampSafeUv(uv + vec2( 1.00,  0.00) * px - chromaVec)).rgb * 0.10;
    acc += texture2D(uColorMap, clampSafeUv(uv + vec2(-1.00,  0.00) * px - chromaVec)).rgb * 0.10;
    return acc;
  }

  void main() {
    // Subtle overscan crop to keep displaced borders completely free of edge clamping
    float overscan = 1.0 + abs(uDepthScale) * 0.14;
    vec2 scaledUv = (vUv - 0.5) / overscan + 0.5;

    float rawDepth = texture2D(uDepthMap, clampSafeUv(scaledUv)).r;

    if (uOverlayMode > 0.5 && uOverlayMode < 1.5) {
      gl_FragColor = vec4(vec3(rawDepth), 1.0);
      return;
    }

    if (uOverlayMode >= 1.5 && uOverlayMode < 2.5) {
      gl_FragColor = vec4(depthToHeatmap(rawDepth), 1.0);
      return;
    }

    vec2 shift = uParallaxOffset * (uDepthScale * 0.14);
    vec3 hit = raymarchPom(scaledUv, shift);
    vec3 finalCol = sampleOptics(hit.xy, hit.z);

    // Subtle cinema vignette
    float dist = length((vUv - 0.5) * vec2(1.15, 1.0));
    float vig = 1.0 - smoothstep(0.42, 0.98, dist) * (uVignette * 0.55);
    finalCol *= vig;

    if (uOverlayMode >= 2.5) {
      // Split comparison: Left = heatmap depth map, Right = live 2.5D POM result
      if (vUv.x < uSplitX) {
        finalCol = mix(texture2D(uColorMap, clampSafeUv(scaledUv)).rgb, depthToHeatmap(rawDepth), 0.72);
      }
      float line = 1.0 - smoothstep(0.0, 0.003, abs(vUv.x - uSplitX));
      finalCol = mix(finalCol, vec3(0.90, 0.60, 0.22), line);
    }

    gl_FragColor = vec4(finalCol, 1.0);
  }
`;

export const LDI_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const LDI_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform sampler2D uLayerMap;
  uniform sampler2D uDepthMap;
  uniform float uLayerDepth;
  uniform float uConvergence;
  uniform float uDofAmount;
  uniform float uChromatic;
  uniform float uVignette;
  uniform float uIsExploded;
  uniform float uShowRawHoleChecker;
  uniform vec2 uTexelSize;

  varying vec2 vUv;

  vec2 clampSafeUv(vec2 uv) {
    return clamp(uv, vec2(0.001), vec2(0.999));
  }

  void main() {
    vec4 baseSample = texture2D(uLayerMap, vUv);

    // When showing exploded view or raw disocclusion holes on the background plane,
    // render a subtle technical dark checkerboard wherever the hole was left unfilled
    if (uShowRawHoleChecker > 0.5 && baseSample.a < 0.08) {
      vec2 grid = floor(vUv * vec2(48.0, 27.0));
      float checker = mod(grid.x + grid.y, 2.0);
      vec3 holeColor = mix(vec3(0.09, 0.10, 0.13), vec3(0.16, 0.12, 0.08), checker);
      gl_FragColor = vec4(holeColor, 0.94);
      return;
    }

    if (baseSample.a < 0.015) {
      discard;
    }

    float coc = abs(uLayerDepth - uConvergence) * uDofAmount * (1.0 - uIsExploded * 0.75);
    vec2 chroma = (vUv - 0.5) * (uChromatic * 0.007 * (0.35 + coc));

    vec3 col;
    if (coc < 0.03) {
      float r = texture2D(uLayerMap, clampSafeUv(vUv + chroma)).r;
      float g = baseSample.g;
      float b = texture2D(uLayerMap, clampSafeUv(vUv - chroma)).b;
      col = vec3(r, g, b);
    } else {
      vec2 px = uTexelSize * (coc * 4.5);
      vec4 acc = baseSample * 0.28;
      acc += texture2D(uLayerMap, clampSafeUv(vUv + vec2( 0.86,  0.50) * px)) * 0.12;
      acc += texture2D(uLayerMap, clampSafeUv(vUv + vec2(-0.86,  0.50) * px)) * 0.12;
      acc += texture2D(uLayerMap, clampSafeUv(vUv + vec2( 0.86, -0.50) * px)) * 0.12;
      acc += texture2D(uLayerMap, clampSafeUv(vUv + vec2(-0.86, -0.50) * px)) * 0.12;
      acc += texture2D(uLayerMap, clampSafeUv(vUv + vec2( 0.00,  1.00) * px)) * 0.12;
      acc += texture2D(uLayerMap, clampSafeUv(vUv + vec2( 0.00, -1.00) * px)) * 0.12;
      col = acc.rgb / max(0.001, acc.a);
    }

    // Subtle cinema vignette (disabled in exploded 3D stack view for clean plate inspection)
    if (uIsExploded < 0.5) {
      float dist = length((vUv - 0.5) * vec2(1.12, 1.0));
      float vig = 1.0 - smoothstep(0.45, 1.02, dist) * (uVignette * 0.52);
      col *= vig;
    } else {
      // Hairline studio plate border in 3D exploded layer inspection mode
      float borderX = min(vUv.x, 1.0 - vUv.x);
      float borderY = min(vUv.y, 1.0 - vUv.y);
      float edge = 1.0 - smoothstep(0.002, 0.006, min(borderX, borderY));
      col = mix(col, vec3(0.90, 0.60, 0.22), edge * 0.65);
    }

    gl_FragColor = vec4(col, baseSample.a);
  }
`;

export const PARTICLE_VERTEX_SHADER = /* glsl */ `
  attribute float aScale;
  attribute float aPhase;
  uniform float uTime;
  uniform float uMode; // 1=dust, 2=mist, 3=rain
  uniform float uPixelRatio;
  uniform vec2 uBounds;
  uniform float uFrameOffsetY;

  varying float vAlpha;
  varying float vMode;

  void main() {
    vec3 pos = position;
    vMode = uMode;

    // Position is stored in normalized [-0.5..0.5] frame coordinates
    if (uMode < 1.5) {
      // Delicate drifting sunlit dust motes
      pos.x += sin(uTime * 0.28 + aPhase) * 0.04;
      pos.y = mod(pos.y + uTime * 0.02 + 0.5, 1.0) - 0.5;
      vAlpha = 0.28 + 0.22 * sin(uTime * 1.1 + aPhase * 3.0);
    } else if (uMode < 2.5) {
      // Soft atmospheric mist restricted to lower-mid valley zone
      pos.x = mod(pos.x + uTime * 0.025 + 0.5, 1.0) - 0.5;
      pos.y = pos.y * 0.55 - 0.12 + sin(uTime * 0.18 + aPhase) * 0.02;
      vAlpha = 0.065 + 0.03 * sin(uTime * 0.5 + aPhase);
    } else {
      // Subtle angled cinema rain streaks
      float fall = mod(uTime * 0.85 + aPhase, 1.0);
      pos.y = 0.5 - fall;
      pos.x = mod(pos.x - fall * 0.07 + 0.5, 1.0) - 0.5;
      vAlpha = 0.34;
    }

    // Smoothly fade particles out before touching image border so nothing floats in black letterboxing
    float edgeFadeX = smoothstep(0.5, 0.38, abs(pos.x));
    float edgeFadeY = smoothstep(0.5, 0.36, abs(pos.y));
    vAlpha *= edgeFadeX * edgeFadeY;

    vec3 worldPos = vec3(pos.x * uBounds.x, pos.y * uBounds.y + uFrameOffsetY, pos.z);
    vec4 mvPos = modelViewMatrix * vec4(worldPos, 1.0);
    gl_Position = projectionMatrix * mvPos;
    float baseSize = uMode < 1.5 ? 9.0 : (uMode < 2.5 ? 160.0 : 14.0);
    gl_PointSize = clamp((baseSize * aScale * uPixelRatio) / max(0.8, -mvPos.z), 2.0, 180.0);
  }
`;

export const PARTICLE_FRAGMENT_SHADER = /* glsl */ `
  precision mediump float;
  varying float vAlpha;
  varying float vMode;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float alpha = 0.0;
    vec3 color = vec3(1.0);

    if (vMode < 1.5) {
      // Tiny soft warm dust speck
      float d = length(c);
      alpha = pow(smoothstep(0.5, 0.0, d), 2.2) * vAlpha;
      color = vec3(1.0, 0.90, 0.72);
    } else if (vMode < 2.5) {
      // Ultra-soft wide atmospheric cloud puff
      float d = length(c * vec2(0.7, 1.35));
      alpha = pow(smoothstep(0.5, 0.0, d), 2.5) * vAlpha;
      color = vec3(0.84, 0.88, 0.94);
    } else {
      // Crisp thin rain streak
      float x = abs(c.x + c.y * 0.16);
      float y = abs(c.y);
      alpha = smoothstep(0.06, 0.01, x) * smoothstep(0.48, 0.08, y) * vAlpha;
      color = vec3(0.78, 0.88, 0.98);
    }

    if (alpha < 0.004) discard;
    gl_FragColor = vec4(color, alpha);
  }
`;
