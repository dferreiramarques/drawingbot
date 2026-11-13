# Guia de montagem do DrawingBot

Este guia explica como transformar uma Creality CR-10 numa máquina de desenho com caneta
flutuante, igual à do projeto. Ao fim tens uma máquina que desenha ficheiros SVG em papel,
controlada pelo browser por USB ou, com um Raspberry Pi, pela rede de casa.

> **Tempo estimado:** um fim de semana. Imprimir o suporte demora umas horas, a montagem
> mecânica uma tarde e o firmware cerca de uma hora.
>
> **Nível:** confortável a desmontar a cabeça de uma impressora 3D e a gravar firmware
> numa placa compatível com Arduino.

## 1. Como funciona

- A CR-10 perde o hotend. No lugar dele fica um **suporte de caneta flutuante**: a caneta
  desliza na vertical sobre rolamentos e assenta no papel **pelo próprio peso**.
- O eixo Z só aproxima a caneta do papel. Como a caneta flutua, pequenas irregularidades
  da mesa ou do papel não deixam marcas de pressão nem partem a ponta.
- Um firmware Marlin próprio (`CR-10 Desenho`) tira o hotend e a extrusão, faz origem só em X/Y
  e deixa o zero Z para ser definido à mão, com a ponta a tocar no papel.
- A app DrawingBot importa o SVG, compensa a espessura real da ponta, mostra o desenho à escala
  e envia-o para a máquina.

## 2. Material

### Máquina e eletrónica

| Peça | Notas |
|---|---|
| Creality CR-10 (300 × 300 mm) | Outras máquinas cartesianas com Marlin servem, mas a configuração tem de ser adaptada. |
| Placa **MKS Gen V1.4** (ATmega2560) | É a placa para a qual o firmware está configurado. |
| 3 drivers **TMC2208** em modo STEP/DIR (standalone) | X, Y e Z. O segundo motor Z usa a saída E1. |
| Cabo USB da placa ao computador ou ao Pi | |

### Suporte da caneta (impresso)

Usamos o **[Pen Holder for Ender 3 / Ender 3 pro / CR 10 / Ender 5](https://www.thingiverse.com/thing:4721453)**
de **umer3d** (licença CC BY), na versão deslizante:

| Ficheiro | Quantidade |
|---|---|
| `back_part.stl`: peça fixa ao carro do eixo X | 1 |
| `pen_part.stl`: peça que segura a caneta e desliza | 1 |
| `bolt.stl`: parafuso que aperta a caneta | 1 |

| Ferragens | Quantidade |
|---|---|
| Parafusos M3 | 4 |
| Porcas M3 | 8 |
| Rolamentos de ranhura em V pequenos, 12 mm de diâmetro exterior e furo de 3 mm | 4 |

Sugestão de impressão (não é do autor): PLA ou PETG, camada de 0,2 mm, 3 paredes, 25 % de enchimento.
A peça `pen_part` tem de deslizar sem folga lateral nem prender.

### Para desenhar

- Canetas ou marcadores de corpo cilíndrico que caibam no suporte.
- Papel e molas ou fita de papel para o prender à mesa.
- Opcional: a cama aquecida da CR-10 ajuda a secar tintas à base de água nos preenchimentos.
  Vê [quando usar a cama](DRAWINGBOT.md#cama-aquecida-quando-usar).

### Opcional: controlo pela rede

- Raspberry Pi Zero 2 W, cartão microSD, fonte de 5 V 2,5 A e adaptador OTG micro-USB → USB-A.
  O processo está em [RASPBERRY-PI.md](RASPBERRY-PI.md).

## 3. Imprimir e montar o suporte

1. Imprime as três peças da versão deslizante (`back_part`, `pen_part`, `bolt`).
2. Monta os **4 rolamentos em V** na peça que desliza, com os parafusos e porcas M3,
   seguindo as fotos e o modelo Fusion 360 do autor no Thingiverse.
3. Verifica que a `pen_part` desliza na `back_part` só pelo peso: deve descer sozinha
   e subir com um toque leve. Se prender, alivia o aperto dos rolamentos.

## 4. Retirar o hotend e montar o suporte

> Desliga a impressora da corrente antes de mexer na cabeça.

1. Retira a cobertura e o conjunto do hotend do carro do eixo X: bloco, cartucho de
   aquecimento, termístor e ventoinhas.
2. Desliga e isola os cabos do aquecedor e do termístor do hotend. O firmware de desenho
   não usa o hotend nem o extrusor.
3. Aparafusa a `back_part` ao carro do eixo X nos furos onde estava o hotend.
4. Encaixa a `pen_part` com a caneta e aperta-a com o `bolt`. A ponta deve ficar uns
   milímetros abaixo do ponto mais baixo do carro.
5. Move os eixos à mão para confirmar que nada bate nos extremos. Se o suporte limitar o
   alcance, reduz a área útil na app (Área útil e diagnóstico).

## 5. Placa e firmware

O firmware está em [`firmware/Marlin-2.1.2`](../firmware/), já configurado. O que muda face
ao Marlin oficial está em [`firmware/plotter-v0.1.patch`](../firmware/plotter-v0.1.patch) e
resumido em [firmware/README.md](../firmware/README.md):

- X/Y com 80 passos/mm, Z com 400 passos/mm.
- Drivers TMC2208 standalone; segundo Z na saída E1 (STEP 36, DIR 34, ENABLE 30).
- Hotend e extrusão removidos; cama disponível mas desligada por defeito.
- Origem automática só em X/Y. `G28 Z` é recusado e não há fim de curso Z.
- Nome do firmware: `CR-10 Desenho`. A app usa este nome para reconhecer a placa.

### Compilar e gravar

1. Instala o [PlatformIO](https://platformio.org/install/cli) (ou a extensão do VS Code).
2. Compila:
   ```sh
   pio run -d firmware/Marlin-2.1.2 -e mega2560
   ```
3. Liga a placa por USB e grava (no Windows a porta é `COM3`, `COM4`…; no Linux `/dev/ttyUSB0`):
   ```sh
   pio run -d firmware/Marlin-2.1.2 -e mega2560 -t upload --upload-port COM3
   ```

> Antes de gravar, guarda a configuração atual da tua máquina (por exemplo com `M503` num terminal
> série) para poderes voltar atrás.

### Outra máquina ou outra placa

Se a tua máquina não for igual, ajusta em `Configuration.h` e `Configuration_adv.h`:
`MOTHERBOARD`, os passos por mm, a inversão dos eixos, o tamanho da mesa (`X_BED_SIZE`,
`Y_BED_SIZE`) e os drivers. Mantém `CUSTOM_MACHINE_NAME "CR-10 Desenho"`, senão a app recusa a ligação.

## 6. Primeiro desenho

1. Abre a app em <https://dferreiramarques.github.io/drawingbot/app/> no **Chrome ou Edge**,
   num computador ligado à placa por USB.
2. Prende uma folha à mesa e escolhe «Ligar máquina». A app espera pelo arranque da placa.
3. **Origem X/Y:** com a caneta levantada, X e Y procuram os fins de curso.
4. **Contacto da caneta:** desce o Z em passos de 0,1 mm até a ponta tocar levemente no papel
   e escolhe «Definir zero Z». A caneta levanta sozinha.
5. Desenha na mesa ou importa um SVG (ou usa o exemplo), indica a espessura real do traço e a posição, e escolhe «Desenhar».
6. No fim a caneta sobe 10 mm e a mesa vem para a frente, para tirares o papel.

Para não depender do computador, monta o Raspberry Pi: os desenhos ficam guardados no Pi e
correm mesmo com o browser fechado. Vê [RASPBERRY-PI.md](RASPBERRY-PI.md).

## 7. Preparar ficheiros SVG

- A app desenha **contornos e linhas**, sem preenchimento.
- Converte **texto em caminhos** (Inkscape: *Caminho → Objeto para caminho*).
- Imagens em bitmap não são desenhadas: vetoriza-as antes (Inkscape: *Caminho → Vetorizar bitmap*).
- Mede a espessura real do traço no papel: é ela que a app usa para compensar contornos
  por dentro ou por fora.
- Mais pormenores em [DRAWINGBOT.md](DRAWINGBOT.md).

## 8. Problemas comuns

| Sintoma | Causa provável |
|---|---|
| «A placa não tem o firmware de desenho» | O nome do firmware não é `CR-10 Desenho`. Grava o firmware deste projeto. |
| A porta USB não aparece no browser | Usa Chrome ou Edge e fecha outros programas que usem a porta (Cura, Pronterface…). |
| Traços falhados | A caneta não chega ao papel: define o zero Z outra vez ou baixa «Desenhar Z» em 0,1 mm. |
| Linhas tremidas ou duplas | Folga nos rolamentos do suporte ou caneta mal apertada. |
| Um eixo anda ao contrário | Ajusta `INVERT_X_DIR`, `INVERT_Y_DIR` ou `INVERT_Z_DIR` no firmware. |
| O desenho sai fora do papel | Confirma o formato e a posição do papel nas definições «Papel e velocidade». |

## 9. Créditos e licenças

- Suporte da caneta: [Pen Holder for Ender 3 / CR 10](https://www.thingiverse.com/thing:4721453),
  de umer3d, licença [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- Firmware: [Marlin](https://marlinfw.org/), licença GPL, com os avisos originais na pasta `firmware/`.
- Bibliotecas de geometria: Clipper e svgpath, com as licenças em `public/THIRD-PARTY.txt`.
