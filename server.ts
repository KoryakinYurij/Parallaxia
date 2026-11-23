import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

function createGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '16mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.post('/api/analyze-scene', async (req, res) => {
    try {
      const { imageBase64, mimeType } = req.body as {
        imageBase64?: unknown;
        mimeType?: unknown;
      };

      if (typeof imageBase64 !== 'string' || imageBase64.length < 32) {
        res.status(400).json({ error: 'Некорректные данные изображения.' });
        return;
      }

      const safeMime =
        typeof mimeType === 'string' && /^image\/(png|jpeg|jpg|webp)$/i.test(mimeType)
          ? mimeType
          : 'image/jpeg';

      const ai = createGeminiClient();
      if (!ai) {
        res.status(503).json({
          error:
            'Сервис AI-анализа глубины недоступен: не задан ключ GEMINI_API_KEY в настройках окружения. Вы можете использовать локальный генератор карты глубины и ручную кисть.',
        });
        return;
      }

      const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');

      const prompt = `Ты — ведущий VFX-композитор и технический директор 2.5D-анимации (After Effects, Nuke, DepthFlow, LDI).
Проанализируй это изображение и разложи его на пространственные зоны глубины для создания 2.5D параллакса.
Координаты нормализованы от 0 до 1 (x=0 слева, x=1 справа; y=0 сверху, y=1 снизу).
Глубина depth от 0.0 (самый дальний фон, небо/горизонт) до 1.0 (самый близкий объект переднего плана).
Выдели от 4 до 9 ключевых пространственных областей (объекты переднего плана, средний план, плоскость земли/пола, фон).
Также порекомендуй лучший пресет камеры (orbit | dolly-zoom | truck | ken-burns | breathe) и атмосферу (none | dust | mist | rain), а также короткую профессиональную рекомендацию на русском (1-2 предложения) по 2.5D-анимации именно этого кадра.`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: safeMime,
                data: cleanBase64,
              },
            },
            { text: prompt },
          ],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING, description: 'Короткое название сцены на русском (2-4 слова)' },
              horizonY: { type: Type.NUMBER, description: 'Нормализованная линия горизонта от 0.1 до 0.85' },
              recommendedMotion: {
                type: Type.STRING,
                description: 'Один из: orbit, dolly-zoom, truck, ken-burns, breathe',
              },
              recommendedAtmosphere: {
                type: Type.STRING,
                description: 'Один из: none, dust, mist, rain',
              },
              recommendedFocus: {
                type: Type.NUMBER,
                description: 'Рекомендуемая плоскость конвергенции (0.2..0.85)',
              },
              cinematographyNote: {
                type: Type.STRING,
                description: 'Краткий профессиональный совет по 2.5D параллаксу для этого кадра на русском',
              },
              regions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    label: { type: Type.STRING },
                    layer: { type: Type.STRING, description: 'foreground, midground, или background' },
                    shape: { type: Type.STRING, description: 'ellipse или rect' },
                    cx: { type: Type.NUMBER },
                    cy: { type: Type.NUMBER },
                    rx: { type: Type.NUMBER },
                    ry: { type: Type.NUMBER },
                    depth: { type: Type.NUMBER },
                    softness: { type: Type.NUMBER },
                  },
                },
              },
            },
          },
        },
      });

      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        res.status(502).json({ error: 'Модель вернула пустой ответ при анализе глубины.' });
        return;
      }

      const parsed = JSON.parse(rawText);
      res.json({ analysis: parsed });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ошибка анализа сцены';
      console.error('[/api/analyze-scene] error:', message);
      res.status(500).json({
        error: `Не удалось выполнить AI-анализ сцены: ${message}`,
      });
    }
  });

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Parallaxia server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
