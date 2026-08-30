# Espinho: inferência local

Programa isolado, fora do engine, para responder quatro perguntas antes de o
Milestone 3 desenhar camadas e máscaras em cima de suposições:

1. O ONNX Runtime linka e roda nesta stack?
2. Quanto custa carregar um modelo e rodar uma inferência?
3. Qual o pico de memória, somado ao que o buffer de trabalho já ocupa?
4. Que forma tem a máscara que sai — e o que isso implica para o `Mask` do engine?

Não faz parte do build do produto. Se as respostas forem boas, o que volta daqui
é conhecimento, não código.

## Licenças

| Componente | Licença |
|---|---|
| ONNX Runtime 1.28.1 (binário oficial win-x64) | MIT |
| U²-Net / U²-Netp (pesos) | Apache-2.0 |

Restrição deliberada: só modelos com licença permissiva. Os modelos de remoção
de fundo mais conhecidos — MODNet, RMBG-1.4, ISNet — são não-comerciais e estão
fora, porque a V1 precisa ser comercialmente viável.

## Rodar

```bat
spikes\ai\build.bat
spikes\ai\run.bat
```

Não baixa nada: espera o runtime em `.tooling\onnxruntime` e os modelos em
`.tooling\models`. A entrada é RGBA cru, porque o espinho não decodifica nada —
a pergunta é sobre o runtime, não sobre formatos.

## Resultados

Medido numa foto de 2,2 MP, CPU, sem GPU.

| | u2netp (4,4 MB) | u2net (168 MB) |
|---|---|---|
| carregar modelo | 92 ms | 711 ms |
| pré-processar | 16 ms | 17 ms |
| **inferência** | **282 ms** | **566 ms** |
| pós-processar | 28 ms | 26 ms |
| pico de memória | 515 MB | 845 MB |

### O que isso responde

**1. Roda.** ONNX Runtime 1.28.1 com MSVC 2019 e CRT dinâmico. Os únicos
percalços foram ordem de include e `NOMINMAX`.

**2. A inferência não escala com o tamanho da foto.** O modelo sempre vê
320×320, venha a imagem de 2 MP ou de 50. Isso inverte a economia do resto do
engine, onde tudo é proporcional a megapixels. O que escala é levar a máscara de
volta à resolução plena — e isso é código nosso, otimizável.

**3. Memória é a restrição de verdade.** 515 MB para o modelo pequeno, 845 MB
para o completo, *além* do buffer de trabalho: uma foto de 24 MP já ocupa 192 MB
a 8 bytes por pixel. Uma remoção de fundo numa foto grande beira 1 GB. O
gerenciador de modelos da §28 precisa descarregar com agressividade, e a fila de
jobs precisa de um orçamento de memória, não só de um contador de workers.

**4. A máscara é alfa contínuo, não seleção binária.** No modelo completo, 7% dos
pixels caem em valores intermediários — as bordas são genuinamente suaves. O
`Mask` do engine tem que ser um canal único contínuo, e o feather e o opacity da
§16 operam nele naturalmente. O desenho da spec se confirma.

### O que isso não responde

**Qualidade.** O sujeito de teste é sintético, e os dois modelos acharam a cabeça
mas quase ignoraram o corpo — comportamento esperado de um detector de saliência
diante de uma silhueta chapada. Julgar qualidade exige fotografias de verdade.

**GPU.** O vcpkg tem `onnxruntime-gpu` e a máquina tem NVIDIA. Não medido.
