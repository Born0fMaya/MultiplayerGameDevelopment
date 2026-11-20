// Lightweight post stack for the studio viewport: SSAO + FXAA.
// No EffectComposer dependency — one color/depth target and fullscreen passes.

import * as THREE from '/Assets/lib/three.module.js';

function makeQuad(material) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  return mesh;
}

  const SSAO_FRAGMENT = /* glsl */`
  uniform sampler2D tDepth;
  uniform sampler2D tNoise;
  uniform vec2 resolution;
  uniform float zNear;
  uniform float zFar;
  uniform float intensity;
  uniform float radius;
  uniform float bias;
  uniform mat4 viewProjectionMatrix;
  uniform mat4 viewProjectionMatrixInverse;
  varying vec2 vUv;

  float perspectiveDepthToViewZ(float depth, float near, float far) {
    return (near * far) / ((far - near) * depth - far);
  }

  float getDepth(vec2 uv) {
    return texture2D(tDepth, uv).x;
  }

  float getViewZ(float depth) {
    return perspectiveDepthToViewZ(depth, zNear, zFar);
  }

  vec3 getViewPosition(vec2 uv, float depth, float viewZ) {
    float clipW = viewProjectionMatrix[2][3] * viewZ + viewProjectionMatrix[3][3];
    vec4 clip = vec4((vec3(uv, depth) - 0.5) * 2.0, 1.0);
    clip.xyz *= clipW;
    return (viewProjectionMatrixInverse * clip).xyz;
  }

  vec3 getViewNormal(vec3 viewPos) {
    return normalize(cross(dFdy(viewPos), dFdx(viewPos)));
  }

  void main() {
    float depth = getDepth(vUv);
    if (depth >= 0.9999) {
      gl_FragColor = vec4(1.0);
      return;
    }
    float viewZ = getViewZ(depth);
    vec3 viewPos = getViewPosition(vUv, depth, viewZ);
    vec3 normal = getViewNormal(viewPos);
    vec2 noiseScale = resolution / 4.0;
    vec3 random = texture2D(tNoise, vUv * noiseScale).xyz * 2.0 - 1.0;

    float occlusion = 0.0;
    const int KERNEL = 16;
    for (int i = 0; i < KERNEL; i++) {
      float fi = float(i);
      float a = fi * 2.399963;
      float r = (fi + 1.0) / float(KERNEL);
      vec3 sampleDir = normalize(vec3(cos(a) * r, sin(a) * r, 1.0 - r * 0.35));
      vec3 tangent = normalize(random - normal * dot(random, normal));
      vec3 bitangent = cross(normal, tangent);
      mat3 tbn = mat3(tangent, bitangent, normal);
      vec3 samplePos = viewPos + tbn * sampleDir * radius * (0.35 + r * 0.65);

      vec4 offset = viewProjectionMatrix * vec4(samplePos, 1.0);
      offset.xy = (offset.xy / offset.w) * 0.5 + 0.5;
      if (offset.x < 0.0 || offset.x > 1.0 || offset.y < 0.0 || offset.y > 1.0) continue;

      float sampleDepth = getDepth(offset.xy);
      float sampleViewZ = getViewZ(sampleDepth);
      float rangeCheck = smoothstep(0.0, 1.0, radius / abs(viewZ - sampleViewZ));
      occlusion += (sampleViewZ >= samplePos.z + bias ? 1.0 : 0.0) * rangeCheck;
    }
    occlusion = 1.0 - clamp((occlusion / float(KERNEL)) * intensity, 0.0, 1.0);
    // Strengthen contact darkening without crushing open surfaces.
    occlusion = pow(occlusion, 1.35);
    gl_FragColor = vec4(vec3(occlusion), 1.0);
  }
`;

const BLUR_FRAGMENT = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform vec2 direction;
  uniform vec2 resolution;
  varying vec2 vUv;
  void main() {
    vec2 texel = direction / resolution;
    float result = 0.0;
    float total = 0.0;
    float center = texture2D(tDiffuse, vUv).r;
    for (int i = -4; i <= 4; i++) {
      float fi = float(i);
      float w = 1.0 - abs(fi) / 5.0;
      float sampleValue = texture2D(tDiffuse, vUv + texel * fi).r;
      float depthAware = 1.0 - smoothstep(0.0, 0.12, abs(sampleValue - center));
      float weight = w * (0.35 + 0.65 * depthAware);
      result += sampleValue * weight;
      total += weight;
    }
    gl_FragColor = vec4(vec3(result / max(total, 1e-4)), 1.0);
  }
`;

const COMPOSITE_FRAGMENT = /* glsl */`
  uniform sampler2D tColor;
  uniform sampler2D tAO;
  uniform float aoAmount;
  varying vec2 vUv;
  void main() {
    vec4 color = texture2D(tColor, vUv);
    float ao = texture2D(tAO, vUv).r;
    ao = mix(1.0, ao, aoAmount);
    gl_FragColor = vec4(color.rgb * ao, color.a);
  }
`;

// FXAA 3.11 (Jimenez) — compact port for LDR color.
const FXAA_FRAGMENT = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform vec2 resolution;
  varying vec2 vUv;

  float fxaaLuma(vec3 color) {
    return dot(color, vec3(0.299, 0.587, 0.114));
  }

  void main() {
    vec2 texel = 1.0 / resolution;
    vec3 rgbNW = texture2D(tDiffuse, vUv + vec2(-1.0, -1.0) * texel).rgb;
    vec3 rgbNE = texture2D(tDiffuse, vUv + vec2(1.0, -1.0) * texel).rgb;
    vec3 rgbSW = texture2D(tDiffuse, vUv + vec2(-1.0, 1.0) * texel).rgb;
    vec3 rgbSE = texture2D(tDiffuse, vUv + vec2(1.0, 1.0) * texel).rgb;
    vec3 rgbM = texture2D(tDiffuse, vUv).rgb;
    float lumaNW = fxaaLuma(rgbNW);
    float lumaNE = fxaaLuma(rgbNE);
    float lumaSW = fxaaLuma(rgbSW);
    float lumaSE = fxaaLuma(rgbSE);
    float lumaM = fxaaLuma(rgbM);
    float lumaMin = min(lumaM, min(min(lumaNW, lumaNE), min(lumaSW, lumaSE)));
    float lumaMax = max(lumaM, max(max(lumaNW, lumaNE), max(lumaSW, lumaSE)));
    vec2 dir;
    dir.x = -((lumaNW + lumaNE) - (lumaSW + lumaSE));
    dir.y = ((lumaNW + lumaSW) - (lumaNE + lumaSE));
    float dirReduce = max((lumaNW + lumaNE + lumaSW + lumaSE) * 0.03125, 0.0078125);
    float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
    dir = clamp(dir * rcpDirMin, vec2(-8.0), vec2(8.0)) * texel;
    vec3 rgbA = 0.5 * (
      texture2D(tDiffuse, vUv + dir * (1.0 / 3.0 - 0.5)).rgb +
      texture2D(tDiffuse, vUv + dir * (2.0 / 3.0 - 0.5)).rgb
    );
    vec3 rgbB = rgbA * 0.5 + 0.25 * (
      texture2D(tDiffuse, vUv + dir * -0.5).rgb +
      texture2D(tDiffuse, vUv + dir * 0.5).rgb
    );
    float lumaB = fxaaLuma(rgbB);
    gl_FragColor = vec4((lumaB < lumaMin || lumaB > lumaMax) ? rgbA : rgbB, 1.0);
  }
`;

function makeNoiseTexture() {
  const size = 4;
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const o = i * 4;
    data[o] = Math.random() * 255;
    data[o + 1] = Math.random() * 255;
    data[o + 2] = 0;
    data[o + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

export function createPostStack(renderer) {
  const depthTexture = new THREE.DepthTexture();
  depthTexture.format = THREE.DepthFormat;
  depthTexture.type = THREE.UnsignedIntType;

  const colorTarget = new THREE.WebGLRenderTarget(1, 1, {
    depthTexture,
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    samples: 0,
  });
  colorTarget.texture.colorSpace = THREE.SRGBColorSpace;

  const aoTarget = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
  const aoBlurTarget = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
  const compositeTarget = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
  compositeTarget.texture.colorSpace = THREE.SRGBColorSpace;

  const noise = makeNoiseTexture();
  const passCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const passScene = new THREE.Scene();

  const ssaoMat = new THREE.ShaderMaterial({
    uniforms: {
      tDepth: { value: depthTexture },
      tNoise: { value: noise },
      resolution: { value: new THREE.Vector2(1, 1) },
      zNear: { value: 0.1 },
      zFar: { value: 1000 },
      intensity: { value: 0.9 },
      radius: { value: 2.2 },
      bias: { value: 0.055 },
      viewProjectionMatrix: { value: new THREE.Matrix4() },
      viewProjectionMatrixInverse: { value: new THREE.Matrix4() },
    },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: SSAO_FRAGMENT,
    depthTest: false,
    depthWrite: false,
    extensions: { derivatives: true },
  });

  const blurMat = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      direction: { value: new THREE.Vector2(1, 0) },
      resolution: { value: new THREE.Vector2(1, 1) },
    },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: BLUR_FRAGMENT,
    depthTest: false,
    depthWrite: false,
  });

  const compositeMat = new THREE.ShaderMaterial({
    uniforms: {
      tColor: { value: colorTarget.texture },
      tAO: { value: aoBlurTarget.texture },
      aoAmount: { value: 0.4 },
    },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: COMPOSITE_FRAGMENT,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });

  const fxaaMat = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: compositeTarget.texture },
      resolution: { value: new THREE.Vector2(1, 1) },
    },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: FXAA_FRAGMENT,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });

  const quad = makeQuad(ssaoMat);
  passScene.add(quad);

  let width = 1;
  let height = 1;
  let aoEnabled = true;
  const defaultAo = compositeMat.uniforms.aoAmount.value;

  function setAoAmount(amount) {
    const next = Math.max(0, Math.min(1, Number(amount) || 0));
    compositeMat.uniforms.aoAmount.value = next;
    aoEnabled = next > 0.001;
  }

  function resize(w, h) {
    const pr = renderer.getPixelRatio();
    width = Math.max(1, Math.floor(w * pr));
    height = Math.max(1, Math.floor(h * pr));
    colorTarget.setSize(width, height);
    const aoW = Math.max(1, width >> 1);
    const aoH = Math.max(1, height >> 1);
    aoTarget.setSize(aoW, aoH);
    aoBlurTarget.setSize(aoW, aoH);
    compositeTarget.setSize(width, height);
    ssaoMat.uniforms.resolution.value.set(aoW, aoH);
    blurMat.uniforms.resolution.value.set(aoW, aoH);
    fxaaMat.uniforms.resolution.value.set(width, height);
  }

  function renderPass(material, target) {
    quad.material = material;
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(passScene, passCamera);
  }

  function render(scene, camera) {
    renderer.setRenderTarget(colorTarget);
    renderer.clear();
    renderer.render(scene, camera);

    if (aoEnabled) {
      ssaoMat.uniforms.zNear.value = camera.near;
      ssaoMat.uniforms.zFar.value = camera.far;
      ssaoMat.uniforms.viewProjectionMatrix.value.copy(camera.projectionMatrix);
      ssaoMat.uniforms.viewProjectionMatrixInverse.value.copy(camera.projectionMatrixInverse);
      renderPass(ssaoMat, aoTarget);
      blurMat.uniforms.tDiffuse.value = aoTarget.texture;
      blurMat.uniforms.direction.value.set(1, 0);
      renderPass(blurMat, aoBlurTarget);
      blurMat.uniforms.tDiffuse.value = aoBlurTarget.texture;
      blurMat.uniforms.direction.value.set(0, 1);
      renderPass(blurMat, aoTarget);
      compositeMat.uniforms.tAO.value = aoTarget.texture;
      renderPass(compositeMat, compositeTarget);
      fxaaMat.uniforms.tDiffuse.value = compositeTarget.texture;
    } else {
      fxaaMat.uniforms.tDiffuse.value = colorTarget.texture;
    }
    renderPass(fxaaMat, null);
  }

  function dispose() {
    colorTarget.dispose();
    aoTarget.dispose();
    aoBlurTarget.dispose();
    compositeTarget.dispose();
    noise.dispose();
    ssaoMat.dispose();
    blurMat.dispose();
    compositeMat.dispose();
    fxaaMat.dispose();
    quad.geometry.dispose();
  }

  return {
    resize,
    render,
    dispose,
    setAoAmount,
    restoreAo() { setAoAmount(defaultAo); },
  };
}
