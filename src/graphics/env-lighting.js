import { Vec4 } from '../math/vec4.js';
import { Texture } from './texture.js';
import { reprojectTexture } from './reproject-texture.js';
import {
    TEXTURETYPE_DEFAULT, TEXTURETYPE_RGBM,
    TEXTUREPROJECTION_EQUIRECT,
    ADDRESS_CLAMP_TO_EDGE,
    PIXELFORMAT_R8_G8_B8_A8, PIXELFORMAT_RGBA16F, PIXELFORMAT_RGBA32F
} from './constants.js';
import { DebugGraphics } from './debug-graphics.js';

const fixCubemapSeams = true;

// calculate the number of mipmap levels given texture dimensions
const calcLevels = (width, height) => {
    return 1 + Math.floor(Math.log2(Math.max(width, height)));
};

const supportsFloat16 = (device) => {
    return device.extTextureHalfFloat && device.textureHalfFloatRenderable;
};

const supportsFloat32 = (device) => {
    return device.extTextureFloat && device.textureFloatRenderable;
};

// lighting source should be stored HDR
const lightingSourcePixelFormat = (device) => {
    return supportsFloat16(device) ? PIXELFORMAT_RGBA16F :
        supportsFloat32(device) ? PIXELFORMAT_RGBA32F :
            PIXELFORMAT_R8_G8_B8_A8;
};

// runtime lighting can be RGBM
const lightingPixelFormat = (device) => {
    return PIXELFORMAT_R8_G8_B8_A8;
};

const createCubemap = (device, size, format, mipmaps) => {
    return new Texture(device, {
        name: `lighting-${size}`,
        cubemap: true,
        width: size,
        height: size,
        format: format,
        type: format === PIXELFORMAT_R8_G8_B8_A8 ? TEXTURETYPE_RGBM : TEXTURETYPE_DEFAULT,
        addressU: ADDRESS_CLAMP_TO_EDGE,
        addressV: ADDRESS_CLAMP_TO_EDGE,
        fixCubemapSeams: fixCubemapSeams,
        mipmaps: !!mipmaps
    });
};

/**
 * Helper functions to support prefiltering lighting data.
 *
 * @ignore
 */
class EnvLighting {
    /**
     * Generate a skybox cubemap in the correct pixel format from the source texture.
     *
     * @param {Texture} source - The source texture. This is either a 2d texture in equirect format
     * or a cubemap.
     * @param {number} [size] - Size of the resulting texture. Otherwise use automatic sizing.
     * @returns {Texture} The resulting cubemap.
     */
    static generateSkyboxCubemap(source, size) {
        const device = source.device;

        DebugGraphics.pushGpuMarker(device, "genSkyboxCubemap");

        const result = createCubemap(device, size || (source.cubemap ? source.width : source.width / 4), PIXELFORMAT_R8_G8_B8_A8, false);

        reprojectTexture(source, result, {
            numSamples: 1024
        });

        DebugGraphics.popGpuMarker(device);

        return result;
    }

    /**
     * Create a texture in the format needed to precalculate lighting data.
     *
     * @param {Texture} source - The source texture. This is either a 2d texture in equirect format
     * or a cubemap.
     * @returns {Texture} The resulting cubemap.
     */
    static generateLightingSource(source) {
        const device = source.device;

        DebugGraphics.pushGpuMarker(device, "genLightingSource");

        const format = lightingSourcePixelFormat(device);
        const result = new Texture(device, {
            name: `lighting-source`,
            cubemap: true,
            width: 128,
            height: 128,
            format: format,
            type: format === PIXELFORMAT_R8_G8_B8_A8 ? TEXTURETYPE_RGBM : TEXTURETYPE_DEFAULT,
            addressU: ADDRESS_CLAMP_TO_EDGE,
            addressV: ADDRESS_CLAMP_TO_EDGE,
            fixCubemapSeams: false,
            mipmaps: true
        });

        // copy into top level
        reprojectTexture(source, result, {
            numSamples: source.mipmaps ? 1 : 1024
        });

        DebugGraphics.popGpuMarker(device);

        // generate mipmaps
        return result;
    }

    /**
     * Generate the environment lighting atlas containing prefiltered reflections and ambient.
     *
     * @param {Texture} source - The source lighting texture, generated by generateLightingSource.
     * @param {object} [options] - Specify prefilter options.
     * @returns {Texture} The resulting atlas
     */
    static generateAtlas(source, options) {
        const device = source.device;
        const format = lightingPixelFormat(device);

        DebugGraphics.pushGpuMarker(device, "genAtlas");

        const result = options?.target || new Texture(device, {
            width: 512,
            height: 512,
            format: format,
            type: format === PIXELFORMAT_R8_G8_B8_A8 ? TEXTURETYPE_RGBM : TEXTURETYPE_DEFAULT,
            projection: TEXTUREPROJECTION_EQUIRECT,
            addressU: ADDRESS_CLAMP_TO_EDGE,
            addressV: ADDRESS_CLAMP_TO_EDGE,
            mipmaps: false
        });

        DebugGraphics.pushGpuMarker(device, "mipmaps");

        // generate mipmaps
        const rect = new Vec4(0, 0, 512, 256);
        const levels = calcLevels(result.width, result.height);
        for (let i = 0; i < levels; ++i) {
            reprojectTexture(source, result, {
                numSamples: 1,
                rect: rect,
                seamPixels: 1
            });

            rect.x += rect.w;
            rect.y += rect.w;
            rect.z = Math.max(1, Math.floor(rect.z * 0.5));
            rect.w = Math.max(1, Math.floor(rect.w * 0.5));
        }

        DebugGraphics.popGpuMarker(device);
        DebugGraphics.pushGpuMarker(device, "reflections");

        // generate blurry reflections
        rect.set(0, 256, 256, 128);
        for (let i = 1; i < 7; ++i) {
            reprojectTexture(source, result, {
                numSamples: options?.numSamples || 1024,
                distribution: options?.distribution || 'ggx',
                specularPower: Math.max(1, 2048 >> (i * 2)),
                rect: rect,
                seamPixels: 1
            });
            rect.y += rect.w;
            rect.z = Math.max(1, Math.floor(rect.z * 0.5));
            rect.w = Math.max(1, Math.floor(rect.w * 0.5));
        }

        DebugGraphics.popGpuMarker(device);
        DebugGraphics.pushGpuMarker(device, "ambient");

        // generate ambient
        rect.set(128, 256 + 128, 64, 32);
        reprojectTexture(source, result, {
            numSamples: options?.numSamples || 2048,
            distribution: 'lambert',
            rect: rect,
            seamPixels: 1
        });

        DebugGraphics.popGpuMarker(device);
        DebugGraphics.popGpuMarker(device);

        return result;
    }

    /**
     * Generate the environment lighting atlas from prefiltered cubemap data.
     *
     * @param {Texture[]} sources - Array of 6 prefiltered textures.
     * @param {object} options - The options object
     * @returns {Texture} The resulting atlas
     */
    static generatePrefilteredAtlas(sources, options) {
        const device = sources[0].device;
        const format = lightingPixelFormat(device);

        DebugGraphics.pushGpuMarker(device, "genPrefilteredAtlas");

        const result = options?.target || new Texture(device, {
            width: 512,
            height: 512,
            format: format,
            type: format === PIXELFORMAT_R8_G8_B8_A8 ? TEXTURETYPE_RGBM : TEXTURETYPE_DEFAULT,
            projection: TEXTUREPROJECTION_EQUIRECT,
            addressU: ADDRESS_CLAMP_TO_EDGE,
            addressV: ADDRESS_CLAMP_TO_EDGE,
            mipmaps: false
        });

        DebugGraphics.pushGpuMarker(device, "mipmaps");

        // generate mipmaps
        const rect = new Vec4(0, 0, 512, 256);
        const levels = calcLevels(result.width, result.height);
        for (let i = 0; i < levels; ++i) {
            reprojectTexture(sources[0], result, {
                numSamples: 1,
                rect: rect,
                seamPixels: 1
            });

            rect.x += rect.w;
            rect.y += rect.w;
            rect.z = Math.max(1, Math.floor(rect.z * 0.5));
            rect.w = Math.max(1, Math.floor(rect.w * 0.5));
        }

        DebugGraphics.popGpuMarker(device);
        DebugGraphics.pushGpuMarker(device, "reflections");

        // copy blurry reflections
        rect.set(0, 256, 256, 128);
        for (let i = 1; i < sources.length; ++i) {
            reprojectTexture(sources[i], result, {
                numSamples: 1,
                rect: rect,
                seamPixels: 1
            });
            rect.y += rect.w;
            rect.z = Math.max(1, Math.floor(rect.z * 0.5));
            rect.w = Math.max(1, Math.floor(rect.w * 0.5));
        }

        DebugGraphics.popGpuMarker(device);
        DebugGraphics.pushGpuMarker(device, "ambient");

        // generate ambient
        rect.set(128, 256 + 128, 64, 32);
        if (options?.legacyAmbient) {
            reprojectTexture(sources[5], result, {
                numSamples: 1,
                rect: rect,
                seamPixels: 1
            });
        } else {
            reprojectTexture(sources[0], result, {
                numSamples: options?.numSamples || 2048,
                distribution: 'lambert',
                rect: rect,
                seamPixels: 1
            });
        }

        DebugGraphics.popGpuMarker(device);
        DebugGraphics.popGpuMarker(device);

        return result;
    }
}

export {
    EnvLighting
};
