# Photoy

Editor de fotos desktop local-first. Especificação completa em
[`docs/photo-editor-spec-driven-development.md`](docs/photo-editor-spec-driven-development.md);
o sistema visual em [`docs/style-guide.html`](docs/style-guide.html).

**Estado: Milestone 1 completo**, mais gerenciamento de cor, a pilha de edições
não destrutiva com fila de jobs, e os ajustes básicos. Abrir, decodificar,
gerenciar cor, canvas, zoom, pan, girar, espelhar, recortar, ajustar luz e cor,
desfazer/refazer e exportar.

## Convenções

- **Código em inglês**: identificadores, comentários, mensagens de erro do engine, nomes de arquivo.
- **Interface em pt-BR**: toda copy visível ao usuário, seguindo o vocabulário do style guide.
- O engine devolve um **código** de erro; a UI é dona do texto. Um código novo no C++
  precisa de uma entrada correspondente em `renderer/src/lib/errors.ts`.
- Windows é a plataforma de referência. O código evita APIs exclusivas de Windows fora de
  `core/paths.cpp` e do transporte stdio, que já têm o caminho POSIX escrito para o port de macOS.

## Pré-requisitos (Windows)

| Ferramenta | Observação |
|---|---|
| Visual Studio Build Tools | workload *Desktop development with C++*, toolset x64 |
| Node.js 20+ | usado para o app e para os testes |
| Python 3.10+ | só para provisionar CMake e Ninja num virtualenv local |
| Git | usado para clonar o vcpkg |

CMake, Ninja, vcpkg e os codecs C++ **não** precisam estar instalados na máquina: o setup
os coloca em `.tooling/`, fora do sistema.

## Setup

```bat
npm run setup
```

Faz, em ordem: virtualenv com CMake e Ninja, clone e bootstrap do vcpkg, build dos codecs
(`libjpeg-turbo`, `libpng`, `libtiff`, `libwebp`, `lcms2`), e `npm install`. A primeira execução leva
alguns minutos por causa da compilação dos codecs; as seguintes são quase instantâneas.

## Uso

Atalhos: `Ctrl+O` abrir · `Ctrl+E` exportar · `Ctrl+Z` / `Ctrl+Shift+Z` desfazer e refazer ·
`Ctrl+[` / `Ctrl+]` girar · `Ctrl+0` ajustar · `Ctrl+1` tamanho real. Duplo clique num
slider o zera.

```bat
npm run build         :: engine C++ + main/preload + renderer
npm run build:native  :: só o engine C++
npm start             :: build e abre o app
npm run dev           :: Vite com hot reload, esbuild em watch, Electron reiniciando sozinho
npm test              :: testes do engine, ponta a ponta pelo protocolo real
npm run typecheck     :: TypeScript em todo o workspace
```

O engine também roda sozinho, o que é a forma mais rápida de investigar um problema de decode:

```bat
set PHOTOY_LOG_LEVEL=debug
build\Release\bin\photoy-engine.exe
```

## Arquitetura

> React desenha. Electron orquestra. C++ processa.

```
┌── apps/desktop/renderer ──┐   React, Zustand, Tailwind. Canvas, zoom, pan, diálogos.
│                           │   Não conhece o filesystem nem o engine.
└─────────── window.photoy ─┘
              │ contextBridge, superfície fechada e tipada
┌── apps/desktop/electron ──┐   Janela, diálogos nativos, validação de caminho,
│                           │   ciclo de vida do engine.
└──────── stdin / stdout ───┘
              │ frames com cabeçalho JSON + payload binário
┌── apps/native ────────────┐   Decode, resample, encode. Um processo separado.
└───────────────────────────┘
```

### O engine é um processo, não um addon

A alternativa era um native addon N-API. Um processo separado ganha em quatro pontos que
importam para o resto do roadmap: não fica preso à ABI do Electron (nenhuma recompilação a
cada upgrade), é executável e depurável direto do terminal, um decoder que quebra derruba o
engine e não a janela, e o job system cancelável do Milestone 4 já nasce com isolamento real.

O custo é a serialização. Por isso o protocolo mantém os pixels **fora** do JSON: cada frame é

```
uint32le headerLength │ header JSON │ uint32le payloadLength │ payload
```

O contrato vive em `packages/ipc` e é compilado a partir do fonte pelos dois lados, então
não existe versão divergente entre o main process e o renderer.

### Decisões que valem registro

- **RGBA16 é o formato único** dentro do engine. Decoders normalizam para ele, encoders leem
  dele. Um pixel de trabalho custa 8 bytes.
- **O espaço de trabalho é linear, com primárias ProPhoto, a 16 bits.** Largo o bastante para
  conter qualquer gamut de câmera sem cortar na entrada; linear porque exposição vira uma
  multiplicação e um downscale passa a fazer a média em luz linear, e não em números com
  gama aplicada. Linear é também por que são 16 bits: a 8 bancaria feio nas sombras.
  A definição está num lugar só, em `color/profile.cpp`.
- **Exportação sempre carimba o perfil.** Arquivo sem tag é o que faz um export wide-gamut
  parecer errado em todo visualizador que assume sRGB.
- **Recorte é expresso no que o usuário vê.** O retângulo chega em coordenadas já giradas e
  é mapeado de volta pela orientação acumulada. O contrário obrigaria a UI a conhecer a
  álgebra da pilha.
- **Um render cancelado não é um erro.** A UI ignora `cancelled` em silêncio: é a fila
  funcionando, não uma falha que o usuário precise ler.
- **Os ajustes vão fundidos na conversão de saída**, não numa passada própria. Uma passada
  separada dobraria o tráfego de memória sobre o maior buffer do engine.
- **Exposição é a única com unidade física** — um stop é um fator de dois em luz linear, e o
  teste verifica isso aritmeticamente. As outras são curvas de resposta, matéria de gosto, e
  estão isoladas em `edit/adjustments.cpp` para serem calibradas contra fotos de verdade.
- **Balanço de branco é adaptação cromática de verdade**, por Bradford entre o branco do
  espaço de trabalho e um ponto na curva de luz do dia — não um ganho por canal chutado.
- **Frames são montados sem concatenar por chunk.** Juntar a cada pedaço que chega do pipe
  copia o acumulado inteiro toda vez, o que é quadrático no tamanho do payload: um preview
  de 8 MB chega em centenas de leituras e custava centenas de MB de cópia.
- **Orientação EXIF é resolvida no decode.** Os pixels que saem do engine estão sempre de pé,
  e a tag é reescrita para 1 na exportação — carregá-la adiante faria o visualizador girar
  a foto uma segunda vez.
- **Exportação é atômica**: escreve num arquivo temporário e move por cima. Um encode que
  falha nunca trunca o arquivo que o usuário já tinha.
- **O renderer não alcança a rede.** O main process cancela requisições externas e o CSP do
  `index.html` fecha o resto. As fontes IBM Plex são versionadas no repositório.
- **O formato vem do conteúdo, não da extensão.** `SniffFormat` lê a assinatura do arquivo.
- **A janela inicial é limitada à work area.** Tamanhos de janela são DIPs: 1360 DIP viram
  1700 pixels físicos a 125%, o que passa da borda em telas menores.

### O que ainda não existe

Sem camadas, ajustes, máscaras, IA, projeto `.myphoto`, undo/redo ou GPU — tudo isso é
Milestone 2 em diante. Consequências visíveis hoje:

- **O preview sai sempre em sRGB de 8 bits.** O Chromium converte disso para o perfil da
  tela ao compor, então numa tela comum a imagem está correta. O que se perde é o que
  estiver fora do sRGB: num monitor wide-gamut o corte acontece aqui dentro, antes de a
  tela ter chance. E um perfil calibrado é aproximado pelo Chromium a primárias mais curva,
  o que descarta a correção por canal que a calibração carregava. Resolver de verdade é
  produzir o preview no espaço da tela e marcar o canvas com ele — o engine já sabe fazer
  a conversão, falta decidir o espaço e evitar converter duas vezes.
- **Perfis não-RGB caem para sRGB.** Os decoders sempre entregam RGB, então um perfil CMYK
  ou grayscale não descreve os pixels que temos em mãos; usá-lo seria pior que a suposição.
- **TIFF de 16 bits só pelo caminho simples** — contíguo, RGB, sem tiles. Qualquer layout
  mais exótico cai na interface RGBA da libtiff, correta mas a 8 bits.
- O preview é uma imagem inteira, com teto de 24 MP. Zoom muito além disso mostra a foto
  levemente macia. O pipeline em tiles do Milestone 4 remove o compromisso.
- **Um quadro de slider custa ~31 ms**, dos quais cerca de metade é o transporte dos 3,7 MB
  do preview pelo pipe. Dá ~32 fps. Baixar a resolução do preview durante o arrasto e subir
  ao soltar é o próximo ganho fácil, e a API já aceita isso sem mudança.
- **Faltam os ajustes que a §9 lista além destes**: matiz, vibração, nitidez, clareza,
  vinheta e grão. E `resize`, que o M2 pede.
- **Jobs reportam estado, não porcentagem.** `queued → running → completed/cancelled/failed`
  chega como evento, mas nenhuma operação de hoje sabe reportar uma fração real, e o style
  guide proíbe inventar uma. As porcentagens entram junto com as operações que sabem medi-las.
- **Recorte existe no engine, mas ainda não na UI.** A ferramenta com alças no canvas vem
  junto do painel lateral. Pela API e pelos testes o recorte já funciona.

## Layout

```
apps/native/src/
  core/       erros, log, IO de arquivo com caminho UTF-8
  protocol/   framing e transporte stdio
  jobs/       fila de trabalho, supressão e cancelamento
  edit/       operações, ajustes, pilha com undo/redo, avaliação em qualquer resolução
  color/      definição dos espaços, perfis ICC, matriz derivada e conversão rápida
  image/      buffer RGBA8/RGBA16, resample, orientação
  decoder/    sniffer, marcadores JPEG, EXIF, jpeg, png, tiff, webp
  export/     encoders e escrita atômica
  engine/     registro de documentos e dispatch síncrono/assíncrono

apps/desktop/
  electron/   main, preload, cliente do engine, handlers IPC, validação de caminho
  renderer/   React, tokens do design system, canvas, diálogos

packages/
  types/      tipos de domínio compartilhados
  ipc/        protocolo do engine, canais e a API exposta ao renderer

tests/engine/ suítes que falam o protocolo real com o binário real
```
