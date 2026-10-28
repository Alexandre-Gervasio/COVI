const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const decodeHeic = require('heic-decode');

function registerImageConverterIpc(ipcMain) {
  const LOSSLESS_SPACES = ['srgb', 'rgb', 'rgb16', 'b-w', 'grey16'];
  const LOSSLESS_FORMATS = [
    { id: 'png', encoder: 'png', extension: 'png', label: 'PNG (sem perda)', spaces: LOSSLESS_SPACES },
    { id: 'tiff', encoder: 'tiff', extension: 'tiff', label: 'TIFF sem compressão' },
    { id: 'webp', encoder: 'webp', extension: 'webp', label: 'WebP lossless', spaces: ['srgb'], depth: 'uchar' },
    { id: 'avif-lossless', encoder: 'heif', extension: 'avif', label: 'AVIF lossless', spaces: ['srgb'], depth: 'uchar' }
  ];
  const LOSSY_FORMATS = [
    { id: 'jpg', encoder: 'jpeg', extension: 'jpg', label: 'JPG (com perda)' },
    { id: 'webp-lossy', encoder: 'webp', extension: 'webp', label: 'WebP (com perda)' },
    { id: 'avif', encoder: 'heif', extension: 'avif', label: 'AVIF (com perda)' },
    { id: 'gif', encoder: 'gif', extension: 'gif', label: 'GIF (com perda, até 256 cores)' }
  ];
  const INPUT_FORMATS = {
    jpeg: ['jpg', 'jpeg', 'jpe'],
    png: ['png'],
    webp: ['webp'],
    tiff: ['tif', 'tiff', 'tf8', 'btf', 'btif'],
    gif: ['gif'],
    heif: ['heic', 'heif', 'hif', 'avif'],
  };

  function getSupportedImageExtensions() {
    return Object.entries(INPUT_FORMATS)
      .filter(([format]) => sharp.format[format] && sharp.format[format].input.file)
      .flatMap(([, extensions]) => extensions)
      .sort();
  }

  function getInputFormat(filePath) {
    const extension = path.extname(filePath).slice(1).toLowerCase();
    return Object.entries(INPUT_FORMATS).find(([format, extensions]) =>
      extensions.includes(extension) && sharp.format[format] && sharp.format[format].input.file
    )?.[0];
  }

  function getAvailableFormats(formats) {
    return formats.filter((format) => sharp.format[format.encoder]?.output.file);
  }

  function getLosslessTargets(metadata) {
    if ((metadata.pages || 1) > 1) return [];
    if (!['uchar', 'ushort'].includes(metadata.depth)) return [];
    if (!LOSSLESS_SPACES.includes(metadata.space)) return [];
    return getAvailableFormats(LOSSLESS_FORMATS)
      .filter((format) => (!format.spaces || format.spaces.includes(metadata.space)) &&
        (!format.depth || format.depth === metadata.depth) &&
        (format.id !== 'tiff' || ['uchar', 'ushort'].includes(metadata.depth)))
      .map(({ id, label }) => ({ id, label }));
  }

  async function getImageConversionInfo(filePath) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
      throw new Error('Caminho de arquivo inválido.');
    }
    const inputFormat = getInputFormat(filePath);
    if (!inputFormat) throw new Error('Formato de entrada não suportado por esta versão do C.O.V.I.');
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) throw new Error('O caminho selecionado não é um arquivo.');
    const metadata = await sharp(filePath, { animated: true }).metadata();
    const losslessTargets = getLosslessTargets(metadata);
    const targets = (metadata.pages || 1) > 1 || !['uchar', 'ushort'].includes(metadata.depth)
      ? losslessTargets
      : losslessTargets.concat(getAvailableFormats(LOSSY_FORMATS).map(({ id, label }) => ({ id, label })));
    let reason = '';
    if ((metadata.pages || 1) > 1) reason = 'Animações e imagens com várias páginas são recusadas para não descartar quadros.';
    else if (!['uchar', 'ushort'].includes(metadata.depth)) reason = `Profundidade de cor ${metadata.depth} não pode ser preservada com segurança.`;
    else if (!LOSSLESS_SPACES.includes(metadata.space)) reason = `Espaço de cor ${metadata.space} não pode ser preservado com segurança.`;
    else if (!targets.length) reason = 'Nenhum formato de saída compatível e sem perda está disponível para esta imagem.';
    return {
      width: metadata.width,
      height: metadata.height,
      channels: metadata.channels,
      depth: metadata.depth,
      space: metadata.space,
      hasAlpha: metadata.hasAlpha,
      pages: metadata.pages || 1,
      losslessTargets,
      targets,
      reason
    };
  }

  async function convertHeic(contents, outputFormat) {
    if (!Buffer.isBuffer(contents) && !(contents instanceof ArrayBuffer) && !ArrayBuffer.isView(contents)) {
      throw new Error('Dados da imagem HEIC invalidos.');
    }
    if (!['png', 'jpg'].includes(outputFormat)) {
      throw new Error('Formato de saida HEIC invalido.');
    }

    const input = Buffer.isBuffer(contents)
      ? contents
      : contents instanceof ArrayBuffer
        ? Buffer.from(contents)
        : Buffer.from(contents.buffer, contents.byteOffset, contents.byteLength);
    const { width, height, data } = await decodeHeic({ buffer: input });
    const expectedLength = width * height * 4;
    if (
      !Number.isSafeInteger(expectedLength) ||
      width < 1 ||
      height < 1 ||
      data.byteLength !== expectedLength
    ) {
      throw new Error('O decodificador retornou dados invalidos para a imagem HEIC.');
    }

    let image = sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), {
      raw: { width, height, channels: 4 }
    });
    if (outputFormat === 'jpg') {
      image = image.flatten({ background: '#ffffff' })
        .jpeg({ quality: 92, chromaSubsampling: '4:4:4', mozjpeg: true });
    } else {
      image = image.png({ compressionLevel: 9, palette: false });
    }

    const { data: output, info } = await image.toBuffer({ resolveWithObject: true });
    return {
      data: new Uint8Array(output),
      size: info.size,
      width: info.width,
      height: info.height
    };
  }

  function writeAtomically(filePath, contents) {
    const temporary = path.join(
      path.dirname(filePath),
      `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
    );
    try {
      fs.writeFileSync(temporary, contents, { flag: 'wx' });
      fs.renameSync(temporary, filePath);
    } catch (error) {
      if (fs.existsSync(temporary)) {
        try { fs.unlinkSync(temporary); } catch (cleanupError) {
          console.error('Não foi possível remover o arquivo temporário de conversão:', cleanupError);
        }
      }
      throw error;
    }
  }

  function replaceOriginal(filePath, extension, contents) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
      throw new Error('Caminho de arquivo inválido.');
    }
    const allowedFormats = [...LOSSLESS_FORMATS, ...LOSSY_FORMATS];
    if (!allowedFormats.some((format) => format.extension === extension)) {
      throw new Error('Formato de saída inválido.');
    }
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) throw new Error('O caminho selecionado não é um arquivo.');

    const dir = path.dirname(filePath);
    const base = path.basename(filePath, path.extname(filePath));
    const normalize = (candidate) => process.platform === 'win32'
      ? path.resolve(candidate).toLowerCase()
      : path.resolve(candidate);
    const sameFile = (candidate) => normalize(candidate) === normalize(filePath);
    let destination = path.join(dir, `${base}.${extension}`);
    const replacingInPlace = sameFile(destination);
    let suffix = 1;
    while (!replacingInPlace && fs.existsSync(destination)) {
      destination = path.join(dir, `${base} (${suffix++}).${extension}`);
    }

    writeAtomically(destination, Buffer.from(contents));
    if (!replacingInPlace) {
      try {
        fs.unlinkSync(filePath);
      } catch (error) {
        throw new Error(`A conversão foi salva em ${destination}, mas o original não pôde ser removido: ${error.message}`);
      }
    }
    return destination;
  }

  ipcMain.handle('replaceOriginal', (e, filePath, extension, contents) => replaceOriginal(filePath, extension, contents));
  ipcMain.handle('convertHeic', (e, contents, format) => convertHeic(contents, format));
  ipcMain.handle('getImageConverterFormats', () => ({
    extensions: getSupportedImageExtensions(),
    outputs: [...getAvailableFormats(LOSSLESS_FORMATS), ...getAvailableFormats(LOSSY_FORMATS)]
      .map(({ id, label, extension }) => ({ id, label, extension }))
  }));
  ipcMain.handle('getImageConversionInfo', (e, filePath) => getImageConversionInfo(filePath));
  ipcMain.handle('convertImage', async (e, filePath, formatId) => {
    const info = await getImageConversionInfo(filePath);
    const format = [...LOSSLESS_FORMATS, ...LOSSY_FORMATS].find(({ id }) => id === formatId);
    if (!format || !info.targets.some((target) => target.id === formatId)) {
      throw new Error(info.reason || 'Este formato de saída não está disponível para esta imagem.');
    }
    let image = sharp(filePath).keepMetadata();
    const lossless = LOSSLESS_FORMATS.some(({ id }) => id === formatId);
    if (lossless) image = image.toColourspace(info.space);
    if (formatId === 'png') {
      image = image.png({ compressionLevel: 9, bitdepth: info.depth === 'ushort' ? 16 : 8, palette: false });
    } else if (formatId === 'tiff') {
      image = image.tiff({ compression: 'none' });
    } else if (formatId === 'webp') {
      image = image.webp({ lossless: true, effort: 6, exact: true });
    } else if (formatId === 'avif-lossless') {
      image = image.avif({ lossless: true, effort: 4, bitdepth: 8 });
    } else if (formatId === 'jpg') {
      image = image.flatten({ background: '#ffffff' }).jpeg({ quality: 92, chromaSubsampling: '4:4:4', mozjpeg: true });
    } else if (formatId === 'webp-lossy') {
      image = image.webp({ quality: 90, alphaQuality: 100, effort: 6 });
    } else if (formatId === 'avif') {
      image = image.avif({ quality: 90, effort: 4 });
    } else if (formatId === 'gif') {
      image = image.gif({ colours: 256, effort: 7 });
    }
    const { data, info: outputInfo } = await image.toBuffer({ resolveWithObject: true });
    if (lossless) {
      const outputMetadata = await sharp(data).metadata();
      const [sourcePixels, outputPixels] = await Promise.all([
        sharp(filePath).raw({ depth: info.depth }).toBuffer(),
        sharp(data).raw({ depth: info.depth }).toBuffer()
      ]);
      if (
        outputInfo.width !== info.width ||
        outputInfo.height !== info.height ||
        outputInfo.channels !== info.channels ||
        outputMetadata.depth !== info.depth ||
        !sourcePixels.equals(outputPixels)
      ) {
        throw new Error('A saída não preservou exatamente os pixels, as dimensões e a profundidade de cor originais.');
      }
    }
    return {
      data: new Uint8Array(data),
      size: outputInfo.size,
      width: outputInfo.width,
      height: outputInfo.height
    };
  });
}

module.exports = registerImageConverterIpc;
