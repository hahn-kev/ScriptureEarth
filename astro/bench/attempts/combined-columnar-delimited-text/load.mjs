import { readFile } from 'node:fs/promises';
import path from 'node:path';

const RECORD_SEP = '\x1f';
const ELEMENT_SEP = '\t';
const LINE_SEP = '\n';

export const RIGHTS = ['read', 'listen', 'watch', 'app', 'buy'];

export async function load({ dir }) {
  const raw = await readFile(path.join(dir, 'data.txt'), 'utf8');
  const [headerLine, idxLine, codeLine, slugLine, nmLine, nmsLine, altLine, ccLine, rLine] =
    raw.split(LINE_SEP);

  const countries = {};
  for (const entry of headerLine.split(RECORD_SEP)) {
    const sepIdx = entry.indexOf(ELEMENT_SEP);
    countries[entry.slice(0, sepIdx)] = entry.slice(sepIdx + 1);
  }

  const idxCol = idxLine.split(RECORD_SEP);
  const codeCol = codeLine.split(RECORD_SEP);
  const slugCol = slugLine.split(RECORD_SEP);
  const nmCol = nmLine.split(RECORD_SEP);
  const nmsCol = nmsLine.split(RECORD_SEP);
  const altCol = altLine.split(RECORD_SEP);
  const ccCol = ccLine.split(RECORD_SEP);
  const rCol = rLine.split(RECORD_SEP);

  return idxCol.map((idxStr, i) => {
    const cc = ccCol[i] === '' ? [] : ccCol[i].split(ELEMENT_SEP);
    const mask = Number(rCol[i]);
    return {
      idx: Number(idxStr),
      slug: slugCol[i] === '' ? codeCol[i] : slugCol[i],
      code: codeCol[i],
      nm: nmCol[i],
      auto: null,
      nms: nmsCol[i] === '' ? [] : nmsCol[i].split(ELEMENT_SEP),
      alt: altCol[i] === '' ? [] : altCol[i].split(ELEMENT_SEP),
      where: cc.map((c) => countries[c]).join(', '),
      cc,
      r: RIGHTS.filter((_, bit) => mask & (1 << bit)),
    };
  });
}
