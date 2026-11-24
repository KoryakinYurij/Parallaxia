import { parseAndValidateSceneManifest } from '../engine/depthPipeline';
import type { StudioScenePreset } from '../engine/types';

/**
 * Auto-discovers every declarative scene manifest dropped into src/scenes/*.json.
 * Adding a new 2.5D scene in future sessions requires ZERO TypeScript edits:
 * simply save an image in src/assets/images/ and drop a JSON manifest in src/scenes/.
 */
const sceneModules = import.meta.glob<{ default: unknown }>('./*.json', { eager: true });

export const STUDIO_SCENES: StudioScenePreset[] = Object.entries(sceneModules)
  .map(([filePath, mod]) => {
    const raw = (mod && typeof mod === 'object' && 'default' in mod ? mod.default : mod) as unknown;
    const result = parseAndValidateSceneManifest(raw);
    if (!result.ok) {
      console.warn(`[Parallaxia registry] Skipped invalid manifest ${filePath}: ${result.error}`);
      return null;
    }
    return result.manifest;
  })
  .filter((item): item is StudioScenePreset => item !== null)
  .sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.id.localeCompare(b.id));
