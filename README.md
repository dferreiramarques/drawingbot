# DrawingBot

Conversão de uma CR-10 numa máquina de desenho com canetas flutuantes.
Inclui a app DrawingBot, o servidor para Raspberry Pi e o firmware Marlin configurado para a máquina.

## Três formas de usar

| Modo | Onde corre | Ligação à CR-10 |
|---|---|---|
| **Online** | https://dferreiramarques.github.io/drawingbot/ (Chrome ou Edge) | USB ao computador (Web Serial) |
| **Raspberry Pi** | `http://drawingbot.local` em qualquer browser da rede | USB ao Pi Zero 2 W, que corre os desenhos sozinho |
| **Local** | `npm run build` e servir `dist/` em localhost | USB ao computador |

Sem máquina, «Experimentar sem ligar» simula o equipamento (modo online e local).

## Raspberry Pi (DrawingBot na rede)

Guia completo em [docs/RASPBERRY-PI.md](docs/RASPBERRY-PI.md). Resumo:

1. Gravar **Raspberry Pi OS Lite (64-bit)** com o Raspberry Pi Imager, com Wi-Fi e SSH.
2. Por SSH: `curl -fsSL https://dferreiramarques.github.io/drawingbot/pi/install.sh | sudo bash`
3. Abrir `http://drawingbot.local`. Os projetos são enviados para o Pi e desenhados por ele:
   o browser pode fechar sem interromper o desenho.
4. Wi-Fi, nome na rede e PIN ficam em `drawingbot.txt`, na raiz da partição `bootfs` do cartão SD,
   editável em qualquer computador.

## Desenvolvimento

Requisitos: Node.js 18+ e npm.

```sh
npm ci
npm test           # geometria, protocolo, máquina, servidor do Pi e drawingbot.txt
npm run build      # app em dist/
npm run pi:dev     # servidor do Pi em simulação: http://localhost:8790
npm run build:pi   # pacote do Pi em dist-pi/drawingbot-pi.tar.gz
```

Cada push para `main` corre os testes e publica a app e o pacote do Pi no GitHub Pages
(`.github/workflows/pages.yml`). No Windows também é possível abrir `local/Abrir DrawingBot.cmd`
depois de `npm run build`.

## Funcionalidades

- Importação SVG, tamanho, rotação e posição na cama.
- Espessura real da ponta; compensação de contornos por meia espessura, por dentro ou fora.
- Linhas abertas mantêm o eixo; texto e símbolos devem ser convertidos em caminhos.
- Controlo USB, origem X/Y, zero Z manual e suporte flutuante pelo peso da caneta.
- Pausa/retoma, terminação controlada e emergência M112.
- No fim de um desenho completo: levantar para Z10 mm, aguardar e levar Y ao máximo configurado.
- Exportação G-code, projetos JSON e cama opcional sem espera por aquecimento.
- Raspberry Pi: projetos guardados no Pi, desenho a correr no Pi, PIN opcional, configuração por ficheiro de texto.

O G-code exportado não faz homing nem define o zero: as referências são manuais.
Consultar [docs/DRAWINGBOT.md](docs/DRAWINGBOT.md) para os pormenores de utilização e limitações SVG.

## Firmware

Fontes completas configuradas em `firmware/Marlin-2.1.2/`.
Consultar `firmware/README.md` antes de compilar.
A app identifica a placa pelo nome de firmware `CR-10 Desenho`; esse nome mantém-se no firmware
para não obrigar a regravar a placa.

## Estrutura

- `src/`: app (geometria, SVG, protocolo Marlin, regras da máquina, cliente do Pi).
- `public/`: HTML, CSS, ícones e service worker.
- `pi/`: servidor do Raspberry Pi, instalador, `drawingbot.txt` e serviços systemd.
- `tests/`: testes automáticos.
- `local/`: lançador Windows e servidor local, sem dependências Python externas.
- `firmware/`: Marlin, configuração e patch face à versão oficial.
- `docs/`: utilização, Raspberry Pi e registo de validação.

## Licenças

O Marlin conserva a licença GPL e os avisos originais dentro da pasta do firmware.
Os avisos das bibliotecas de geometria estão em `public/THIRD-PARTY.txt` e `public/vendor/`.
O pacote do Pi inclui `serialport` (MIT). Não é atribuída uma licença adicional ao código próprio.
