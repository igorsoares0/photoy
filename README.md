# Photoy

Editor de fotos desktop local-first. Especificação completa em
[`docs/photo-editor-spec-driven-development.md`](docs/photo-editor-spec-driven-development.md);
o sistema visual em [`docs/style-guide.html`](docs/style-guide.html).

**Estado: Milestone 1 completo, Milestone 2 em 10 de 11, Milestone 3 completo
exceto máscaras pintadas.** Abrir, decodificar, gerenciar cor, canvas, zoom, pan, girar,
espelhar, recortar com alças e proporções, empilhar camadas de ajuste com
opacidade, modo de mistura e máscara, desfazer/refazer, **navegar pelo
histórico**, salvar e reabrir projetos,
recuperar uma sessão interrompida, e exportar.

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

Atalhos: `Ctrl+O` abrir foto · `Ctrl+Shift+O` abrir projeto · `Ctrl+S` salvar ·
`Ctrl+Shift+S` salvar como · `Ctrl+E` exportar · `Ctrl+Z` / `Ctrl+Shift+Z` desfazer e refazer ·
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
- **O arquivo de projeto guarda exatamente o JSON que o protocolo carrega.** Um esquema para
  manter correto, não dois que divergem — e um projeto pode ser lido por qualquer coisa que
  já fale o protocolo.
- **Violeta aparece nas máscaras e em mais nada.** O style guide o reserva para o que um
  modelo tocou e para máscaras; gastá-lo como ênfase o esvaziaria antes de a IA chegar.
- **A sobreposição da máscara mostra a fronteira, não a queda.** A linha tracejada é exata
  porque o ponto médio é um número que a máscara já carrega; o banho violeta ao lado é uma
  rampa linear e a engine usa um smoothstep. Desenhar a queda seria uma figura que discorda
  da figura.
- **Camadas são algo em que se opta, não um passo antes do slider.** Mover um controle numa
  foto sem camadas cria a camada de que ele precisa. Quem nunca abrir o painel de camadas
  nunca precisa saber que elas existem.
- **Seleção de camada é superfície mais anel, não violeta.** O style guide reserva violeta
  para o que um modelo tocou; usá-lo como ênfase de seleção o gastaria.
- **Recorte só entra na pilha quando confirmado.** Enquadrar é uma decisão; o histórico
  registra a decisão, não cada retângulo tentado no caminho até ela. `Enter` aplica, `Esc`
  desiste, e a ferramenta toma o painel enquanto está aberta.
- **Uma proporção travada encolhe para caber, nunca cresce.** Crescer para o candidato maior
  é desfeito pelo clamp aos limites do documento — que é como uma proporção travada deixa de
  ser respeitada em silêncio.
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
  vinheta e grão. E `resize`, o único item do M2 ainda em aberto.
- **Jobs reportam estado, não porcentagem.** `queued → running → completed/cancelled/failed`
  chega como evento, mas nenhuma operação de hoje sabe reportar uma fração real, e o style
  guide proíbe inventar uma. As porcentagens entram junto com as operações que sabem medi-las.
- **Um seletor do zustand precisa devolver a mesma referência quando nada mudou.** Escrever
  `?? []` ou montar um objeto dentro de um seletor faz o store ver mudança a cada chamada e
  o renderer entra em laço até o React desistir. Já aconteceu três vezes aqui; para listas,
  use a constante `NO_LAYERS`, e para tamanhos, selecione números.
- **Os documentos residentes ficam fora do orçamento de jobs.** Uma foto de 24 MP ocupa
  192 MB enquanto estiver aberta, e nada contabiliza isso. Hoje a UI segura um documento por
  vez, então não incomoda; abrir vários exige estender o orçamento para cobri-los.
- **A estimativa de abertura é um chute com piso**, porque o tamanho real só se conhece
  depois de ler o cabeçalho. Erra para cima de propósito: um job que superestima espera um
  pouco mais pela vez dele, um que subestima é admitido junto de outro e falta memória.

### O histórico

Desfazer e refazer movem o cursor um passo; o painel salta para qualquer ponto.
Nada é descartado ao voltar, então ir e vir é de graça — a cauda só some quando
se edita a partir de um ponto anterior, que é onde o ramo abandonado deixa de
existir.

**Cada linha que tem um número mostra o número.** Uma operação de ajuste carrega
o estado inteiro dos controles, e não um delta — é isso que a torna replayável —
então o painel recupera o que mudou comparando com o estado anterior *da mesma
camada*. Um histórico que diz "ajustado" sem dizer quanto não é auditável.

### Máscaras

As máscaras de hoje são **descritas, não pintadas**: um gradiente linear ou
radial é meia dúzia de números. Isso resolve três problemas de uma vez — não
ocupam memória, não trazem binário para o projeto, e avaliam em qualquer
resolução sem nada ser reamostrado no caminho. A mesma máscara vale para um
preview de 60 px e para uma exportação de 24 MP, e há teste comparando as duas.

Coordenadas são frações do documento; distâncias usam o **lado mais curto** como
unidade, que é o que mantém uma máscara radial circular num quadro que não é
quadrado.

Máscaras pintadas são pixels e vão precisar do diretório `masks/` do container —
que já existe no formato à espera delas.

### O projeto

Um `.myphoto` é **um zip comum**, e isso é deliberado: se este aplicativo um dia
não conseguir abrir um, a fotografia lá dentro continua a um duplo clique de
distância.

```
manifest.json          o formato, a versão, e a lista de operações
original/<arquivo>      os bytes originais, sem recompressão
```

Nada é comprimido. O original já é uma imagem comprimida, e deixar o manifesto
legível significa que um projeto quebrado ainda se inspeciona com qualquer
ferramenta.

**O original vai embutido**, não referenciado. Um projeto que só apontasse para a
foto perderia o valor no momento em que ela fosse movida.

**A cauda de refazer é preservada.** Fechar e reabrir não descarta em silêncio o
que um desfazer tinha posto de lado.

Um projeto de um formato mais novo é **recusado, não lido pela metade** — abrir
descartaria o que a versão nova gravou, e o próximo salvamento destruiria isso.

### Autosave e recuperação

O autosave escreve numa área própria do aplicativo, **nunca sobre o projeto do
usuário**: um autosave que sobrescrevesse o arquivo em edição transformaria uma
queda em perda de dados em vez de evitá-la.

Uma sessão interrompida é **oferecida, nunca aplicada sozinha** — restaurar por
conta própria substituiria o que a pessoa acabou de abrir. Sair de forma limpa
apaga a sessão pendente: o que ficou por salvar foi escolha de quem estava lá.

Intervalo padrão de 30 s, ajustável por `PHOTOY_AUTOSAVE_SECONDS`.

## Espinhos

`spikes/` guarda investigações fora do build do produto. O que volta delas é
conhecimento, não código.

- **`spikes/ai`** — inferência local com ONNX Runtime. Responde se o runtime roda
  nesta stack, quanto custa, e que forma tem a máscara que sai. Resumo dos
  números no README de lá. Três conclusões mudam o plano: a inferência **não**
  escala com megapixels, memória é a restrição real (~1 GB numa foto grande), e a
  máscara é alfa contínuo — o que confirma o desenho de `Mask` da §16.

## Layout

```
apps/native/src/
  core/       erros, log, IO de arquivo com caminho UTF-8
  protocol/   framing e transporte stdio
  jobs/       fila de trabalho, supressão e cancelamento
  edit/       operações, ajustes, camadas, máscaras, pilha com undo/redo/seek,
              avaliação em qualquer resolução
  project/    leitura e escrita do .myphoto
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

tests/engine/   suítes que falam o protocolo real com o binário real
tests/renderer/ geometria pura do renderer, importada direto do TypeScript
```
