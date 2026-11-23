import type { StudioScenePreset, TechniqueGuideItem } from './types';

export const STUDIO_SCENES: StudioScenePreset[] = [
  {
    id: 'alpine-explorer',
    title: 'Альпийский хребет',
    category: 'Пейзаж · 3 плана',
    imageUrl: '/src/assets/images/scene_alpine_explorer_1795441215104.jpg',
    aspectRatio: 16 / 9,
    defaultMotion: 'orbit',
    defaultAtmosphere: 'mist',
    defaultConvergence: 0.52,
    defaultForegroundCut: 0.66,
    defaultMidgroundCut: 0.34,
    cinematographyNote:
      'Силуэт альпиниста и базальтовый выступ отделяются на передний LDI-слой, а зона неба и гор за фигурой восстанавливается многопроходным инпейнтингом.',
    blueprint: {
      horizonY: 0.36,
      groundSlope: 0.42,
      edgeWeight: 0.16,
      regions: [
        // Sky & distant golden peaks
        { label: 'Небо и дальние вершины', layer: 'background', shape: 'rect', cx: 0.5, cy: 0.16, rx: 0.55, ry: 0.22, depth: 0.08, softness: 0.14 },
        // Glacial valley midground
        { label: 'Ледниковая долина', layer: 'midground', shape: 'ellipse', cx: 0.44, cy: 0.56, rx: 0.28, ry: 0.24, depth: 0.36, softness: 0.14 },
        // Right midground jagged ridge
        { label: 'Средний хребет справа', layer: 'midground', shape: 'ellipse', cx: 0.84, cy: 0.48, rx: 0.22, ry: 0.20, depth: 0.52, softness: 0.1 },
        // Left foreground dark basalt cliff
        { label: 'Левая скала переднего плана', layer: 'foreground', shape: 'ellipse', cx: 0.08, cy: 0.72, rx: 0.20, ry: 0.42, depth: 0.92, softness: 0.08 },
        // Right foreground rock ledge
        { label: 'Базальтовый выступ', layer: 'foreground', shape: 'ellipse', cx: 0.76, cy: 0.88, rx: 0.34, ry: 0.28, depth: 0.94, softness: 0.08 },
        // Mountaineer body & backpack
        { label: 'Альпинист', layer: 'foreground', shape: 'ellipse', cx: 0.66, cy: 0.50, rx: 0.065, ry: 0.18, depth: 0.89, softness: 0.035 },
      ],
    },
  },
  {
    id: 'kyoto-shrine',
    title: 'Храм Киото',
    category: 'Архитектура · Сумерки',
    imageUrl: '/src/assets/images/scene_kyoto_shrine_1795441166722.jpg',
    aspectRatio: 16 / 9,
    defaultMotion: 'dolly-zoom',
    defaultAtmosphere: 'dust',
    defaultConvergence: 0.56,
    defaultForegroundCut: 0.68,
    defaultMidgroundCut: 0.36,
    cinematographyNote:
      'Долли-зум фиксирует красный мост на плоскости конвергенции, тогда как каменный фонарь и клён на переднем плане эффектно выдвигаются к камере.',
    blueprint: {
      horizonY: 0.28,
      groundSlope: 0.48,
      edgeWeight: 0.14,
      regions: [
        { label: 'Сумеречное небо и горы', layer: 'background', shape: 'rect', cx: 0.5, cy: 0.14, rx: 0.55, ry: 0.18, depth: 0.09, softness: 0.12 },
        { label: 'Храм в глубине', layer: 'background', shape: 'ellipse', cx: 0.68, cy: 0.36, rx: 0.16, ry: 0.14, depth: 0.25, softness: 0.08 },
        { label: 'Красный мост', layer: 'midground', shape: 'ellipse', cx: 0.64, cy: 0.57, rx: 0.22, ry: 0.12, depth: 0.55, softness: 0.07 },
        { label: 'Каменная дорожка', layer: 'midground', shape: 'ellipse', cx: 0.74, cy: 0.85, rx: 0.24, ry: 0.22, depth: 0.72, softness: 0.1 },
        { label: 'Каменный фонарь', layer: 'foreground', shape: 'ellipse', cx: 0.25, cy: 0.60, rx: 0.12, ry: 0.42, depth: 0.93, softness: 0.045 },
        { label: 'Кленовая листва слева', layer: 'foreground', shape: 'ellipse', cx: 0.08, cy: 0.42, rx: 0.16, ry: 0.48, depth: 0.96, softness: 0.07 },
        { label: 'Ветви справа', layer: 'foreground', shape: 'ellipse', cx: 0.94, cy: 0.36, rx: 0.14, ry: 0.32, depth: 0.84, softness: 0.07 },
      ],
    },
  },
  {
    id: 'neon-rain-alley',
    title: 'Дождливый переулок',
    category: 'Ночной город · Перспектива',
    imageUrl: '/src/assets/images/scene_neon_rain_alley_1795441169243.jpg',
    aspectRatio: 16 / 9,
    defaultMotion: 'ken-burns',
    defaultAtmosphere: 'rain',
    defaultConvergence: 0.48,
    defaultForegroundCut: 0.65,
    defaultMidgroundCut: 0.32,
    cinematographyNote:
      'Глубокая центральная перспектива переулка идеально раскрывается при медленном наезде (Push-In) с 3D-каплями дождя между фонарём и дальней дымкой.',
    blueprint: {
      horizonY: 0.48,
      groundSlope: 0.45,
      edgeWeight: 0.15,
      regions: [
        { label: 'Туманные небоскрёбы', layer: 'background', shape: 'ellipse', cx: 0.53, cy: 0.32, rx: 0.18, ry: 0.34, depth: 0.08, softness: 0.1 },
        { label: 'Мокрый асфальт', layer: 'midground', shape: 'ellipse', cx: 0.56, cy: 0.84, rx: 0.32, ry: 0.22, depth: 0.58, softness: 0.12 },
        { label: 'Витрины справа', layer: 'midground', shape: 'rect', cx: 0.88, cy: 0.42, rx: 0.16, ry: 0.45, depth: 0.60, softness: 0.09 },
        { label: 'Кирпичная стена и велосипед', layer: 'foreground', shape: 'rect', cx: 0.16, cy: 0.55, rx: 0.20, ry: 0.52, depth: 0.91, softness: 0.06 },
        { label: 'Бумажный фонарь', layer: 'foreground', shape: 'ellipse', cx: 0.27, cy: 0.23, rx: 0.07, ry: 0.16, depth: 0.96, softness: 0.035 },
      ],
    },
  },
  {
    id: 'botanical-atelier',
    title: 'Ателье у окна',
    category: 'Интерьер · Предметка',
    imageUrl: '/src/assets/images/scene_botanical_atelier_1795441167857.jpg',
    aspectRatio: 16 / 9,
    defaultMotion: 'truck',
    defaultAtmosphere: 'dust',
    defaultConvergence: 0.58,
    defaultForegroundCut: 0.66,
    defaultMidgroundCut: 0.35,
    cinematographyNote:
      'Горизонтальный проезд камеры (Truck) создаёт ощутимый объём между вазой с оливой на столе, мольбертом в центре и средиземноморскими крышами за окном.',
    blueprint: {
      horizonY: 0.42,
      groundSlope: 0.44,
      edgeWeight: 0.16,
      regions: [
        { label: 'Пейзаж за аркой окна', layer: 'background', shape: 'ellipse', cx: 0.86, cy: 0.28, rx: 0.16, ry: 0.32, depth: 0.08, softness: 0.06 },
        { label: 'Шторы и стол в глубине', layer: 'midground', shape: 'rect', cx: 0.46, cy: 0.38, rx: 0.24, ry: 0.34, depth: 0.42, softness: 0.1 },
        { label: 'Мольберт и табурет', layer: 'midground', shape: 'ellipse', cx: 0.69, cy: 0.56, rx: 0.14, ry: 0.42, depth: 0.62, softness: 0.05 },
        { label: 'Дубовый верстак', layer: 'foreground', shape: 'rect', cx: 0.26, cy: 0.86, rx: 0.34, ry: 0.20, depth: 0.94, softness: 0.06 },
        { label: 'Керамическая ваза и ветви', layer: 'foreground', shape: 'ellipse', cx: 0.24, cy: 0.52, rx: 0.17, ry: 0.38, depth: 0.92, softness: 0.05 },
      ],
    },
  },
];

export const PRO_TECHNIQUES: TechniqueGuideItem[] = [
  {
    id: 'ldi-inpainting',
    index: '01',
    title: 'Layered Depth Images (LDI) и заполнение скрытых зон',
    industryTools: 'After Effects 3D · Photoshop Generative Fill · 3D Photo Inpainting',
    summary:
      'Главный враг 2.5D-анимации — «резиновое растяжение» пикселей по краям объектов при смещении камеры. Профессионалы разрезают кадр на независимые Z-слои и дорисовывают фон позади вырезанного объекта.',
    howItWorks:
      'Карта глубины сегментируется на Передний, Средний и Дальний планы с мягкой растушёвкой. Пиксели позади переднего объекта помечаются как зона дисокклюзии (разрыв) и заполняются многопроходным алгоритмом диффузии строго из соседних фоновых пикселей, исключая попадание цвета переднего плана.',
    proTip:
      'Откройте режим «3D Разбор слоёв» и сравните «Многопроходный Inpaint» с выключенным заполнением, чтобы увидеть реальные пустоты дисокклюзии.',
    applyPatch: {
      activeTab: 'layers',
      pipelineMode: 'exploded',
      inpaintMode: 'multipass',
      layerSeparation: 0.72,
    },
  },
  {
    id: 'pom-raymarching',
    index: '02',
    title: 'Parallax Occlusion Mapping (POM) — лучевой шейдер',
    industryTools: 'DepthFlow · Immersity AI (LeiaPix) · GLSL Shaders',
    summary:
      'Вместо грубой деформации сетки профессиональные real-time движки используют пошаговую трассировку луча (Raymarching) по карте высот прямо во фрагментном шейдере.',
    howItWorks:
      'Для каждого пикселя луч смещается вдоль вектора взгляда камеры в несколько шагов до пересечения с поверхностью карты глубины, затем выполняется бинарное уточнение границы. Это сохраняет резкие края объектов без артефактов полигональной сетки.',
    proTip:
      'Идеально для мягких непрерывных поверхностей (дорожки, ландшафт, интерьеры) при умеренной амплитуде параллакса.',
    applyPatch: {
      activeTab: 'scene',
      pipelineMode: 'pom',
      motionPreset: 'orbit',
      parallaxStrength: 0.62,
    },
  },
  {
    id: 'convergence-plane',
    index: '03',
    title: 'Плоскость конвергенции (Zero-Parallax / Focus Plane)',
    industryTools: 'Nuke · DepthFlow · Stereoscopic Cinema',
    summary:
      'Регулирует глубину, которая остаётся неподвижной при движении камеры. Всё, что ближе этой плоскости, движется в одну сторону; всё, что дальше — в противоположную.',
    howItWorks:
      'Формула смещения (depth - convergence) * cameraOffset фиксирует главный смысловой объект (например, героя или мост) в центре внимания зрителя, снижая усталость глаз и усиливая ощущение физического пространства.',
    proTip:
      'В сочетании с Depth-of-Field (боке по глубине) фокус автоматически привязывается к плоскости конвергенции, как у реального кинообъектива.',
    applyPatch: {
      activeTab: 'scene',
      pipelineMode: 'ldi',
      dofAmount: 0.58,
      convergence: 0.58,
      motionPreset: 'truck',
    },
  },
  {
    id: 'dolly-zoom',
    index: '04',
    title: 'Киноэффект Долли-зум (Эффект Вертиго)',
    industryTools: 'Кинематограф · After Effects Camera Rig · Blender',
    summary:
      'Камера физически приближается к объекту по оси Z, одновременно расширяя угол обзора (FOV) так, чтобы размер главного объекта оставался постоянным, а фон драматически «растягивался» вглубь.',
    howItWorks:
      'Угол обзора пересчитывается каждый кадр по оптической формуле FOV = 2 · atan(H / (2 · D)), поддерживая постоянный масштаб плоскости фокуса при изменении дистанции камеры D.',
    proTip:
      'Эффектнее всего работает на сценах с глубокой перспективой: «Храм Киото» или «Дождливый переулок».',
    applyPatch: {
      activeTab: 'scene',
      pipelineMode: 'ldi',
      motionPreset: 'dolly-zoom',
      parallaxStrength: 0.75,
    },
  },
  {
    id: 'depth-sculpting',
    index: '05',
    title: 'Ручная доработка карты глубины и 3D-атмосфера',
    industryTools: 'Photoshop Depth Pass · MiDaS / Depth Anything · Trapcode Particular',
    summary:
      'Даже лучшие нейросети ошибаются на стекле, отражениях и тонких ветках. В продакшене карту глубины всегда дорабатывают мягкой кистью и добавляют 3D-частицы между слоями.',
    howItWorks:
      'Переключитесь на «Карту глубины» в режиме теплокарты, чтобы выявить перепады, аккуратно подкрасьте близкие объекты белым (Ближе) или дальние чёрным (Дальше) и добавьте 3D-пыль или туман, пролетающий между слоями.',
    proTip:
      'После правки кистью LDI-слои и заполнение фона (Inpaint) автоматически пересчитываются под новый контур.',
    applyPatch: {
      activeTab: 'depth',
      depthOverlay: 'heatmap',
      atmosphere: 'dust',
    },
  },
];
