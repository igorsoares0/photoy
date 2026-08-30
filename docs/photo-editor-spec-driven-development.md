# Photo Editor Desktop — Spec-Driven Development

## 1. Visão do Produto

Um editor de fotos desktop moderno, local-first e fácil de aprender, com edição não destrutiva e IA integrada.

O produto será construído para funcionar principalmente offline. A edição das imagens e as operações de IA devem ocorrer localmente sempre que os modelos necessários estiverem disponíveis.

### Princípios

- Local-first / offline-first.
- Sem necessidade de conta para editar.
- A imagem original nunca deve ser destruída.
- Operações pesadas não podem bloquear a UI.
- React cuida da interface.
- Electron cuida da aplicação desktop e orquestração.
- C++ é responsável pelo processamento de imagem e operações pesadas.
- IA deve ser abstraída do frontend e integrada ao engine.
- UX deve transformar operações complexas em ações simples.

---

# 2. Objetivos da V1

A V1 deve entregar um editor comercialmente viável com:

- abertura e exportação de imagens;
- edição básica e avançada;
- camadas;
- máscaras;
- presets;
- projetos não destrutivos;
- histórico e undo/redo;
- processamento acelerado;
- IA local;
- assistente de edição por linguagem natural;
- organização básica de projetos.

A V1 não pretende competir com todo o escopo de Photoshop ou Lightroom.

---

# 3. Stack

## Frontend

- React
- TypeScript
- Zustand
- Tailwind CSS

## Desktop

- Electron
- Node.js
- TypeScript

## Native Engine

- C++
- CMake

## Database

- SQLite

## AI

- Runtime de inferência local, preferencialmente ONNX Runtime ou equivalente conforme os modelos escolhidos.

## Image Processing

O engine deve utilizar bibliotecas maduras para codecs e formatos de imagem, evitando implementar codecs do zero.

Suporte inicial:

- JPEG
- PNG
- TIFF
- WebP
- RAW através de biblioteca madura quando incluído na V1.

---

# 4. Arquitetura

A regra principal da arquitetura é:

> React desenha. Electron orquestra. C++ processa.

```text
┌──────────────────────────────────────────────────────────────┐
│                         ELECTRON                             │
│                                                              │
│  ┌───────────────────────┐       ┌────────────────────────┐ │
│  │       React UI        │       │   Electron Main        │ │
│  │                       │◄─────►│                        │ │
│  │ Canvas                │       │ IPC                    │ │
│  │ Layers                │       │ Filesystem             │ │
│  │ Adjustments           │       │ Project management     │ │
│  │ Masks                 │       │ Native integration     │ │
│  │ AI controls           │       │ Licensing              │ │
│  └───────────────────────┘       └───────────┬────────────┘ │
│                                              │              │
└──────────────────────────────────────────────┼──────────────┘
                                               │
                                         Native Bridge
                                               │
                                               ▼
                              ┌──────────────────────────────┐
                              │          C++ ENGINE           │
                              │                              │
                              │ Image processing             │
                              │ Color management             │
                              │ Compositing                  │
                              │ Masks                        │
                              │ GPU                          │
                              │ AI inference                 │
                              │ Export                       │
                              │ Project processing           │
                              └──────────────────────────────┘
```

---

# 5. Responsabilidades por Camada

## React

Responsável por:

- UI;
- canvas/interface de edição;
- toolbar;
- sliders;
- layers panel;
- masks UI;
- presets;
- histórico;
- dialogs;
- crop;
- brush;
- seleção;
- controles de IA;
- assistente;
- feedback de processamento.

React não deve executar processamento pesado de imagem.

---

## Electron Main

Responsável por:

- criação e gerenciamento das janelas;
- filesystem;
- dialogs nativos;
- drag & drop;
- abertura de arquivos;
- salvamento;
- gerenciamento de projetos;
- comunicação IPC;
- ciclo de vida do C++ engine;
- cache de aplicação;
- recentes;
- favoritos;
- configurações;
- licensing/activation quando necessário;
- auto update;
- crash recovery.

O renderer não deve possuir acesso irrestrito ao filesystem.

---

## C++ Engine

É o núcleo do produto.

Responsável por:

- decoding;
- encoding;
- processamento de imagem;
- ajustes;
- transformações;
- composição;
- layers;
- masks;
- previews;
- cache;
- GPU;
- processamento RAW;
- IA;
- exportação;
- operações assíncronas;
- processamento em alta resolução.

---

# 6. Estrutura do Repositório

```text
photo-editor/
│
├── apps/
│   ├── desktop/
│   │   ├── electron/
│   │   └── renderer/
│   │
│   └── native/
│       ├── src/
│       │   ├── core/
│       │   ├── image/
│       │   ├── decoder/
│       │   ├── engine/
│       │   ├── adjustments/
│       │   ├── masks/
│       │   ├── gpu/
│       │   ├── ai/
│       │   ├── project/
│       │   └── export/
│       │
│       └── CMakeLists.txt
│
├── packages/
│   ├── types/
│   ├── ipc/
│   ├── project-schema/
│   └── ui/
│
├── models/
│
├── tests/
│   ├── engine/
│   ├── project/
│   ├── ai/
│   └── integration/
│
├── scripts/
│
└── CMakeLists.txt
```

---

# 7. Fundamentos do Editor

## Importação

A aplicação deve permitir:

- abrir JPG;
- abrir PNG;
- abrir TIFF;
- abrir WebP;
- drag & drop;
- abrir projetos `.myphoto`.

## Exportação

A aplicação deve permitir exportar:

- JPG;
- PNG;
- TIFF;
- WebP.

O sistema deve preservar metadados EXIF quando tecnicamente possível.

## Navegação

Deve existir:

- zoom;
- pan;
- navegação fluida;
- comparação antes/depois.

---

# 8. Transformações

O editor deve suportar:

- crop livre;
- crop com proporções predefinidas;
- rotação;
- flip horizontal;
- flip vertical;
- resize.

O crop e transform devem ser não destrutivos enquanto o projeto estiver sendo editado.

---

# 9. Sistema de Ajustes

## Ajustes básicos

O editor deve oferecer:

- exposição;
- brilho;
- contraste;
- highlights;
- shadows;
- blacks;
- whites;
- saturação;
- vibrance;
- temperatura;
- matiz;
- nitidez;
- clareza/estrutura;
- vinheta;
- grain.

## Ajustes avançados

A V1 deve prever suporte para:

- curvas;
- HSL;
- color balance;
- RGB;
- blend modes;
- opacity.

A interface deve manter os controles avançados separados dos ajustes básicos para não sobrecarregar usuários iniciantes.

---

# 10. Image Engine

O engine deve operar com um pipeline não destrutivo.

```text
Original
   ↓
Decode
   ↓
Color Management
   ↓
Transform
   ↓
Adjustment Layers
   ↓
Masks
   ↓
AI Layers
   ↓
Compositing
   ↓
Preview / Export
```

A mesma estrutura deve permitir renderização em diferentes resoluções.

---

# 11. Preview e Alta Resolução

O engine deve diferenciar:

- thumbnail;
- preview;
- renderização full resolution.

Durante a interação:

```text
User changes slider
        ↓
Preview render
        ↓
GPU/optimized pipeline
        ↓
UI update
```

No export:

```text
Project
   ↓
Full Resolution Pipeline
   ↓
Color Conversion
   ↓
Encoder
   ↓
Final File
```

A aplicação não deve recalcular a imagem inteira em resolução máxima a cada alteração de slider.

---

# 12. Performance

A V1 deve priorizar:

- preview em tempo real;
- GPU acceleration;
- processamento em background;
- cache de previews;
- edição não destrutiva;
- carregamento de modelos sob demanda;
- cancelamento de operações pesadas.

Operações como:

- denoise;
- upscale;
- inpainting;
- AI segmentation;
- RAW processing;
- export;

devem executar fora da UI thread.

---

# 13. Job System

O C++ engine deve possuir uma fila de jobs.

```text
UI
 │
 ▼
Job Queue
 │
 ├── Worker
 ├── Worker
 ├── Worker
 └── Worker
```

Cada operação pesada deve possuir:

- ID;
- status;
- progresso;
- possibilidade de cancelamento;
- resultado;
- erro.

Estados:

```text
queued
running
completed
cancelled
failed
```

---

# 14. GPU

O engine deve possuir uma abstração de GPU.

O código de alto nível não deve depender diretamente de uma API específica.

A arquitetura deve permitir futuramente:

```text
Windows → DirectX
macOS   → Metal
Linux   → Vulkan
```

A implementação inicial pode priorizar uma plataforma e evoluir posteriormente.

---

# 15. Sistema de Camadas

Cada documento deve possuir uma stack de layers.

Tipos iniciais:

- Image Layer;
- Adjustment Layer;
- AI Layer;
- Group Layer.

Cada layer deve possuir:

```text
id
type
visible
opacity
blendMode
transform
mask
content
```

Exemplo:

```text
Layers

☀ Exposure
🧹 Object Removal
🌈 Color
👤 Portrait
📷 Original
```

Operações de IA devem poder gerar layers para manter o fluxo não destrutivo.

---

# 16. Máscaras

Máscaras são objetos de primeira classe do engine.

Devem suportar:

- máscara livre;
- máscara por IA;
- brush;
- erase;
- invert;
- feather;
- opacity.

Exemplo:

```text
Select Sky
    ↓
AI segmentation
    ↓
Mask
    ↓
Temperature +20
```

A máscara deve poder ser reutilizada por diferentes operações.

---

# 17. Seleção Inteligente

A IA deve permitir seleção de:

- pessoa;
- objeto;
- céu;
- fundo;
- primeiro plano.

Fluxo:

```text
User selects target
       ↓
AI segmentation
       ↓
Mask
       ↓
User edits/refines mask
```

Também deve existir um brush inteligente:

```text
User paints approximate area
          ↓
AI refines selection
          ↓
Final mask
```

---

# 18. Remoção de Objeto

Fluxo:

```text
Remove Object
      ↓
User paints object
      ↓
Generate mask
      ↓
Process
      ↓
Preview result
      ↓
Accept / Retry
```

Deve suportar:

- remoção simples;
- remoção de pessoas;
- remoção de fios;
- preenchimento inteligente;
- múltiplas tentativas.

O usuário deve conseguir comparar resultados.

---

# 19. Remover Fundo

Fluxo:

```text
Remove Background
       ↓
AI segmentation
       ↓
Background mask
       ↓
User refinement
```

Após remover:

```text
Background

○ Transparent
○ Color
○ Image
○ Blur
```

---

# 20. Substituir Fundo

O usuário pode substituir o fundo por:

- imagem local;
- cor;
- blur;
- background gerado.

Geração de background por IA deve ser tratada como experimental na V1.

---

# 21. Auto Enhance

A função `Improve Photo` deve analisar a imagem e gerar uma lista explícita de alterações.

Exemplo:

```text
Analysis complete

✓ Improve lighting
✓ Recover shadows
✓ Improve colors
✓ Reduce noise
✓ Increase details

[Apply]
```

A aplicação nunca deve aplicar alterações silenciosamente.

A IA deve gerar uma proposta de edição que o usuário pode revisar antes de aplicar.

---

# 22. Denoise

Deve existir uma ferramenta de redução de ruído com controles como:

- intensidade;
- preservação de detalhes.

Casos de uso:

- baixa luz;
- ISO alto;
- fotos antigas;
- JPEG muito comprimido.

---

# 23. Upscale

A ferramenta deve permitir:

- 2×;
- 4×;
- preservação de detalhes.

O processamento deve ocorrer em background.

---

# 24. Retrato

A V1 deve incluir ferramentas simples de retrato:

- detecção de rosto;
- suavização de pele;
- remoção de pequenas imperfeições;
- clareamento de dentes;
- melhoria dos olhos;
- iluminação do rosto;
- ajuste de fundo;
- blur de fundo.

Controles devem utilizar sliders.

Também deve existir:

```text
Auto
```

para aplicar uma configuração automática.

---

# 25. Presets

Presets devem existir desde o lançamento.

Categorias iniciais:

- cor;
- preto e branco;
- cinematográfico;
- retrato;
- paisagem.

O usuário deve poder:

- aplicar preset;
- criar preset;
- editar preset;
- salvar preset;
- excluir preset.

Presets devem armazenar parâmetros de edição, não imagens renderizadas.

---

# 26. RAW

Caso o público-alvo da V1 seja fotógrafo, RAW deve ser suportado.

O sistema deve utilizar uma biblioteca madura para decoding RAW.

Controles principais:

- exposição;
- white balance;
- highlights;
- shadows;
- tint;
- sharpening;
- noise reduction.

Se RAW não for prioridade no lançamento, deve ser tratado como milestone posterior.

---

# 27. Assistente de Edição

O assistente permite comandos em linguagem natural.

Exemplo:

```text
"Deixe a foto mais quente e com aparência cinematográfica."
```

Pipeline:

```text
User
 ↓
Local LLM
 ↓
Edit Plan
 ↓
Validation
 ↓
Image Engine
 ↓
Preview
```

O LLM não deve editar pixels diretamente.

O LLM deve produzir operações estruturadas.

Exemplo:

```json
{
  "operations": [
    {
      "type": "temperature",
      "value": 12
    },
    {
      "type": "contrast",
      "value": 8
    },
    {
      "type": "highlights",
      "value": -14
    },
    {
      "type": "saturation",
      "value": 4
    },
    {
      "type": "vignette",
      "value": 6
    }
  ]
}
```

O plano deve ser validado antes de ser enviado ao engine.

Nunca permitir execução arbitrária de código proveniente do LLM.

---

# 28. AI Model Manager

Modelos devem ser carregados sob demanda.

Exemplo:

```text
Application starts
       ↓
No AI model loaded

User clicks Remove Background
       ↓
Model Manager
       ↓
Load segmentation model
       ↓
Inference
```

O sistema deve controlar:

- descoberta dos modelos;
- carregamento;
- descarregamento;
- versão;
- memória;
- disponibilidade;
- erros.

---

# 29. Sistema de Projeto

O formato do projeto será:

```text
MyProject.myphoto
```

O projeto deve preservar o estado necessário para reabrir a edição posteriormente.

Estrutura conceitual:

```text
project/
├── original/
├── previews/
├── masks/
├── adjustments/
└── metadata/
```

A implementação pode utilizar um container próprio ou outra estratégia equivalente, desde que o formato seja versionável e robusto.

---

# 30. SQLite

SQLite será usado para dados estruturados da aplicação.

Exemplos:

```text
projects
recent_files
favorites
presets
history
metadata
settings
```

Imagens e arquivos grandes não devem ser armazenados diretamente no SQLite.

---

# 31. Undo / Redo

O histórico deve ser baseado em comandos/operações.

Exemplo:

```text
Crop
Exposure +0.25
Contrast +0.12
Mask Created
Object Removal
Temperature +10
```

Não armazenar uma cópia completa da imagem para cada estado.

Cada command deve possuir parâmetros suficientes para desfazer/refazer a operação.

---

# 32. Histórico

O usuário deve visualizar as alterações realizadas.

O histórico deve:

- registrar operações;
- permitir undo;
- permitir redo;
- sobreviver enquanto o projeto estiver aberto;
- integrar-se ao sistema de projeto quando necessário.

---

# 33. Antes / Depois

A interface deve oferecer comparação entre:

```text
Original
vs
Current Result
```

O usuário deve conseguir visualizar rapidamente a diferença sem destruir o estado atual.

---

# 34. Organização

A V1 terá organização simples.

Deve suportar:

- projetos;
- favoritos;
- recentes;
- busca por nome;
- histórico de projetos;
- thumbnails;
- copiar ajustes;
- colar ajustes.

Não implementar um catálogo fotográfico completo na V1.

---

# 35. IPC

O renderer deve utilizar uma API tipada para comunicação com Electron.

Exemplo conceitual:

```ts
interface PhotoEngine {
  openImage(path: string): Promise<ImageInfo>;
  saveProject(path: string): Promise<void>;
  loadProject(path: string): Promise<Project>;
  renderPreview(request: RenderRequest): Promise<Preview>;
  exportImage(request: ExportRequest): Promise<ExportResult>;
  runAi(request: AIRequest): Promise<AIResult>;
  cancelJob(jobId: string): Promise<void>;
}
```

A API IPC deve ser pequena, explícita e versionável.

---

# 36. Segurança

O Electron deve seguir uma arquitetura segura:

- `contextIsolation` habilitado;
- Node desabilitado no renderer;
- preload com API explícita;
- IPC validado;
- paths validados;
- dados do projeto validados;
- outputs do LLM validados por schema.

O renderer não deve possuir acesso arbitrário ao sistema operacional.

---

# 37. Autosave e Crash Recovery

O aplicativo deve realizar autosave do estado do projeto.

Em caso de crash:

```text
Application restarted
       ↓
Recovery detected
       ↓
Restore project
```

O autosave não deve substituir o arquivo principal de forma insegura.

---

# 38. Cache

O sistema deve possuir cache para:

- thumbnails;
- previews;
- máscaras processadas;
- resultados intermediários;
- modelos carregados quando apropriado.

O cache deve poder ser recriado sem perda do projeto.

---

# 39. Critérios de Performance

A V1 deve buscar:

- interação fluida com sliders;
- canvas responsivo;
- operações pesadas fora da UI;
- cancelamento de jobs;
- previews progressivos;
- uso eficiente de memória;
- carregamento lazy de modelos;
- renderização full resolution somente quando necessária.

Benchmarks devem ser criados para imagens pequenas, médias e grandes.

---

# 40. Testes

## C++

Testar:

- decoding;
- encoding;
- ajustes;
- transformações;
- compositing;
- masks;
- serialization;
- undo/redo;
- export;
- cancelamento de jobs.

## React

Testar:

- stores;
- panels;
- controls;
- layer interactions;
- history UI;
- IPC contracts.

## Integration

Testar:

```text
React
 ↓
Electron
 ↓
Native Engine
 ↓
Result
```

Também testar:

- abrir projeto;
- salvar projeto;
- recuperar projeto;
- exportar;
- executar IA;
- cancelar IA.

---

# 41. Milestones

## Milestone 1 — Image Engine

- abrir imagem;
- decode;
- canvas;
- zoom;
- pan;
- export;
- formatos básicos.

## Milestone 2 — Basic Editing

- crop;
- rotate;
- flip;
- resize;
- exposure;
- brightness;
- contrast;
- highlights;
- shadows;
- saturation;
- temperature.

## Milestone 3 — Document Model

- layers;
- masks;
- undo/redo;
- history;
- project;
- `.myphoto`;
- autosave.

## Milestone 4 — Performance

- preview pipeline;
- cache;
- background jobs;
- GPU acceleration;
- cancellation.

## Milestone 5 — AI

- smart selection;
- remove background;
- object removal;
- denoise;
- upscale;
- portrait;
- auto enhance.

## Milestone 6 — Assistant

- local LLM;
- edit plans;
- validation;
- operation execution.

## Milestone 7 — Polish

- presets;
- favorites;
- recent projects;
- metadata;
- export improvements;
- crash recovery;
- performance optimization.

---

# 42. Fora do Escopo da V1

Não implementar:

- edição de vídeo;
- colaboração;
- cloud storage;
- versão mobile;
- rede social;
- catálogo fotográfico completo;
- IA generativa extremamente sofisticada;
- treinamento de modelos;
- plugins;
- scripting;
- edição 3D;
- dezenas de filtros;
- suporte a todos os formatos RAW existentes.

O objetivo é evitar transformar a V1 em um clone completo do Photoshop.

---

# 43. Definition of Done

Uma feature só é considerada pronta quando:

1. possui implementação no domínio correto;
2. não bloqueia a UI;
3. possui tratamento de erro;
4. possui estado de loading quando necessário;
5. suporta cancelamento quando a operação for pesada;
6. integra-se ao histórico quando aplicável;
7. respeita a edição não destrutiva;
8. funciona corretamente após salvar/reabrir o projeto quando aplicável;
9. possui testes relevantes;
10. possui preview e comportamento aceitáveis em imagens de alta resolução.

---

# 44. Princípios Arquiteturais Finais

### 1. Não destrutivo por padrão

A imagem original nunca deve ser alterada durante a edição.

### 2. Native-first para processamento

Operações pesadas pertencem ao C++ engine.

### 3. UI desacoplada

React não deve conhecer detalhes internos do processamento de imagem.

### 4. IA como operação, não como mágica

IA deve produzir máscaras, parâmetros ou resultados controláveis pelo engine.

### 5. Offline-first

O editor deve funcionar sem internet sempre que a feature não depender de um serviço externo.

### 6. Performance como requisito

Performance não deve ser uma otimização feita somente no final.

### 7. Simplicidade na UX

Recursos complexos devem ser apresentados como ações simples.

### 8. Projetos versionáveis

O formato `.myphoto` deve ser pensado para evolução futura e compatibilidade.

### 9. Não implementar tudo

A V1 deve priorizar qualidade e experiência em vez de quantidade de funcionalidades.

---

# 45. Visão Final da Arquitetura

```text
                         PHOTO EDITOR
                              │
                ┌─────────────┴─────────────┐
                │                           │
             React                       Electron
                │                           │
                │                      File System
                │                      Projects
                │                      IPC
                │                      Lifecycle
                │                           │
                └─────────────┬─────────────┘
                              │
                       Native Bridge
                              │
                    ┌─────────▼─────────┐
                    │    C++ ENGINE     │
                    │                   │
                    │ Image Engine      │
                    │ Color Engine      │
                    │ Layer Engine      │
                    │ Mask Engine       │
                    │ GPU Engine        │
                    │ AI Engine         │
                    │ Project Engine    │
                    │ Export Engine     │
                    └─────────┬─────────┘
                              │
             ┌────────────────┼────────────────┐
             │                │                │
          CPU/GPU           AI             Storage
             │                │                │
         Rendering       Local Models      SQLite
         Processing      Segmentation      .myphoto
         Export          Inpainting        Cache
                         Denoise
                         Upscale
```

## Resultado esperado

A V1 deve resultar em um editor desktop que permita ao usuário:

```text
Abrir foto
    ↓
Editar
    ↓
Selecionar partes com IA
    ↓
Aplicar ajustes
    ↓
Remover objetos/fundo
    ↓
Melhorar foto
    ↓
Usar layers e masks
    ↓
Salvar projeto
    ↓
Reabrir depois
    ↓
Exportar
```

com uma experiência simples para iniciantes e uma base técnica suficientemente robusta para evoluir posteriormente para funcionalidades profissionais.
