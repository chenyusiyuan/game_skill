/**
 * three-registry.js — Three.js 的素材注册表 adapter
 *
 * 实现 _common/registry.spec.js 的 createRegistry。Three.js 场景下：
 *  - images / spritesheets → THREE.Texture（TextureLoader）
 *  - 3D 模型（.glb/.gltf）→ 归入 images 段，用 GLTFLoader 加载，get 时返回 gltf.scene
 *  - audio → AudioBuffer，可由 THREE.PositionalAudio 消费
 *
 * 用法（codegen 产出的业务代码）：
 *   import { createRegistry } from './adapters/three-registry.js';
 *   import manifest from './assets.manifest.json' with { type: 'json' };
 *   const registry = await createRegistry(manifest);
 *   const tex = registry.getTexture('tile-floor');
 *   const model = registry.getTexture('hero-knight');   // .glb 也走这里
 *   const buffer = registry.getAudio('sfx-hit');
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { validateManifest, buildStats } from "../../../_common/registry.spec.js";

export async function createRegistry(manifest) {
  const check = validateManifest(manifest);
  if (!check.ok) {
    throw new Error(`[three-registry] manifest 校验失败: ${check.errors.join(" / ")}`);
  }

  const entries = new Map(); // id → { kind, value, loaded, meta? }
  const texLoader = new THREE.TextureLoader();
  const gltfLoader = new GLTFLoader();
  const audioLoader = new THREE.AudioLoader();
  const basePath = manifest.basePath.replace(/\/$/, "");

  const jobs = [];

  // ── images / 3D 模型 ──
  for (const item of manifest.images ?? []) {
    if (item.type === "local-file") {
      const url = `${basePath}/${item.src}`;
      const is3D = /\.(glb|gltf)$/i.test(item.src);
      jobs.push(
        (is3D
          ? loadGLTF(gltfLoader, url)
          : loadTexture(texLoader, url)
        )
          .then((value) => entries.set(item.id, { kind: is3D ? "model" : "texture", value, loaded: true }))
          .catch((err) => {
            console.error(`[three-registry] ${item.id} 加载失败: ${err.message}`);
            entries.set(item.id, { kind: is3D ? "model" : "texture", value: null, loaded: false });
          })
      );
    } else if (item.type === "inline-svg") {
      // 把 SVG 塞进 DataURL，作为 texture 用
      const dataUrl = "data:image/svg+xml;utf8," + encodeURIComponent(item.svg ?? "");
      jobs.push(
        loadTexture(texLoader, dataUrl)
          .then((value) => entries.set(item.id, { kind: "texture", value, loaded: true }))
          .catch(() => entries.set(item.id, { kind: "texture", value: null, loaded: false }))
      );
    } else if (item.type === "graphics-generated") {
      // 生成几何体占位，value 是一个 factory（调用时返回新 Mesh）
      entries.set(item.id, {
        kind: "factory",
        value: () => makePlaceholderMesh(item.draw ?? {}),
        loaded: true,
      });
    }
  }

  // ── spritesheets（Three.js 下即切分 UV 的单张 texture） ──
  for (const item of manifest.spritesheets ?? []) {
    if (item.type !== "local-file") continue;
    const url = `${basePath}/${item.src}`;
    jobs.push(
      loadTexture(texLoader, url)
        .then((tex) => {
          tex.magFilter = THREE.NearestFilter;
          tex.minFilter = THREE.NearestFilter;
          entries.set(item.id, {
            kind: "spritesheet",
            value: tex,
            loaded: true,
            meta: { frameWidth: item.frameWidth, frameHeight: item.frameHeight },
          });
        })
        .catch(() => entries.set(item.id, { kind: "spritesheet", value: null, loaded: false }))
    );
  }

  // ── audio ──
  for (const item of manifest.audio ?? []) {
    if (item.type === "local-file") {
      const url = `${basePath}/${item.src}`;
      jobs.push(
        new Promise((resolve) => {
          audioLoader.load(
            url,
            (buffer) => { entries.set(item.id, { kind: "audio", value: buffer, loaded: true }); resolve(); },
            undefined,
            (err) => {
              console.error(`[three-registry] audio ${item.id} 加载失败: ${err?.message}`);
              entries.set(item.id, { kind: "audio", value: null, loaded: false });
              resolve();
            }
          );
        })
      );
    } else if (item.type === "synthesized") {
      entries.set(item.id, { kind: "audio-synth", value: item.params ?? {}, loaded: true });
    }
  }

  await Promise.all(jobs);

  return {
    getTexture(id) {
      const e = entries.get(id);
      if (!e) { console.warn(`[three-registry] missing id: ${id}`); return null; }
      if (e.kind === "factory") return e.value(); // 每次取占位都 new 一个 Mesh
      return e.value;
    },
    getSpritesheet(id) {
      const e = entries.get(id);
      if (!e || e.kind !== "spritesheet") {
        console.warn(`[three-registry] not a spritesheet: ${id}`);
        return null;
      }
      return e.value && { texture: e.value, ...e.meta };
    },
    getAudio(id) {
      const e = entries.get(id);
      if (!e) { console.warn(`[three-registry] missing audio: ${id}`); return null; }
      return e.value;
    },
    has(id) { return entries.has(id); },
    stats() { return buildStats(entries); },
  };
}

function loadTexture(loader, url) {
  return new Promise((resolve, reject) => {
    loader.load(url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      resolve(tex);
    }, undefined, reject);
  });
}

function loadGLTF(loader, url) {
  return new Promise((resolve, reject) => {
    loader.load(url, (gltf) => resolve(gltf.scene), undefined, reject);
  });
}

function makePlaceholderMesh(draw) {
  const color = parseColor(draw.color ?? "#60a5fa");
  const shape = draw.shape ?? "box";
  let geo;
  switch (shape) {
    case "sphere":   geo = new THREE.SphereGeometry(draw.radius ?? 0.5, 16, 12); break;
    case "cylinder": geo = new THREE.CylinderGeometry(draw.radius ?? 0.5, draw.radius ?? 0.5, draw.height ?? 1, 16); break;
    default:         geo = new THREE.BoxGeometry(draw.width ?? 1, draw.height ?? 1, draw.depth ?? 1);
  }
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color }));
}

function parseColor(c) {
  if (typeof c === "number") return c;
  return new THREE.Color(c).getHex();
}
