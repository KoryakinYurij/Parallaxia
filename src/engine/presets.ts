import { STUDIO_SCENES } from '../scenes/registry';
import type { TechniqueGuideItem } from './types';

export { STUDIO_SCENES };

export const PRO_TECHNIQUES: TechniqueGuideItem[] = [
  {
    id: 'hybrid-pom-inpaint',
    index: '01',
    title: 'Гибрид 2.5D: лучевой шейдер (POM) + Inpainting разрывов',
    industryTools: 'DepthFlow · Immersity AI (LeiaPix) · 3D Photo Inpainting',
    summary:
      'Чистое нарезание фото на 3 плоские карточки рвёт непрерывные поверхности (полы, столы, стены), а обычный шейдер глубины без инпейнтинга «растягивает» края объектов как резину. Профессиональное решение объединяет оба подхода.',
    howItWorks:
      'Фрагментный шейдер выполняет пошаговый raymarching по непрерывной карте глубины (отфильтрованной 3-канальным RGB Guided Image Filter), а при обнаружении резкого перепада на переднем плане плавно подмешивает восстановленный фон.',
    proTip:
      'Это основной режим студии: полы и столы двигаются в плавной перспективе, а края ваз, фонарей и фигур остаются чистыми без резиновых артефактов.',
    applyPatch: {
      activeTab: 'scene',
      pipelineMode: 'pom',
      inpaintMode: 'multipass',
      parallaxStrength: 0.6,
    },
  },
  {
    id: 'clean-plate-ldi',
    index: '02',
    title: 'Clean Plate (чистый фон) и LDI 3D-разбор слоёв',
    industryTools: 'After Effects 3D · Photoshop Generative Fill · Nuke Projections',
    summary:
      'Для сложных структурированных фонов позади вырезанного объекта (окна, книги, кирпич) профессионалы используют реальный Clean Plate — фоновый кадр с генеративно удалённым объектом переднего плана.',
    howItWorks:
      'Если для сцены загружен Clean Plate (через манифест JSON или вкладку «Слои и Inpaint»), студия автоматически подставляет чёткие HD-пиксели чистого фона внутрь маски дисокклюзии вместо размытой диффузии.',
    proTip:
      'Откройте «3D Разбор слоёв» и переключите «Выкл. (показать разрывы)», чтобы точно оценить масштаб скрытых зон за объектами.',
    applyPatch: {
      activeTab: 'layers',
      pipelineMode: 'exploded',
      inpaintMode: 'multipass',
      layerSeparation: 0.65,
    },
  },
  {
    id: 'convergence-plane',
    index: '03',
    title: 'Плоскость конвергенции (Zero-Parallax) и кино-боке DoF',
    industryTools: 'Nuke · DepthFlow · Stereoscopic Cinema',
    summary:
      'Определяет глубину, которая остаётся визуально неподвижной при движении камеры. Всё ближе неё смещается в одну сторону, всё дальше — в противоположную.',
    howItWorks:
      'Формула (depth - convergence) * cameraOffset фиксирует главный объект (вазу, мост или альпиниста) в центре внимания, а глубина резкости (DoF) мягко размывает планы пропорционально удалению от этой плоскости.',
    proTip:
      'Подберите ползунок «Фокус (Конвергенция)» под главный объект кадра и добавьте 30–50% DoF для кинематографического объёма.',
    applyPatch: {
      activeTab: 'scene',
      pipelineMode: 'pom',
      dofAmount: 0.45,
      convergence: 0.56,
      motionPreset: 'truck',
    },
  },
  {
    id: 'dolly-zoom',
    index: '04',
    title: 'Киноэффект Долли-зум (Эффект Вертиго)',
    industryTools: 'Кинематограф · After Effects Camera Rig · Blender',
    summary:
      'Камера физически приближается по оси Z, одновременно расширяя угол обзора FOV так, чтобы масштаб главного объекта на плоскости фокуса оставался неизменным, а пространство за ним драматически «дышало».',
    howItWorks:
      'Каждый кадр вычисляется оптическая компенсация FOV = 2 · atan(H / (2 · D)), сохраняя неизменную ширину кадра на фокусной дистанции D.',
    proTip:
      'Наиболее выразительно работает на сценах с глубокой перспективой: «Храм Киото» или «Дождливый переулок».',
    applyPatch: {
      activeTab: 'scene',
      pipelineMode: 'pom',
      motionPreset: 'dolly-zoom',
      parallaxStrength: 0.72,
    },
  },
  {
    id: 'guided-depth-sculpting',
    index: '05',
    title: 'RGB Guided Filter, внешние карты глубины и ручная кисть',
    industryTools: 'Depth Anything V2 · Blender Z-Pass · He et al. Guided Filter',
    summary:
      'Вы можете загрузить готовую Ч/Б карту глубины из внешней нейросети или 3D-рендера, автоматически выровнять её по контурам фотографии через RGB Guided Filter и точечно доработать кистью.',
    howItWorks:
      '3-канальный RGB Guided Image Filter анализирует локальную дисперсию по R, G и B каналам фотографии и притягивает границы глубины точно к контурам любого цвета (листва, одежда, стекло, архитектура).',
    proTip:
      'Включите «Теплокарту» во вкладке «Карта глубины» — белый/жёлтый ближе к камере, синий/фиолетовый дальше — или импортируйте готовую PNG-карту кнопкой «Карта PNG».',
    applyPatch: {
      activeTab: 'depth',
      depthOverlay: 'heatmap',
    },
  },
];
