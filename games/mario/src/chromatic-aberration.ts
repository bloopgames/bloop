import { Backends, Colors, type Toodle } from "@bloopjs/toodle";

export function createChromaticAberrationEffect(toodle: Toodle): Backends.PostProcess {
  if (!(toodle.backend instanceof Backends.WebGPUBackend)) {
    throw new Error("Post-processing requires WebGPU backend");
  }

  const device = toodle.backend.device;
  const presentationFormat = toodle.backend.presentationFormat;

  const pipeline = device.createRenderPipeline({
    label: "chromatic aberration pipeline",
    layout: "auto",
    primitive: { topology: "triangle-strip" },
    vertex: {
      module: Backends.PostProcessDefaults.vertexShader(device),
    },
    fragment: {
      targets: [{ format: presentationFormat }],
      module: device.createShaderModule({
        label: "chromatic aberration fragment shader",
        code: /*wgsl*/ `
          @group(0) @binding(0) var inputTex: texture_2d<f32>;
          @group(0) @binding(1) var inputSampler: sampler;
          @group(0) @binding(2) var<uniform> time: f32;

          @fragment
          fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
            // Time-based jitter for animation
            let jitter = sin(time * 0.1) * 0.003;
            let baseOffset = 0.008 + jitter;

            // Sample RGB at different horizontal offsets
            let r = textureSample(inputTex, inputSampler, uv + vec2f(baseOffset, 0.0)).r;
            let g = textureSample(inputTex, inputSampler, uv).g;
            let b = textureSample(inputTex, inputSampler, uv - vec2f(baseOffset, 0.0)).b;
            let a = textureSample(inputTex, inputSampler, uv).a;

            // Scanline effect
            let scanline = sin(uv.y * 800.0) * 0.04 + 0.96;

            // Horizontal glitch bands (occasional)
            let glitchBand = step(0.98, fract(sin(floor(uv.y * 20.0 + time * 0.05)) * 43758.5453));
            let glitchOffset = glitchBand * 0.02;

            // Apply glitch offset to final sample
            let glitchedUv = uv + vec2f(glitchOffset, 0.0);
            let glitchedR = textureSample(inputTex, inputSampler, glitchedUv + vec2f(baseOffset, 0.0)).r;
            let glitchedG = textureSample(inputTex, inputSampler, glitchedUv).g;
            let glitchedB = textureSample(inputTex, inputSampler, glitchedUv - vec2f(baseOffset, 0.0)).b;

            // Mix glitched and non-glitched based on band
            let finalR = mix(r, glitchedR, glitchBand);
            let finalG = mix(g, glitchedG, glitchBand);
            let finalB = mix(b, glitchedB, glitchBand);

            return vec4f(finalR, finalG, finalB, a) * scanline;
          }
        `,
      }),
    },
  });

  const sampler = Backends.PostProcessDefaults.sampler(device);

  // Create a buffer for the time uniform
  const timeBuffer = device.createBuffer({
    label: "time uniform buffer",
    size: 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  return {
    process(queue, encoder, pingpong, screen) {
      // Update time uniform
      const timeData = new Float32Array([toodle.diagnostics.frames]);
      queue.writeBuffer(timeBuffer, 0, timeData);

      const renderPass = encoder.beginRenderPass({
        label: "chromatic aberration render pass",
        colorAttachments: [
          {
            view: screen.createView(),
            clearValue: Colors.web.black,
            loadOp: "clear" as const,
            storeOp: "store" as const,
          },
        ],
      });

      const bindGroup = device.createBindGroup({
        label: "chromatic aberration bind group",
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: pingpong[0].createView() },
          { binding: 1, resource: sampler },
          { binding: 2, resource: { buffer: timeBuffer } },
        ],
      });

      renderPass.setPipeline(pipeline);
      renderPass.setBindGroup(0, bindGroup);
      renderPass.draw(4);
      renderPass.end();
    },
  };
}
