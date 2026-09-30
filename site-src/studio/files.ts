/**
 * Fichiers de l'utilisateur (logo, polices importées) : gardés en mémoire pour la session, et
 * dans IndexedDB quand il répond. Ils ne sont envoyés nulle part.
 */

import { storage } from './storage.js';
import { store } from './store.js';

const memory = new Map<string, Uint8Array>();

export async function putFile(key: string, bytes: Uint8Array): Promise<void> {
  memory.set(key, bytes);
  if (store.get().ui.storage === 'ok') await storage.setFile(key, bytes).catch(() => undefined);
}

export async function getFile(key: string): Promise<Uint8Array | undefined> {
  const cached = memory.get(key);
  if (cached) return cached;
  if (store.get().ui.storage !== 'ok') return undefined;
  const bytes = await storage.getFile(key).catch(() => undefined);
  if (bytes) memory.set(key, bytes);
  return bytes;
}

/** Charge une image dans un `<img>`, pour la redessiner sur un canvas. */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('image illisible'));
    image.src = url;
  });
}

/**
 * Prépare un logo pour le PDF : un SVG est rastérisé en PNG (pdf-lib n'embarque que PNG et JPEG),
 * une image démesurée est réduite, et tout sort en PNG 8 bits ou en JPEG — des formats que
 * PDF/A accepte sans discussion. La transparence est conservée.
 */
export async function normalizeLogo(
  file: File,
): Promise<{ bytes: Uint8Array; type: 'png' | 'jpeg' }> {
  const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
  const isJpeg = file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name);
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const natural = { width: image.naturalWidth || 600, height: image.naturalHeight || 300 };
    // 120 points de haut au plus sur la page, à 4 pixels par point : bien assez pour l'impression.
    const maxHeight = 480;
    const ratio = natural.width / natural.height;
    const height = isSvg ? maxHeight : Math.min(natural.height, maxHeight);
    const width = Math.round(height * ratio);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, Math.round(height));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas indisponible');
    if (isJpeg) {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const type = isJpeg ? 'jpeg' : 'png';
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, isJpeg ? 'image/jpeg' : 'image/png', 0.92),
    );
    if (!blob) throw new Error('conversion impossible');
    return { bytes: new Uint8Array(await blob.arrayBuffer()), type };
  } finally {
    URL.revokeObjectURL(url);
  }
}
