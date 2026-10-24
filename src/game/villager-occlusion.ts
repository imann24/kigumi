import * as THREE from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import {
  BUILDING_OCCLUDER_LAYER,
  VILLAGER_SILHOUETTE_LAYER,
} from "./occlusion-layers";

const vertexShader = /* glsl */ `
  #include <common>
  #include <batching_pars_vertex>
  void main() {
    #include <batching_vertex>
    #include <begin_vertex>
    #include <project_vertex>
  }
`;

function maskTarget() {
  return new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType),
  });
}

/** Scene-owned screen-space effect. Borrows live geometry; owns only GPU passes. */
export class VillagerOcclusion {
  private surface = maskTarget();
  private villagers = maskTarget();
  private size = new THREE.Vector2();
  private buildingLayer = new THREE.Layers();
  private mask = new THREE.ShaderMaterial({
    uniforms: { building: { value: 0 } },
    vertexShader,
    fragmentShader: /* glsl */ `
      uniform float building;
      void main() { gl_FragColor = vec4(building, 0.0, 0.0, 1.0); }
    `,
    blending: THREE.NoBlending,
  });
  private outline = new THREE.ShaderMaterial({
    uniforms: {
      surface: { value: this.surface.texture },
      surfaceDepth: { value: this.surface.depthTexture },
      villagerDepth: { value: this.villagers.depthTexture },
      texel: { value: new THREE.Vector2() },
      width: { value: 1 },
      ink: { value: new THREE.Color("#625540") },
      ivory: { value: new THREE.Color("#f4ddb0") },
    },
    vertexShader: /* glsl */ `
      varying vec2 uvScreen;
      void main() {
        uvScreen = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D surface, surfaceDepth, villagerDepth;
      uniform vec2 texel;
      uniform float width;
      uniform vec3 ink, ivory;
      varying vec2 uvScreen;
      float outside(vec2 offset) {
        return step(0.999999, texture2D(villagerDepth, uvScreen + offset).r);
      }
      float edge(float radius) {
        vec2 d = texel * radius;
        return max(max(max(outside(vec2(d.x, 0.0)), outside(vec2(-d.x, 0.0))),
                       max(outside(vec2(0.0, d.y)), outside(vec2(0.0, -d.y)))),
                   max(max(outside(d * 0.7071), outside(-d * 0.7071)),
                       max(outside(vec2(d.x, -d.y) * 0.7071), outside(vec2(-d.x, d.y) * 0.7071))));
      }
      void main() {
        float person = texture2D(villagerDepth, uvScreen).r;
        // Only paint pixels whose nearest opaque scene surface is a building.
        // Terrain/resources/visible villagers therefore veto an x-ray here.
        if (person >= 0.999999 || texture2D(surface, uvScreen).r < 0.5 ||
            texture2D(surfaceDepth, uvScreen).r + 0.00001 >= person) discard;
        if (edge(width * 2.0) < 0.5) discard;
        gl_FragColor = vec4(mix(ivory, ink, edge(width * 0.75)), 0.95);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  private quad = new FullScreenQuad(this.outline);

  constructor() {
    this.buildingLayer.set(BUILDING_OCCLUDER_LAYER);
    this.mask.onBeforeRender = (
      _renderer,
      _scene,
      _camera,
      _geometry,
      object,
    ) => {
      this.mask.uniforms.building.value = object.layers.test(this.buildingLayer)
        ? 1
        : 0;
      this.mask.uniformsNeedUpdate = true;
    };
  }

  render(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ) {
    renderer.getDrawingBufferSize(this.size);
    this.surface.setSize(this.size.x, this.size.y);
    this.villagers.setSize(this.size.x, this.size.y);
    this.outline.uniforms.texel.value.set(1 / this.size.x, 1 / this.size.y);
    this.outline.uniforms.width.value = renderer.getPixelRatio();
    const target = renderer.getRenderTarget();
    const background = scene.background,
      override = scene.overrideMaterial;
    const layers = camera.layers.mask,
      autoClear = renderer.autoClear;
    const shadows = renderer.shadowMap.enabled;
    const clear = renderer.getClearColor(new THREE.Color()),
      alpha = renderer.getClearAlpha();
    try {
      renderer.autoClear = true;
      renderer.shadowMap.enabled = false;
      renderer.setClearColor(0, 0);
      scene.background = null;
      scene.overrideMaterial = this.mask;
      renderer.setRenderTarget(this.surface);
      renderer.render(scene, camera);
      camera.layers.set(VILLAGER_SILHOUETTE_LAYER);
      renderer.setRenderTarget(this.villagers);
      renderer.render(scene, camera);
    } finally {
      scene.background = background;
      scene.overrideMaterial = override;
      camera.layers.mask = layers;
      renderer.shadowMap.enabled = shadows;
      renderer.autoClear = autoClear;
      renderer.setClearColor(clear, alpha);
      renderer.setRenderTarget(target);
    }
    // Preserve the existing antialiased, tone-mapped scene and selection drawing.
    renderer.render(scene, camera);
    renderer.autoClear = false;
    try {
      this.quad.render(renderer);
    } finally {
      renderer.autoClear = autoClear;
    }
  }

  dispose() {
    this.surface.dispose();
    this.villagers.dispose();
    this.mask.dispose();
    this.outline.dispose();
    this.quad.dispose();
  }
}
