import sharp from 'sharp';
const [input, output, size] = process.argv.slice(2);
await sharp(input).resize(Number(size), Number(size), { fit: 'contain' }).png().toFile(output);
