# Photoy

Editor de fotos desktop local-first. Especificação completa em
[`docs/photo-editor-spec-driven-development.md`](docs/photo-editor-spec-driven-development.md);
o sistema visual em [`docs/style-guide.html`](docs/style-guide.html).

**Estado: Milestone 1 completo, Milestone 2 em 10 de 11, Milestone 3 completo,
Milestone 5 começado — seleção de sujeito por IA, ponta a ponta.** Abrir, decodificar, gerenciar cor, canvas, zoom, pan, girar,
espelhar, recortar com alças e proporções, empilhar camadas de ajuste com
opacidade, modo de mistura e máscara — **inclusive gerada por um modelo local** —,
desfazer/refazer, navegar pelo histórico, salvar e reabrir projetos,
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
(`libjpeg-turbo`, `libpng`, `libtiff`, `libwebp`, `lcms2`, `libzip`), o ONNX
Runtime e o modelo de segmentação, e `npm install`. A primeira execução leva
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

Sem GPU e sem pipeline em tiles — Milestone 4 em diante. Consequências visíveis
hoje:

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
- **O preview inteiro é um só buffer**, com teto de 24 MP. Enquanto o arrasto usa rascunho,
  o quadro final ainda paga o tamanho cheio; o pipeline em tiles do M4 é o que remove isso.
- **O fundo só vira transparente ou cor.** Preencher com uma imagem ou com um desfoque
  da própria foto (§19) ainda não existe; a camada matte já tem onde guardar a escolha.
- **A calibração dos níveis vem de uma única fotografia.** `SEGMENTED_LEVELS` foi medido
  num retrato real, o que é uma a mais que os fixtures sintéticos oferecem e muito menos do
  que a escolha merece. O ponto branco em particular é juízo, não medição.
- **A borda continua sendo contorno, não fios.** Os níveis e a descontaminação arrumam a
  cor e a extensão do halo, mas nenhum dos dois recupera fio de cabelo: para isso é preciso
  matting de verdade, que olha a fotografia e não só a máscara.
- **Aumentar usa bilinear**, que interpola mas não inventa nitidez. Um aumento grande fica
  macio, e é assim que deve ficar: o upscale que reconstrói detalhe é o item de IA do M5.
- **Um resize que reduz um eixo e aumenta o outro alia o eixo reduzido**, porque nesse caso
  os dois passam pela bilinear. É um resize deliberadamente distorcido; separar o filtro por
  eixo resolveria, e ainda não pagou o próprio custo.
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

### RAW

A §26 pede RAW quando o público é fotógrafo, e pede uma biblioteca madura em vez
de um decoder próprio. A escolhida é a **LibRaw**, por dois motivos que se
somam: ela é o que praticamente todo mundo usa fora da Adobe, e a licença fecha.

**LibRaw é dupla — LGPL-2.1 ou CDDL-1.0 — e a escolha é nossa. Tomamos a
CDDL-1.0.** O copyleft dela é por arquivo: alcança modificações nas fontes da
própria LibRaw e nada além, o que é o que a torna compatível com linkar
estaticamente dentro de um binário proprietário. O ramo LGPL, sob link estático,
não seria. Nada aqui modifica a LibRaw. A dependência transitiva nova é a
`jasper`, sob JasPer License 2.0, permissiva.

**O sniffer não consegue decidir sozinho.** CR2, NEF, ARW, DNG e PEF são
containers TIFF e têm os mesmos bytes iniciais de um TIFF comum; RAF, CR3, RW2 e
X3F têm assinaturas que o sniffer nunca viu. Então o `SniffFormat` continua
sendo só o número mágico, barato e puro, e quem decide é o `Decode`: se o sniff
deu TIFF ou desconhecido, ele pergunta à LibRaw, que parseia o cabeçalho e
recusa o que não for sensor. Continua valendo a regra da casa — o conteúdo
decide o formato, nunca a extensão — e há teste garantindo que um TIFF comum não
é sequestrado nesse caminho.

**A decodificação entrega direto no espaço de trabalho.** A LibRaw sabe emitir
ProPhoto linear em 16 bits, que é exatamente o espaço do engine, então é isso
que ela emite: `output_color = 4`, `gamm = {1,1}`, `output_bps = 16`. Nada de
`no_auto_bright` desligado e nada de reconstrução de altas-luzes — clarear e
recuperar highlights são gosto, e gosto mora na pilha de edição, não no decode.
Um decode tem que ser reproduzível a partir do arquivo.

Uma fixture sintética prova as duas coisas que importam. `tests/fixtures/dng.mjs`
escreve um DNG à mão — nenhuma câmera envolvida, nenhum arquivo de terceiro no
repositório —, e um quadro uniforme a meia escala sai em **[188, 188, 188]**:
cinza exato, e exatamente o valor que a curva sRGB dá para 0,5 de luz linear.
Se o ponto branco tivesse escorregado, apareceria como dominante; se algo
estivesse clareando por baixo do pano, o número seria outro. Um segundo DNG
declara uma câmera que registra o dobro de vermelho para o mesmo neutro e cai no
mesmo 188 — que é como se prova que o white balance do arquivo foi aplicado.

**A medição mudou o desenho duas vezes.** Um quadro de 24 MP abria em 7,7 s:

| | tempo | por MP |
|---|---|---|
| primeira ligação | 7,7 s | 321 ms |
| sem a transformação identidade | 3,4 s | 142 ms |
| com demosaic paralelo | **1,3 s** | 53 ms |

Os 4,3 s do primeiro corte eram uma **transformação de cor que não fazia nada**:
como o RAW já chega no espaço de trabalho, o lcms percorria 24 milhões de pixels
para não mudar nenhum, mais uma alocação e uma cópia da imagem inteira. O
`DecodedImage` ganhou um `in_working_space`, e quem abre move os pixels em vez
de convertê-los. Os 2,0 s seguintes eram o demosaic AHD num núcleo só; a LibRaw
compilada com a feature `openmp` faz o mesmo trabalho em 0,9 s. Isso acrescenta
`VCOMP140.DLL` às importações do engine, do mesmo redistribuível do Visual C++
que já fornece `MSVCP140` e `VCRUNTIME140` — o empacotamento ganha um arquivo,
não uma dependência nova.

**A Fujifilm era o outlier, e a medição resolveu.** X-Trans ladrilha 6×6 em vez
do 2×2 de Bayer, e o demosaic dele custava três vezes mais: 169 ms/MP contra
52-82 das outras. A LibRaw roda Markesteijn em três passagens acima de
`user_qual` 2 e em uma abaixo.

Medido nas duas pontas, em duas fotos X-Trans de caráter oposto — um gato de
pelo macio e um telhado com painéis solares, galhos nus e treliça, que é o
conteúdo que gera artefato de labirinto. Uma passagem custa 40% menos e a
diferença média é 0,04% da escala. Localizei o bloco de 256×256 onde os dois
mais discordam em cada imagem: indistinguíveis a 100%.

O número que decidiu foi a energia de detalhe, pela direção dela. Artefato de
labirinto é detalhe *falso*, então uma passagem com artefato teria energia
**maior**. É 0,6% menor — compatível com um pouco mais de suavização, não com
artefato. Ficou com uma passagem, e a Fuji entrou na mesma faixa das Bayer:
2,2 s para 24 MP contra 3,8 s antes.

**RAW é só de leitura, e o tipo diz isso.** O `ImageFormat` virou o que o engine
abre e um `ExportFormat` mais estreito virou o que ele escreve, porque não há
volta de pixels editados para um mosaico de sensor. As duas listas de filtros de
diálogo saem da mesma fonte que o guarda de caminhos usa, para que a caixa de
abrir e o guarda não possam discordar sobre o que abre.

### Temperatura e tint

Os outros cinco controles que a §26 pede — exposição, highlights, shadows,
sharpening, redução de ruído — já existiam como ajustes e funcionam sobre um
documento RAW como sobre qualquer foto. Estes dois não podiam: white balance
multiplica as leituras do sensor **antes** de o mosaico de cor ser interpolado,
e não existe caminho de volta a essas leituras a partir de pixels prontos.

Então o `developRaw` é a única operação da pilha que alcança atrás do decode.
Mudar a temperatura decodifica o arquivo de novo. O `Document` ganhou um segundo
buffer para isso, e o invariante que já existia foi mantido em vez de quebrado:
os pixels continuam imutáveis depois de produzidos, só que agora podem ser
**substituídos** por outro buffer, entregue por `shared_ptr`. Um render que já
está lendo continua com o seu enquanto o próximo pedido troca. O cache da
geometria passou a ter as configurações na chave — sem isso, mudar o white
balance deixaria a forma igual e devolveria alegremente a base construída com o
decode antigo.

**A matemática é a parte que precisa estar certa, e é verificável.** Temperatura
anda sobre o locus planckiano — as cores que um corpo negro emite ao esquentar —
e tint sai dele, que é o eixo que uma lâmpada fluorescente ou um reflexo de
folhagem empurram e nenhuma temperatura responde. O locus vem de um ajuste
cúbico publicado, não da tabela de Robertson: trinta e uma linhas de constantes
não dizem o que são. Conferido contra um padrão externo — a 2856 K ele dá
(0,4471, 0,4075) e o iluminante A da CIE é definido nessa temperatura como
(0,44757, 0,40745).

O tint é um deslocamento em CIE 1960 UCS e não em xy, porque lá as isotermas
cruzam o locus em ângulo reto e "fora do locus por tanto" significa a mesma
coisa a 3000 K e a 9000 K. **O sinal é o inverso da física, de propósito:** o
slider é rotulado pelo efeito na fotografia, e equilibrar para uma luz mais
verde significa corrigir para magenta. Um controle rotulado pela luz andaria ao
contrário para todo mundo que já usou um.

**A prova que vale é o round trip.** A temperatura lida dos multiplicadores da
própria câmera, devolvida como temperatura, tem que decodificar a mesma
fotografia — e decodifica, pixel a pixel. Isso atravessa o locus, a normal do
tint e a matriz da câmera nos dois sentidos, então qualquer erro em qualquer um
deles apareceria como dominante. Um Nikon Z 6 fotografado sob tungstênio lê
**3052 K**, que é onde tungstênio fica.

**Onde a matriz da câmera mora, e o que isso custa.** A LibRaw preenche a
`cam_xyz` a partir da tabela interna dela, que cobre os formatos proprietários.
Um DNG de câmera que não está na tabela deixa isso vazio e põe a matriz no
`dng_color`, declarada pelo próprio arquivo. Um DNG pode declarar **duas**,
medidas sob luzes diferentes, e a resposta correta interpola entre elas na
temperatura perguntada. Aqui pega-se a medida mais perto da luz do dia, e a
simplificação não é pequena: no DNG de um iPhone que traz as duas, o mesmo
arquivo lê 5463 K pela matriz de luz do dia e 4521 K pela de tungstênio.

Isso custa a precisão do número na tela, não a fotografia. O arquivo intocado é
revelado pelo balanço da própria câmera e não passa por essa matriz; depois de
uma temperatura ser escolhida, a mesma matriz converte nos dois sentidos, então
pedir a temperatura que o painel mostrou reproduz exatamente o que a câmera deu.

**O custo, medido:** cerca de 920 ms por mudança num arquivo de 13,8 MP, contra
30 ms quando o balanço é o da câmera e o decode já está em cache. É o decode
inteiro de novo, e não há como não ser. Por isso estes dois sliders são os
únicos do produto que **não** aplicam durante o arrasto: o `Slider` ganhou um
sinal de fim de gesto, o botão segue o dedo localmente e o engine só é chamado
quando o dedo levanta. A alternativa é um controle gaguejando um segundo atrás
da mão. Decodificar em meia resolução durante o arrasto cortaria isso para uns
250 ms e é o próximo passo óbvio, mas exige que o plano de preview saiba que a
fonte encolheu, o que não é uma linha.

**Recuperação de realce não entrou, e a medição é o motivo.** A §26 pede um
controle de highlights, e o slider que existe escurece realces que ainda têm
informação em vez de reconstruir um canal estourado a partir dos outros. Parecia
um parâmetro da LibRaw. Não é: o modo de realce está preso à normalização da
exposição pela linha `if (!highlight) dmax = dmin`. Em zero os multiplicadores
de white balance são escalados pelo menor deles, todo canal é multiplicado para
cima e o mais forte estoura — que é o brilho que as pessoas esperam. Em qualquer
outro modo são escalados pelo maior, nada estoura, e a foto inteira escurece
pela razão entre eles: **2,12× num Nikon Z 6**, mais de um stop.

Ou seja, recuperar realce precisa de um lugar para pôr os valores acima do
branco, e o buffer de trabalho é 16 bits sem sinal com o teto exatamente ali.
Fazer certo é dar espaço acima do branco no espaço de trabalho — mudança no que
um pixel significa, não um ajuste de parâmetro. Fica registrado como limite em
vez de escondido atrás de um padrão otimista.

**Os controles só aparecem quando podem responder.** Um arquivo sem matriz de
câmera utilizável não recebe slider nenhum, porque um slider que não move a
foto é pior que a ausência dele.

### Upscale, e o segundo modelo que não deu

A §23 pede 2×, 4× e preservação de detalhes. O caminho óbvio era um modelo, e
ele foi percorrido até o fim outra vez.

**A licença fecha:** Real-ESRGAN é BSD-3-Clause sem cláusula separada para os
pesos, lido no LICENSE e não num resumo. **O que não fecha é a procedência do
export.** O repositório oficial publica só `.pth`; das vinte buscas por um ONNX,
todas voltaram sem licença declarada no metadado, e as duas que declaram
`bsd-3-clause` por tag são uploads individuais sem como verificar de que pesos
vieram. Um re-export não rastreável não é coisa que se redistribui.

**E a medição encerrou a discussão de qualquer jeito.** O export melhor
documentado que achei — RRDBNet 23-block, o x4plus completo — custa **185 s por
megapixel de entrada** nesta CPU, três vezes e meia o SCUNet:

| entrada | saída | tempo |
|---|---|---|
| 800×600 | 3200×2400 | 1,5 min |
| 1000×1000 | 4000×4000 | 3,1 min |
| 3000×2000 | 12000×8000 | 18,5 min |

Uma ampliação 4× também multiplica o buffer de trabalho por dezesseis: uma foto
de 12 MP viraria 192 MP, que são 1,5 GB só de pixels.

**O que entrou foi o filtro certo em vez do modelo.** A ampliação usava
bilinear, que lê dois pixels por eixo e mistura — isto é, borra. Entrou
**Lanczos-3**, que lê seis por eixo através de um sinc janelado e reconstrói o
sinal entre as amostras em vez de mediar entre elas. Separável, em duas
passagens, com o intermediário em ponto flutuante: arredondar para dezesseis
bits entre elas jogaria fora exatamente a precisão que a segunda usa.

Medido contra o gabarito — uma fotografia reduzida a um quarto e devolvida ao
tamanho:

| filtro | erro vs. original | detalhe preservado | tempo |
|---|---|---|---|
| **Lanczos-3** | 1,79 de 255 | **65,6%** | 82 ms |
| bilinear | 1,95 de 255 | 54,8% | 79 ms |

Vinte por cento mais detalhe recuperado por 4% mais tempo. Contra os 185 s/MP do
modelo, são **duas mil vezes** mais barato — para uma diferença de qualidade que
o modelo teria, mas que ninguém pode esperar dezoito minutos para ver.

Isso melhora toda ampliação do produto, não só o botão: o zoom acima de 100% e
qualquer resize para cima passam pelo mesmo caminho.

**Dois testes, e ambos foram consertados depois de falharem em discriminar.** O
primeiro comparava uma redução e uma ampliação empilhadas — e o fold da pilha
pega o último resize, não a sequência, então os dois se cancelavam e o teste
comparava a foto consigo mesma. O segundo media a largura da transição numa
borda de alfa, e passava com bilinear também, porque o excesso do sinc bate no
clamp de 0 e 255 e some. O que ficou mede a energia de detalhe de uma ida e
volta materializada em disco: dá 7,2 com Lanczos e exatamente 5,0 com bilinear,
verificado trocando o filtro para ver o teste falhar.

### Retrato

A §24 pede oito ferramentas e um `Auto`. **Três já existiam**: ajuste e blur de
fundo são a camada matte com preenchimento `kBlur`, construída para remoção de
fundo, e remoção de imperfeições é o patch do LaMa, construído para remoção de
objeto. As outras cinco não precisaram de código novo de pixel nenhum.

**O modelo é o YuNet**, do OpenCV Zoo. A licença fecha e o detalhe importa: ele
tem um `LICENSE` **MIT dentro da própria pasta do modelo**, não herdado do
repositório — então os pesos estão cobertos e não só o código em volta. O
download é servido por `media.githubusercontent.com` porque o Zoo guarda os
modelos em git-lfs e a URL `raw.` devolve um ponteiro de 131 bytes, e o sha256
é conferido contra o que o repositório registra.

**E ele não é a parede de inferência:** 136 ms na primeira vez, **31 ms**
depois, com entrada fixa de 640×640 — o custo não depende do tamanho da foto,
como no U²-Net. Ao lado dos 4 s do LaMa e dos 53 s/MP do SCUNet, é de graça.

O YuNet responde em **doze tensores** — três escalas × classificação,
objetividade, caixa e cinco pontos — então o `Session` ganhou saída múltipla. A
decodificação das âncoras e o NMS ficaram separados da inferência, em função
pura: é onde os erros moram, e assim dá para testá-los sem o modelo.

**O corte é o mesmo do auto enhance: o engine mede, a interface decide.** O
`ai.detectFaces` reporta caixas e cinco pontos e para aí. Deliberadamente não
produz máscara — uma máscara já se compromete com o que a ferramenta é, e oito
ferramentas querem oito regiões diferentes dos mesmos cinco pontos. As regiões
são desenhadas no renderer e sobem por `mask.store`, o mesmo caminho do pincel,
então o resto da §24 é TypeScript testável que muda sem recompilar C++.

Cada ferramenta é **região gerada + ajustes que já existem**:

| ferramenta | região | ajustes |
|---|---|---|
| Pele | oval do rosto menos olhos e boca | `denoise` + `denoiseDetail`, `clarity` negativa |
| Luz do rosto | oval do rosto | `exposure`, `shadows` |
| Olhos | elipses nos dois pontos | `clarity`, `exposure`, `sharpen` |
| Dentes | boca, filtrada por claro e sem cor | `saturation` negativa, `brightness` |

Duas decisões que valem registro. **Recortar olhos e boca da máscara de pele** é
a maior parte da diferença entre suavizar e virar plástico: com os olhos
suavizados junto, o rosto para de ler como rosto. E **os dentes são a única
região que a geometria não desenha** — entre os cantos da boca há tanto dente
quanto lábio, e clarear lábio é exatamente o erro. O que separa os dois não é
forma, é cor: dente é a parte clara e sem cor de uma boca, lábio é a parte
colorida, qualquer que seja o formato de cada um. Uma boca fechada rende quase
nada, o que está certo — não há o que clarear ali.

A borda usa smoothstep e não rampa linear, porque uma rampa linear deixa um
vinco visível onde a queda começa: o olho lê a mudança de inclinação, não o
valor.

**Medido numa foto real.** Detecção em 135 ms, e as regiões cobrem 9,4% da foto
(pele), 17,3% (rosto), 1,1% (olhos), 1,0% (dentes). Com o `Auto` aplicado, a
diferença média dentro da caixa do rosto é 4,84 de 255 e fora dela 0,23 — vinte
e uma vezes mais dentro que fora, e o que sobra fora é ruído de recompressão.

**A limitação, dita em vez de escondida:** cinco pontos não são landmarks
densos. O oval do rosto é construído da caixa mais a linha dos olhos, que dá a
inclinação, e não contornado. Para as "ferramentas simples de retrato" que a
seção pede isso serve; se a suavização vazar no cabelo de alguém, é coisa que se
mede e se aperta, não que se redesenha.

**O `Auto` é conservador de propósito** — 40 de pele, 30 de olhos, 35 de dentes,
25 de luz. Um retrato que obviamente passou por retoque é uma fotografia pior
que um que não passou, e quem olha com mais atenção é a pessoa retratada.

### Inferência local

O engine carrega e roda modelos ONNX. A primeira operação é a **segmentação**:
`ai.segment` produz uma máscara de cobertura sobre o sujeito, que vira uma
máscara raster numa camada — a IA gera camada, como a §15 exige, em vez de
achatar pixel.

Três coisas que o [espinho](spikes/ai) mediu e que o desenho respeita:

- **O custo não depende do tamanho da foto.** O modelo sempre vê um quadrado
  pequeno; tudo antes e depois é reamostragem. Uma foto de 50 MP custa o que uma
  de 5 MP custa. Medido aqui: 421 ms na primeira vez, 276 ms depois.
- **Memória é a restrição, não velocidade.** Meio giga residente para o modelo
  pequeno. Nada é carregado por antecipação e a fila de jobs cobra 900 MB por uma
  inferência, o que impede duas de serem admitidas juntas.
- **A máscara é alfa contínuo.** Tratá-la como seleção binária jogaria fora
  exatamente a borda suave em torno do sujeito.

**Licenças são reportadas pelo `engine.describe`** porque são restrição de
produto. Só entram pesos com licença permissiva: MODNet, RMBG e ISNet são
não-comerciais e ficaram de fora.

**A seleção é o único preenchimento violeta do produto.** É onde um modelo toca
a imagem, que é exatamente o que a cor está reservada para significar.

Uma máscara raster guarda o tamanho de documento para o qual foi feita. Um
recorte depois move cada pixel debaixo dela, então em vez de esticá-la para algo
silenciosamente errado o engine a **descarta e reporta** — a camada volta a
aplicar em todo lugar, visivelmente, e a UI pode oferecer refazer.

### Máscaras

As máscaras de hoje são **descritas, não pintadas**: um gradiente linear ou
radial é meia dúzia de números. Isso resolve três problemas de uma vez — não
ocupam memória, não trazem binário para o projeto, e avaliam em qualquer
resolução sem nada ser reamostrado no caminho. A mesma máscara vale para um
preview de 60 px e para uma exportação de 24 MP, e há teste comparando as duas.

Coordenadas são frações do documento; distâncias usam o **lado mais curto** como
unidade, que é o que mantém uma máscara radial circular num quadro que não é
quadrado.

Máscaras geradas são pixels e vivem no diretório `masks/` do container, uma PNG
em tons de cinza por máscara — em tons de cinza porque é o que uma máscara é, e
porque abrir `masks/1.png` em qualquer visualizador deve mostrar a máscara, não
um enigma.

### Reduzir ruído, e um modelo que não deu

A §22 pede redução de ruído com controles de intensidade e preservação de
detalhes. O caminho óbvio era o mesmo do LaMa — achar um modelo permissivo,
baixar, integrar —, e ele foi percorrido até o fim: **SCUNet**, Apache-2.0 sem
cláusula separada para os pesos, com export ONNX de entrada dinâmica em altura e
largura. Tudo certo, menos uma coisa.

**Cinquenta e três segundos por megapixel na CPU.** Medido em dois tamanhos, com
escala linear: dez minutos para uma foto de celular de 12 MP, vinte e um para
24 MP. Ladrilhar não ajudaria — o custo é linear no número de pixels, então
tiles mudam a memória e não a espera. É a arquitetura: um híbrido
Swin-transformer de dezoito milhões de parâmetros.

Então o denoise que existe é **clássico, e roda em toda máquina**: um filtro
guiado. Para cada vizinhança ele ajusta a reta que melhor prevê a imagem a
partir dela mesma, e o `epsilon` é quanta variância ele aceita chamar de ruído
em vez de sinal. Onde a variância está muito acima disso — uma borda — o ajuste
é a identidade e nada é tocado; onde está muito abaixo — grão chapado — ele
colapsa na média local e o grão vai embora. Custa o mesmo em qualquer raio,
porque tudo nele é média de caixa, e média de caixa é soma corrente: os mesmos
`BoxHorizontal`/`BoxVertical` que a nitidez já usava.

**~0,17 s/MP**, contra 53. Trezentas e vinte vezes mais rápido, dois segundos
numa foto de 12 MP na exportação.

Ele filtra no domínio **codificado**, não em luz linear: em luz linear o grão de
uma sombra é numericamente minúsculo e seria poupado, embora seja justamente o
grão que as pessoas veem. E usa **um guia só** para os três canais, para que
sejam suavizados ao longo da mesma estrutura e uma borda não se desfaça em
franjas coloridas.

Os dois controles da §22 caem naturalmente: **intensidade** é o epsilon, e
**preservar detalhe** repõe a diferença de brilho que a suavização custou. Ruído
de cor vai embora inteiro e não volta — suavizar cor não custa detalhe nenhum,
porque detalhe é carregado pelo brilho, e ruído de cor é a metade que vale
remover sem dó. O denoise roda **antes** de nitidez e clareza, porque afiar
ruído é como um denoiser leva a culpa por piorar a foto.

O SCUNet ficou na árvore, com licença verificada e conversão correta, alcançável
por `ai.denoise` e por nada na interface. No dia em que a inferência rodar na
GPU ele vira o denoiser melhor e o filtro guiado continua sendo o que funciona
em qualquer lugar. Ele não está no `setup-windows.bat` de propósito: setenta
megabytes por algo inalcançável não é um download para fazer alguém esperar.

### Melhorar foto

A §21 pede uma função que analise a fotografia e **gere uma lista explícita de
alterações**, e é categórica: *"a aplicação nunca deve aplicar alterações
silenciosamente"*. Isso não é um detalhe de interface, é o desenho inteiro.

A divisão é entre **medir e decidir**. Medir é aritmética e está no engine:
histograma de luminância, média por canal, distância média do cinza, diferença
média entre pixels vizinhos. Decidir o que uma medida vale — que uma foto está
chapada, que uma dominante quer correção — é **gosto**, e gosto está em
`lib/enhance.ts`, no renderer, onde dá para mudar sem recompilar, ler sem
compilador e testar como função pura.

A medição roda num quadro de no máximo 1024 px. Um histograma de um milhão de
pixels diz o mesmo que um de vinte e quatro milhões sobre como uma foto está
exposta, e alguém está esperando a resposta.

Cada regra é um limiar e uma proporção, e cada proposta mostra **a medida que a
gerou** — "20 % da foto no escuro", "usa 60 % da escala". Uma proposta errada
fica discutível em vez de misteriosa. Nada é aplicado sem ser marcado, e o que é
aplicado **soma ao que já está lá**: a proposta é uma melhoria da foto como ela
está, não um veredito sobre ela.

Duas regras nasceram erradas e o teste as pegou. Eu media as pontas do
histograma por **fração fixa** — "mais de 12 % abaixo do nível 40 quer sombras
levantadas" —, e isso propõe consertar uma fotografia distribuída uniformemente
por toda a escala, que é uma fotografia boa. O teste certo é **densidade**: a
ponta escura segura mais por nível do que o meio? Uma imagem uniforme mede
exatamente 1,0 e não quer nada; um quinto de imagem empilhado perto do branco
mede 1,45 e quer. O limiar ficou entre os dois, e está escrito por quê.

**O que não está aqui:** "reduzir ruído", que o exemplo da spec cita. Não existe
denoise ainda (§22 é outro milestone), e propor o que não se sabe fazer seria
mentir na lista.

### Não perder trabalho

Um relato de uso encontrou três buracos que os testes não encontrariam, porque
nenhum deles está no engine. O engine persiste tudo: os treze ajustes sobrevivem
a salvar e reabrir idênticos bit a bit, e há teste disso. O que faltava era em
volta.

**A aplicação fechava descartando edições sem perguntar.** O autosave é uma rede
contra queda e é limpo numa saída limpa, justamente porque uma saída limpa
deveria significar que o usuário teve a chance de decidir — só que essa chance
não existia. Agora a janela pergunta, e um salvamento cancelado no diálogo de
arquivo não conta como salvo: a janela fica aberta em vez de tomar o silêncio
por consentimento.

**Um projeto salvo não entrava nos recentes**, então o único caminho de volta a
ele era o diálogo de arquivo — a lista que acabara de ser construída não ajudava
em nada.

**E uma foto não lembrava do projeto dela.** Abrir `foto.jpg` pelos recentes dava
a foto crua mesmo existindo um `foto.myphoto` ao lado com todo o trabalho. Agora
salvar registra o vínculo e **o projeto toma o lugar da foto na lista**: uma vez
que o trabalho existe, oferecer a fotografia intocada é oferecer recomeçar. A
lista carrega os dois tipos, marcados por glifo, e cada um abre pela porta certa
— ler um projeto como se fosse foto perderia a pilha inteira.

### Presets, e o banco que eles pediram

A §25 abre com *"presets devem existir desde o lançamento"*, e a §30 pede SQLite
para dados estruturados. As duas se resolvem juntas, e a spec já tinha resolvido
a parte difícil: *"presets devem armazenar parâmetros de edição, não imagens
renderizadas"* — que é exatamente o que a pilha de edição já é. Um preset é um
punhado de números, aplicar um é uma operação comum, e o desfazer o desfaz como
qualquer outra.

**O banco é `node:sqlite`.** O Electron 44 traz o Node 24, que o tem embutido, o
que evita um módulo nativo que precisaria ser recompilado contra a ABI do
Electron a cada atualização — a mesma troca que este projeto já tinha feito ao
escolher um processo separado em vez de um addon. Ele guarda `presets`,
`recent_files` e `settings`, e nada grande: os pixels continuam no engine e no
container do projeto.

**Os presets que vêm com o app não são linhas do banco**, são uma constante em
`@photoy/types`. Assim eles viajam com a versão que os define, não podem ser
perdidos nem editados até deixarem de corresponder ao próprio nome. Só os do
usuário vão para o SQLite. Os valores que escrevi são ponto de partida: foram
raciocinados, não testados em algumas centenas de fotografias, que é o único
jeito de acertar números desses.

Um `adjust` passou a poder carregar um nome, para o histórico dizer
"Predefinição · Paisagem" em vez de "Ajustes · 7 controles".

Também matou o stub: **arquivos recentes** era literalmente uma função que
devolvia lista vazia. Os caminhos são conferidos na saída e não na entrada — um
arquivo pode ser movido entre uma execução e outra, e oferecer para abrir algo
que não está mais lá é pior que não oferecer.

### Comparar com o original

A §7 pede comparação antes/depois ao lado de zoom e pan. O "antes" é a fotografia
**com o enquadramento atual e nada feito a ela** — enquadramento, e não o arquivo
como foi decodificado, para que o que se move entre as duas vistas seja a edição
sendo julgada e não o formato da imagem. No engine é uma linha: compor com a
lista de camadas vazia.

Isso derruba camadas junto com sliders, o que importa: remoção de fundo e de
objeto são camadas, e são exatamente o tipo de edição que alguém quer ver
desfeita por um instante.

É **segurar**, não alternar — na barra de ferramentas ou na tecla `\`. Um
alternador deixaria a tela mostrando uma coisa que não é a foto sem nada dizendo
isso. O "antes" fica guardado ao lado do preview, então segurar é instantâneo
depois da primeira vez e soltar é sempre; ele é descartado quando a pilha muda,
porque aí passou a ser retrato de um antes que não é mais o antes.

### Os seis ajustes que faltavam

Matiz, vibração, vinheta, grão, nitidez e clareza fecham a lista da §9. Eles se
dividem em três grupos por uma razão de arquitetura, não de gosto.

**Matiz é de graça.** Uma rotação de matiz é linear, e exposição e balanço de
branco já são multiplicados numa matriz só — então matiz entra nela e não custa
nada por pixel. A rotação em si é Rodrigues em torno do eixo neutro, que é o que
faz um cinza continuar **exatamente** cinza em vez de quase. Isso sozinho move a
luminância das cores saturadas, então é corrigido por uma atualização de posto
um: com pesos que somam um, `R + 1 (w^T (I - R))` gira igual a R e deixa `w . x`
intacto para todo x — e continua sendo uma matriz. Medido: um cinza sai idêntico,
e uma cor dentro do gamute mantém Y em 0,2387 → 0,2385. Um primário totalmente
saturado sai do gamute sRGB e o preview de 8 bits recorta, o que muda a
luminância por um motivo que não tem nada a ver com a matriz.

**Vibração, vinheta e grão** cabem no laço por pixel, que já recebe (x, y). A
vibração pesa o ganho pelo quanto a cor já tem de saturação, que é o que a separa
da saturação comum. O grão precisou de mais uma informação: a **escala do render**.
Ele pertence à fotografia, não à tela, então é amostrado em coordenadas do
documento e a amplitude é reduzida com a escala do jeito que uma média reduziria
— sem isso, o grão do preview teria o tamanho errado na exportação.

**Nitidez e clareza não cabem**, e é a primeira coisa neste engine que não cabe.
As duas são a diferença entre um pixel e uma versão borrada do que o cerca, então
precisam de uma passagem própria sobre um buffer (`edit/detail.cpp`). Uma camada
que carrega uma delas deixa de poder ser fundida na conversão de cor. As duas
agem só sobre luminância: afiar cada canal separadamente põe franja colorida em
toda borda, e nenhum dos dois controles é sobre cor.

Custou caro na primeira versão — **+280 ms** num quadro de 2,2 MP, triplicando o
render. Duas medições depois:

- **O `pow` por pixel era metade do custo da clareza.** O peso de meios-tons é uma
  curva suave de uma variável; virou tabela de mil entradas.
- **A passagem vertical do desfoque andava na memória com passo de uma linha
  inteira.** Reescrita para carregar uma soma corrente por coluna e percorrer as
  linhas em ordem, ela lê os dois buffers sequencialmente.

Juntas: **+280 ms viraram +72 ms**. E durante um arrasto o rascunho sai em metade
da resolução, então são cerca de 18 ms.

### O pincel de máscara

Máscaras eram descritas (linear, radial) ou geradas (segmentação). Faltava a
terceira: **desenhada**. Ela é o dispositivo de entrada da remoção de objeto — não
há como marcar um objeto arbitrário com um gradiente — e é o remendo que faltava
para corrigir um erro de segmentação sem refazer nada.

O pincel é **duro, e isso é escolha**. A tela em que ele pinta *é* a máscara:
violeta em alfa cheio onde o pincel passou, nada onde não passou, de modo que o
mesmo buffer é o que aparece na tela e, lido pelo canal alfa, o que vai para o
engine. Traços opacos sobrepostos são idempotentes; um pincel macio acumularia
uma costura mais escura em todo lugar onde o traço cruza a si mesmo. E máscara
dura é o que o inpainting quer. Se um dia fizer falta suavidade, o ponto preto e
o ponto branco da máscara já estão lá.

O tamanho é **porcentagem do lado mais curto**, não pixels — a unidade que todas
as outras máscaras daqui usam. Significa a mesma coisa numa foto de celular e num
escaneamento, e sobrevive a um resize.

A máscara é pintada e guardada com no máximo 2048 px de lado. Ela viaja inteira
para o engine a cada traço, então pintar no tamanho de uma foto de 24 MP mandaria
24 MB por traço para descrever uma borda que o engine vai reamostrar de qualquer
jeito. **Um traço é um passo do histórico**: o engine só fica sabendo quando a mão
sai.

Isso exigiu duas coisas novas no protocolo. `mask.store` leva bytes no *payload*
do pedido — até então só as respostas carregavam payload — e `mask.fetch` devolve
uma máscara guardada, que é o que permite o pincel continuar de onde a
segmentação parou em vez de começar do zero. O tamanho declarado no cabeçalho é
conferido contra o payload: confiar nele leria as linhas nos deslocamentos
errados e cisalharia a máscara, que é o tipo de falha que ninguém atribuiria ao
pincel.

### Remover objeto

O modelo é o **LaMa**, e a licença foi verificada antes de qualquer código: li o
LICENSE de `advimman/lama` (Apache-2.0, sem cláusula separada para os pesos) e o
do repositório da OpenCV que redistribui o export ONNX, não um resumo de nenhum
dos dois. O arquivo é o da OpenCV — 92 MB contra 208 MB do export original,
entradas nomeadas `image` e `mask`, e o `lama.py` deles serve de especificação
executável do pré-processamento.

A entrada é **fixa em 512 × 512**, o que decide o desenho: o inpainting roda numa
**janela em torno da marcação**, não na foto inteira. O custo passa a ser função do
tamanho do que se está apagando e não dos megapixels — a mesma lição que a
segmentação já tinha ensinado — e cada pixel fora da janela fica exatamente como
estava, em vez de sobreviver a uma ida e volta por um reamostrador. A janela tem
o dobro do lado da marcação, porque inpainting é extrapolação a partir do
entorno: uma janela cortada rente à marca não deixaria de onde extrapolar.

#### O patch é uma camada, e guarda só o que o modelo sabe

O resultado vira uma **camada de tipo patch**, pelo mesmo motivo que a remoção de
fundo virou camada: dá para desfazer, esconder, reduzir a intensidade e refazer.
A camada guarda duas coisas separadas — os pixels que o modelo inventou e a
máscara que marcou o objeto — e **a mistura acontece na composição**. Isso é o que
permite corrigir a marca com o pincel depois, sem rodar o modelo de novo.

Um patch é guardado **como o modelo o produziu**: sRGB de 8 bits, na resolução do
modelo. Converter e ampliar para o tamanho do documento antes de guardar seria
guardar interpolação e chamar de detalhe. A conversão e a reamostragem acontecem
por render, em cache ao lado do documento, exatamente como uma máscara ajustada.
No `.myphoto` ele vai para `patches/` como PNG comum, que é o que deixa abrir
`patches/1.png` em qualquer visualizador e ver o que foi pintado na fotografia.

Isso expôs um erro que já existia: **a exportação entregava as máscaras sem
reamostrar**. `CompiledMask` procura por índice de pixel, então uma máscara
guardada num tamanho diferente do render seria lida nos deslocamentos errados —
invisível enquanto todas as máscaras vinham da segmentação, que as produz no
tamanho natural, e quebrado assim que o pincel passou a guardá-las em até 2048.
Agora a exportação reamostra máscara e patch para o tamanho de saída.

#### O que custa, e o que não está verificado

Carregar o modelo leva ~7 s, uma vez. Cada inferência leva **3,6 a 4,5 s**, e é
constante, porque a janela sempre vira 512. Isso é lento para um editor: a
segmentação leva 0,7 s. Ainda não investiguei se o gargalo é o LaMa ser pesado ou
a configuração do runtime — e depois de ter otimizado a peça errada uma vez neste
projeto, não vou chutar.

**A ordem dos canais não está verificada.** A implementação de referência da
OpenCV alimenta o modelo com uma imagem de `cv.imread`, que é BGR, e não troca —
então seguimos a referência (`kModelWantsBgr`). Mas a troca é simétrica na
entrada e na saída, o que a torna **invisível em fidelidade de cor**: o que ela
afeta é a qualidade do preenchimento, e julgar isso pede uma fotografia de
verdade. Nos fixtures sintéticos não dá para distinguir.

### Remover fundo

Remover o fundo **é uma camada**, não uma alteração da fotografia. A camada de
tipo *matte* carrega uma máscara — normalmente a que a segmentação produziu — e
tudo que a máscara não marca deixa de aparecer. Os pixels continuam lá: dá para
desfazer, suavizar a borda, inverter, esconder a camada ou trocar o fundo depois
sem segmentar de novo. É a mesma razão de a pilha de edição ser o estado.

O que entra no lugar do fundo são as quatro que a §20 pede menos a gerada por
IA, que a própria spec classifica como experimental: **transparente, cor,
desfoque e imagem**.

**Desfoque** reaproveita a estimativa de fundo que a descontaminação já usava —
a mesma construção, com a grade e o raio como parâmetros em vez de opiniões
fixas. Ela é montada **só a partir dos pixels que a máscara chama de fundo**, e é
por isso que o sujeito não vira um halo em volta de si mesmo: desfocar o quadro
inteiro arrastaria a cor dele para fora. Como um desfoque pesado é liso por
construção, montá-lo numa grade pequena e amostrar de volta é indistinguível de
fazê-lo inteiro, e custa um dezesseis avos.

**Imagem** não precisou de máquina nova: um fundo é pixels guardados colocados no
documento, que é exatamente o que um patch já é. A camada aponta para ele do
mesmo jeito, e ele viaja dentro do `.myphoto` porque patches já viajam. A imagem
é recortada para a forma do documento e escalada para preenchê-lo — recortada, e
não esticada, que é a diferença entre um fundo e um fundo espremido.

Um detalhe que só aparece na exportação: **JPEG não tem canal alfa**. Deixar o
encoder simplesmente descartá-lo traria o fundo removido de volta, calado, o que
é pior que qualquer falha visível. Então quando o formato não carrega alfa a
imagem é composta sobre branco antes de sair — e a composição acontece no espaço
de trabalho, em luz linear, para que uma borda suave misture luz e não valores
já codificados. `FormatCarriesAlpha()` em `export/encode.cpp` é a única coisa que
decide isso; há teste que exporta em JPEG e confere que o canto ficou branco, e
não o fundo original.

O preenchimento por cor é escolhido em sRGB, na UI, e convertido para o espaço de
trabalho **uma vez**, quando a camada é compilada — não por pixel.

#### O mapa de saliência não é uma seleção

A primeira versão entregava a saída do U²-Net crua como alfa, e numa fotografia
de verdade isso produziu duas falhas visíveis: uma faixa diagonal de fundo que
sobrou flutuando no quadro, e um halo pálido em volta do cabelo. Medindo a
máscara, as duas têm a mesma causa. A faixa tem alfa **médio 8 e máximo 73**, de
255 — o modelo nunca acreditou nela, e nós é que a estávamos exibindo. O halo é a
outra ponta: uma faixa larga de alfa baixo mantendo pixels do prédio
parcialmente opacos.

Daí os dois controles, ambos em `Mask`:

**Níveis (`low`, `high`)** são o ponto preto e o ponto branco da *confiança* do
modelo. Com corte em 0,25 a faixa cai para 1 % da sua área enquanto o cabelo
mantém 30 % — quer dizer, custa só os fios mais fantasmagóricos. Uma máscara
recém-segmentada nasce em `SEGMENTED_LEVELS`, não em identidade, porque
identidade é o que estava medidamente errado. São sliders: um sujeito que é
mesmo macio recupera a faixa inteira.

**Descontaminação (`Layer::decontaminate`)** resolve o que sobra, que não é alfa
e sim *cor*. Num contorno suave o pixel é uma mistura, `C = F·α + B·(1-α)`;
compor essa mistura sobre o fundo novo carrega o fundo velho junto. Resolver
para `F` desfaz isso, e precisa saber quem era `B` — daí `edit/decontaminate.cpp`,
que estima o fundo numa grade de 192 células a partir dos pixels que a máscara
chama de fundo e espalha esse valor para dentro. A grade é grosseira de
propósito: o fundo perto de uma borda varia devagar, e uma grade grosseira não
tem como inventar detalhe próprio.

Medido no retrato de teste: dos 201.254 pixels totalmente cobertos, **a maior
mudança foi 0** — a descontaminação não toca a fotografia onde ela está inteira.
Dos 4.873 pixels de borda, 97 % mudaram, e a luminância média caiu de 136,6 para
118,1: é o bege do prédio saindo do cabelo.

O custo é proporcional à largura da borda, não ao tamanho da imagem. Num export
de 4,7 MP com borda fina a descontaminação não aparece na medição; com uma borda
artificialmente larga (uma radial de 20 % de suavização) ela custa ~240 ms, todo
ele no unmix por pixel. A estimativa do fundo em si custava 35 ms até passar a
amostrar com passo em vez de ler todo pixel — a grade tem 192 células, ler
milhões de pixels para preenchê-la era desperdício. Vale registrar que otimizei o
passo errado primeiro: só medindo com borda fina e com borda larga separadamente
é que ficou claro onde o tempo estava.

### Latência do arrasto

Um slider arrastado tinha dois problemas somados, e o menor era o que eu achava
que era o maior.

O grande era **estrutural**: cada mudança agendava o render atrás de um debounce
de 180 ms que se reiniciava a cada evento do ponteiro. Enquanto o dedo estava se
movendo, portanto, o canvas **não atualizava nada** — só depois de você parar. O
debounce existe para que uma roda de mouse ou um redimensionamento de janela não
enfileirem um render por evento; num arrasto ele estava impedindo exatamente o
que devia acontecer. Durante um gesto o atraso passou a ser zero, e o que evita a
enxurrada é um guarda de "um render em voo por vez, com uma repescagem depois" —
que é o comportamento certo de qualquer jeito, porque enfileirar renders que o
engine só vai cancelar é trabalho jogado fora.

O segundo é a **resolução**. Durante o gesto o preview sai em metade da largura e
metade da altura, o que é um quarto dos pixels e cerca de um quarto dos dois
custos que importam: a composição e a volta pelo pipe. Medido numa foto de
2600 × 1800, um quadro de arrasto caiu de **94,2 ms a 1800 px para 21,7 ms a
900 px** — de 9,0 MB para 2,2 MB no transporte. O quadro que encerra o gesto é
renderizado em tamanho cheio, então o que fica na tela nunca é o rascunho.

A política de tamanho virou `previewTarget()` em `lib/preview.ts`, fora do
componente, porque é a única decisão do laço de render e tem três motivos para
dizer não. Tem suíte própria — inclusive o caso que deixaria um quadro macio na
tela se a escala do rascunho um dia chegasse perto de 1.

Isso também corrigiu a regra de vizinho-mais-próximo. Ela existe para mostrar a
grade de pixels **da fotografia**, então só se aplica quando o preview carrega
esses pixels um para um; um rascunho já é interpolação, e desenhá-lo em blocos
duros mostraria uma grade que não é a da foto.

### Tamanho

`resize` é uma transformação como o crop e a rotação, não uma opção de
exportação: entra na pilha, desfaz, e a fotografia embaixo continua com todos os
pixels com que chegou. Por isso `Geometry` carrega duas coisas separadas — o
`source_rect` diz **quais** pixels sobrevivem e o `target` diz em **quantos** eles
se transformam. São perguntas independentes, e precisam continuar independentes
para a pilha poder ser reproduzida em qualquer ordem.

Daí saem três comportamentos que valem registro, cada um com teste:

- **Um quarto de volta leva o tamanho junto.** O tamanho pedido está em
  coordenadas de saída, então girar 90° troca largura por altura.
- **Um crop depois de um resize mantém a escala.** Recortar pega um pedaço menor
  da fotografia; não muda o tamanho de um pixel. O retângulo do crop vem
  expresso no que o usuário vê, então volta pela escala do resize antes de
  virar coordenadas da origem, e o `target` é recalculado para segurar a razão.
- **Reduzir usa filtro de caixa, aumentar usa bilinear.** Um filtro de caixa média
  os pixels de origem sob cada pixel de destino — aumentando existe no máximo um
  deles, e o resultado seria vizinho-mais-próximo. Tem teste com uma borda dura,
  porque num gradiente de 8 bits os degraus interpolados quantizam de volta em
  repetições e o teste não distinguiria nada.

Um resize também expôs um erro que já estava plantado: **uma máscara raster estava
amarrada ao tamanho de saída**. Como um resize muda esse tamanho, redimensionar
depois de remover o fundo teria feito a remoção desaparecer calada. A máscara
pertence à *geometria* — recorte e orientação —, não ao tamanho de saída: um
resize escala todos os pixels juntos e deixa a máscara significando o que
significava, enquanto um crop ou uma rotação os afasta. Por isso `edit.history`
reporta `naturalWidth`/`naturalHeight` além de `width`/`height`, e é contra
aqueles que a obsolescência é medida. Há teste dos dois lados: sobrevive a um
resize, não sobrevive a um crop.

A estimativa de memória da exportação passou a dobrar a pilha em vez de olhar o
arquivo, porque quem decide o tamanho do export agora é o resize e não o decode —
dimensionar pelo arquivo admitiria na fila um job que a máquina não segura.

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
  ai/         gerenciador de modelos e segmentação
  color/      definição dos espaços, perfis ICC, matriz derivada e conversão rápida
  image/      buffer RGBA8/RGBA16, resample, orientação
  decoder/    sniffer, marcadores JPEG, EXIF, jpeg, png, tiff, webp, raw
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
