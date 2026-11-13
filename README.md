# DrawingBot

Conversão de uma CR-10 numa máquina de desenho com caneta flutuante.
Inclui a app DrawingBot, o servidor para Raspberry Pi e o firmware Marlin configurado para a máquina.

- **Página do projeto:** https://dferreiramarques.github.io/drawingbot/
- **Guia de montagem** (para replicar a máquina): [docs/GUIA.md](docs/GUIA.md), também em
  https://dferreiramarques.github.io/drawingbot/guia/
- **App:** https://dferreiramarques.github.io/drawingbot/app/

## Três formas de usar

| Modo | Onde corre | Ligação à CR-10 |
|---|---|---|
| **Online** | https://dferreiramarques.github.io/drawingbot/app/ (Chrome ou Edge) | USB ao computador (Web Serial) |
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
npm run build:site # site do GitHub Pages em dist-site/ (produto, guia, app e pacote do Pi)
```

Cada push para `main` corre os testes e publica no GitHub Pages a página do projeto, o guia, a app e o pacote do Pi
(`.github/workflows/pages.yml`). No Windows também é possível abrir `local/Abrir DrawingBot.cmd`
depois de `npm run build`.

## Funcionalidades

- Editor na própria mesa: retângulo, elipse, polígono, estrela, coração, linha e mão livre; mover, redimensionar e rodar; desfazer/refazer; vários objetos por desenho.
- Preenchimentos para qualquer forma fechada: cheio, linhas, quadriculado, ondas, ziguezague, concêntrico, espiral e pontos.
- Importação SVG (vários por desenho, também por arrastar para a mesa).
- Ferramenta de texto com 16 tipos de letra: **letra preenchida** (contorno e enchimento em ziguezague à medida da ponta) ou **linha única** (um só traço por letra, tipo escantilhão), com acentos portugueses.
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
- `public/`: HTML, CSS, ícones e service worker da app.
- `site/`: página do projeto e modelo do guia (o conteúdo do guia vem de `docs/GUIA.md`).
- `pi/`: servidor do Raspberry Pi, instalador, `drawingbot.txt` e serviços systemd.
- `tests/`: testes automáticos.
- `local/`: lançador Windows e servidor local, sem dependências Python externas.
- `firmware/`: Marlin, configuração e patch face à versão oficial.
- `docs/`: guia de montagem, utilização, Raspberry Pi e registo de validação.

## Licenças

O Marlin conserva a licença GPL e os avisos originais dentro da pasta do firmware.
Os avisos das bibliotecas de geometria estão em `public/THIRD-PARTY.txt` e `public/vendor/`.
O suporte da caneta é o [Pen Holder for Ender 3 / CR 10](https://www.thingiverse.com/thing:4721453) de umer3d (CC BY 4.0).
Os tipos de letra da ferramenta de texto (OFL 1.1 e Hershey) estão descritos em `public/fonts/README.txt`.
O pacote do Pi inclui `serialport` (MIT). Não é atribuída uma licença adicional ao código próprio.
