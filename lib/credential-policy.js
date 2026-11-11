const TERMOS_OFENSIVOS = [
  'arrombado',
  'arrombada',
  'bosta',
  'buceta',
  'cacete',
  'caralho',
  'caralha',
  'corno',
  'cuzão',
  'cuzona',
  'desgraça',
  'desgraçado',
  'desgraçada',
  'filhodaputa',
  'foda',
  'foder',
  'fodido',
  'fodida',
  'merda',
  'pica',
  'porra',
  'puta',
  'puto',
  'putaria',
  'vagabundo',
  'vagabunda',
  'viado',
  'viada',
];

const SUBSTITUICOES = { 0: 'o', 1: 'i', 2: 'z', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b' };

function normalizarTexto(valor) {
  let texto = valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  let anterior;
  do {
    anterior = texto;
    texto = texto
      .replace(/([a-z])([01234578])([a-z])/g, (_, antes, caractere, depois) =>
        antes + SUBSTITUICOES[caractere] + depois)
      .replace(/([a-z])([@$!])([a-z])/g, (_, antes, caractere, depois) =>
        antes + ({ '@': 'a', '$': 's', '!': 'i' })[caractere] + depois);
  } while (texto !== anterior);

  return texto
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const TERMOS_NORMALIZADOS = TERMOS_OFENSIVOS.map((termo) =>
  normalizarTexto(termo).replace(/ /g, ''));
const TERMOS_REDUZIDOS = new Set(TERMOS_NORMALIZADOS.map((termo) =>
  termo.replace(/(.)\1+/g, '$1')));
const MAIOR_TERMO = Math.max(...TERMOS_NORMALIZADOS.map((termo) => termo.length));

function equivalenteComUmaEdicao(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;

  let indiceA = 0;
  let indiceB = 0;
  let edicoes = 0;

  while (indiceA < a.length && indiceB < b.length) {
    if (a[indiceA] === b[indiceB]) {
      indiceA++;
      indiceB++;
      continue;
    }

    edicoes++;
    if (edicoes > 1) return false;
    if (a.length > b.length) indiceA++;
    else if (a.length < b.length) indiceB++;
    else {
      indiceA++;
      indiceB++;
    }
  }

  return edicoes + Number(indiceA < a.length || indiceB < b.length) <= 1;
}

function correspondeTermo(candidato) {
  const candidatos = new Set([
    candidato,
    candidato.replace(/\d+$/g, ''),
    candidato.replace(/\d+$/g, (sufixo) =>
      [...sufixo].map((caractere) => SUBSTITUICOES[caractere] || caractere).join('')),
  ]);

  return [...candidatos].some((normalizado) => {
    if (!normalizado) return false;
    const reduzido = normalizado.replace(/(.)\1+/g, '$1');
    if (TERMOS_REDUZIDOS.has(reduzido)) return true;

    return TERMOS_NORMALIZADOS.some((termo) => {
      if (termo.length < 6) return false;
      const termoReduzido = termo.replace(/(.)\1+/g, '$1');
      const tamanhoMinimo = Math.max(1, termo.length - 1);
      const tamanhoMaximo = termo.length + 1;

      for (let inicio = 0; inicio < reduzido.length; inicio++) {
        for (let tamanho = tamanhoMinimo; tamanho <= tamanhoMaximo; tamanho++) {
          const trecho = reduzido.slice(inicio, inicio + tamanho);
          if (trecho.length === tamanho && equivalenteComUmaEdicao(trecho, termoReduzido)) return true;
        }
      }
      return false;
    });
  });
}

function contemTermoOfensivo(valor) {
  const palavras = normalizarTexto(valor).match(/[a-z0-9]+/g) || [];
  if (!palavras.length) return false;

  for (let inicio = 0; inicio < palavras.length; inicio++) {
    let candidato = '';
    for (let fim = inicio; fim < palavras.length && candidato.length <= MAIOR_TERMO + 1; fim++) {
      candidato += palavras[fim];
      if (correspondeTermo(candidato)) return true;
    }
  }

  return false;
}

function validarSenha(senha) {
  if (typeof senha !== 'string' || senha.length < 6 || senha.length > 128) {
    return 'A senha deve ter entre 6 e 128 caracteres.';
  }
  if (!/\p{Lu}/u.test(senha)) {
    return 'A senha deve conter ao menos uma letra maiúscula.';
  }
  if (!/[^\p{L}\p{N}\s]/u.test(senha)) {
    return 'A senha deve conter ao menos um caractere especial.';
  }
  if (contemTermoOfensivo(senha)) {
    return 'A senha não pode conter termos ofensivos.';
  }
  return null;
}

module.exports = { contemTermoOfensivo, validarSenha };
