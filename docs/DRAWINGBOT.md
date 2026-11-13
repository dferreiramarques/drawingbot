# DrawingBot

App para a CR-10 com MKS Gen V1.4 e firmware CR-10 Desenho / Marlin 2.1.2.

## Utilização

Abrir em Chrome ou Edge no computador ligado por USB (ou, com o Raspberry Pi, em `http://drawingbot.local` — ver `RASPBERRY-PI.md`) e escolher «Ligar máquina».
A app espera pelo arranque da placa a 115200 baud. Cada nova ligação invalida as referências:
fazer origem X/Y com caneta levantada, aproximar a ponta em passos de 0,1 mm e definir zero Z.
O botão define o contacto e levanta automaticamente a caneta. O suporte é flutuante: desenhar
normalmente a Z0, deixando a caneta assentar pelo peso.

Importar SVG, definir a espessura real do traço, posicionar e enviar. A pré-visualização e a
verificação de limites incluem o raio da tinta. Exportar G-code não inclui homing nem G92:
as referências têm de ser definidas no equipamento antes de executar o ficheiro por SD.

«Centro» mantém o eixo dos traços. «Por dentro» e «Por fora» deslocam contornos fechados em
metade da largura da ponta. Linhas abertas não são deslocadas. Contornos totalmente contidos
são tratados como recortes; sobreposições são unidas. Apenas os contornos são desenhados,
sem enchimento de áreas. Texto, imagens, símbolos SVG, recortes e efeitos devem ser convertidos
em caminhos simples no editor de origem. A espessura indicada deve ser medida no papel;
a marca nominal da ponta pode diferir do traço real.

Pausar e terminar deixam acabar movimentos já no planner e levantam a caneta. Emergência
envia M112 imediatamente e invalida as referências. M84 S0 mantém motores ativos; «Soltar
motores» liberta-os e exige novas referências. A cama fica desligada por defeito. O painel permite consultar a temperatura, pedir um alvo opcional
entre 0 e 60 °C e desligar o aquecimento. O desenho nunca espera pelo aquecimento.

No fim de um desenho completo (USB ou G-code exportado), a caneta sobe para Z10 mm.
Após confirmar o levantamento, Y avança até ao máximo configurado (300 mm por defeito),
sem alterar X. Pausar durante esta sequência mantém os 10 mm de folga.

## Instalação local

```
npm ci
npm test
npm run build
python -m http.server 8787 --directory dist --bind 127.0.0.1
```

Abrir http://localhost:8787 no Chrome/Edge e instalar pelo menu do navegador.
HTTPS ou localhost são necessários para USB e service worker. A PWA também pode ser instalada
a partir do Site publicado. As dependências estão incluídas no bundle; não são necessários CDNs
em funcionamento. Projetos e preferências são locais, as referências da máquina não são persistidas.

O modo «Experimentar sem ligar» simula o equipamento e nunca escreve numa porta USB.
Não executar outra aplicação serial em simultâneo. Desligar a sessão de diagnóstico Python
antes de selecionar a porta no navegador.

## Validação

Testes de geometria: raio da ponta, recortes, sobreposições, linhas abertas, contornos colapsados,
limites físicos da tinta e geração de G-code. Testes do protocolo: ACKs antigos, reinício, erros,
pausa/retoma e cancelamento. A validação em simulação não substitui o ensaio físico do navegador.

Referências: https://developer.chrome.com/docs/capabilities/serial
e https://github.com/junmer/clipper-lib/blob/master/Documentation.md

Clipper e svgpath conservam as respetivas licenças nos pacotes de origem e nos avisos do bundle.
