/**
 * Engine error codes turned into copy.
 *
 * The order is fixed by the style guide: what happened, what is still intact,
 * what to do next. The technical note stays in monospace next to it, never
 * folded into the prose.
 */
export interface ErrorCopy {
  headline: string;
  body: string;
}

const COPY: Record<string, ErrorCopy> = {
  engine_unavailable: {
    headline: 'O motor de imagem não está em execução',
    body: 'Nenhum arquivo foi alterado. Reinicie o aplicativo para continuar.',
  },
  file_not_found: {
    headline: 'O arquivo não foi encontrado',
    body: 'Nada foi alterado. Verifique se ele foi movido ou renomeado.',
  },
  file_unreadable: {
    headline: 'O arquivo não pôde ser lido',
    body: 'Nada foi alterado. Verifique as permissões da pasta e tente de novo.',
  },
  unsupported_format: {
    headline: 'Formato não suportado',
    body: 'Nada foi alterado. Esta versão abre JPG, PNG, TIFF e WebP.',
  },
  decode_failed: {
    headline: 'A imagem não pôde ser decodificada',
    body: 'O arquivo original está intacto. Ele pode estar corrompido ou incompleto.',
  },
  encode_failed: {
    headline: 'A exportação falhou ao codificar',
    body: 'Nenhum arquivo foi escrito. Tente outro formato ou outra qualidade.',
  },
  write_failed: {
    headline: 'A exportação não pôde ser salva',
    body: 'O arquivo de destino não foi alterado. Verifique o espaço em disco e as permissões.',
  },
  document_not_found: {
    headline: 'A imagem não está mais aberta',
    body: 'O arquivo original está intacto. Abra a imagem novamente.',
  },
  out_of_memory: {
    headline: 'Memória insuficiente para esta imagem',
    body: 'Nada foi aplicado. Feche outras imagens e tente de novo.',
  },
  invalid_request: {
    headline: 'A operação foi recusada',
    body: 'Nada foi alterado. Isto é uma falha do aplicativo, não do seu arquivo.',
  },
  cancelled: {
    headline: 'Operação cancelada',
    body: 'Nada foi aplicado.',
  },
};

const FALLBACK: ErrorCopy = {
  headline: 'A operação falhou',
  body: 'Nada foi alterado. Tente novamente.',
};

export function errorCopy(code: string): ErrorCopy {
  return COPY[code] ?? FALLBACK;
}
