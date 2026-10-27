"use client";

import { useLoader } from "@react-three/fiber";
import { useMemo } from "react";
import { RepeatWrapping, SRGBColorSpace, TextureLoader, type Group, type Mesh, type Object3D, type Texture } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

/**
 * The office's downloaded assets (Poly Haven, CC0), served from /office:
 * models (glb, meshopt + webp), floor and wall textures, the lighting map.
 */
export const ASSETS = "/office";

export type ModelName = "potted_plant_02" | "potted_plant_04" | "ArmChair_01" | "coffee_table_round_01";

/** Poly Haven models are in metres; one floor tile is about 0.7 m. */
export const METRE = 1 / 0.7;

function withMeshopt(loader: GLTFLoader) {
  loader.setMeshoptDecoder(MeshoptDecoder);
}

/** A model, cloned for each use (geometry and materials are shared). */
export function useModel(name: ModelName): Group {
  const gltf = useLoader(GLTFLoader, `${ASSETS}/models/${name}.glb`, withMeshopt);
  return useMemo(() => {
    const g = gltf.scene.clone(true);
    g.traverse((o: Object3D) => {
      const m = o as Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    return g;
  }, [gltf]);
}

/** Colour, normal and roughness maps of a Poly Haven texture, repeating every `tile` units. */
export function useSurface(name: "laminate_floor_02" | "white_plaster_02") {
  const [color, normal, rough] = useLoader(TextureLoader, [`${ASSETS}/tex/${name}_color.jpg`, `${ASSETS}/tex/${name}_normal.jpg`, `${ASSETS}/tex/${name}_rough.jpg`]);
  return useMemo(() => {
    for (const t of [color, normal, rough] as Texture[]) {
      t.wrapS = t.wrapT = RepeatWrapping;
      t.anisotropy = 8;
    }
    color!.colorSpace = SRGBColorSpace;
    return { map: color!, normalMap: normal!, roughnessMap: rough! };
  }, [color, normal, rough]);
}
