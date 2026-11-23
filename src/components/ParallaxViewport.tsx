import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import { computeCameraRig } from '../engine/depthPipeline';
import type { ComputedLdiAssets, LoadedImageAssets } from '../engine/imageProcessor';
import {
  LDI_FRAGMENT_SHADER,
  LDI_VERTEX_SHADER,
  PARTICLE_FRAGMENT_SHADER,
  PARTICLE_VERTEX_SHADER,
  POM_FRAGMENT_SHADER,
  POM_VERTEX_SHADER,
} from '../engine/shaders';
import type { StudioState } from '../engine/types';

export interface ParallaxViewportHandle {
  captureFrameDataUrl: () => string | null;
  recordLoopWebm: (
    durationSec: number,
    onProgress: (ratio: number) => void,
  ) => Promise<Blob>;
}

interface ParallaxViewportProps {
  state: StudioState;
  dockCollapsed: boolean;
  imageAssets: LoadedImageAssets | null;
  ldiAssets: ComputedLdiAssets | null;
  fallbackImageUrl: string;
  onBrushPaint: (nx: number, ny: number, commit: boolean) => void;
}

function detectSoftwareGl(): boolean {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') || probe.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export const ParallaxViewport = forwardRef<ParallaxViewportHandle, ParallaxViewportProps>(
  function ParallaxViewport(
    { state, dockCollapsed, imageAssets, ldiAssets, fallbackImageUrl, onBrushPaint },
    ref,
  ) {
    const mountRef = useRef<HTMLDivElement | null>(null);
    const stateRef = useRef<StudioState>(state);
    stateRef.current = state;
    const dockCollapsedRef = useRef<boolean>(dockCollapsed);
    dockCollapsedRef.current = dockCollapsed;

    const onBrushPaintRef = useRef(onBrushPaint);
    onBrushPaintRef.current = onBrushPaint;

    const pointerRef = useRef({ x: 0, y: 0, targetX: 0, targetY: 0 });
    const paintingRef = useRef(false);
    const [brushCursor, setBrushCursor] = useState<{ x: number; y: number; visible: boolean }>({
      x: 0,
      y: 0,
      visible: false,
    });
    const [contextLost, setContextLost] = useState(false);
    const [webglUnavailable, setWebglUnavailable] = useState(false);

    // Three.js persistent engine objects stored in a ref so React updates never rebuild the WebGL context
    const engineRef = useRef<{
      renderer: THREE.WebGLRenderer;
      scene: THREE.Scene;
      camera: THREE.PerspectiveCamera;
      pomMesh: THREE.Mesh;
      pomMaterial: THREE.ShaderMaterial;
      ldiGroup: THREE.Group;
      bgMesh: THREE.Mesh;
      midMesh: THREE.Mesh;
      fgMesh: THREE.Mesh;
      bgMat: THREE.ShaderMaterial;
      midMat: THREE.ShaderMaterial;
      fgMat: THREE.ShaderMaterial;
      stageGrid: THREE.LineSegments;
      particles: THREE.Points;
      particleMat: THREE.ShaderMaterial;
      textures: THREE.Texture[];
      aspectRatio: number;
      renderNow: () => void;
    } | null>(null);

    useImperativeHandle(ref, () => ({
      captureFrameDataUrl() {
        const eng = engineRef.current;
        if (!eng) return null;
        eng.renderNow();
        return eng.renderer.domElement.toDataURL('image/png');
      },
      recordLoopWebm(durationSec, onProgress) {
        return new Promise<Blob>((resolve, reject) => {
          const eng = engineRef.current;
          if (!eng) {
            reject(new Error('WebGL-рендерер не готов'));
            return;
          }
          const canvas = eng.renderer.domElement;
          if (typeof canvas.captureStream !== 'function' || typeof MediaRecorder === 'undefined') {
            reject(new Error('Браузер не поддерживает запись WebM-видео через MediaRecorder'));
            return;
          }

          const stream = canvas.captureStream(30);
          const mimeCandidates = [
            'video/webm;codecs=vp9',
            'video/webm;codecs=vp8',
            'video/webm',
          ];
          const mimeType =
            mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || 'video/webm';

          const chunks: Blob[] = [];
          const recorder = new MediaRecorder(stream, {
            mimeType,
            videoBitsPerSecond: 6_000_000,
          });

          recorder.ondataavailable = (ev) => {
            if (ev.data && ev.data.size > 0) chunks.push(ev.data);
          };
          recorder.onerror = () => reject(new Error('Ошибка записи видеопотока'));
          recorder.onstop = () => {
            stream.getTracks().forEach((t) => t.stop());
            resolve(new Blob(chunks, { type: mimeType }));
          };

          const startTime = performance.now();
          const durationMs = Math.max(1000, durationSec * 1000);
          recorder.start(120);

          const timer = window.setInterval(() => {
            const elapsed = performance.now() - startTime;
            onProgress(Math.min(1, elapsed / durationMs));
            if (elapsed >= durationMs) {
              window.clearInterval(timer);
              if (recorder.state !== 'inactive') recorder.stop();
            }
          }, 80);
        });
      },
    }));

    // Mount WebGLRenderer & Three.js scene ONCE
    useEffect(() => {
      const container = mountRef.current;
      if (!container) return;

      const isSoftwareGl = detectSoftwareGl();
      let renderer: THREE.WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({
          antialias: !isSoftwareGl,
          alpha: false,
          powerPreference: 'high-performance',
          preserveDrawingBuffer: true,
        });
      } catch {
        setWebglUnavailable(true);
        return;
      }

      const pixelRatio = isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2);
      renderer.setPixelRatio(pixelRatio);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.02;
      renderer.setClearColor(0x0b0d10, 1);

      const width = Math.max(320, container.clientWidth);
      const height = Math.max(240, container.clientHeight);
      renderer.setSize(width, height, false);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      renderer.domElement.style.display = 'block';
      container.innerHTML = '';
      container.appendChild(renderer.domElement);

      const handleContextLost = (e: Event) => {
        e.preventDefault();
        setContextLost(true);
      };
      const handleContextRestored = () => {
        setContextLost(false);
      };
      renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored);

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0b0d10);

      const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 40);
      camera.position.set(0, 0, 3.2);

      // Placeholder 1x1 dark texture until scene assets finish loading
      const blankData = new Uint8Array([16, 19, 24, 255]);
      const blankTex = new THREE.DataTexture(blankData, 1, 1);
      blankTex.needsUpdate = true;

      const planeGeo = new THREE.PlaneGeometry(1, 1, 1, 1);

      // 1. POM Raymarching Single-Plane Mesh
      const pomMaterial = new THREE.ShaderMaterial({
        uniforms: {
          uColorMap: { value: blankTex },
          uDepthMap: { value: blankTex },
          uParallaxOffset: { value: new THREE.Vector2(0, 0) },
          uDepthScale: { value: 0.55 },
          uConvergence: { value: 0.52 },
          uDofAmount: { value: 0.2 },
          uChromatic: { value: 0.15 },
          uVignette: { value: 0.35 },
          uOverlayMode: { value: 0 },
          uSplitX: { value: 0.5 },
          uSteps: { value: isSoftwareGl ? 8 : 16 },
          uTexelSize: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
        },
        vertexShader: POM_VERTEX_SHADER,
        fragmentShader: POM_FRAGMENT_SHADER,
        depthWrite: true,
        depthTest: true,
      });
      const pomMesh = new THREE.Mesh(planeGeo, pomMaterial);
      scene.add(pomMesh);

      // 2. LDI 3-Plane Separated Stack (Background Inpainted, Midground, Foreground)
      const ldiGroup = new THREE.Group();
      const createLdiMat = (layerDepth: number) =>
        new THREE.ShaderMaterial({
          uniforms: {
            uLayerMap: { value: blankTex },
            uDepthMap: { value: blankTex },
            uLayerDepth: { value: layerDepth },
            uConvergence: { value: 0.52 },
            uDofAmount: { value: 0.2 },
            uChromatic: { value: 0.15 },
            uVignette: { value: 0.35 },
            uIsExploded: { value: 0 },
            uShowRawHoleChecker: { value: 0 },
            uTexelSize: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
          },
          vertexShader: LDI_VERTEX_SHADER,
          fragmentShader: LDI_FRAGMENT_SHADER,
          transparent: true,
          depthWrite: false,
          depthTest: true,
          side: THREE.DoubleSide,
        });

      const bgMat = createLdiMat(0.15);
      const midMat = createLdiMat(0.5);
      const fgMat = createLdiMat(0.88);

      const bgMesh = new THREE.Mesh(planeGeo, bgMat);
      bgMesh.renderOrder = 1;
      const midMesh = new THREE.Mesh(planeGeo, midMat);
      midMesh.renderOrder = 2;
      const fgMesh = new THREE.Mesh(planeGeo, fgMat);
      fgMesh.renderOrder = 3;

      ldiGroup.add(bgMesh, midMesh, fgMesh);
      scene.add(ldiGroup);

      // Technical 3D Depth Stage Grid visible only during "3D Разбор слоёв" (Exploded view)
      const gridPoints: number[] = [];
      const gridY = -1.08;
      for (let i = -5; i <= 5; i++) {
        const x = i * 0.42;
        gridPoints.push(x, gridY, -1.2, x, gridY, 1.2);
      }
      for (let j = -4; j <= 4; j++) {
        const z = j * 0.3;
        gridPoints.push(-2.1, gridY, z, 2.1, gridY, z);
      }
      const gridGeo = new THREE.BufferGeometry();
      gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gridPoints, 3));
      const gridMat = new THREE.LineBasicMaterial({
        color: 0xe59838,
        transparent: true,
        opacity: 0.22,
      });
      const stageGrid = new THREE.LineSegments(gridGeo, gridMat);
      stageGrid.visible = false;
      scene.add(stageGrid);

      // 3. 3D Depth-Sorted Atmospheric Particle System in normalized [-0.5..0.5] frame coords
      const particleCount = isSoftwareGl ? 42 : 90;
      const pPositions = new Float32Array(particleCount * 3);
      const pScales = new Float32Array(particleCount);
      const pPhases = new Float32Array(particleCount);
      for (let i = 0; i < particleCount; i++) {
        pPositions[i * 3] = Math.random() - 0.5;
        pPositions[i * 3 + 1] = Math.random() - 0.5;
        // Spread between background (-0.18) and near foreground (+0.38)
        pPositions[i * 3 + 2] = -0.18 + Math.random() * 0.56;
        pScales[i] = 0.65 + Math.random() * 1.1;
        pPhases[i] = Math.random() * Math.PI * 2;
      }
      const particleGeo = new THREE.BufferGeometry();
      particleGeo.setAttribute('position', new THREE.BufferAttribute(pPositions, 3));
      particleGeo.setAttribute('aScale', new THREE.BufferAttribute(pScales, 1));
      particleGeo.setAttribute('aPhase', new THREE.BufferAttribute(pPhases, 1));

      const particleMat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uMode: { value: 1 },
          uPixelRatio: { value: pixelRatio },
          uBounds: { value: new THREE.Vector2(3.2, 1.8) },
          uFrameOffsetY: { value: 0.22 },
        },
        vertexShader: PARTICLE_VERTEX_SHADER,
        fragmentShader: PARTICLE_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const particles = new THREE.Points(particleGeo, particleMat);
      particles.renderOrder = 4;
      scene.add(particles);

      // Scratch camera state for silky exponential damping
      let simTime = 0;
      let lastPerf = performance.now();
      let smoothOffX = 0;
      let smoothOffY = 0;
      let smoothDollyZ = 0;
      let smoothFov = 38;
      let smoothYaw = 0;
      let smoothPitch = 0;
      let smoothExplode = 0;
      let smoothFrameY = 0.24;

      const updateFrame = (dt: number) => {
        const s = stateRef.current;
        const eng = engineRef.current;
        const imgAspect = eng ? eng.aspectRatio : 16 / 9;

        const isDepthEdit = s.activeTab === 'depth';
        const isExploded = s.pipelineMode === 'exploded' && !isDepthEdit;
        const usePom =
          isDepthEdit ||
          s.pipelineMode === 'pom' ||
          s.depthOverlay !== 'final';

        if (s.isPlaying && !isDepthEdit) {
          simTime += dt * s.speed;
        }

        // Smooth pointer tracking
        const ptr = pointerRef.current;
        const pLerp = 1 - Math.exp(-8 * dt);
        ptr.x += (ptr.targetX - ptr.x) * pLerp;
        ptr.y += (ptr.targetY - ptr.y) * pLerp;

        const targetRig = isDepthEdit
          ? { offsetX: 0, offsetY: 0, dollyZ: 0, fov: 38, yaw: 0, pitch: 0, roll: 0 }
          : computeCameraRig({
              preset: s.motionPreset,
              timeSec: simTime,
              amplitude: s.parallaxStrength,
              pointerX: ptr.x,
              pointerY: ptr.y,
              exploded: isExploded,
              baseFovDeg: 38,
              baseDistance: 3.2,
            });

        const damp = 1 - Math.exp(-6.5 * dt);
        smoothOffX += (targetRig.offsetX - smoothOffX) * damp;
        smoothOffY += (targetRig.offsetY - smoothOffY) * damp;
        smoothDollyZ += (targetRig.dollyZ - smoothDollyZ) * damp;
        smoothFov += (targetRig.fov - smoothFov) * damp;
        smoothYaw += (targetRig.yaw - smoothYaw) * damp;
        smoothPitch += (targetRig.pitch - smoothPitch) * damp;
        smoothExplode += ((isExploded ? 1 : 0) - smoothExplode) * damp;

        // Compute ideal plane size so the 2.5D frame sits cleanly ABOVE the bottom dock when open
        const viewAspect = camera.aspect;
        const baseDistance = 3.2;
        const frustumH = 2 * Math.tan((38 * Math.PI) / 360) * baseDistance;
        const frustumW = frustumH * viewAspect;

        const dockOpen = !dockCollapsedRef.current;
        const targetFrameY = dockOpen ? frustumH * 0.135 : 0;
        smoothFrameY += (targetFrameY - smoothFrameY) * damp;

        const marginH = isExploded ? 0.56 : dockOpen ? 0.66 : 0.9;
        const marginW = isExploded ? 0.72 : 0.92;
        let planeH = frustumH * marginH;
        let planeW = planeH * imgAspect;
        if (planeW > frustumW * marginW) {
          planeW = frustumW * marginW;
          planeH = planeW / imgAspect;
        }

        pomMesh.visible = usePom;
        ldiGroup.visible = !usePom;
        stageGrid.visible = !usePom && smoothExplode > 0.12;
        stageGrid.position.y = 0;
        (stageGrid.material as THREE.LineBasicMaterial).opacity = smoothExplode * 0.24;

        if (usePom) {
          camera.position.set(0, -smoothFrameY, baseDistance + smoothDollyZ * 0.55);
          camera.fov = smoothFov;
          camera.lookAt(0, -smoothFrameY, 0);
          camera.updateProjectionMatrix();

          pomMesh.position.set(0, 0, 0);
          pomMesh.scale.set(planeW, planeH, 1);
          pomMaterial.uniforms.uParallaxOffset.value.set(smoothOffX * 2.2, smoothOffY * 2.2);
          pomMaterial.uniforms.uDepthScale.value = s.parallaxStrength;
          pomMaterial.uniforms.uConvergence.value = s.convergence;
          pomMaterial.uniforms.uDofAmount.value = isDepthEdit ? 0 : s.dofAmount;
          pomMaterial.uniforms.uChromatic.value = isDepthEdit ? 0 : s.chromaticAmount;
          pomMaterial.uniforms.uVignette.value = isDepthEdit ? 0.1 : s.vignetteAmount;
          const overlayCode =
            s.depthOverlay === 'grayscale'
              ? 1
              : s.depthOverlay === 'heatmap'
                ? 2
                : s.depthOverlay === 'split'
                  ? 3
                  : 0;
          pomMaterial.uniforms.uOverlayMode.value = overlayCode;
          pomMaterial.uniforms.uSplitX.value = 0.5 + ptr.x * 0.38;
        } else {
          // Real 3D camera orbiting & dollying across separated LDI depth planes
          const camDist = baseDistance + smoothDollyZ + smoothExplode * 0.7;
          const camX = smoothOffX * (1.25 + smoothExplode * 1.15);
          const camY = -smoothFrameY + smoothOffY * (1.05 + smoothExplode * 0.4);
          camera.position.set(camX, camY, camDist);
          camera.fov = smoothFov;
          const sep = (0.34 + s.layerSeparation * 0.55) * (1 + smoothExplode * 1.25);
          const zBg = -sep * 0.58;
          const zMid = 0.0;
          const zFg = sep * 0.58;
          const focusZ = THREE.MathUtils.lerp(zBg, zFg, s.convergence);
          camera.lookAt(0, -smoothFrameY, focusZ);
          camera.rotation.z += targetRig.roll;
          camera.updateProjectionMatrix();

          const scaleForZ = (z: number) => {
            const distFromCam = Math.max(0.5, baseDistance - z);
            const overscan = isExploded ? 1.0 : 1.06;
            return (distFromCam / baseDistance) * overscan;
          };

          const bgScale = scaleForZ(zBg);
          const midScale = scaleForZ(zMid);
          const fgScale = scaleForZ(zFg);

          bgMesh.position.set(0, 0, zBg);
          bgMesh.scale.set(planeW * bgScale, planeH * bgScale, 1);

          midMesh.position.set(0, 0, zMid);
          midMesh.scale.set(planeW * midScale, planeH * midScale, 1);

          fgMesh.position.set(0, 0, zFg);
          fgMesh.scale.set(planeW * fgScale, planeH * fgScale, 1);

          const rawHoleChecker = s.inpaintMode === 'none' ? 1 : 0;
          const updateLdiUniforms = (mat: THREE.ShaderMaterial, showChecker: number) => {
            mat.uniforms.uConvergence.value = s.convergence;
            mat.uniforms.uDofAmount.value = s.dofAmount;
            mat.uniforms.uChromatic.value = s.chromaticAmount;
            mat.uniforms.uVignette.value = s.vignetteAmount;
            mat.uniforms.uIsExploded.value = smoothExplode;
            mat.uniforms.uShowRawHoleChecker.value = showChecker;
          };
          updateLdiUniforms(bgMat, rawHoleChecker);
          updateLdiUniforms(midMat, 0);
          updateLdiUniforms(fgMat, 0);
        }

        // Atmospheric particles clipped cleanly within the image plane bounds
        const atmoMode =
          s.atmosphere === 'dust'
            ? 1
            : s.atmosphere === 'mist'
              ? 2
              : s.atmosphere === 'rain'
                ? 3
                : 0;
        particles.visible = atmoMode > 0 && !isDepthEdit && s.depthOverlay === 'final';
        if (particles.visible) {
          particleMat.uniforms.uTime.value = simTime;
          particleMat.uniforms.uMode.value = atmoMode;
          particleMat.uniforms.uBounds.value.set(planeW * 0.94, planeH * 0.92);
          particleMat.uniforms.uFrameOffsetY.value = 0;
        }
      };

      const renderNow = () => {
        renderer.render(scene, camera);
      };

      engineRef.current = {
        renderer,
        scene,
        camera,
        pomMesh,
        pomMaterial,
        ldiGroup,
        bgMesh,
        midMesh,
        fgMesh,
        bgMat,
        midMat,
        fgMat,
        stageGrid,
        particles,
        particleMat,
        textures: [blankTex],
        aspectRatio: 16 / 9,
        renderNow,
      };

      if (!isSoftwareGl) {
        renderer.compile(scene, camera);
      }

      // Software-WebGL-safe render loop using fenceSync afterDraw() per threejs skill
      let frameId = 0;
      let disposed = false;

      const afterDraw = (cb: () => void) => {
        const gl = renderer.getContext() as WebGL2RenderingContext;
        if (typeof gl.fenceSync === 'function') {
          const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
          gl.flush();
          const poll = () => {
            if (disposed) return;
            const status = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
            if (status === gl.UNSIGNALED) {
              frameId = window.setTimeout(poll, 6);
            } else {
              if (sync) gl.deleteSync(sync);
              frameId = window.setTimeout(cb, 80);
            }
          };
          frameId = window.setTimeout(poll, 6);
        } else {
          frameId = window.setTimeout(cb, 90);
        }
      };

      const tick = () => {
        if (disposed) return;
        const now = performance.now();
        const dt = Math.min(0.06, Math.max(0.001, (now - lastPerf) / 1000));
        lastPerf = now;

        updateFrame(dt);
        renderer.render(scene, camera);

        if (isSoftwareGl) {
          afterDraw(tick);
        } else {
          frameId = window.requestAnimationFrame(tick);
        }
      };

      tick();

      const resizeObserver = new ResizeObserver(() => {
        if (!container || disposed) return;
        const w = Math.max(320, container.clientWidth);
        const h = Math.max(240, container.clientHeight);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h, false);
      });
      resizeObserver.observe(container);

      return () => {
        disposed = true;
        window.cancelAnimationFrame(frameId);
        window.clearTimeout(frameId);
        resizeObserver.disconnect();
        renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
        renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);

        engineRef.current?.textures.forEach((t) => t.dispose());
        planeGeo.dispose();
        gridGeo.dispose();
        gridMat.dispose();
        particleGeo.dispose();
        particleMat.dispose();
        pomMaterial.dispose();
        bgMat.dispose();
        midMat.dispose();
        fgMat.dispose();
        renderer.dispose();
        engineRef.current = null;
      };
    }, []);

    // Upload updated HD photo + LDI + Depth CanvasTextures into the live Three.js engine without tearing down WebGL
    useEffect(() => {
      const eng = engineRef.current;
      if (!eng || !imageAssets || !ldiAssets) return;

      const maxAniso = eng.renderer.capabilities.getMaxAnisotropy();
      const makeTex = (canvas: HTMLCanvasElement, isColor: boolean) => {
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        tex.anisotropy = Math.min(4, maxAniso);
        tex.needsUpdate = true;
        return tex;
      };

      const colorTex = makeTex(imageAssets.sourceCanvas, true);
      const depthTex = makeTex(ldiAssets.depthCanvas, false);
      const bgTex = makeTex(ldiAssets.backgroundCanvas, true);
      const midTex = makeTex(ldiAssets.midgroundCanvas, true);
      const fgTex = makeTex(ldiAssets.foregroundCanvas, true);

      const oldTextures = eng.textures;
      eng.textures = [colorTex, depthTex, bgTex, midTex, fgTex];
      eng.aspectRatio = imageAssets.aspectRatio;

      const texelX = 1 / Math.max(1, imageAssets.displayWidth);
      const texelY = 1 / Math.max(1, imageAssets.displayHeight);

      eng.pomMaterial.uniforms.uColorMap.value = colorTex;
      eng.pomMaterial.uniforms.uDepthMap.value = depthTex;
      eng.pomMaterial.uniforms.uTexelSize.value.set(texelX, texelY);

      eng.bgMat.uniforms.uLayerMap.value = bgTex;
      eng.bgMat.uniforms.uDepthMap.value = depthTex;
      eng.bgMat.uniforms.uTexelSize.value.set(texelX, texelY);

      eng.midMat.uniforms.uLayerMap.value = midTex;
      eng.midMat.uniforms.uDepthMap.value = depthTex;
      eng.midMat.uniforms.uTexelSize.value.set(texelX, texelY);

      eng.fgMat.uniforms.uLayerMap.value = fgTex;
      eng.fgMat.uniforms.uDepthMap.value = depthTex;
      eng.fgMat.uniforms.uTexelSize.value.set(texelX, texelY);

      oldTextures.forEach((t) => t.dispose());
    }, [imageAssets, ldiAssets]);

    // Convert viewport pointer coords to normalized image UV (accounting for letterboxed plane & dock shift)
    const getNormalizedImageCoords = (clientX: number, clientY: number) => {
      const container = mountRef.current;
      if (!container) return null;
      const rect = container.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;

      const viewAspect = rect.width / Math.max(1, rect.height);
      const imgAspect = imageAssets?.aspectRatio ?? 16 / 9;
      const dockOpen = !dockCollapsedRef.current;
      const marginH = dockOpen ? 0.66 : 0.9;
      const marginW = 0.92;

      let imgH = rect.height * marginH;
      let imgW = imgH * imgAspect;
      if (imgW > rect.width * marginW) {
        imgW = rect.width * marginW;
        imgH = imgW / imgAspect;
      }

      const left = (rect.width - imgW) * 0.5;
      const top = (rect.height - imgH) * 0.5 - (dockOpen ? rect.height * 0.135 : 0);
      const nx = (px - left) / Math.max(1, imgW);
      const ny = (py - top) / Math.max(1, imgH);
      return { nx, ny, px, py, imgW, imgH, viewAspect };
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
      const container = mountRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const normX = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      const normY = -(((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1);
      pointerRef.current.targetX = normX;
      pointerRef.current.targetY = normY;

      if (state.activeTab === 'depth') {
        const coords = getNormalizedImageCoords(e.clientX, e.clientY);
        if (coords) {
          setBrushCursor({ x: coords.px, y: coords.py, visible: true });
          if (paintingRef.current && coords.nx >= 0 && coords.nx <= 1 && coords.ny >= 0 && coords.ny <= 1) {
            onBrushPaintRef.current(coords.nx, coords.ny, false);
          }
        }
      }
    };

    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
      if (state.activeTab !== 'depth') return;
      const coords = getNormalizedImageCoords(e.clientX, e.clientY);
      if (!coords) return;
      if (coords.nx >= 0 && coords.nx <= 1 && coords.ny >= 0 && coords.ny <= 1) {
        paintingRef.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        onBrushPaintRef.current(coords.nx, coords.ny, false);
      }
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
      if (!paintingRef.current) return;
      paintingRef.current = false;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      const coords = getNormalizedImageCoords(e.clientX, e.clientY);
      if (coords) {
        onBrushPaintRef.current(
          Math.min(1, Math.max(0, coords.nx)),
          Math.min(1, Math.max(0, coords.ny)),
          true,
        );
      }
    };

    const handlePointerLeave = () => {
      pointerRef.current.targetX = 0;
      pointerRef.current.targetY = 0;
      setBrushCursor((c) => (c.visible ? { ...c, visible: false } : c));
    };

    const brushDiameterPx = Math.max(18, Math.round(state.brushRadius * 420));

    return (
      <div
        className={`relative w-full h-full overflow-hidden bg-[#0B0D10] select-none ${
          state.activeTab === 'depth' ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'
        }`}
        data-testid="parallax-viewport"
        data-pipeline={state.pipelineMode}
        data-motion={state.motionPreset}
        data-scene={state.sceneId}
        onPointerMove={handlePointerMove}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
      >
        {/* Dedicated empty WebGL mount container isolated from React overlays */}
        <div ref={mountRef} className="w-full h-full" />

        {/* Graceful fallback if WebGL is unavailable or context lost */}
        {(webglUnavailable || contextLost) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0B0D10] p-8 text-center z-20">
            <img
              src={fallbackImageUrl}
              alt="Предпросмотр сцены"
              referrerPolicy="no-referrer"
              className="max-h-[60vh] max-w-[80vw] rounded-lg object-contain border border-white/10"
            />
            <p className="mt-4 text-sm text-[#A6AEBC]">
              {contextLost
                ? 'Контекст WebGL временно приостановлен. Восстанавливаем рендер...'
                : 'Аппаратный WebGL недоступен в этом браузере — показан статичный кадр.'}
            </p>
          </div>
        )}

        {/* Depth Brush Cursor Reticle (strictly during Depth Map sculpting tab) */}
        {state.activeTab === 'depth' && brushCursor.visible && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute z-20 rounded-full border-2"
            style={{
              width: `${brushDiameterPx}px`,
              height: `${brushDiameterPx}px`,
              left: `${brushCursor.x - brushDiameterPx / 2}px`,
              top: `${brushCursor.y - brushDiameterPx / 2}px`,
              borderColor:
                state.brushTool === 'near'
                  ? '#FFFFFF'
                  : state.brushTool === 'far'
                    ? '#60A5FA'
                    : '#E59838',
              boxShadow: '0 0 0 1px rgba(11, 13, 16, 0.85)',
            }}
          />
        )}
      </div>
    );
  },
);
