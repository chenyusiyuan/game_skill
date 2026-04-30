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
import { validateManifest, buildStats } from "../_common/registry.spec.js";
import { recordAssetUsage, recordAssetRenderEvidence } from "../_common/asset-usage.js";

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
  const manifestImageById = new Map((manifest.images ?? []).map((it) => [it.id, it]));
  const manifestSheetById = new Map((manifest.spritesheets ?? []).map((it) => [it.id, it]));
  const manifestAudioById = new Map((manifest.audio ?? []).map((it) => [it.id, it]));

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

  function recordThreeObject(id, object, opts = {}) {
    const manifestItem = opts.section === "spritesheets"
      ? manifestSheetById.get(id)
      : manifestImageById.get(id);
    const width = Number(opts.width ?? Math.abs(object?.scale?.x ?? 1));
    const height = Number(opts.height ?? Math.abs(object?.scale?.y ?? 1));
    const visible = opts.visible ?? object?.visible !== false;
    recordAssetRenderEvidence({
      id,
      section: opts.section ?? "images",
      kind: opts.kind ?? "three-object3d",
      manifestItem,
      slotId: opts.slotId ?? null,
      entityId: opts.entityId ?? null,
      semanticSlot: opts.semanticSlot ?? null,
      renderZone: opts.renderZone ?? null,
      x: opts.x ?? object?.position?.x ?? null,
      y: opts.y ?? object?.position?.y ?? null,
      width,
      height,
      visible,
      source: opts.source ?? "three-registry.recordObject",
      extra: opts.extra ?? null,
    });
  }

  function applyObjectOptions(object, opts = {}) {
    if (!object) return object;
    if (object.position) {
      if (Number.isFinite(Number(opts.x))) object.position.x = Number(opts.x);
      if (Number.isFinite(Number(opts.y))) object.position.y = Number(opts.y);
      if (Number.isFinite(Number(opts.z))) object.position.z = Number(opts.z);
    }
    if (object.scale) {
      if (Number.isFinite(Number(opts.width))) object.scale.x = Number(opts.width);
      if (Number.isFinite(Number(opts.height))) object.scale.y = Number(opts.height);
      if (Number.isFinite(Number(opts.depth))) object.scale.z = Number(opts.depth);
    }
    if (typeof opts.visible === "boolean") object.visible = opts.visible;
    return object;
  }

  function objectForValue(value, opts = {}) {
    if (!value) return null;
    if (typeof value.clone === "function" && value.isObject3D) return value.clone(true);
    if (value.isTexture) {
      if (opts.as === "mesh") {
        return new THREE.Mesh(
          new THREE.PlaneGeometry(1, 1),
          new THREE.MeshBasicMaterial({ map: value, transparent: true }),
        );
      }
      return new THREE.Sprite(new THREE.SpriteMaterial({ map: value, transparent: true }));
    }
    if (value.isObject3D) return value;
    return null;
  }

  function getTexture(id, extra = null) {
      const e = entries.get(id);
      if (!e) { console.warn(`[three-registry] missing id: ${id}`); return null; }
      recordAssetUsage({
        id,
        section: "images",
        kind: e.kind === "model" ? "model" : "texture",
        manifestItem: manifestImageById.get(id),
        extra,
      });
      if (e.kind === "factory") return e.value(); // 每次取占位都 new 一个 Mesh
      return e.value;
  }

  function getSpritesheet(id, extra = null) {
      const e = entries.get(id);
      if (!e || e.kind !== "spritesheet") {
        console.warn(`[three-registry] not a spritesheet: ${id}`);
        return null;
      }
      recordAssetUsage({
        id,
        section: "spritesheets",
        kind: "spritesheet",
        manifestItem: manifestSheetById.get(id),
        extra,
      });
      return e.value && { texture: e.value, ...e.meta };
  }

  function getAudio(id, extra = null) {
      const e = entries.get(id);
      if (!e) { console.warn(`[three-registry] missing audio: ${id}`); return null; }
      recordAssetUsage({
        id,
        section: "audio",
        kind: "audio",
        manifestItem: manifestAudioById.get(id),
        extra,
      });
      return e.value;
  }

  return {
    getTexture,
    getSpritesheet,
    getAudio,
    addObject(scene, id, opts = {}) {
      const value = getTexture(id, opts.extra ?? null);
      const object = applyObjectOptions(objectForValue(value, opts), opts);
      if (!object) return null;
      if (scene && typeof scene.add === "function") scene.add(object);
      recordThreeObject(id, object, {
        ...opts,
        source: opts.source ?? "three-registry.addObject",
      });
      return object;
    },
    recordObject(id, object, opts = {}) {
      recordThreeObject(id, object, opts);
      return object;
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
