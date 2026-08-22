// Gera build/icon.ico a partir de ../assets/favicon.svg.
//
// O `technik-logo.png` não serve: é wordmark 1599x847, e ícone precisa ser
// quadrado. O favicon.svg é 512x512 e vetorial, então rasteriza limpo em
// qualquer tamanho.
//
// O .ico é montado à mão em vez de instalar uma dependência: o formato aceita
// PNG embutido desde o Vista, então o arquivo é só um cabeçalho + uma entrada
// de diretório por tamanho + os PNGs concatenados. Reusa o `sharp` que já está
// em server/node_modules — nenhum pacote novo.

const fs = require('node:fs');
const path = require('node:path');

const sharp = require(path.join(__dirname, '..', 'server', 'node_modules', 'sharp'));

const SRC = path.join(__dirname, '..', 'assets', 'favicon.svg');
const OUT = path.join(__dirname, 'build', 'icon.ico');
const SIZES = [16, 32, 48, 64, 128, 256];

async function main() {
  if (!fs.existsSync(SRC)) throw new Error(`não achei ${SRC}`);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });

  const pngs = await Promise.all(
    SIZES.map(size =>
      sharp(SRC, { density: 384 })            // densidade alta: SVG nítido em 256
        .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png({ compressionLevel: 9 })
        .toBuffer()
    )
  );

  // ICONDIR: reserved(2) + type(2, 1=ícone) + count(2)
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(SIZES.length, 4);

  // ICONDIRENTRY tem 16 bytes cada, todas antes dos dados das imagens.
  let offset = 6 + SIZES.length * 16;
  const entries = pngs.map((png, i) => {
    const size = SIZES[i];
    const e = Buffer.alloc(16);
    e.writeUInt8(size === 256 ? 0 : size, 0);  // 256 se escreve como 0
    e.writeUInt8(size === 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);                        // paleta: 0 = sem paleta
    e.writeUInt8(0, 3);                        // reservado
    e.writeUInt16LE(1, 4);                     // planos
    e.writeUInt16LE(32, 6);                    // bits por pixel
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    return e;
  });

  fs.writeFileSync(OUT, Buffer.concat([header, ...entries, ...pngs]));

  // electron-builder também aceita um PNG grande pra outros alvos.
  await sharp(SRC, { density: 384 }).resize(512, 512).png().toFile(
    path.join(__dirname, 'build', 'icon.png')
  );

  const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
  console.log(`icon.ico gerado (${SIZES.join(', ')}px) — ${kb} KB`);
}

main().catch(e => { console.error('falhou:', e.message); process.exit(1); });
